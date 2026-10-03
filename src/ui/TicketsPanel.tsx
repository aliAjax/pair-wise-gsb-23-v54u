import { useStore } from "../store";
import { fmtFull } from "./format";
import type { AnomalyTicket } from "../domain/types";

const STATUS: Record<AnomalyTicket["status"], { label: string; cls: string }> = {
  open: { label: "进行中", cls: "st-open" },
  revoked: { label: "已撤销（重算达标）", cls: "st-revoked" },
  closed: { label: "已关闭（处置完成）", cls: "st-closed" },
};

export function TicketsPanel() {
  const { state, closeTicket } = useStore();
  const s = state.server;
  const tickets = [...s.tickets].sort((a, b) => a.id.localeCompare(b.id));

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>同一设备序号只有一张工单</p>
          <h2>异常工单（幂等键 设备#序号）</h2>
        </div>
      </div>
      <div className="ticket-list">
        {tickets.length === 0 && <p className="empty">暂无工单。</p>}
        {tickets.map((t) => {
          const room = s.rooms.find((r) => r.id === t.roomId)!;
          const st = STATUS[t.status];
          const canClose =
            t.status === "open" &&
            (state.currentUser.role === "engineer" || state.currentUser.role === "leader");
          return (
            <article key={t.id} className="ticket-card">
              <div className="ticket-main">
                <div className="ticket-title">
                  <code>{t.id}</code>
                  <span className={`ticket-status ${st.cls}`}>{st.label}</span>
                </div>
                <p className="ticket-facts">
                  {room.id} {room.name} · 设备 <code>{t.deviceSn}</code> · 序号{" "}
                  <b>{t.seq === null ? `补录 ${s.readings.find((r) => r.id === t.readingId)?.clientDraftId}` : `#${t.seq}`}</b>{" "}
                  · 超限通道 {t.overChannels.length ? `${t.overChannels.join("/")}µm` : "—"}
                </p>
                <details className="ticket-audit">
                  <summary>工单审计轨迹（{t.audit.length}）</summary>
                  <ol>
                    {t.audit.map((a, i) => (
                      <li key={i}>
                        {fmtFull(a.at)} · {a.action} · 依据 v{a.basisVersion} — {a.detail}
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
              <button disabled={!canClose} onClick={() => closeTicket(t.id)}>
                现场处置并关闭
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
