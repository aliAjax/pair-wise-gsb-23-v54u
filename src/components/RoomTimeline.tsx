import { selectRoomTimeline } from "../domain/ingest";
import { canSignRoom } from "../domain/permissions";
import { AppState, User, readingKey } from "../domain/types";
import { fmtTime, levelClass, levelText } from "../ui/format";

export interface TimelineProps {
  state: AppState;
  user: User;
  roomId: string;
  onSelectRoom: (roomId: string) => void;
  onSign: (key: string) => void;
}

// 房间合并时间线：在线读数与断网补录读数按采样时间归并到同一房间视图
export function RoomTimeline({ state, user, roomId, onSelectRoom, onSign }: TimelineProps) {
  const room = state.rooms.find((r) => r.id === roomId);
  const timeline = selectRoomTimeline(state, roomId);
  const maySign = room ? canSignRoom(user, room) : false;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>按房间合并</p>
          <h2>房间读数时间线</h2>
        </div>
        <div className="chips">
          {state.rooms.map((r) => (
            <button
              key={r.id}
              className={r.id === roomId ? "chip chip-on" : "chip"}
              onClick={() => onSelectRoom(r.id)}
            >
              {r.id}
            </button>
          ))}
        </div>
      </div>
      {room && (
        <p className="hint">
          {room.name} · {room.roomClass} · 归属{state.shifts.find((s) => s.id === room.shiftId)?.name}
          {maySign ? " · 你可签认本班房间" : user.role === "auditor" ? " · 审计只读" : " · 非本班，仅查看"}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>读数（设备#序号）</th>
              <th>片段</th>
              <th>样本计数</th>
              <th>阈值版本</th>
              <th>结论</th>
              <th>状态 / 签认依据</th>
              <th>工单</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((r) => {
              const key = readingKey(r);
              const order = state.workOrders.find((o) => o.readingKey === key && o.status === "open");
              return (
                <tr key={key}>
                  <td>
                    <strong>{key}</strong>
                    <br />
                    <span className="hint">
                      {fmtTime(r.sampledAt)} · {r.origin === "offline-draft" ? "断网补录" : "在线"}
                    </span>
                  </td>
                  <td>{r.segmentId.split("·")[1]}</td>
                  <td>{r.sampleCount}</td>
                  <td>{r.evaluation.thresholdVersionId}</td>
                  <td>
                    <span className={`lv ${levelClass[r.evaluation.level]}`}>
                      {levelText[r.evaluation.level]}
                    </span>
                  </td>
                  <td>
                    {r.status === "signed" && r.signOff ? (
                      <span className="hint">
                        已签认 · {r.signOff.userName}
                        <br />
                        依据 {r.signOff.basis.thresholdVersionId}（{r.signOff.basis.warnLimit}/
                        {r.signOff.basis.actionLimit}）
                      </span>
                    ) : (
                      "待复核"
                    )}
                  </td>
                  <td>{order ? `${order.id}（${levelText[order.level]}）` : "—"}</td>
                  <td>
                    {r.status === "pending" && maySign && (
                      <button className="primary-action" onClick={() => onSign(key)}>
                        签认
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {timeline.length === 0 && (
              <tr>
                <td colSpan={8} className="hint">
                  该房间暂无读数
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
