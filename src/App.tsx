import "./styles.css";
import { StoreProvider } from "./store";
import { Header } from "./ui/Header";
import { Metrics } from "./ui/Metrics";
import { TasksPanel } from "./ui/TasksPanel";
import { IngestPanel } from "./ui/IngestPanel";
import { ThresholdPanel } from "./ui/ThresholdPanel";
import { TicketsPanel } from "./ui/TicketsPanel";
import { FactsPanel } from "./ui/FactsPanel";

export default function App() {
  return (
    <StoreProvider>
      <main className="app-shell">
        <Header />
        <Metrics />
        <TasksPanel />
        <IngestPanel />
        <div className="two-pane">
          <ThresholdPanel />
          <TicketsPanel />
        </div>
        <FactsPanel />
        <footer className="footnote">
          规则：读数带设备序号与阈值版本 · 同序号重发不重复开工单 · 计数器归零开新片段（段内下降非异常）·
          断网补录本机留存、恢复后按房间合并 · 阈值改版待复核立即重算 · 已签认保留当时依据 ·
          班组长仅签认本班房间 · 审计员只读
        </footer>
      </main>
    </StoreProvider>
  );
}
