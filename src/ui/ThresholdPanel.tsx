import { currentThreshold } from "../domain/engine";
import { CHANNELS, GRADES, nextThresholdDraft } from "../domain/seed";
import { useStore } from "../store";
import { fmtFull } from "./format";

export function ThresholdPanel() {
  const { state, publishThreshold } = useStore();
  const s = state.server;
  const cur = currentThreshold(s);
  const canPublish = state.currentUser.role === "engineer";
  const next = nextThresholdDraft(cur);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>改阈值：待复核立即重算，已签认保留当时依据</p>
          <h2>阈值版本</h2>
        </div>
        <button
          className="primary-action"
          disabled={!canPublish}
          title={!canPublish ? "仅厂务工程师可发布阈值" : ""}
          onClick={() => publishThreshold({ ...next, publishedAt: new Date().toISOString(), publishedBy: state.currentUser.name })}
        >
          发布 v{next.version}（ISO 6 · 0.5µm 收紧到 9000）
        </button>
      </div>

      <div className="threshold-list">
        {[...s.thresholds].reverse().map((tv) => (
          <article key={tv.id} className={`threshold-card ${tv.version === cur.version ? "is-current" : ""}`}>
            <header>
              <h3>
                v{tv.version} {tv.version === cur.version && <span className="cur-badge">当前</span>}
              </h3>
              <p>
                {fmtFull(tv.publishedAt)} · {tv.publishedBy}
              </p>
            </header>
            <p className="threshold-reason">{tv.reason}</p>
            <table className="limit-table">
              <thead>
                <tr>
                  <th>等级</th>
                  {CHANNELS.map((ch) => (
                    <th key={ch}>{ch}µm</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GRADES.map((g) => (
                  <tr key={g}>
                    <td>{g}</td>
                    {CHANNELS.map((ch) => (
                      <td key={ch}>{tv.limits[g][ch]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </section>
  );
}
