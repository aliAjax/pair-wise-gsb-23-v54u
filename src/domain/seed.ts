import type {
  Channel,
  Device,
  Grade,
  Room,
  ServerState,
  Shift,
  ThresholdVersion,
  User,
} from "./types";

export const CHANNELS: Channel[] = [0.3, 0.5, 1.0, 5.0];

export const GRADES: Grade[] = ["ISO 5", "ISO 6", "ISO 7"];

// ISO 14644-1 风格的各通道每立方米颗粒数限值（演示数据，非逐字引用标准）
function gradeLimits(
  iso5: [number, number, number, number],
  iso6: [number, number, number, number],
  iso7: [number, number, number, number],
): Record<Grade, Record<Channel, number>> {
  const toRow = (r: [number, number, number, number]): Record<Channel, number> => ({
    0.3: r[0],
    0.5: r[1],
    1.0: r[2],
    5.0: r[3],
  });
  return {
    "ISO 5": toRow(iso5),
    "ISO 6": toRow(iso6),
    "ISO 7": toRow(iso7),
  };
}

const THRESHOLDS_V1: ThresholdVersion = {
  id: "TV-20260928-1",
  version: 1,
  publishedAt: "2026-09-28T08:00:00+08:00",
  publishedBy: "厂务工程师 冯岚",
  reason: "季度初始阈值基线",
  //        0.3µm, 0.5µm, 1.0µm, 5.0µm（个/m³）
  limits: gradeLimits(
    [35200, 3520, 832, 29],
    [102000, 10200, 2370, 83],
    [293000, 29300, 6800, 233],
  ),
};

const THRESHOLDS_V2: ThresholdVersion = {
  id: "TV-20261003-2",
  version: 2,
  publishedAt: "2026-10-03T09:40:00+08:00",
  publishedBy: "厂务工程师 冯岚",
  reason: "黄光区涂胶线改造，ISO 6 的 0.5µm 通道由 10200 收紧至 9000",
  limits: gradeLimits(
    [35200, 3520, 832, 29],
    [102000, 9000, 2370, 83],
    [293000, 29300, 6800, 233],
  ),
};

export const ROOMS: Room[] = [
  { id: "CR-1201", name: "光刻准备间", grade: "ISO 5", yellow: false },
  { id: "CR-2107", name: "刻蚀工段", grade: "ISO 6", yellow: false },
  { id: "Y-0302", name: "黄光区涂胶线", grade: "ISO 6", yellow: true },
  { id: "CR-3310", name: "封装前室", grade: "ISO 7", yellow: false },
];

export const DEVICES: Device[] = [
  { sn: "OPC-A101", roomId: "CR-1201", firmware: "fw 4.2" },
  { sn: "OPC-B204", roomId: "CR-2107", firmware: "fw 4.2" },
  { sn: "OPC-Y031", roomId: "Y-0302", firmware: "fw 4.1" },
  { sn: "OPC-C318", roomId: "CR-3310", firmware: "fw 4.2" },
];

export const SHIFTS: Shift[] = [
  { id: "S-day", label: "白班", date: "2026-10-03", startHour: 8, endHour: 20, leaderId: "u-leader-day" },
  { id: "S-night", label: "夜班", date: "2026-10-03", startHour: 20, endHour: 8, leaderId: "u-leader-night" },
];

export const USERS: User[] = [
  { id: "u-insp", name: "巡检员 邱实", role: "inspector" },
  { id: "u-eng", name: "厂务工程师 冯岚", role: "engineer" },
  { id: "u-leader-day", name: "班组长 陆岩（白班）", role: "leader", shiftId: "S-day" },
  { id: "u-leader-night", name: "班组长 高岑（夜班）", role: "leader", shiftId: "S-night" },
  { id: "u-auditor", name: "审计员 闻证", role: "auditor" },
];

export function createInitialState(): ServerState {
  return {
    thresholds: [THRESHOLDS_V1],
    rooms: ROOMS,
    devices: DEVICES,
    shifts: SHIFTS,
    users: USERS,
    segments: [],
    tasks: [],
    readings: [],
    tickets: [],
    events: [],
    counters: { event: 0 },
  };
}

/** 演示用：阈值改动（厂务工程师发布新版本） */
export function nextThresholdDraft(current: ThresholdVersion): ThresholdVersion {
  return THRESHOLDS_V2.version > current.version
    ? THRESHOLDS_V2
    : {
        ...current,
        version: current.version + 1,
        publishedAt: new Date().toISOString(),
        reason: "阈值例行修订",
      };
}
