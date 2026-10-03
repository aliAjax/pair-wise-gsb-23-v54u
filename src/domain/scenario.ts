import {
  closeTicket,
  currentThreshold,
  ingestPacket,
  PermissionError,
  publishThreshold,
  signTask,
  submitDraft,
} from "./engine";
import { createInitialState, nextThresholdDraft, USERS } from "./seed";
import type { Channel, DevicePacket, OfflineDraft, ServerState } from "./types";

function c(a: number, b: number, c5: number, d: number): Record<Channel, number> {
  return { 0.3: a, 0.5: b, 1.0: c5, 5.0: d };
}

/**
 * 预置链路回放：
 *  - 计数器乱序重发（幂等，不重复开工单）
 *  - 段内计数下降不算异常
 *  - 计数器归零开新片段
 *  - 黄光区断网补录，恢复后按房间合并
 *  - 班组长签认白班后厂务发布新阈值：待复核重算、已签认冻结
 */
export function buildScenario(): ServerState {
  let state = createInitialState();

  const inspector = USERS[0];
  const engineer = USERS[1];
  const leaderDay = USERS[2];
  const leaderNight = USERS[3];
  const auditor = USERS[4];

  // 1) 08:20 CR-2107 正常读数（v1：0.5µm 限值 10200）
  state = ingestPacket(state, {
    deviceSn: "OPC-B204", seq: 101,
    sampledAt: "2026-10-03T08:20:00+08:00",
    counts: c(48000, 8400, 1200, 40), stampedVersion: 1, reset: false,
  } as DevicePacket);

  // 2) 09:05 黄光区读数超限（v1 下 0.5µm=11800 > 10200）→ 工单 TK-OPC-Y031-118
  state = ingestPacket(state, {
    deviceSn: "OPC-Y031", seq: 118,
    sampledAt: "2026-10-03T09:05:00+08:00",
    counts: c(71000, 11800, 1800, 60), stampedVersion: 1, reset: false,
  } as DevicePacket);

  // 3) 同一序号乱序重发两次 → 忽略，不产生第二张工单
  state = ingestPacket(state, {
    deviceSn: "OPC-Y031", seq: 118,
    sampledAt: "2026-10-03T09:05:00+08:00",
    counts: c(71000, 11800, 1800, 60), stampedVersion: 1, reset: false,
  } as DevicePacket);
  state = ingestPacket(state, {
    deviceSn: "OPC-Y031", seq: 118,
    sampledAt: "2026-10-03T09:05:00+08:00",
    counts: c(71000, 11800, 1800, 60), stampedVersion: 1, reset: false,
  } as DevicePacket);

  // 4) 序号 120 先到、119 后到（乱序）；119 段内计数下降，仅记录
  state = ingestPacket(state, {
    deviceSn: "OPC-Y031", seq: 120,
    sampledAt: "2026-10-03T09:32:00+08:00",
    counts: c(76000, 12100, 1900, 64), stampedVersion: 1, reset: false,
  } as DevicePacket);
  state = ingestPacket(state, {
    deviceSn: "OPC-Y031", seq: 119,
    sampledAt: "2026-10-03T09:18:00+08:00",
    counts: c(64000, 9900, 1500, 44), stampedVersion: 1, reset: false,
  } as DevicePacket);

  // 5) 黄光区断网：巡检员本机补录一条 09:55 的读数（0.5µm=9600，v1 下达标）
  const draft: OfflineDraft = {
    clientDraftId: "QiuShi-Y0302-0955",
    roomId: "Y-0302",
    operator: inspector.name,
    sampledAt: "2026-10-03T09:55:00+08:00",
    counts: c(60000, 9600, 1400, 38),
    stampedVersion: 1,
    note: "黄光区断网，手抄补录",
    savedAt: "2026-10-03T09:57:00+08:00",
  };
  state = submitDraft(state, draft);
  // 补录重复提交（例如客户端重试）→ 幂等忽略
  state = submitDraft(state, draft);

  // 6) CR-1201（ISO 5）白班读数
  state = ingestPacket(state, {
    deviceSn: "OPC-A101", seq: 57,
    sampledAt: "2026-10-03T10:10:00+08:00",
    counts: c(21000, 2100, 400, 12), stampedVersion: 1, reset: false,
  } as DevicePacket);

  // 7) 白班班组长签认 CR-1201 任务（依据随读数冻结）
  const dayCrTask = state.tasks.find((t) => t.roomId === "CR-1201")!;
  state = signTask(state, dayCrTask.id, leaderDay);

  // 审计员尝试签认 → 被拒（只记录，不改变状态）
  try {
    state = signTask(state, dayCrTask.id, auditor);
  } catch (e) {
    if (!(e instanceof PermissionError)) throw e;
  }

  // 8) 计数器归零（中午停机重启）→ 新片段；计数从小开始，不算下降异常
  state = ingestPacket(state, {
    deviceSn: "OPC-Y031", seq: 1,
    sampledAt: "2026-10-03T13:05:00+08:00",
    counts: c(12000, 2200, 300, 8), stampedVersion: 1, reset: true,
  } as DevicePacket);
  state = ingestPacket(state, {
    deviceSn: "OPC-Y031", seq: 2,
    sampledAt: "2026-10-03T13:20:00+08:00",
    counts: c(58000, 9400, 1300, 36), stampedVersion: 1, reset: false,
  } as DevicePacket);

  // 9) 工程师处置完成 #118 对应工单（关闭）
  const tk118 = state.tickets.find((t) => t.idempotencyKey === "OPC-Y031#118")!;
  state = closeTicket(state, tk118.id, engineer);

  // 10) 厂务发布 v2：ISO 6 的 0.5µm 收紧到 9000
  //     → 待复核读数全部重算：#119(9900)、补录(9600)、#2(9400) 新超限；
  //        #118 工单保持已关闭事实；白班 CR-1201 已签认，保留 v1 依据不动
  const v2 = nextThresholdDraft(currentThreshold(state));
  state = publishThreshold(state, {
    ...v2,
    publishedAt: "2026-10-03T14:00:00+08:00",
    publishedBy: engineer.name,
  });

  // 11) 同序号再重发 #118：即便 v2 已生效，重发依然幂等，不重开、不新建工单
  state = ingestPacket(state, {
    deviceSn: "OPC-Y031", seq: 118,
    sampledAt: "2026-10-03T09:05:00+08:00",
    counts: c(71000, 11800, 1800, 60), stampedVersion: 1, reset: false,
  } as DevicePacket);

  // 12) 21:30 夜班 CR-3310 读数（v2 时代，按新版本判定）
  state = ingestPacket(state, {
    deviceSn: "OPC-C318", seq: 12,
    sampledAt: "2026-10-03T21:30:00+08:00",
    counts: c(120000, 12000, 3000, 90), stampedVersion: 2, reset: false,
  } as DevicePacket);

  // 13) 权限演示：夜班班组长不能签白班黄光区任务，但可以签本班 CR-3310
  const yDay = state.tasks.find((t) => t.roomId === "Y-0302")!;
  try {
    state = signTask(state, yDay.id, leaderNight);
  } catch (e) {
    if (!(e instanceof PermissionError)) throw e;
  }

  return state;
}
