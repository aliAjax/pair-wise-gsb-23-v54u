import { AppState } from "../domain/types";
import { fmtTime, levelClass, levelText } from "../ui/format";

// 异常工单：与读数按 readingKey 一一对应，重发不会出第二张
export function WorkOrders({ state }: { state: AppState }) {
  const orders = [...state.workOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>异常闭环</p>
          <h2>异常工单</h2>
        </div>
      </div>
      <div className="record-list">
        {orders.length === 0 && <p className="hint">暂无工单：当前没有超限的待复核读数。</p>}
        {orders.map((o) => (
          <article key={o.id} className={o.status === "open" ? "wo wo-open" : "wo"}>
            <div>
              <strong>{o.id}</strong> · {o.readingKey} · {o.roomId}
              <span className={`lv ${levelClass[o.level]}`}> {levelText[o.level]}</span>
            </div>
            <p className="hint">
              依据 {o.thresholdVersionId} · 开单 {fmtTime(o.createdAt)} ·{" "}
              {o.status === "open" ? "未闭环" : `已作废：${o.voidReason}`}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
