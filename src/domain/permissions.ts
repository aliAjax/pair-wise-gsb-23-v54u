import { AppState, Room, User } from "./types";

// 审计员只查看事实：任何写操作前都必须过 canWrite
export const canWrite = (user: User): boolean => user.role !== "auditor";

// 班组长只能签认本班房间
export const canSignRoom = (user: User, room: Room): boolean =>
  user.role === "shiftLeader" && user.shiftId === room.shiftId;

export const findUser = (state: AppState, userId: string): User | undefined =>
  state.users.find((u) => u.id === userId);
