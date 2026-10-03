import { AppState } from "../domain/types";
import { fmtTime } from "../ui/format";

const KIND_LABEL: Record<string, string> = {
  ingest: "接入",
  "dedup-skip": "去重",
  "segment-open": "新片段",
  "threshold-publish": "阈值发布",
  reevaluate: "重算",
  "workorder-open": "工单开立",
  "workorder-update": "工单更新",
  "workorder-void": "工单作废",
  signoff: "签认",
  "signoff-denied": "签认被拒",
  "draft-queued": "草稿留存",
  "draft-uploaded": "草稿上传",
  merge: "按房间合并",
};

// 审计日志：只追加的事实流，审计员可见全部、不可改任何一条
export function AuditLog({ state }: { state: AppState }) {
  const nameOf = (actor: string) =>
    actor === "system" ? "系统" : state.users.find((u) => u.id === actor)?.name ?? actor;
  const events = [...state.audit].reverse();
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>事实流</p>
          <h2>审计日志（{events.length}）</h2>
        </div>
      </div>
      <div className="audit-list">
        {events.map((e) => (
          <article key={e.id} className="audit-item">
            <span className="audit-kind">{KIND_LABEL[e.kind] ?? e.kind}</span>
            <div>
              <p>{e.summary}</p>
              <span className="hint">
                {e.id} · {fmtTime(e.at)} · {nameOf(e.actor)}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
