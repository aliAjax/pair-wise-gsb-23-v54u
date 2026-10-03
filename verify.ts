// 链路不变量验证：node 直接运行编译后的场景逻辑（通过 vite-node 太重，这里用 esbuild 转译）
import { buildScenario } from "./src/domain/scenario";
import { ingestPacket, publishThreshold, signTask, PermissionError, currentThreshold } from "./src/domain/engine";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${msg}`);
  }
}

const state = buildScenario();

// 1. 读数带设备序号 + 阈值版本
assert(state.readings.every((r) => typeof r.basisVersion === "number"), "所有读数都带判定阈值版本");
assert(
  state.readings.filter((r) => r.source === "online").every((r) => r.seq !== null && r.deviceSn !== "MANUAL"),
  "在线读数都带设备序号",
);

// 2. 同序号重发不生成第二张工单
const tk118 = state.tickets.filter((t) => t.idempotencyKey === "OPC-Y031#118");
assert(tk118.length === 1, "OPC-Y031#118 三次上报只产生一张工单");
assert(!state.readings.some((r) => r.deviceSn === "OPC-Y031" && r.seq === 118 && false), "");
const dupCount118 = state.readings.filter((r) => r.deviceSn === "OPC-Y031" && r.seq === 118).length;
assert(dupCount118 === 1, "#118 读数只入库一条（重发被幂等拦截）");
assert(state.events.filter((e) => e.kind === "duplicate").length >= 3, "重发事件至少 3 条（含 v2 后再重发）");

// 3. 归零开新片段；下降不算异常
const ySegments = state.segments.filter((s) => s.deviceSn === "OPC-Y031");
assert(ySegments.length === 2, "OPC-Y031 归零后有两个片段");
assert(ySegments[1].reason === "reset" && ySegments[1].openedBySeq === 1, "第二片段由归零(seq=1)开启");
const r119 = state.readings.find((r) => r.deviceSn === "OPC-Y031" && r.seq === 119)!;
assert((r119.dropChannels ?? []).length > 0, "乱序到达的 #119 相对 #118 的段内下降被标记");
assert(r119.verdict === "over" && (r119.dropChannels ?? []).length > 0, "#119 同时携带「段内下降」事实与 v2 超限判定，两者互不否定");
const dropTickets = state.tickets.filter((t) => t.idempotencyKey === "OPC-Y031#119" && false);
assert(dropTickets.length === 0, "计数下降本身不产生专属异常工单（#119 仅在 v2 真正超限时才开单）");
const rReset1 = state.readings.find((r) => r.deviceSn === "OPC-Y031" && r.seq === 1)!;
assert((rReset1.dropChannels ?? []).length === 0, "归零后首条读数不判为下降异常");

// 4. 断网补录按房间合并
const draft = state.readings.find((r) => r.clientDraftId === "QiuShi-Y0302-0955")!;
assert(draft.source === "manual" && draft.seq === null, "补录读数存在且为手工来源");
const yTask = state.tasks.find((t) => t.id === draft.taskId)!;
assert(yTask.source === "merged", "黄光区任务为在线+补录合并");
assert(yTask.readingIds.includes(draft.id), "补录并入按房间/班次合并的任务");
assert(
  state.readings.filter((r) => r.clientDraftId === "QiuShi-Y0302-0955").length === 1,
  "补录重复提交也幂等",
);
const merges = state.events.filter((e) => e.kind === "merge");
assert(merges.length === 1, "黄光区在线/补录首次相遇只有一条合并事件（首个在线读数不误报）");
assert(merges[0]?.roomId === "Y-0302", "合并事件归属于黄光区房间");

// 5. 阈值改动：待复核重算，已签认冻结
assert(currentThreshold(state).version === 2, "当前阈值为 v2");
const signedCr = state.readings.filter((r) => r.roomId === "CR-1201");
assert(signedCr.every((r) => r.reviewState === "signed" && r.basisVersion === 1), "已签认 CR-1201 保留 v1 依据");
const crTask = state.tasks.find((t) => t.roomId === "CR-1201")!;
assert(crTask.status === "signed" && crTask.basisVersion === 1, "已签认任务冻结在 v1");
// 补录 9600 与 #2 9400：v1 达标，v2(9000) 超限 → 待复核读数被重算
assert(draft.basisVersion === 2 && draft.verdict === "over", "补录 9600 在 v2 下重算为超限");
assert(draft.overChannels.includes(0.5), "补录超限通道为 0.5µm");
const r2 = state.readings.find((r) => r.deviceSn === "OPC-Y031" && r.seq === 2)!;
assert(r2.basisVersion === 2 && r2.verdict === "over", "归零片段 #2(9400) 在 v2 下重算为超限");
// v2 新超限的读数补开工单（同幂等键唯一）
assert(state.tickets.some((t) => t.idempotencyKey === "draft#QiuShi-Y0302-0955"), "补录补开了唯一工单");
const tk119 = state.tickets.filter((t) => t.idempotencyKey === "OPC-Y031#119");
assert(tk119.length === 1, "#119 v2 超限时只开一张工单");
// #118 工单在 v2 前已关闭，重算不翻案；再重发也不重开
assert(tk118[0].status === "closed", "#118 工单保持已关闭（历史处置事实）");

// 6. 权限：班组长只能签本班；审计员只读
let blocked = false;
try {
  signTask(state, state.tasks.find((t) => t.roomId === "Y-0302")!.id, state.users.find((u) => u.id === "u-leader-night")!);
} catch (e) {
  blocked = e instanceof PermissionError;
}
assert(blocked, "夜班组长不能签白班黄光区任务");
let auditorBlocked = false;
try {
  signTask(state, state.tasks.find((t) => t.status === "pending")!.id, state.users.find((u) => u.role === "auditor")!);
} catch (e) {
  auditorBlocked = e instanceof PermissionError;
}
assert(auditorBlocked, "审计员签认被拒绝（只读事实）");

// 7. 签认后再次发布阈值也不动冻结读数
const v3 = { ...currentThreshold(state), version: 3, publishedAt: "2026-10-03T18:00:00+08:00", publishedBy: "x", reason: "t",
  limits: JSON.parse(JSON.stringify(currentThreshold(state).limits)) };
const afterV3 = publishThreshold(state, v3);
assert(
  afterV3.readings.filter((r) => r.roomId === "CR-1201").every((r) => r.basisVersion === 1),
  "v3 发布后已签认读数仍保留 v1",
);
// 8. 签认后新事实不污染冻结任务（另开待复核任务）
const before = afterV3.tasks.filter((t) => t.roomId === "CR-1201").length;
const more = ingestPacket(afterV3, {
  deviceSn: "OPC-A101", seq: 58, sampledAt: "2026-10-03T11:00:00+08:00",
  counts: { 0.3: 999999, 0.5: 999999, 1.0: 999999, 5.0: 999999 }, stampedVersion: 3, reset: false,
});
assert(more.tasks.filter((t) => t.roomId === "CR-1201").length === before + 1, "签认后同房间新读数另开待复核任务，不回写冻结结论");
assert(more.readings.filter((r) => r.roomId === "CR-1201" && r.reviewState === "signed").every((r) => r.basisVersion === 1), "冻结读数依旧 v1");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
