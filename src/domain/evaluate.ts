import {
  AppState,
  AuditEvent,
  EvalLevel,
  Evaluation,
  ParticleReading,
  RoomClass,
  ThresholdVersion,
} from "./types";

export const levelOf = (sampleCount: number, tv: ThresholdVersion): EvalLevel => {
  if (sampleCount >= tv.actionLimit) return "action";
  if (sampleCount >= tv.warnLimit) return "warn";
  return "normal";
};

export const evaluateWith = (
  sampleCount: number,
  tv: ThresholdVersion,
  at: string,
): Evaluation => ({
  level: levelOf(sampleCount, tv),
  thresholdVersionId: tv.id,
  warnLimit: tv.warnLimit,
  actionLimit: tv.actionLimit,
  evaluatedAt: at,
});

export const activeThreshold = (
  thresholds: ThresholdVersion[],
  roomClass: RoomClass,
  particleSizeUm: number,
): ThresholdVersion | undefined =>
  thresholds.find(
    (t) =>
      t.roomClass === roomClass &&
      t.particleSizeUm === particleSizeUm &&
      t.status === "active",
  );

const nextEvent = (
  state: AppState,
  kind: AuditEvent["kind"],
  actor: string,
  at: string,
  summary: string,
  facts?: Record<string, string | number>,
): AuditEvent => ({
  id: `EV-${state.counters.event + 1}`,
  at,
  actor,
  kind,
  summary,
  facts,
});

export const withEvent = (
  state: AppState,
  kind: AuditEvent["kind"],
  actor: string,
  at: string,
  summary: string,
  facts?: Record<string, string | number>,
): AppState => ({
  ...state,
  audit: [...state.audit, nextEvent(state, kind, actor, at, summary, facts)],
  counters: { ...state.counters, event: state.counters.event + 1 },
});

// 重算一条读数：仅待复核读数跟随当前生效阈值；已签认读数冻结，保留签认时依据
export const reevaluateReading = (
  reading: ParticleReading,
  state: AppState,
  at: string,
): ParticleReading => {
  if (reading.status === "signed") return reading;
  const room = state.rooms.find((r) => r.id === reading.roomId);
  const task = state.tasks.find((t) => t.id === reading.taskId);
  if (!room || !task) return reading;
  const tv = activeThreshold(state.thresholds, room.roomClass, task.particleSizeUm);
  if (!tv) return reading;
  return { ...reading, evaluation: evaluateWith(reading.sampleCount, tv, at) };
};

// 工单对账：让工单与待复核读数的最新结论对齐（幂等，按 readingKey 唯一）
// - 待复核且超限：无单则开单，有单则同步级别/阈值版本
// - 待复核且恢复正常：作废未闭环工单
// - 已签认：工单作为历史事实冻结，不再改动
export const reconcileWorkOrders = (
  state: AppState,
  readings: ParticleReading[],
  actor: string,
  at: string,
): AppState => {
  let s = state;
  for (const reading of readings) {
    if (reading.status !== "pending") continue;
    const key = `${reading.deviceSerial}#${reading.seq}`;
    const open = s.workOrders.find((o) => o.readingKey === key && o.status === "open");
    const abnormal = reading.evaluation.level !== "normal";
    if (abnormal && !open) {
      const order = {
        id: `WO-${s.counters.workOrder + 1}`,
        readingKey: key,
        roomId: reading.roomId,
        deviceSerial: reading.deviceSerial,
        seq: reading.seq,
        level: reading.evaluation.level,
        thresholdVersionId: reading.evaluation.thresholdVersionId,
        status: "open" as const,
        createdAt: at,
      };
      s = {
        ...s,
        workOrders: [...s.workOrders, order],
        counters: { ...s.counters, workOrder: s.counters.workOrder + 1 },
      };
      s = withEvent(s, "workorder-open", actor, at, `异常工单 ${order.id}：${key} ${order.level}`, {
        room: reading.roomId,
        level: reading.evaluation.level,
        threshold: reading.evaluation.thresholdVersionId,
      });
    } else if (abnormal && open) {
      if (
        open.level !== reading.evaluation.level ||
        open.thresholdVersionId !== reading.evaluation.thresholdVersionId
      ) {
        s = {
          ...s,
          workOrders: s.workOrders.map((o) =>
            o.id === open.id
              ? {
                  ...o,
                  level: reading.evaluation.level,
                  thresholdVersionId: reading.evaluation.thresholdVersionId,
                }
              : o,
          ),
        };
        s = withEvent(
          s,
          "workorder-update",
          actor,
          at,
          `工单 ${open.id} 随重算更新为 ${reading.evaluation.level}（${reading.evaluation.thresholdVersionId}）`,
        );
      }
    } else if (!abnormal && open) {
      s = {
        ...s,
        workOrders: s.workOrders.map((o) =>
          o.id === open.id
            ? { ...o, status: "voided" as const, voidReason: "复算后恢复正常" }
            : o,
        ),
      };
      s = withEvent(s, "workorder-void", actor, at, `工单 ${open.id} 作废：复算后恢复正常`);
    }
  }
  return s;
};

export interface PublishResult {
  state: AppState;
  version: ThresholdVersion;
  flipped: number; // 结论发生变化的待复核读数条数
}

// 阈值发布：旧版本作废，待复核读数立即按新版本重算并同步工单；已签认读数保留当时依据
export const publishThreshold = (
  state: AppState,
  input: { roomClass: RoomClass; particleSizeUm: number; warnLimit: number; actionLimit: number },
  actor: string,
  at: string,
): PublishResult => {
  const version: ThresholdVersion = {
    id: `TV-${state.counters.threshold + 1}`,
    roomClass: input.roomClass,
    particleSizeUm: input.particleSizeUm,
    warnLimit: input.warnLimit,
    actionLimit: input.actionLimit,
    effectiveFrom: at,
    status: "active",
  };
  let s: AppState = {
    ...state,
    thresholds: [
      ...state.thresholds.map((t) =>
        t.roomClass === input.roomClass &&
        t.particleSizeUm === input.particleSizeUm &&
        t.status === "active"
          ? { ...t, status: "superseded" as const }
          : t,
      ),
      version,
    ],
    counters: { ...state.counters, threshold: state.counters.threshold + 1 },
  };
  s = withEvent(
    s,
    "threshold-publish",
    actor,
    at,
    `阈值版本 ${version.id} 生效（${input.roomClass} ${input.particleSizeUm}µm 预警≥${input.warnLimit} 行动≥${input.actionLimit}）`,
  );

  const roomIds = new Set(
    s.rooms.filter((r) => r.roomClass === input.roomClass).map((r) => r.id),
  );
  const affected = s.readings.filter((r) => roomIds.has(r.roomId) && r.status === "pending");
  const before = new Map(affected.map((r) => [`${r.deviceSerial}#${r.seq}`, r.evaluation.level]));

  const reevaluated = s.readings.map((r) =>
    roomIds.has(r.roomId) ? reevaluateReading(r, s, at) : r,
  );
  s = { ...s, readings: reevaluated };

  const changed = reevaluated.filter(
    (r) =>
      roomIds.has(r.roomId) &&
      r.status === "pending" &&
      before.get(`${r.deviceSerial}#${r.seq}`) !== r.evaluation.level,
  );
  s = withEvent(s, "reevaluate", actor, at, `待复核读数按 ${version.id} 重算 ${affected.length} 条，结论变化 ${changed.length} 条；已签认读数保留当时依据`, {
    reevaluated: affected.length,
    flipped: changed.length,
  });
  s = reconcileWorkOrders(s, changed, actor, at);
  return { state: s, version, flipped: changed.length };
};
