import { useStore } from "../store";

export function Metrics() {
  const { state } = useStore();
  const s = state.server;
  const openTickets = s.tickets.filter((t) => t.status === "open").length;
  const revoked = s.tickets.filter((t) => t.status === "revoked").length;
  const signed = s.tasks.filter((t) => t.status === "signed").length;
  const pendingReadings = s.readings.filter((r) => r.reviewState === "pending").length;
  const drops = s.events.filter((e) => e.kind === "drop").length;
  const duplicates = s.events.filter((e) => e.kind === "duplicate").length;
  const queue = state.pendingDrafts.length + state.pendingPackets.length;

  const cards = [
    { label: "读数总数（含补录）", value: s.readings.length, sub: `${pendingReadings} 条待复核` },
    { label: "进行中异常工单", value: openTickets, sub: `撤销 ${revoked} · 关闭 ${s.tickets.length - openTickets - revoked}`, danger: openTickets > 0 },
    { label: "已签认任务 / 片段", value: `${signed} / ${s.segments.length}`, sub: "依据冻结 / 归零开段" },
    { label: "乱序重发被幂等拦截", value: duplicates, sub: `段内下降 ${drops} 次（非异常）` },
    { label: "本机待补传", value: queue, sub: state.offline ? "当前断网" : "恢复网络后一键合并", danger: queue > 0 },
  ];

  return (
    <section className="metrics">
      {cards.map((c) => (
        <article key={c.label} className={`metric ${c.danger ? "metric-danger" : ""}`}>
          <span>{c.label}</span>
          <strong>{c.value}</strong>
          <p>{c.sub}</p>
        </article>
      ))}
    </section>
  );
}
