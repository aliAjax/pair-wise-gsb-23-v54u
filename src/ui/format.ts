import { currentThreshold } from "../domain/engine";
import { CHANNELS } from "../domain/seed";
import type { Channel, Reading, Room, ServerState, ThresholdVersion } from "../domain/types";

/** 按时间戳自带偏移量取挂钟 Date（getUTC* 读出当地时分） */
function wallDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?/.exec(iso);
  if (!m) return new Date(iso);
  const [, y, mo, da, h, mi, se, offsetRaw] = m;
  let offMin = 0;
  if (offsetRaw && offsetRaw !== "Z") {
    const sign = offsetRaw.startsWith("-") ? -1 : 1;
    offMin = sign * (Number(offsetRaw.slice(1, 3)) * 60 + Number(offsetRaw.slice(3).replace(":", "") || "0"));
  }
  const utcMs = Date.UTC(+y, +mo - 1, +da, +h, +mi, se ? +se : 0) - offMin * 60000;
  return new Date(utcMs);
}

export const fmtTime = (iso: string): string => {
  const d = wallDate(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export const fmtFull = (iso: string): string => {
  const d = wallDate(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${fmtTime(iso)}`;
};

export const fmtCounts = (counts: Record<Channel, number>): string =>
  CHANNELS.map((ch) => `${ch}µm:${counts[ch]}`).join("  ");

export function roomOf(state: ServerState, roomId: string): Room {
  return state.rooms.find((r) => r.id === roomId)!;
}

export function limitRow(tv: ThresholdVersion, grade: Reading["grade"]): Record<Channel, number> {
  return tv.limits[grade];
}

/** 读数在其判定依据版本下的逐通道状态（用于高亮超限/下降） */
export function channelState(
  state: ServerState,
  r: Reading,
): { ch: Channel; value: number; limit: number; over: boolean; drop: boolean }[] {
  const tv = state.thresholds.find((t) => t.version === r.basisVersion) ?? currentThreshold(state);
  const row = tv.limits[r.grade];
  return CHANNELS.map((ch) => ({
    ch,
    value: r.counts[ch],
    limit: row[ch],
    over: r.overChannels.includes(ch),
    drop: !!r.dropChannels?.includes(ch),
  }));
}
