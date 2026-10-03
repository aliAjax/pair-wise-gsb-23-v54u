import { useState } from "react";
import { AppState, RoomClass } from "../domain/types";

export interface ThresholdProps {
  state: AppState;
  readOnly: boolean;
  onPublish: (roomClass: RoomClass, warn: number, action: number) => void;
  lastPublish: string | null;
}

const CLASS_LABEL: Record<RoomClass, string> = {
  ISO5: "ISO 5",
  ISO6: "ISO 6",
  ISO7: "ISO 7",
  YELLOW: "黄光区",
};

// 阈值版本：发布后待复核读数立即重算，已签认读数保留当时依据
export function ThresholdPanel({ state, readOnly, onPublish, lastPublish }: ThresholdProps) {
  const [roomClass, setRoomClass] = useState<RoomClass>("ISO5");
  const [warn, setWarn] = useState("3000");
  const [action, setAction] = useState("3520");

  const submit = () => {
    const w = Number(warn);
    const a = Number(action);
    if (!Number.isFinite(w) || !Number.isFinite(a) || w <= 0 || a <= 0 || w > a) return;
    onPublish(roomClass, w, a);
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>限值管理</p>
          <h2>阈值版本</h2>
        </div>
      </div>
      <ul className="tv-list">
        {state.thresholds.map((t) => (
          <li key={t.id} className={t.status === "active" ? "tv tv-active" : "tv"}>
            <strong>{t.id}</strong> · {CLASS_LABEL[t.roomClass]} · {t.particleSizeUm}µm · 预警≥
            {t.warnLimit} 行动≥{t.actionLimit}
            <span className="hint"> {t.status === "active" ? "（生效中）" : "（已作废）"}</span>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="publish-form">
          <label>
            <span>洁净等级</span>
            <select value={roomClass} onChange={(e) => setRoomClass(e.target.value as RoomClass)}>
              {(Object.keys(CLASS_LABEL) as RoomClass[]).map((c) => (
                <option key={c} value={c}>
                  {CLASS_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>预警限</span>
            <input value={warn} onChange={(e) => setWarn(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            <span>行动限</span>
            <input value={action} onChange={(e) => setAction(e.target.value)} inputMode="numeric" />
          </label>
          <button className="primary-action" onClick={submit}>
            发布新阈值版本
          </button>
        </div>
      )}
      {lastPublish && <p className="hint">{lastPublish}</p>}
    </section>
  );
}
