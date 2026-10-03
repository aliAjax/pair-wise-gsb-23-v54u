import { ingestBatch } from "./ingest";
import { signOffReading } from "./signoff";
import { AppState } from "./types";

// 演示种子：三间房、两台在线计数器 + 黄光区一台，全部读数经真实接入管线生成
export const buildSeedState = (): AppState => {
  const base: AppState = {
    shifts: [
      { id: "S-A", name: "甲班" },
      { id: "S-B", name: "乙班" },
    ],
    rooms: [
      { id: "CR-1201", name: "光刻间 1201", roomClass: "ISO5", shiftId: "S-A" },
      { id: "CR-2107", name: "刻蚀间 2107", roomClass: "ISO6", shiftId: "S-A" },
      { id: "Y-0302", name: "黄光区 0302", roomClass: "YELLOW", shiftId: "S-B" },
    ],
    users: [
      { id: "U-INS", name: "小周（巡检员）", role: "inspector" },
      { id: "U-LA", name: "林岚（甲班班组长）", role: "shiftLeader", shiftId: "S-A" },
      { id: "U-LB", name: "老赵（乙班班组长）", role: "shiftLeader", shiftId: "S-B" },
      { id: "U-AU", name: "安审（审计员）", role: "auditor" },
    ],
    tasks: [
      { id: "T-1201", roomId: "CR-1201", shiftId: "S-A", deviceSerial: "PC-9001", particleSizeUm: 0.5, createdAt: "2026-10-03T07:30:00.000Z" },
      { id: "T-2107", roomId: "CR-2107", shiftId: "S-A", deviceSerial: "PC-9002", particleSizeUm: 0.5, createdAt: "2026-10-03T07:30:00.000Z" },
      { id: "T-0302", roomId: "Y-0302", shiftId: "S-B", deviceSerial: "PC-9003", particleSizeUm: 0.5, createdAt: "2026-10-03T07:30:00.000Z" },
    ],
    thresholds: [
      { id: "TV-1", roomClass: "ISO5", particleSizeUm: 0.5, warnLimit: 3000, actionLimit: 3520, effectiveFrom: "2026-10-01T00:00:00.000Z", status: "active" },
      { id: "TV-2", roomClass: "ISO6", particleSizeUm: 0.5, warnLimit: 30000, actionLimit: 35200, effectiveFrom: "2026-10-01T00:00:00.000Z", status: "active" },
      { id: "TV-3", roomClass: "ISO7", particleSizeUm: 0.5, warnLimit: 300000, actionLimit: 352000, effectiveFrom: "2026-10-01T00:00:00.000Z", status: "active" },
      { id: "TV-4", roomClass: "YELLOW", particleSizeUm: 0.5, warnLimit: 30000, actionLimit: 35200, effectiveFrom: "2026-10-01T00:00:00.000Z", status: "active" },
    ],
    readings: [],
    workOrders: [],
    drafts: [],
    audit: [],
    online: true,
    counters: { workOrder: 0, threshold: 4, draft: 0, event: 0 },
  };

  const t = (min: number) => `2026-10-03T08:${String(min).padStart(2, "0")}:00.000Z`;
  const { state: s1 } = ingestBatch(
    base,
    [
      { deviceSerial: "PC-9001", seq: 1, taskId: "T-1201", roomId: "CR-1201", cumulative: 120, sampledAt: t(1), origin: "online" },
      { deviceSerial: "PC-9001", seq: 2, taskId: "T-1201", roomId: "CR-1201", cumulative: 240, sampledAt: t(2), origin: "online" },
      { deviceSerial: "PC-9001", seq: 3, taskId: "T-1201", roomId: "CR-1201", cumulative: 390, sampledAt: t(3), origin: "online" },
      { deviceSerial: "PC-9001", seq: 4, taskId: "T-1201", roomId: "CR-1201", cumulative: 520, sampledAt: t(4), origin: "online" },
      { deviceSerial: "PC-9001", seq: 5, taskId: "T-1201", roomId: "CR-1201", cumulative: 660, sampledAt: t(5), origin: "online" },
      { deviceSerial: "PC-9002", seq: 1, taskId: "T-2107", roomId: "CR-2107", cumulative: 800, sampledAt: t(2), origin: "online" },
      { deviceSerial: "PC-9002", seq: 2, taskId: "T-2107", roomId: "CR-2107", cumulative: 1650, sampledAt: t(4), origin: "online" },
      { deviceSerial: "PC-9002", seq: 3, taskId: "T-2107", roomId: "CR-2107", cumulative: 2400, sampledAt: t(6), origin: "online" },
      { deviceSerial: "PC-9003", seq: 1, taskId: "T-0302", roomId: "Y-0302", cumulative: 500, sampledAt: t(3), origin: "online" },
      { deviceSerial: "PC-9003", seq: 2, taskId: "T-0302", roomId: "Y-0302", cumulative: 980, sampledAt: t(6), origin: "online" },
    ],
    "system",
    t(6),
  );
  // 甲班班组长签认本班房间的一条读数，作为“已签认保留当时依据”的对照样本
  const signed = signOffReading(s1, "PC-9001#2", base.users[1], t(10));
  return signed.state;
};
