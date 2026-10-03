// 洁净室粒子计数链路领域模型
// 链路：采样任务 -> 粒子读数(设备序号+阈值版本) -> 异常工单 -> 班组长签认 -> 审计事实

export type RoomClass = "ISO5" | "ISO6" | "ISO7" | "YELLOW";

export interface Shift {
  id: string;
  name: string;
}

export interface Room {
  id: string;
  name: string;
  roomClass: RoomClass;
  shiftId: string; // 房间归属班次：班组长只能签认本班房间
}

export type Role = "inspector" | "shiftLeader" | "auditor";

export interface User {
  id: string;
  name: string;
  role: Role;
  shiftId?: string; // 班组长所属班次
}

export interface SamplingTask {
  id: string;
  roomId: string;
  shiftId: string;
  deviceSerial: string; // 粒子计数器设备序号
  particleSizeUm: number; // 采样粒径，如 0.5
  createdAt: string;
}

export interface ThresholdVersion {
  id: string;
  roomClass: RoomClass;
  particleSizeUm: number;
  warnLimit: number; // 预警限：sampleCount >= warnLimit 记 warn
  actionLimit: number; // 行动限：sampleCount >= actionLimit 记 action
  effectiveFrom: string;
  status: "active" | "superseded";
}

export type EvalLevel = "normal" | "warn" | "action";

// 评估结论：阈值版本与限值随结论一起落存，签认时整份快照为“当时依据”
export interface Evaluation {
  level: EvalLevel;
  thresholdVersionId: string;
  warnLimit: number;
  actionLimit: number;
  evaluatedAt: string;
}

export interface SignOff {
  userId: string;
  userName: string;
  signedAt: string;
  basis: Evaluation; // 签认当时依据：之后阈值再改也不回写
}

export interface ParticleReading {
  deviceSerial: string; // 设备序号
  seq: number; // 设备报文序号；去重键 = deviceSerial#seq
  taskId: string;
  roomId: string;
  cumulative: number; // 计数器累计值：下降即归零，开新片段，不记异常
  segmentId: string; // 片段号，归零重排后确定
  sampleCount: number; // 本样本计数 = 段内累计差分
  sampledAt: string;
  evaluation: Evaluation;
  status: "pending" | "signed"; // pending=待复核(阈值改动立即重算) signed=已签认(冻结)
  signOff?: SignOff;
  origin: "online" | "offline-draft"; // offline-draft=黄光区断网补录
}

export type WorkOrderStatus = "open" | "voided";

export interface ExceptionWorkOrder {
  id: string;
  readingKey: string; // deviceSerial#seq，唯一：同一序号重发不会生成第二张工单
  roomId: string;
  deviceSerial: string;
  seq: number;
  level: EvalLevel;
  thresholdVersionId: string;
  status: WorkOrderStatus;
  createdAt: string;
  voidReason?: string;
}

// 本机草稿：保存失败/断网时保留本机待补传
export interface Draft {
  id: string;
  roomId: string;
  taskId: string;
  deviceSerial: string;
  particleSizeUm: number;
  readings: Array<{ seq: number; cumulative: number; sampledAt: string }>;
  createdAt: string;
  status: "pending-upload" | "uploaded";
  note?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string; // userId 或 "system"
  kind:
    | "ingest"
    | "dedup-skip"
    | "segment-open"
    | "threshold-publish"
    | "reevaluate"
    | "workorder-open"
    | "workorder-update"
    | "workorder-void"
    | "signoff"
    | "signoff-denied"
    | "draft-queued"
    | "draft-uploaded"
    | "merge";
  summary: string;
  facts?: Record<string, string | number>;
}

export interface Counters {
  workOrder: number;
  threshold: number;
  draft: number;
  event: number;
}

export interface AppState {
  shifts: Shift[];
  rooms: Room[];
  users: User[];
  tasks: SamplingTask[];
  thresholds: ThresholdVersion[];
  readings: ParticleReading[];
  workOrders: ExceptionWorkOrder[];
  drafts: Draft[];
  audit: AuditEvent[];
  online: boolean;
  counters: Counters;
}

export const readingKey = (r: { deviceSerial: string; seq: number }): string =>
  `${r.deviceSerial}#${r.seq}`;
