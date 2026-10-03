import { useStore } from "../store";
import { currentThreshold } from "../domain/engine";
import type { Reading, SamplingTask, ServerState } from "../domain/types";
import { channelState, fmtCounts, fmtTime, roomOf } from "./format";

function sourceLabel(r: Reading): string {
  if (r.source === "manual") return "断网补录";
  return r.seq === null ? "补录" : `在线 #${r.seq}`;
}

function ReadingRow({ state, reading }: { state: ServerState; reading: Reading }) {
  const rows = channelState(state, reading);
  const basisMismatch = reading.stampedVersion !== reading.basisVersion;
  return (
    <div className={`reading-row ${reading.verdict === "over" ? "is-over" : ""}`}>
      <div className="reading-head">
        <span className="tag tag-source">{sourceLabel(reading)}</span>
        <time>{fmtTime(reading.sampledAt)}</time>
        <code className="sn">{reading.deviceSn}</code>
        {reading.reviewState === "signed" ? (
          <span className="tag tag-signed">已签认·依据冻结 v{reading.basisVersion}</span>
        ) : (
          <span className="tag tag-pending">待复核</span>
        )}
        <span className="tag tag-version" title="读数携带的设备戳记版本 / 实际判定版本">
          戳记 v{reading.stampedVersion} → 判定 v{reading.basisVersion}
          {basisMismatch ? "（已重算）" : ""}
        </span>
      </div>
      <div className="channels">
        {rows.map(({ ch, value, limit, over, drop }) => (
          <span key={ch} className={`chip ${over ? "chip-over" : ""} ${drop ? "chip-drop" : ""}`}>
            {ch}µm <b>{value}</b>/{limit}
            {drop && <em title="同片段内计数下降，属事实，不算异常">↓</em>}
          </span>
        ))}
      </div>
      <div className="reading-meta">
        {fmtCounts(reading.counts)}
        {reading.overChannels.length > 0 && (
          <b className="over-text">超限通道：{reading.overChannels.join("/")}µm</b>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: SamplingTask }) {
  const { state, signTask } = useStore();
  const s = state.server;
  const room = roomOf(s, task.roomId);
  const shift = s.shifts.find((x) => x.id === task.shiftId)!;
  const readings = task.readingIds
    .map((id) => s.readings.find((r) => r.id === id)!)
    .filter(Boolean)
    .sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
  const canSign =
    state.currentUser.role === "leader" &&
    state.currentUser.shiftId === task.shiftId &&
    task.status === "pending";

  return (
    <article className={`task-card ${task.status === "signed" ? "task-signed" : ""}`}>
      <header>
        <div>
          <h3>
            {room.id} {room.name}
            {room.yellow && <span className="yellow-badge">黄光区</span>}
          </h3>
          <p>
            {task.date} · {shift.label} · {room.grade} · 任务{" "}
            <code>{task.id}</code> · 来源：
            {task.source === "merged" ? "在线+补录已合并" : task.source === "manual" ? "断网补录" : "在线"}
          </p>
        </div>
        <div className="task-side">
          {task.status === "signed" ? (
            <span className="tag tag-signed">
              已签认（{s.users.find((u) => u.id === task.signedBy)?.name} · 依据 v{task.basisVersion}）
            </span>
          ) : (
            <span className="tag tag-pending">待复核 · 当前阈值 v{currentThreshold(s).version}</span>
          )}
          <button
            className="primary-action"
            disabled={!canSign}
            title={
              state.currentUser.role === "auditor"
                ? "审计员只查看事实"
                : !canSign && state.currentUser.role === "leader"
                  ? "只能签认本班次房间"
                  : ""
            }
            onClick={() => signTask(task.id)}
          >
            班组长签认本班房间
          </button>
        </div>
      </header>
      <div className="reading-list">
        {readings.map((r) => (
          <ReadingRow key={r.id} state={s} reading={r} />
        ))}
      </div>
    </article>
  );
}

export function TasksPanel() {
  const { state } = useStore();
  const tasks = [...state.server.tasks].sort((a, b) =>
    `${a.date}${a.shiftId}`.localeCompare(`${b.date}${b.shiftId}`),
  );
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>按房间 × 班次 × 日期合并</p>
          <h2>采样任务与读数（设备序号 + 阈值版本）</h2>
        </div>
      </div>
      <div className="task-grid">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}
