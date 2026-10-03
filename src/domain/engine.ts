import type {
  AnomalyTicket,
  Channel,
  DevicePacket,
  IngestEvent,
  OfflineDraft,
  Reading,
  SamplingTask,
  ServerState,
  ThresholdVersion,
  User,
  Verdict,
} from "./types";
import { CHANNELS } from "./seed";

// ---------- 工具 ----------

export function currentThreshold(state: ServerState): ThresholdVersion {
  return state.thresholds[state.thresholds.length - 1];
}

export function packetKey(deviceSn: string, seq: number): string {
  return `${deviceSn}#${seq}`;
}

export function draftKey(clientDraftId: string): string {
  return `draft#${clientDraftId}`;
}

function nextEventId(state: ServerState): string {
  return `E-${String(state.counters.event + 1).padStart(4, "0")}`;
}

function log(
  state: ServerState,
  ev: Omit<IngestEvent, "id" | "at"> & { at?: string },
): ServerState {
  const event: IngestEvent = {
    id: nextEventId(state),
    at: ev.at ?? new Date().toISOString(),
    kind: ev.kind,
    message: ev.message,
    deviceSn: ev.deviceSn,
    seq: ev.seq,
    roomId: ev.roomId,
  };
  return { ...state, counters: { event: state.counters.event + 1 }, events: [...state.events, event] };
}

/** 按某阈值版本判定读数：返回结论与超限通道 */
export function evaluate(
  counts: Record<Channel, number>,
  grade: Reading["grade"],
  threshold: ThresholdVersion,
): { verdict: Verdict; overChannels: Channel[] } {
  const row = threshold.limits[grade];
  const overChannels = CHANNELS.filter((ch) => {
    const limit = row[ch];
    return limit > 0 && counts[ch] > limit;
  });
  return { verdict: overChannels.length > 0 ? "over" : "ok", overChannels };
}

/**
 * 按采样时间定位班次（夜班跨零点：20:00–次日08:00 归属前一日）。
 * 以时间戳自带偏移量对应的「墙上时钟」为准，避免服务端运行时区（如 UTC）影响判定。
 */
function resolveShift(
  state: ServerState,
  roomId: string,
  sampledAt: string,
): { shiftId: string; date: string } {
  void roomId;
  const { wall, date } = wallClock(sampledAt);
  const hour = wall.getUTCHours();

  const day = state.shifts.find((s) => s.startHour < s.endHour);
  const night = state.shifts.find((s) => s.startHour > s.endHour);

  let shift = day ?? state.shifts[0];
  let resultDate = date;
  if (night && hour < night.endHour) {
    shift = night; // 凌晨（如 0-8 点）归属前一天夜班
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    resultDate = localDate(d);
  } else if (night && hour >= night.startHour) {
    shift = night; // 当日晚间（如 20-24 点）
  }
  return { shiftId: shift.id, date: resultDate };
}

/** 从 ISO8601 字符串解析其偏移量对应的本地挂钟时间与 YYYY-MM-DD */
function wallClock(iso: string): { wall: Date; date: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(iso);
  if (!m) {
    const d = new Date(iso);
    return { wall: d, date: localDate(d) };
  }
  const [, y, mo, da, h, mi, se] = m;
  const offsetRaw = m[8];
  let offMin = 0;
  if (offsetRaw && offsetRaw !== "Z") {
    const sign = offsetRaw.startsWith("-") ? -1 : 1;
    const oh = Number(offsetRaw.slice(1, 3));
    const om = Number(offsetRaw.slice(3).replace(":", "") || "0");
    offMin = sign * (oh * 60 + om);
  }
  const utcMs = Date.UTC(+y, +mo - 1, +da, +h, +mi, se ? +se : 0) - offMin * 60000;
  const shifted = new Date(utcMs + offMin * 60000); // getUTC* 读出的就是挂钟值
  return { wall: shifted, date: `${y}-${mo}-${da}` };
}

/** 本地时区 YYYY-MM-DD（避免 toISOString 按 UTC 跨天） */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// ---------- 任务合并（按房间 × 班次 × 日期） ----------

function mergeIntoTask(
  state: ServerState,
  roomId: string,
  sampledAt: string,
  source: "online" | "manual",
): {
  state: ServerState;
  task: SamplingTask;
  merged: boolean;
} {
  const { shiftId, date } = resolveShift(state, roomId, sampledAt);
  const existing = state.tasks.find(
    (t) => t.roomId === roomId && t.shiftId === shiftId && t.date === date && t.status === "pending",
  );
  if (existing) {
    // 在线与补录进入同一任务（两者首次相遇）→ 标记为 merged
    const willMerge = existing.source === "merged" || existing.source !== source;
    return { state, task: existing, merged: willMerge };
  }

  // 同房间班次已签认后又来新事实：不污染冻结结果，另开一条待复核任务
  const historyCount = state.tasks.filter(
    (t) => t.roomId === roomId && t.shiftId === shiftId && t.date === date,
  ).length;
  const task: SamplingTask = {
    id: `T-${roomId}-${shiftId}-${date}${historyCount ? `-r${historyCount + 1}` : ""}`,
    roomId,
    shiftId,
    date,
    source,
    readingIds: [],
    status: "pending",
  };
  return {
    state: { ...state, tasks: [...state.tasks, task] },
    task,
    merged: false,
  };
}

// ---------- 工单幂等 ----------

function upsertTicketForReading(state: ServerState, reading: Reading): ServerState {
  const key = reading.seq === null ? draftKey(reading.clientDraftId!) : packetKey(reading.deviceSn, reading.seq);
  const existing = state.tickets.find((t) => t.idempotencyKey === key);
  if (existing) {
    // 同幂等键永远只有一张工单：需要时更新状态/依据，绝不新建第二张
    if (reading.overChannels.length === 0) return state;
    const tickets = state.tickets.map((t) =>
      t === existing
        ? {
            ...t,
            basisVersion: reading.basisVersion,
            overChannels: reading.overChannels,
            counts: reading.counts,
          }
        : t,
    );
    return { ...state, tickets };
  }
  if (reading.overChannels.length === 0) return state;
  const ticket: AnomalyTicket = {
    id: `TK-${key.replace("#", "-")}`,
    idempotencyKey: key,
    roomId: reading.roomId,
    taskId: reading.taskId,
    readingId: reading.id,
    deviceSn: reading.deviceSn,
    seq: reading.seq,
    status: "open",
    basisVersion: reading.basisVersion,
    overChannels: reading.overChannels,
    counts: reading.counts,
    audit: [
      {
        at: new Date().toISOString(),
        action: "created",
        basisVersion: reading.basisVersion,
        detail: `通道 ${reading.overChannels.join("/")}µm 超出 v${reading.basisVersion} 限值`,
      },
    ],
  };
  return { ...state, tickets: [...state.tickets, ticket] };
}

// ---------- 设备报文入库（乱序、重发、归零都走这里） ----------

export function ingestPacket(prev: ServerState, packet: DevicePacket): ServerState {
  const key = packetKey(packet.deviceSn, packet.seq);

  // 1) 幂等：同一设备序号重发 → 仅留痕，不产生读数、不产生工单
  if (prev.readings.some((r) => r.deviceSn === packet.deviceSn && r.seq === packet.seq)) {
    return log(prev, {
      kind: "duplicate",
      message: `设备 ${packet.deviceSn} 序号 #${packet.seq} 重发，已忽略（幂等键 ${key}），不生成第二张工单`,
      deviceSn: packet.deviceSn,
      seq: packet.seq,
    });
  }

  const device = prev.devices.find((d) => d.sn === packet.deviceSn);
  if (!device) throw new Error(`未知设备 ${packet.deviceSn}`);
  let state = prev;

  // 2) 片段：计数器归零 → 开启新片段；没有片段也开首段
  let segment = [...state.segments].reverse().find((s) => s.deviceSn === packet.deviceSn);
  if (packet.reset || !segment) {
    segment = {
      id: `SG-${packet.deviceSn}-${state.segments.filter((s) => s.deviceSn === packet.deviceSn).length + 1}`,
      deviceSn: packet.deviceSn,
      roomId: device.roomId,
      openedAt: packet.sampledAt,
      openedBySeq: packet.seq,
      reason: state.segments.some((s) => s.deviceSn === packet.deviceSn) ? "reset" : "first",
    };
    state = { ...state, segments: [...state.segments, segment] };
    state = log(state, {
      kind: "segment",
      message:
        segment.reason === "reset"
          ? `设备 ${packet.deviceSn} 计数器归零（#${packet.seq}），开启新片段 ${segment.id}，计数从小重新累计不判异常`
          : `设备 ${packet.deviceSn} 开启首个计数片段 ${segment.id}`,
      deviceSn: packet.deviceSn,
      seq: packet.seq,
      roomId: device.roomId,
      at: packet.sampledAt,
    });
  }

  // 3) 段内下降检测：只与同片段中序号更小的最近一条比较（兼容乱序到达）
  const prior = state.readings
    .filter((r) => r.segmentId === segment!.id && r.seq !== null && r.seq! < packet.seq)
    .sort((a, b) => b.seq! - a.seq!)[0];
  const dropChannels = prior
    ? CHANNELS.filter((ch) => packet.counts[ch] < prior.counts[ch])
    : [];
  if (dropChannels.length) {
    state = log(state, {
      kind: "drop",
      message: `设备 ${packet.deviceSn} #${packet.seq} 通道 ${dropChannels.join("/")}µm 计数较 #${prior.seq} 下降（同片段内），仅记录事实、不开工单`,
      deviceSn: packet.deviceSn,
      seq: packet.seq,
      roomId: device.roomId,
      at: packet.sampledAt,
    });
  }

  // 4) 汇入/合并采样任务（按房间 × 班次 × 日期）
  const taskMerge = mergeIntoTask(state, device.roomId, packet.sampledAt, "online");
  state = taskMerge.state;
  const task = taskMerge.task;
  // 仅当本任务此前是单一来源、此刻首次与另一来源相遇，才记一条合并事件
  const becomesMerged = taskMerge.merged && task.source !== "merged";

  // 5) 按当前阈值版本判定（待复核读数；设备戳记版本仅作事实留档）
  const basis = currentThreshold(state);
  const grade = roomGrade(state, device.roomId);
  const { verdict, overChannels } = evaluate(packet.counts, grade, basis);
  const reading: Reading = {
    id: `R-${key}`,
    deviceSn: packet.deviceSn,
    seq: packet.seq,
    roomId: device.roomId,
    taskId: task.id,
    segmentId: segment.id,
    source: "online",
    sampledAt: packet.sampledAt,
    receivedAt: new Date().toISOString(),
    counts: packet.counts,
    grade,
    stampedVersion: packet.stampedVersion,
    basisVersion: basis.version,
    verdict,
    overChannels,
    reviewState: "pending",
    dropChannels: dropChannels.length ? dropChannels : undefined,
  };

  state = {
    ...state,
    readings: [...state.readings, reading],
    tasks: state.tasks.map((t) =>
      t.id === task.id
        ? {
            ...t,
            readingIds: [...t.readingIds, reading.id],
            source: taskMerge.merged ? ("merged" as const) : t.source,
          }
        : t,
    ),
  };
  if (becomesMerged) {
    state = log(state, {
      kind: "merge",
      message: `房间 ${device.roomId} 在线读数与断网补录合并进任务 ${task.id}`,
      roomId: device.roomId,
      at: packet.sampledAt,
    });
  }

  // 6) 超限才开工单（幂等）；段内下降不算异常
  if (overChannels.length) {
    state = upsertTicketForReading(state, reading);
    state = log(state, {
      kind: "ticket",
      message: `设备 ${packet.deviceSn} #${packet.seq} 在 ${device.roomId} 超限（${overChannels.join("/")}µm），依据 v${basis.version}，工单幂等键 ${key}`,
      deviceSn: packet.deviceSn,
      seq: packet.seq,
      roomId: device.roomId,
    });
  }
  return state;
}

function roomGrade(state: ServerState, roomId: string): Reading["grade"] {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) throw new Error(`未知房间 ${roomId}`);
  return room.grade;
}

// ---------- 断网手工补录草稿 ----------

export function submitDraft(prev: ServerState, draft: OfflineDraft): ServerState {
  const key = draftKey(draft.clientDraftId);
  if (prev.readings.some((r) => r.clientDraftId === draft.clientDraftId)) {
    return log(prev, {
      kind: "duplicate",
      message: `补录草稿 ${draft.clientDraftId} 重复提交，已忽略`,
      seq: null,
      roomId: draft.roomId,
    });
  }

  let state = prev;
  const taskMerge = mergeIntoTask(state, draft.roomId, draft.sampledAt, "manual");
  state = taskMerge.state;
  const task = taskMerge.task;
  const becomesMerged = taskMerge.merged && task.source !== "merged";

  const basis = currentThreshold(state);
  const grade = roomGrade(state, draft.roomId);
  const { verdict, overChannels } = evaluate(draft.counts, grade, basis);
  const reading: Reading = {
    id: `R-${key}`,
    deviceSn: "MANUAL",
    seq: null,
    roomId: draft.roomId,
    taskId: task.id,
    source: "manual",
    sampledAt: draft.sampledAt,
    receivedAt: new Date().toISOString(),
    counts: draft.counts,
    grade,
    stampedVersion: draft.stampedVersion,
    basisVersion: basis.version,
    verdict,
    overChannels,
    reviewState: "pending",
    clientDraftId: draft.clientDraftId,
  };
  state = {
    ...state,
    readings: [...state.readings, reading],
    tasks: state.tasks.map((t) =>
      t.id === task.id
        ? {
            ...t,
            readingIds: [...t.readingIds, reading.id],
            source: taskMerge.merged ? ("merged" as const) : t.source,
          }
        : t,
    ),
  };
  state = log(state, {
    kind: "draft-flushed",
    message: `巡检员 ${draft.operator} 的断网补录 ${draft.clientDraftId} 已按房间合并进任务 ${task.id}${
      becomesMerged ? "（在线 + 补录）" : ""
    }`,
    roomId: draft.roomId,
    seq: null,
  });
  if (becomesMerged) {
    state = log(state, {
      kind: "merge",
      message: `房间 ${draft.roomId} 断网补录与在线读数合并进任务 ${task.id}`,
      roomId: draft.roomId,
      seq: null,
      at: draft.sampledAt,
    });
  }
  if (overChannels.length) {
    state = upsertTicketForReading(state, reading);
    state = log(state, {
      kind: "ticket",
      message: `补录 ${draft.clientDraftId} 在 ${draft.roomId} 超限（${overChannels.join("/")}µm），依据 v${basis.version}，工单幂等键 ${key}`,
      roomId: draft.roomId,
      seq: null,
    });
  }
  return state;
}

// ---------- 阈值发布：待复核立即重算，已签认冻结 ----------

export function publishThreshold(prev: ServerState, next: ThresholdVersion): ServerState {
  if (next.version !== currentThreshold(prev).version + 1) {
    throw new Error("阈值版本必须递增");
  }
  let state: ServerState = { ...prev, thresholds: [...prev.thresholds, next] };

  for (const reading of state.readings) {
    // 已签认结果保留当时依据，不重算
    if (reading.reviewState === "signed") continue;

    const { verdict, overChannels } = evaluate(reading.counts, reading.grade, next);
    const updated: Reading = {
      ...reading,
      verdict,
      overChannels,
      basisVersion: next.version,
    };
    state = {
      ...state,
      readings: state.readings.map((r) => (r.id === reading.id ? updated : r)),
    };

    const key =
      reading.seq === null ? draftKey(reading.clientDraftId!) : packetKey(reading.deviceSn, reading.seq);
    const ticket = state.tickets.find((t) => t.idempotencyKey === key);
    if (overChannels.length) {
      if (ticket) {
        if (ticket.status === "revoked") {
          state = {
            ...state,
            tickets: state.tickets.map((t) =>
              t.id === ticket.id
                ? {
                    ...t,
                    status: "open",
                    basisVersion: next.version,
                    overChannels,
                    counts: reading.counts,
                    audit: [
                      ...t.audit,
                      {
                        at: new Date().toISOString(),
                        action: "reopened",
                        basisVersion: next.version,
                        detail: `v${next.version} 重算后再次超限（同一序号，复用原工单，不新建）`,
                      },
                    ],
                  }
                : t,
            ),
          };
          state = log(state, {
            kind: "ticket-reopen",
            message: `工单 ${ticket.id} 依据 v${next.version} 重算后重新开启（幂等键 ${key}）`,
            deviceSn: reading.deviceSn,
            seq: reading.seq,
            roomId: reading.roomId,
          });
        } else if (ticket.status === "open") {
          // 仍超限：刷新依据，沿用同一张工单
          state = {
            ...state,
            tickets: state.tickets.map((t) =>
              t.id === ticket.id
                ? {
                    ...t,
                    basisVersion: next.version,
                    overChannels,
                    counts: reading.counts,
                    audit: [
                      ...t.audit,
                      {
                        at: new Date().toISOString(),
                        action: "updated",
                        basisVersion: next.version,
                        detail: `v${next.version} 重算后仍然超限（同一序号，更新依据，不新建工单）`,
                      },
                    ],
                  }
                : t,
            ),
          };
        }
        // 已关闭工单：处置是历史事实，不因重算而翻案
      } else {
        // 旧版本下不超限、新版本下才超限：此刻幂等地补开唯一一张工单
        state = upsertTicketForReading(state, updated);
        state = log(state, {
          kind: "ticket",
          message: `v${next.version} 重算使 ${key} 首次超限，补开工单`,
          deviceSn: reading.deviceSn,
          seq: reading.seq,
          roomId: reading.roomId,
        });
      }
    } else if (ticket && ticket.status === "open") {
      state = {
        ...state,
        tickets: state.tickets.map((t) =>
          t.id === ticket.id
            ? {
                ...t,
                status: "revoked",
                basisVersion: next.version,
                overChannels: [],
                audit: [
                  ...t.audit,
                  {
                    at: new Date().toISOString(),
                    action: "revoked",
                    basisVersion: next.version,
                    detail: `v${next.version} 重算后不再超限，工单撤销（读数仍保留）`,
                  },
                ],
              }
            : t,
        ),
      };
      state = log(state, {
        kind: "ticket-revoke",
        message: `工单 ${ticket.id} 依据 v${next.version} 重算达标，已撤销`,
        deviceSn: reading.deviceSn,
        seq: reading.seq,
        roomId: reading.roomId,
      });
    }
  }

  return log(state, {
    kind: "recompute",
    message: `阈值 v${next.version} 已发布：待复核读数立即重算；已签认结果保留原依据`,
  });
}

// ---------- 签认：班组长只能签认本班房间；审计员只读 ----------

export class PermissionError extends Error {}

export function signTask(prev: ServerState, taskId: string, user: User): ServerState {
  if (user.role !== "leader") {
    throw new PermissionError("仅班组长可签认；审计员只查看事实");
  }
  const task = prev.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("任务不存在");
  if (task.status === "signed") throw new PermissionError("任务已签认，依据已冻结");
  if (user.shiftId !== task.shiftId) {
    throw new PermissionError("班组长只能签认本班次的房间任务");
  }

  // 冻结：逐条固定读数的判定依据（签认后阈值改动不再重算它们）；
  // 任务级记录签认时刻的当前阈值，作为整批签认的版本注记
  const basisVersion = currentThreshold(prev).version;
  const taskReadingIds = new Set(
    prev.tasks.find((t) => t.id === taskId)!.readingIds,
  );
  let state: ServerState = {
    ...prev,
    tasks: prev.tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: "signed" as const, signedAt: new Date().toISOString(), signedBy: user.id, basisVersion }
        : t,
    ),
    readings: prev.readings.map((r) =>
      taskReadingIds.has(r.id)
        ? { ...r, reviewState: "signed" as const }
        : r,
    ),
  };
  const basisList = Array.from(new Set(prev.readings.filter((r) => taskReadingIds.has(r.id)).map((r) => r.basisVersion)));
  return log(state, {
    kind: "sign",
    message: `${user.name} 签认任务 ${taskId}（${task.roomId}），结论依据已冻结（读数依据 v${basisList.join("/")}，签认时当前阈值 v${basisVersion}）`,
    roomId: task.roomId,
  });
}

export function closeTicket(prev: ServerState, ticketId: string, user: User): ServerState {
  if (user.role !== "engineer" && user.role !== "leader") {
    throw new PermissionError("无工单关闭权限");
  }
  const ticket = prev.tickets.find((t) => t.id === ticketId);
  if (!ticket || ticket.status !== "open") return prev;
  let state: ServerState = {
    ...prev,
    tickets: prev.tickets.map((t) =>
      t.id === ticketId
        ? {
            ...t,
            status: "closed" as const,
            audit: [
              ...t.audit,
              {
                at: new Date().toISOString(),
                action: "closed" as const,
                basisVersion: t.basisVersion,
                detail: `${user.name} 现场处置完成并关闭`,
              },
            ],
          }
        : t,
    ),
  };
  return log(state, {
    kind: "ticket-close",
    message: `工单 ${ticketId} 已由 ${user.name} 关闭`,
    roomId: ticket.roomId,
  });
}
