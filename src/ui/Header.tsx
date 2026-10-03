import { useStore } from "../store";

const ROLE_LABEL: Record<string, string> = {
  inspector: "巡检员（可断网补录）",
  engineer: "厂务工程师（发布阈值/处置工单）",
  leader: "班组长（仅签认本班房间）",
  auditor: "审计员（只读事实）",
};

export function Header() {
  const { state, switchUser, toggleOffline, resetDemo, dismissNotice } = useStore();
  const { currentUser, offline, notice, server } = state;

  return (
    <header className="topbar">
      <div className="topbar-title">
        <p className="eyebrow">hxwl-09 · 采样 → 读数 → 阈值 → 工单 → 签认</p>
        <h1>洁净室粒子计数链路</h1>
      </div>
      <div className="topbar-controls">
        <label className="inline-select">
          当前角色
          <select value={currentUser.id} onChange={(e) => {
            const u = server.users.find((x) => x.id === e.target.value)!;
            switchUser(u);
          }}>
            {server.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
        <button className={offline ? "danger" : ""} onClick={toggleOffline}>
          {offline ? "● 断网中（黄光区）" : "○ 链路正常"}
        </button>
        <button onClick={resetDemo}>重置演示</button>
      </div>
      <p className="role-hint">{ROLE_LABEL[currentUser.role]}</p>
      {notice && (
        <div className={`notice notice-${notice.kind}`} onClick={dismissNotice}>
          {notice.text} <span className="notice-x">×</span>
        </div>
      )}
    </header>
  );
}
