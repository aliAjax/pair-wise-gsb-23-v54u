import { useMemo, useState } from "react";
import { useStore } from "../store";
import { currentThreshold, localDate } from "../domain/engine";
import { CHANNELS } from "../domain/seed";
import type { Channel, DevicePacket } from "../domain/types";

const EMPTY_COUNTS: Record<Channel, number> = { 0.3: 0, 0.5: 0, 1.0: 0, 5.0: 0 };

function CountInputs({
  counts,
  setCounts,
}: {
  counts: Record<Channel, number>;
  setCounts: (c: Record<Channel, number>) => void;
}) {
  return (
    <div className="count-inputs">
      {CHANNELS.map((ch) => (
        <label key={ch}>
          <span>{ch}µm</span>
          <input
            type="number"
            min={0}
            value={counts[ch]}
            onChange={(e) => setCounts({ ...counts, [ch]: Number(e.target.value) })}
          />
        </label>
      ))}
    </div>
  );
}

export function IngestPanel() {
  const { state, reportPacket, saveDraft, flushAll } = useStore();
  const s = state.server;

  const maxSeq = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of s.devices) m[d.sn] = 0;
    for (const r of s.readings) {
      if (r.seq !== null && r.seq > (m[r.deviceSn] ?? 0)) m[r.deviceSn] = r.seq;
    }
    return m;
  }, [s.readings, s.devices]);

  const [deviceSn, setDeviceSn] = useState(s.devices[2].sn);
  const [seq, setSeq] = useState(maxSeq[deviceSn] + 1);
  const [reset, setReset] = useState(false);
  const [onlineCounts, setOnlineCounts] = useState<Record<Channel, number>>({
    ...EMPTY_COUNTS,
    0.3: 60000,
    0.5: 9600,
    1.0: 1400,
    5.0: 40,
  });

  const [roomId, setRoomId] = useState("Y-0302");
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [draftCounts, setDraftCounts] = useState<Record<Channel, number>>({
    ...EMPTY_COUNTS,
    0.3: 55000,
    0.5: 9100,
    1.0: 1300,
    5.0: 33,
  });
  const [note, setNote] = useState("黄光区断网手抄");

  const pickDevice = (sn: string) => {
    setDeviceSn(sn);
    setSeq(maxSeq[sn] + 1);
  };

  const sendPacket = () => {
    const today = localDate(new Date());
    const packet: DevicePacket = {
      deviceSn,
      seq,
      sampledAt: `${today}T${time}:00+08:00`,
      counts: onlineCounts,
      stampedVersion: currentThreshold(s).version,
      reset,
    };
    reportPacket(packet);
    if (!state.offline) {
      setSeq(seq + 1);
      setReset(false);
    }
  };

  const sendDraft = () => {
    const today = localDate(new Date());
    saveDraft({
      clientDraftId: `${state.currentUser.id}-${roomId}-${time.replace(":", "")}`,
      roomId,
      operator: state.currentUser.name,
      sampledAt: `${today}T${time}:00+08:00`,
      counts: draftCounts,
      stampedVersion: currentThreshold(s).version,
      note,
      savedAt: new Date().toISOString(),
    });
  };

  const queueCount = state.pendingDrafts.length + state.pendingPackets.length;

  return (
    <section className="panel ingest-panel">
      <div className="section-heading">
        <div>
          <p>{state.offline ? "当前断网：报文/草稿先进本机待补传" : "在线：报文实时入库（仍按序号幂等）"}</p>
          <h2>上报与黄光区断网补录</h2>
        </div>
        <button className="primary-action" disabled={queueCount === 0 || state.offline} onClick={flushAll}>
          恢复网络 · 补传合并（{queueCount}）
        </button>
      </div>

      <div className="ingest-grid">
        <div className="ingest-box">
          <h3>在线计数器报文（可乱序 / 重发 / 归零）</h3>
          <label className="stacked">
            <span>设备</span>
            <select value={deviceSn} onChange={(e) => pickDevice(e.target.value)}>
              {s.devices.map((d) => (
                <option key={d.sn} value={d.sn}>
                  {d.sn}（{d.roomId}）
                </option>
              ))}
            </select>
          </label>
          <div className="two-col">
            <label className="stacked">
              <span>设备序号（重发同号即幂等）</span>
              <input type="number" value={seq} onChange={(e) => setSeq(Number(e.target.value))} />
            </label>
            <label className="check">
              <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
              计数器归零（开新片段）
            </label>
          </div>
          <label className="stacked">
            <span>采样时刻</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <CountInputs counts={onlineCounts} setCounts={setOnlineCounts} />
          <button className="primary-action" onClick={sendPacket}>
            {state.offline ? "存入本机待补传" : "上报读数"}
          </button>
        </div>

        <div className="ingest-box">
          <h3>巡检员断网补录草稿（先存本机）</h3>
          <label className="stacked">
            <span>房间</span>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {s.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} {r.name}
                  {r.yellow ? "（黄光区）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="stacked">
            <span>采样时刻</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <CountInputs counts={draftCounts} setCounts={setDraftCounts} />
          <label className="stacked">
            <span>备注</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button className="primary-action" onClick={sendDraft}>
            {state.offline ? "保存草稿到本机" : "保存并立即补传合并"}
          </button>
          <p className="hint">
            保存失败（本机存储不可用）时数据保留在表单；恢复网络后由右侧/上方“补传合并”统一按房间并入任务。
          </p>
        </div>
      </div>

      {queueCount > 0 && (
        <div className="outbox">
          <h4>本机待补传（{queueCount}）</h4>
          <ul>
            {state.pendingPackets.map((p) => (
              <li key={p.id}>
                [报文] {p.packet.deviceSn} #{p.packet.seq}
                {p.packet.reset ? " · 归零开段" : ""}
              </li>
            ))}
            {state.pendingDrafts.map((d) => (
              <li key={d.clientDraftId}>
                [草稿] {d.roomId} · {d.sampledAt.slice(11, 16)} · {d.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
