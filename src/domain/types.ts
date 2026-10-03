// 洁净室在线粒子计数链路的领域模型
// 链路：采样任务 → 片段(计数器归零开新段) → 读数(带设备序号+阈值版本) → 阈值评估 → 异常工单(幂等) → 签认(冻结依据)

export type Role = "inspector" | "engineer" | "leader" | "auditor";

/** 0.3/0.5/1.0/5.0 µm 四个标准通道 */
export type Channel = 0.3 | 0.5 | 1.0 | 5.0;

export type Grade = "ISO 5" | "ISO 6" | "ISO 7";

export type Verdict = "ok" | "over";

export type ReadingSource = "online" | "manual";

/** 阈值版本：一改动即新增一条，旧版本永久保留作为签认时的历史依据 */
export interface ThresholdVersion {
  id: string; // TV-20261003-1
  version: number;
  publishedAt: string;
  publishedBy: string;
  reason: string;
  /** key: 洁净等级；value: 各通道每立方米最大允许颗粒数 */
  limits: Record<Grade, Record<Channel, number>>;
}

export interface Room {
  id: string; // CR-1201 / Y-0302
  name: string;
  grade: Grade;
  yellow: boolean; // 黄光区（巡检员经常在此断网补录）
}

export interface Device {
  sn: string; // 设备序号，读数必须携带
  roomId: string;
  firmware: string;
}

export interface Shift {
  id: string; // S-day / S-night
  label: string; // 白班 / 夜班
  date: string; // YYYY-MM-DD
  startHour: number;
  endHour: number;
  leaderId: string;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  shiftId?: string; // 班组长所属班次
}

/**
 * 计数器片段：计数器归零时开启新片段。
 * 同一片段内序号递增；同一设备新片段的计数从小重新累计是正常的。
 */
export interface Segment {
  id: string;
  deviceSn: string;
  roomId: string;
  openedAt: string;
  openedBySeq: number; // 触发开段的设备序号
  reason: "first" | "reset";
}

/** 采样任务：按「房间 × 班次 × 日期」合并，在线读数与断网补录最终汇入同一任务 */
export interface SamplingTask {
  id: string;
  roomId: string;
  shiftId: string;
  date: string;
  source: "online" | "manual" | "merged";
  readingIds: string[];
  status: "pending" | "signed";
  /** 签认后冻结：该任务下所有读数的判定依据（阈值版本）与结论不再随新阈值改变 */
  signedAt?: string;
  signedBy?: string;
  basisVersion?: number;
  remark?: string;
}

export interface Reading {
  id: string;
  /** 设备序号 + 该设备自增序号构成幂等键；手工补录 seq 为 null */
  deviceSn: string;
  seq: number | null;
  roomId: string;
  taskId: string;
  segmentId?: string; // 手工补录不属于任何计数器片段
  source: ReadingSource;
  sampledAt: string;
  receivedAt: string;
  counts: Record<Channel, number>;
  grade: Grade;
  /** 读数产出时计数器固件正在使用的阈值版本（可能滞后于当前版本） */
  stampedVersion: number;
  /** 实际判定使用的阈值版本：待复核读数随阈值改动重算；签认后冻结 */
  basisVersion: number;
  verdict: Verdict;
  overChannels: Channel[];
  reviewState: "pending" | "signed";
  /** 段内（非归零）计数下降：只标记事实，不算异常 */
  dropChannels?: Channel[];
  /** 客户端去重用的草稿幂等键 */
  clientDraftId?: string;
}

export type TicketStatus = "open" | "revoked" | "closed";

export interface TicketAuditEntry {
  at: string;
  action: "created" | "updated" | "revoked" | "reopened" | "closed";
  basisVersion: number;
  detail: string;
}

/** 异常工单：幂等键 deviceSn#seq（手工补录用 draft 键），重发绝不产生第二张 */
export interface AnomalyTicket {
  id: string;
  idempotencyKey: string;
  roomId: string;
  taskId: string;
  readingId: string;
  deviceSn: string;
  seq: number | null;
  status: TicketStatus;
  basisVersion: number;
  overChannels: Channel[];
  counts: Record<Channel, number>;
  audit: TicketAuditEntry[];
}

/** 链路事件日志（重发、开段、重算、合并等全部留痕） */
export interface IngestEvent {
  id: string;
  at: string;
  kind:
    | "duplicate"
    | "segment"
    | "drop"
    | "ticket"
    | "ticket-revoke"
    | "ticket-reopen"
    | "ticket-close"
    | "merge"
    | "recompute"
    | "sign"
    | "draft-saved"
    | "draft-flushed";
  message: string;
  deviceSn?: string;
  seq?: number | null;
  roomId?: string;
}

export interface ServerState {
  thresholds: ThresholdVersion[];
  rooms: Room[];
  devices: Device[];
  shifts: Shift[];
  users: User[];
  segments: Segment[];
  tasks: SamplingTask[];
  readings: Reading[];
  tickets: AnomalyTicket[];
  events: IngestEvent[];
  counters: { event: number };
}

/** 设备上报报文：序号可能乱序、可能重发；reset=true 表示计数器已归零 */
export interface DevicePacket {
  deviceSn: string;
  seq: number;
  sampledAt: string;
  counts: Record<Channel, number>;
  stampedVersion: number;
  reset: boolean;
}

/** 巡检员断网期间的手工补录草稿 */
export interface OfflineDraft {
  clientDraftId: string;
  roomId: string;
  operator: string;
  sampledAt: string;
  counts: Record<Channel, number>;
  stampedVersion: number;
  note?: string;
  savedAt: string;
}

/** 设备在线但上报链路暂时不可达时积压的报文（恢复后补传，仍走幂等入口） */
export interface PendingPacket {
  id: string;
  packet: DevicePacket;
  queuedAt: string;
}
