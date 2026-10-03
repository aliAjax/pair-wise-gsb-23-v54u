import { activeThreshold, evaluateWith, reconcileWorkOrders, reevaluateReading, withEvent } from "./evaluate";
import { AppState, Draft, ParticleReading, readingKey } from "./types";

export interface IncomingReading {
  deviceSerial: string;
  seq: number;
  taskId: string;
  roomId: string;
  cumulative: number;
  sampledAt: string;
  origin: "online" | "offline-draft";
}

export interface IngestReport {
  accepted: number;
  deduped: number; // 同一设备序号+报文序号重发，直接丢弃
  openedSegments: string[]; // 计数器归零开启的新片段
}

// 段重排：同一设备的读数按报文序号排序后顺序扫描。
// 累计值下降 = 计数器归零 => 开启新片段；计数下降本身不记异常。
// 段内首条样本计数取累计值本身（归零后从 0 起计），其余取与上一条的差分。
export const rebuildSegments = (
  deviceSerial: string,
  readings: ParticleReading[],
): { readings: ParticleReading[]; openedSegments: string[] } => {
  const sorted = [...readings].sort((a, b) => a.seq - b.seq);
  let seg = 1;
  let prevCumulative = 0;
  const opened: string[] = [];
  const rebuilt = sorted.map((r, i) => {
    const reset = i > 0 && r.cumulative < prevCumulative;
    if (reset) {
      seg += 1;
      opened.push(`${deviceSerial}·SEG${seg}`);
    }
    // 段首条（含归零后首条）以 0 为基线，样本计数即累计值本身
    const base = i === 0 || reset ? 0 : prevCumulative;
    const sampleCount = r.cumulative - base;
    prevCumulative = r.cumulative;
    return { ...r, segmentId: `${deviceSerial}·SEG${seg}`, sampleCount };
  });
  return { readings: rebuilt, openedSegments: opened };
};

// 读数接入：乱序到达先按序号归位，重发去重，归零开新片段，再按当前阈值评估并对账工单
export const ingestBatch = (
  state: AppState,
  batch: IncomingReading[],
  actor: string,
  at: string,
): { state: AppState; report: IngestReport } => {
  let s = state;
  const known = new Set(s.readings.map(readingKey));
  const fresh: ParticleReading[] = [];
  let deduped = 0;

  for (const inc of batch) {
    const key = `${inc.deviceSerial}#${inc.seq}`;
    if (known.has(key)) {
      deduped += 1; // 同一序号重发：不生成第二条读数，也不会生成第二张异常工单
      continue;
    }
    known.add(key);
    const room = s.rooms.find((r) => r.id === inc.roomId);
    const task = s.tasks.find((t) => t.id === inc.taskId);
    const tv = room && task ? activeThreshold(s.thresholds, room.roomClass, task.particleSizeUm) : undefined;
    fresh.push({
      deviceSerial: inc.deviceSerial,
      seq: inc.seq,
      taskId: inc.taskId,
      roomId: inc.roomId,
      cumulative: inc.cumulative,
      segmentId: "",
      sampleCount: 0,
      sampledAt: inc.sampledAt,
      evaluation: tv
        ? evaluateWith(0, tv, at)
        : { level: "normal", thresholdVersionId: "无", warnLimit: 0, actionLimit: 0, evaluatedAt: at },
      status: "pending",
      origin: inc.origin,
    });
  }

  if (deduped > 0) {
    s = withEvent(s, "dedup-skip", actor, at, `重发去重：丢弃 ${deduped} 条重复报文（设备序号+报文序号相同）`, {
      deduped,
    });
  }
  if (fresh.length === 0) return { state: s, report: { accepted: 0, deduped, openedSegments: [] } };

  const devices = [...new Set(fresh.map((r) => r.deviceSerial))];
  const openedSegments: string[] = [];
  let readings = s.readings;
  for (const dev of devices) {
    const merged = [...readings.filter((r) => r.deviceSerial === dev), ...fresh.filter((r) => r.deviceSerial === dev)];
    const before = new Set(readings.filter((r) => r.deviceSerial === dev).map((r) => r.segmentId));
    const { readings: rebuilt, openedSegments: opened } = rebuildSegments(dev, merged);
    for (const segId of opened) {
      if (!before.has(segId)) {
        openedSegments.push(segId);
        s = withEvent(s, "segment-open", actor, at, `${dev} 计数器归零，开启新片段 ${segId}；计数下降不记异常`, {
          device: dev,
          segment: segId,
        });
      }
    }
    // 乱序归位后样本计数可能变化，待复核读数按当前阈值重算
    const reevaluated = rebuilt.map((r) => reevaluateReading(r, s, at));
    readings = [...readings.filter((r) => r.deviceSerial !== dev), ...reevaluated];
  }
  s = { ...s, readings };

  const affected = s.readings.filter((r) => devices.includes(r.deviceSerial));
  s = reconcileWorkOrders(s, affected, actor, at);
  s = withEvent(s, "ingest", actor, at, `接入 ${fresh.length} 条读数（${devices.join("、")}），去重 ${deduped} 条`, {
    accepted: fresh.length,
    deduped,
  });
  return { state: s, report: { accepted: fresh.length, deduped, openedSegments } };
};

// 草稿保存：离线（保存失败）时保留本机待补传；在线时立即上传
export const saveDraft = (
  state: AppState,
  input: Omit<Draft, "id" | "createdAt" | "status">,
  actor: string,
  at: string,
): { state: AppState; queued: boolean } => {
  const draft: Draft = {
    ...input,
    id: `D-${state.counters.draft + 1}`,
    createdAt: at,
    status: "pending-upload",
  };
  let s: AppState = {
    ...state,
    counters: { ...state.counters, draft: state.counters.draft + 1 },
  };
  if (!s.online) {
    s = { ...s, drafts: [...s.drafts, draft] };
    s = withEvent(s, "draft-queued", actor, at, `草稿 ${draft.id} 保存失败（离线），已保留本机待补传（${draft.roomId}，${draft.readings.length} 条）`, {
      draft: draft.id,
      room: draft.roomId,
      readings: draft.readings.length,
    });
    return { state: s, queued: true };
  }
  const uploaded = uploadDraft(s, draft, actor, at);
  return { state: uploaded, queued: false };
};

const uploadDraft = (state: AppState, draft: Draft, actor: string, at: string): AppState => {
  const { state: ingested } = ingestBatch(
    state,
    draft.readings.map((r) => ({
      deviceSerial: draft.deviceSerial,
      seq: r.seq,
      taskId: draft.taskId,
      roomId: draft.roomId,
      cumulative: r.cumulative,
      sampledAt: r.sampledAt,
      origin: "offline-draft" as const,
    })),
    actor,
    at,
  );
  return withEvent(ingested, "draft-uploaded", actor, at, `草稿 ${draft.id} 已上传并入 ${draft.roomId}`, {
    draft: draft.id,
    room: draft.roomId,
  });
};

// 网络恢复：补传全部待传草稿，按房间分组合并（同一序号重发由接入层去重兜底）
export const flushDrafts = (
  state: AppState,
  actor: string,
  at: string,
): { state: AppState; uploaded: number } => {
  let s = state;
  const pending = s.drafts.filter((d) => d.status === "pending-upload");
  if (pending.length === 0) return { state: s, uploaded: 0 };
  for (const draft of pending) {
    s = uploadDraft(s, draft, actor, at);
    s = { ...s, drafts: s.drafts.map((d) => (d.id === draft.id ? { ...d, status: "uploaded" as const } : d)) };
  }
  const byRoom = new Map<string, number>();
  for (const d of pending) byRoom.set(d.roomId, (byRoom.get(d.roomId) ?? 0) + d.readings.length);
  for (const [roomId, count] of byRoom) {
    s = withEvent(s, "merge", actor, at, `网络恢复：${roomId} 按房间合并补录读数 ${count} 条`, {
      room: roomId,
      merged: count,
    });
  }
  return { state: s, uploaded: pending.length };
};

// 房间合并时间线：在线读数与补录读数按采样时间归并到同一房间视图
export const selectRoomTimeline = (state: AppState, roomId: string): ParticleReading[] =>
  state.readings
    .filter((r) => r.roomId === roomId)
    .sort((a, b) => a.sampledAt.localeCompare(b.sampledAt) || a.deviceSerial.localeCompare(b.deviceSerial) || a.seq - b.seq);
