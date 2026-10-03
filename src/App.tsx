import { useEffect, useMemo, useState } from "react";
import { publishThreshold } from "./domain/evaluate";
import { flushDrafts, ingestBatch, IngestReport, saveDraft } from "./domain/ingest";
import { canWrite } from "./domain/permissions";
import { signOffReading } from "./domain/signoff";
import { loadState, persistState, resetState } from "./domain/store";
import { AppState, RoomClass } from "./domain/types";
import { AuditLog } from "./components/AuditLog";
import { Drafts } from "./components/Drafts";
import { IngestConsole } from "./components/IngestConsole";
import { RoomTimeline } from "./components/RoomTimeline";
import { ThresholdPanel } from "./components/ThresholdPanel";
import { WorkOrders } from "./components/WorkOrders";
import { lastCumulative, nextSeq } from "./ui/format";
import "./styles.css";

const now = () => new Date().toISOString();

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [userId, setUserId] = useState("U-INS");
  const [roomId, setRoomId] = useState("CR-1201");
  const [report, setReport] = useState<IngestReport | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  const [lastPublish, setLastPublish] = useState<string | null>(null);

  useEffect(() => persistState(state), [state]);

  const user = state.users.find((u) => u.id === userId) ?? state.users[0];
  const readOnly = !canWrite(user);
  const apply = (fn: (s: AppState) => AppState) => setState((s) => fn(s));

  const metrics = useMemo(
    () => [
      { label: "待复核读数", value: state.readings.filter((r) => r.status === "pending").length },
      { label: "已签认", value: state.readings.filter((r) => r.status === "signed").length },
      { label: "未闭环工单", value: state.workOrders.filter((o) => o.status === "open").length },
      { label: "待补传草稿", value: state.drafts.filter((d) => d.status === "pending-upload").length },
    ],
    [state],
  );

  // —— 现场情形模拟 ——
  const doOutOfOrder = () => {
    const seq = nextSeq(state, "PC-9001");
    const cum = lastCumulative(state, "PC-9001");
    const mk = (i: number) => ({
      deviceSerial: "PC-9001",
      seq: seq + i,
      taskId: "T-1201",
      roomId: "CR-1201",
      cumulative: cum + 140 * (i + 1),
      sampledAt: now(),
      origin: "online" as const,
    });
    const batch = [mk(2), mk(0), mk(1)]; // 乱序到达
    const r = ingestBatch(state, batch, user.id, now());
    setState(r.state);
    setReport(r.report);
    setNotice(["模拟：三条读数乱序到达，已按设备序号+报文序号归位"]);
  };

  const doResend = () => {
    const last = state.readings
      .filter((r) => r.deviceSerial === "PC-9001")
      .sort((a, b) => b.seq - a.seq)[0];
    if (!last) return;
    const r = ingestBatch(
      state,
      [{ deviceSerial: last.deviceSerial, seq: last.seq, taskId: last.taskId, roomId: last.roomId, cumulative: last.cumulative, sampledAt: last.sampledAt, origin: "online" }],
      user.id,
      now(),
    );
    setState(r.state);
    setReport(r.report);
    setNotice([`模拟：重发 ${last.deviceSerial}#${last.seq}，被去重，未生成第二张工单`]);
  };

  const doCounterReset = () => {
    const seq = nextSeq(state, "PC-9001");
    const r = ingestBatch(
      state,
      [{ deviceSerial: "PC-9001", seq, taskId: "T-1201", roomId: "CR-1201", cumulative: 25, sampledAt: now(), origin: "online" }],
      user.id,
      now(),
    );
    setState(r.state);
    setReport(r.report);
    setNotice(["模拟：计数器归零，累计值下降 → 开启新片段，不记异常"]);
  };

  const doExceed = () => {
    const seq = nextSeq(state, "PC-9002");
    const cum = lastCumulative(state, "PC-9002") + 36000; // ISO6 行动限 35200
    const r = ingestBatch(
      state,
      [{ deviceSerial: "PC-9002", seq, taskId: "T-2107", roomId: "CR-2107", cumulative: cum, sampledAt: now(), origin: "online" }],
      user.id,
      now(),
    );
    setState(r.state);
    setReport(r.report);
    setNotice(["模拟：PC-9002 样本计数超行动限，自动开立异常工单"]);
  };

  const doOfflineDraft = () => {
    const offline = { ...state, online: false };
    const seq = nextSeq(state, "PC-9003");
    const cum = lastCumulative(state, "PC-9003");
    const saved = saveDraft(
      offline,
      {
        roomId: "Y-0302",
        taskId: "T-0302",
        deviceSerial: "PC-9003",
        particleSizeUm: 0.5,
        readings: [
          { seq, cumulative: cum + 500, sampledAt: now() },
          { seq: seq + 1, cumulative: cum + 1040, sampledAt: now() },
        ],
        note: "黄光区断网补录",
      },
      user.id,
      now(),
    );
    setState(saved.state);
    setNotice(["模拟：黄光区断网，草稿保存失败，已保留本机待补传"]);
  };

  const doFlush = () => {
    const online = { ...state, online: true };
    const r = flushDrafts(online, user.id, now());
    setState(r.state);
    setNotice([`网络恢复：补传 ${r.uploaded} 份草稿，按房间合并完成`]);
  };

  const doPublish = (roomClass: RoomClass, warn: number, action: number) => {
    const r = publishThreshold(state, { roomClass, particleSizeUm: 0.5, warnLimit: warn, actionLimit: action }, user.id, now());
    setState(r.state);
    setLastPublish(`已发布 ${r.version.id}：待复核读数立即重算，结论变化 ${r.flipped} 条；已签认结果保留当时依据`);
  };

  const doSign = (key: string) => {
    const r = signOffReading(state, key, user, now());
    setState(r.state);
    setNotice([r.ok ? `已签认 ${key}，依据随签认冻结` : `签认被拒：${r.reason}`]);
  };

  const doReset = () => {
    setState(resetState());
    setReport(null);
    setNotice([]);
    setLastPublish(null);
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-09 · 洁净室粒子计数链路</p>
          <h1>半导体洁净室巡检</h1>
          <p className="subtitle">
            读数带设备序号与阈值版本，乱序重发自动去重；计数器归零开新片段；阈值改动待复核立即重算、
            已签认保留当时依据；班组长签认本班房间，审计员只读事实；断网草稿本机待补传。
          </p>
        </div>
        <div className="stack-card">
          <span>当前角色</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {state.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <span>网络</span>
          <button onClick={() => apply((s) => ({ ...s, online: !s.online }))} disabled={readOnly}>
            {state.online ? "在线（点击断网）" : "离线（点击恢复）"}
          </button>
          <button onClick={doReset}>重置演示数据</button>
        </div>
      </section>

      {readOnly && <p className="banner">审计员视角：只查看事实，所有写操作已禁用。</p>}
      {!state.online && <p className="banner banner-warn">当前离线：补录草稿将保存失败并保留本机待补传。</p>}

      <section className="metrics-grid">
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      <div className="layout">
        <IngestConsole
          readOnly={readOnly}
          online={state.online}
          onOutOfOrder={doOutOfOrder}
          onResend={doResend}
          onCounterReset={doCounterReset}
          onExceed={doExceed}
          onOfflineDraft={doOfflineDraft}
          onFlush={doFlush}
          pendingDrafts={metrics[3].value}
          report={report}
          notice={notice}
        />
        <RoomTimeline state={state} user={user} roomId={roomId} onSelectRoom={setRoomId} onSign={doSign} />
      </div>

      <div className="layout">
        <ThresholdPanel state={state} readOnly={readOnly} onPublish={doPublish} lastPublish={lastPublish} />
        <WorkOrders state={state} />
      </div>

      <div className="layout">
        <Drafts state={state} readOnly={readOnly} onFlush={doFlush} />
        <AuditLog state={state} />
      </div>
    </main>
  );
}

export default App;
