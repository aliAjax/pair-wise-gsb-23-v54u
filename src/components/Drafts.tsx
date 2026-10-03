import { AppState } from "../domain/types";
import { fmtTime } from "../ui/format";

export interface DraftsProps {
  state: AppState;
  readOnly: boolean;
  onFlush: () => void;
}

// 本机草稿箱：保存失败的补录留在本机，恢复网络后按房间合并补传
export function Drafts({ state, readOnly, onFlush }: DraftsProps) {
  const pending = state.drafts.filter((d) => d.status === "pending-upload");
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>本机待补传</p>
          <h2>草稿箱（{pending.length}）</h2>
        </div>
        {!readOnly && (
          <button className="primary-action" onClick={onFlush} disabled={pending.length === 0}>
            补传全部
          </button>
        )}
      </div>
      <div className="record-list">
        {state.drafts.length === 0 && <p className="hint">暂无草稿。断网时的补录会保留在本机。</p>}
        {state.drafts.map((d) => (
          <article key={d.id} className="wo">
            <div>
              <strong>{d.id}</strong> · {d.roomId} · {d.deviceSerial} · {d.readings.length} 条
            </div>
            <p className="hint">
              {fmtTime(d.createdAt)} 保存 ·{" "}
              {d.status === "pending-upload" ? "保存失败，本机待补传" : "已上传合并"}
              {d.note ? ` · ${d.note}` : ""}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
