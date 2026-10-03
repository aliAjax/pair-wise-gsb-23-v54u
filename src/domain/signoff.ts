import { withEvent } from "./evaluate";
import { canSignRoom, canWrite } from "./permissions";
import { AppState, User, readingKey } from "./types";

export interface SignResult {
  state: AppState;
  ok: boolean;
  reason?: string;
}

// 签认：仅班组长、仅本班房间、仅待复核读数。
// 签认时把当前评估（阈值版本+限值+结论）整份快照为“当时依据”，之后阈值改动不再回写。
export const signOffReading = (
  state: AppState,
  key: string,
  user: User,
  at: string,
): SignResult => {
  const deny = (reason: string): SignResult => ({
    state: withEvent(state, "signoff-denied", user.id, at, `签认被拒：${key}（${reason}）`, {
      reading: key,
      reason,
    }),
    ok: false,
    reason,
  });

  if (!canWrite(user)) return deny("审计员只读，不能签认");
  const reading = state.readings.find((r) => readingKey(r) === key);
  if (!reading) return deny("读数不存在");
  if (reading.status === "signed") return deny("读数已签认");
  const room = state.rooms.find((r) => r.id === reading.roomId);
  if (!room || !canSignRoom(user, room)) return deny("非本班房间，班组长无权签认");

  const signed = {
    ...reading,
    status: "signed" as const,
    signOff: {
      userId: user.id,
      userName: user.name,
      signedAt: at,
      basis: { ...reading.evaluation },
    },
  };
  let s: AppState = {
    ...state,
    readings: state.readings.map((r) => (readingKey(r) === key ? signed : r)),
  };
  s = withEvent(
    s,
    "signoff",
    user.id,
    at,
    `${user.name} 签认 ${key}（${reading.roomId}）：${signed.signOff.basis.level}，依据 ${signed.signOff.basis.thresholdVersionId}`,
    {
      reading: key,
      room: reading.roomId,
      level: signed.signOff.basis.level,
      threshold: signed.signOff.basis.thresholdVersionId,
    },
  );
  return { state: s, ok: true };
};
