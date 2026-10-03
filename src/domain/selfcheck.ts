// 链路不变量自检：tsc 编译后用 node 运行（见 package.json 的 selfcheck 脚本）
declare const process: { exit(code: number): void };

import { publishThreshold } from "./evaluate";
import { flushDrafts, ingestBatch, saveDraft, selectRoomTimeline } from "./ingest";
import { buildSeedState } from "./seed";
import { signOffReading } from "./signoff";
import { AppState, readingKey } from "./types";

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
};

const T = (min: string) => `2026-10-03T09:${min}:00.000Z`;
const users = (s: AppState) => ({
  inspector: s.users.find((u) => u.role === "inspector")!,
  leaderA: s.users.find((u) => u.id === "U-LA")!,
  leaderB: s.users.find((u) => u.id === "U-LB")!,
  auditor: s.users.find((u) => u.role === "auditor")!,
});
const byKey = (s: AppState, key: string) => s.readings.find((r) => readingKey(r) === key);
const openOrders = (s: AppState, key: string) =>
  s.workOrders.filter((o) => o.readingKey === key && o.status === "open");

// ---- 1. 乱序到达 + 重发去重 ----
console.log("1. 乱序重发");
{
  let s = buildSeedState();
  const before = s.readings.length;
  const r1 = ingestBatch(
    s,
    [
      { deviceSerial: "PC-9001", seq: 8, taskId: "T-1201", roomId: "CR-1201", cumulative: 1100, sampledAt: T("08"), origin: "online" },
      { deviceSerial: "PC-9001", seq: 6, taskId: "T-1201", roomId: "CR-1201", cumulative: 800, sampledAt: T("06"), origin: "online" },
      { deviceSerial: "PC-9001", seq: 7, taskId: "T-1201", roomId: "CR-1201", cumulative: 950, sampledAt: T("07"), origin: "online" },
    ],
    "system",
    T("09"),
  );
  s = r1.state;
  check("乱序三条全部接入", r1.report.accepted === 3 && s.readings.length === before + 3);
  check("乱序归位后样本计数正确（seq6=140, seq7=150, seq8=150）",
    byKey(s, "PC-9001#6")?.sampleCount === 140 &&
    byKey(s, "PC-9001#7")?.sampleCount === 150 &&
    byKey(s, "PC-9001#8")?.sampleCount === 150,
    [byKey(s, "PC-9001#6")?.sampleCount, byKey(s, "PC-9001#7")?.sampleCount, byKey(s, "PC-9001#8")?.sampleCount]);

  const ordersBefore = s.workOrders.length;
  const r2 = ingestBatch(
    s,
    [{ deviceSerial: "PC-9001", seq: 6, taskId: "T-1201", roomId: "CR-1201", cumulative: 800, sampledAt: T("06"), origin: "online" }],
    "system",
    T("10"),
  );
  s = r2.state;
  check("同一序号重发被去重", r2.report.deduped === 1 && s.readings.length === before + 3);
  check("重发不产生新工单", s.workOrders.length === ordersBefore);
}

// ---- 2. 计数器归零开新片段，计数下降不记异常 ----
console.log("2. 计数器归零");
{
  let s = buildSeedState();
  const r = ingestBatch(
    s,
    [
      { deviceSerial: "PC-9001", seq: 6, taskId: "T-1201", roomId: "CR-1201", cumulative: 800, sampledAt: T("06"), origin: "online" },
      { deviceSerial: "PC-9001", seq: 7, taskId: "T-1201", roomId: "CR-1201", cumulative: 30, sampledAt: T("07"), origin: "online" },
    ],
    "system",
    T("08"),
  );
  s = r.state;
  const reset = byKey(s, "PC-9001#7")!;
  check("归零开启新片段 SEG2", reset.segmentId === "PC-9001·SEG2", reset.segmentId);
  check("归零后首条样本计数=累计值 30", reset.sampleCount === 30, reset.sampleCount);
  check("计数下降不记异常、不开工单", reset.evaluation.level === "normal" && s.workOrders.length === 0,
    [reset.evaluation.level, s.workOrders.length]);
}

// ---- 3. 超限开单且幂等 ----
console.log("3. 异常工单幂等");
{
  let s = buildSeedState();
  const exceed = { deviceSerial: "PC-9001", seq: 6, taskId: "T-1201", roomId: "CR-1201", cumulative: 4300, sampledAt: T("06"), origin: "online" as const };
  s = ingestBatch(s, [exceed], "system", T("07")).state;
  check("超限读数开出一张工单", openOrders(s, "PC-9001#6").length === 1, s.workOrders);
  s = ingestBatch(s, [exceed], "system", T("08")).state; // 重发
  s = ingestBatch(s, [exceed], "system", T("09")).state; // 再重发
  check("同一序号反复重发仍只有一张工单", openOrders(s, "PC-9001#6").length === 1 && s.workOrders.length === 1);
  check("工单可回溯到读数与阈值版本",
    s.workOrders[0].readingKey === "PC-9001#6" && s.workOrders[0].thresholdVersionId === "TV-1");
}

// ---- 4. 阈值改动：待复核立即重算，已签认保留当时依据 ----
console.log("4. 阈值版本");
{
  let s = buildSeedState();
  const signedBefore = byKey(s, "PC-9001#2")!;
  check("种子含已签认读数（依据 TV-1）",
    signedBefore.status === "signed" && signedBefore.signOff?.basis.thresholdVersionId === "TV-1");

  const pub = publishThreshold(s, { roomClass: "ISO5", particleSizeUm: 0.5, warnLimit: 100, actionLimit: 200 }, "U-LA", T("20"));
  s = pub.state;
  const pending1 = byKey(s, "PC-9001#1")!; // 样本 120，按新阈值 warn
  const signedAfter = byKey(s, "PC-9001#2")!;
  check("待复核读数立即按 TV-5 重算为 warn",
    pending1.evaluation.level === "warn" && pending1.evaluation.thresholdVersionId === "TV-5",
    pending1.evaluation);
  check("重算后为待复核超限读数补开工单", openOrders(s, "PC-9001#1").length === 1);
  check("已签认读数结论与依据冻结（仍 normal / TV-1）",
    signedAfter.evaluation.level === "normal" &&
    signedAfter.evaluation.thresholdVersionId === "TV-1" &&
    signedAfter.signOff?.basis.thresholdVersionId === "TV-1",
    signedAfter);

  const pub2 = publishThreshold(s, { roomClass: "ISO5", particleSizeUm: 0.5, warnLimit: 3000, actionLimit: 3520 }, "U-LA", T("30"));
  s = pub2.state;
  check("阈值调回后待复核读数恢复 normal", byKey(s, "PC-9001#1")!.evaluation.level === "normal");
  check("对应工单自动作废", openOrders(s, "PC-9001#1").length === 0 &&
    s.workOrders.some((o) => o.readingKey === "PC-9001#1" && o.status === "voided"));
  check("已签认读数依旧冻结", byKey(s, "PC-9001#2")!.evaluation.thresholdVersionId === "TV-1");
}

// ---- 5. 权限：班组长签本班，审计员只读 ----
console.log("5. 权限");
{
  let s = buildSeedState();
  const u = users(s);
  const crossSign = signOffReading(s, "PC-9001#1", u.leaderB, T("40")); // 乙班组长签甲班房间
  s = crossSign.state;
  check("跨班签认被拒", !crossSign.ok && byKey(s, "PC-9001#1")!.status === "pending");
  const auditSign = signOffReading(s, "PC-9001#1", u.auditor, T("41"));
  s = auditSign.state;
  check("审计员签认被拒", !auditSign.ok && byKey(s, "PC-9001#1")!.status === "pending");
  const ownSign = signOffReading(s, "PC-9001#1", u.leaderA, T("42"));
  s = ownSign.state;
  check("本班班组长签认成功", ownSign.ok && byKey(s, "PC-9001#1")!.status === "signed");
  check("拒绝与签认均留审计事实",
    s.audit.some((e) => e.kind === "signoff-denied") && s.audit.some((e) => e.kind === "signoff"));
}

// ---- 6. 断网草稿：本机待补传，恢复后按房间合并 ----
console.log("6. 断网补录与合并");
{
  let s = buildSeedState();
  s = { ...s, online: false };
  const draftInput = {
    roomId: "Y-0302",
    taskId: "T-0302",
    deviceSerial: "PC-9003",
    particleSizeUm: 0.5,
    readings: [
      { seq: 3, cumulative: 1500, sampledAt: T("11") },
      { seq: 4, cumulative: 2050, sampledAt: T("12") },
    ],
    note: "黄光区断网补录",
  };
  const saved = saveDraft(s, draftInput, "U-INS", T("13"));
  s = saved.state;
  check("离线保存失败，草稿保留本机待补传", saved.queued && s.drafts.length === 1 && s.drafts[0].status === "pending-upload");
  check("离线期间读数未进入链路", s.readings.filter((r) => r.deviceSerial === "PC-9003").length === 2);

  s = { ...s, online: true };
  const flushed = flushDrafts(s, "U-INS", T("15"));
  s = flushed.state;
  check("恢复网络后草稿补传", flushed.uploaded === 1 && s.drafts[0].status === "uploaded");
  const timeline = selectRoomTimeline(s, "Y-0302");
  check("补录读数按房间合并进同一时间线", timeline.length === 4 &&
    timeline.some((r) => r.origin === "offline-draft" && r.seq === 3));
  const again = flushDrafts(s, "U-INS", T("16"));
  check("重复补传不产生重复读数", again.uploaded === 0 &&
    again.state.readings.filter((r) => r.deviceSerial === "PC-9003").length === 4);
}

console.log(failures === 0 ? "\n全部不变量通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
