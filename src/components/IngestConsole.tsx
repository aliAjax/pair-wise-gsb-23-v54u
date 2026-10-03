import { IngestReport } from "../domain/ingest";

export interface ConsoleProps {
  readOnly: boolean;
  online: boolean;
  onOutOfOrder: () => void;
  onResend: () => void;
  onCounterReset: () => void;
  onExceed: () => void;
  onOfflineDraft: () => void;
  onFlush: () => void;
  pendingDrafts: number;
  report: IngestReport | null;
  notice: string[];
}

// 接入控制台：复现乱序、重发、归零、超限、断网补录五类现场情形
export function IngestConsole(p: ConsoleProps) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>计数器接入</p>
          <h2>现场情形复现</h2>
        </div>
        <span className={p.online ? "net net-on" : "net net-off"}>{p.online ? "在线" : "离线"}</span>
      </div>
      {p.readOnly ? (
        <p className="hint">审计员只读，接入操作已隐藏。</p>
      ) : (
        <div className="btn-grid">
          <button onClick={p.onOutOfOrder}>乱序到达（PC-9001 三条）</button>
          <button onClick={p.onResend}>重发上一条（同序号）</button>
          <button onClick={p.onCounterReset}>计数器归零（开新片段）</button>
          <button onClick={p.onExceed}>超限读数（PC-9002 行动限）</button>
          <button onClick={p.onOfflineDraft}>黄光区断网补录（存草稿）</button>
          <button onClick={p.onFlush} disabled={p.pendingDrafts === 0}>
            恢复网络并补传（{p.pendingDrafts}）
          </button>
        </div>
      )}
      {p.report && (
        <p className="hint">
          上次接入：受理 {p.report.accepted} 条 · 去重 {p.report.deduped} 条
          {p.report.openedSegments.length > 0 && ` · 新片段 ${p.report.openedSegments.join("、")}`}
        </p>
      )}
      {p.notice.length > 0 && (
        <ul className="notice">
          {p.notice.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
