import { useStore } from "../store";
import { fmtFull } from "./format";
import type { IngestEvent } from "../domain/types";

const KIND_LABEL: Record<IngestEvent["kind"], string> = {
  duplicate: "重发幂等",
  segment: "归零开段",
  drop: "段内下降",
  ticket: "生成工单",
  "ticket-revoke": "重算撤销",
  "ticket-reopen": "重算重开",
  "ticket-close": "工单关闭",
  merge: "房间合并",
  recompute: "阈值重算",
  sign: "签认冻结",
  "draft-saved": "草稿留存",
  "draft-flushed": "补录合并",
};

export function FactsPanel() {
  const { state } = useStore();
  const s = state.server;

  return (
    <section className="panel facts-panel">
      <div className="section-heading">
        <div>
          <p>审计员视角：只看事实，不可操作</p>
          <h2>片段与链路事件</h2>
        </div>
      </div>

      <div className="facts-grid">
        <div>
          <h3>计数器片段（归零开新段，段间下降正常）</h3>
          <div className="segment-list">
            {s.segments.map((sg) => (
              <div key={sg.id} className="segment-row">
                <code>{sg.id}</code>
                <span>{sg.deviceSn}</span>
                <span>{sg.roomId}</span>
                <span>{fmtFull(sg.openedAt)}</span>
                <span className={`seg-reason ${sg.reason}`}>
                  {sg.reason === "reset" ? `归零（#${sg.openedBySeq}）` : "首段"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3>事件日志（{s.events.length}）</h3>
          <ol className="event-log">
            {[...s.events].reverse().map((e) => (
              <li key={e.id} className={`ev ev-${e.kind}`}>
                <span className="ev-time">{fmtFull(e.at)}</span>
                <span className={`ev-kind ev-kind-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                <span className="ev-msg">{e.message}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
