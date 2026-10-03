import { AppState, EvalLevel } from "../domain/types";

export const fmtTime = (iso: string): string => iso.slice(11, 19);

export const levelText: Record<EvalLevel, string> = {
  normal: "正常",
  warn: "预警",
  action: "行动限",
};

export const levelClass: Record<EvalLevel, string> = {
  normal: "lv-normal",
  warn: "lv-warn",
  action: "lv-action",
};

export const nextSeq = (state: AppState, deviceSerial: string): number =>
  state.readings.reduce((m, r) => (r.deviceSerial === deviceSerial ? Math.max(m, r.seq) : m), 0) + 1;

export const lastCumulative = (state: AppState, deviceSerial: string): number =>
  state.readings
    .filter((r) => r.deviceSerial === deviceSerial)
    .reduce((m, r) => Math.max(m, r.cumulative), 0);
