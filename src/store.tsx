import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import {
  closeTicket,
  ingestPacket,
  PermissionError,
  publishThreshold,
  signTask,
  submitDraft,
} from "./domain/engine";
import { buildScenario } from "./domain/scenario";
import type {
  DevicePacket,
  OfflineDraft,
  PendingPacket,
  ServerState,
  ThresholdVersion,
  User,
} from "./domain/types";
import { USERS } from "./domain/seed";
import { outbox } from "./io/outbox";

interface AppState {
  server: ServerState;
  currentUser: User;
  offline: boolean; // 模拟链路中断（黄光区断网）
  pendingDrafts: OfflineDraft[];
  pendingPackets: PendingPacket[];
  notice?: { kind: "ok" | "err" | "info"; text: string };
}

type Action =
  | { type: "switch-user"; user: User }
  | { type: "toggle-offline" }
  | { type: "notice"; notice: AppState["notice"] }
  | { type: "save-draft"; draft: OfflineDraft }
  | { type: "queue-packet"; packet: DevicePacket }
  | { type: "refresh-outbox"; drafts: OfflineDraft[]; packets: PendingPacket[] }
  | { type: "server"; next: ServerState; notice?: AppState["notice"] };

function initialState(): AppState {
  return {
    server: buildScenario(),
    currentUser: USERS[2], // 默认白班班组长，便于直接演示签认
    offline: false,
    pendingDrafts: outbox.drafts(),
    pendingPackets: outbox.packets(),
  };
}

function reducer(prev: AppState, action: Action): AppState {
  switch (action.type) {
    case "switch-user":
      return { ...prev, currentUser: action.user, notice: undefined };
    case "toggle-offline":
      return { ...prev, offline: !prev.offline, notice: undefined };
    case "notice":
      return { ...prev, notice: action.notice };
    case "save-draft":
      return { ...prev, pendingDrafts: outbox.drafts() };
    case "queue-packet":
      return { ...prev, pendingPackets: outbox.packets() };
    case "refresh-outbox":
      return { ...prev, pendingDrafts: action.drafts, pendingPackets: action.packets };
    case "server":
      return {
        ...prev,
        server: action.next,
        notice: action.notice,
        pendingDrafts: outbox.drafts(),
        pendingPackets: outbox.packets(),
      };
    default:
      return prev;
  }
}

interface StoreApi {
  state: AppState;
  switchUser: (user: User) => void;
  toggleOffline: () => void;
  /** 设备报文：在线直接入库；断网进本机待补传队列 */
  reportPacket: (packet: DevicePacket) => void;
  /** 草稿先存本机，在线则立刻补传；保存失败只提示、不丢数据 */
  saveDraft: (draft: OfflineDraft) => void;
  flushAll: () => void;
  publishThreshold: (next: ThresholdVersion) => void;
  signTask: (taskId: string) => void;
  closeTicket: (ticketId: string) => void;
  resetDemo: () => void;
  dismissNotice: () => void;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  const api = useMemo<StoreApi>(() => {
    const guard = (fn: () => ServerState, ok: string) => {
      try {
        const next = fn();
        dispatch({ type: "server", next, notice: { kind: "ok", text: ok } });
      } catch (e) {
        const text = e instanceof PermissionError ? `权限被拒：${e.message}` : (e as Error).message;
        dispatch({ type: "notice", notice: { kind: "err", text } });
      }
    };

    return {
      state,
      switchUser: (user) => dispatch({ type: "switch-user", user }),
      toggleOffline: () => dispatch({ type: "toggle-offline" }),

      reportPacket: (packet) => {
        if (state.offline) {
          outbox.queuePacket(packet);
          dispatch({ type: "queue-packet", packet });
          dispatch({
            type: "notice",
            notice: { kind: "info", text: `链路中断：#${packet.seq} 已存入本机待补传队列` },
          });
          return;
        }
        guard(() => ingestPacket(state.server, packet), `#${packet.seq} 已入库（幂等键 ${packet.deviceSn}#${packet.seq}）`);
      },

      saveDraft: (draft) => {
        const saved = outbox.saveDraft(draft);
        if (!saved) {
          dispatch({
            type: "notice",
            notice: { kind: "err", text: "草稿保存失败：本机存储不可用，数据保留在表单中，请重试或手抄" },
          });
          return;
        }
        dispatch({ type: "save-draft", draft });
        if (state.offline) {
          dispatch({
            type: "notice",
            notice: { kind: "info", text: `草稿 ${draft.clientDraftId} 已保存在本机，待网络恢复补传` },
          });
          return;
        }
        try {
          const next = submitDraft(state.server, draft);
          outbox.removeDraft(draft.clientDraftId);
          dispatch({
            type: "server",
            next,
            notice: { kind: "ok", text: `补录 ${draft.clientDraftId} 已按房间合并` },
          });
        } catch (e) {
          // 服务端确认失败：草稿继续留在本机待补传
          dispatch({
            type: "notice",
            notice: { kind: "err", text: `补传失败，草稿保留本机：${(e as Error).message}` },
          });
        }
      },

      flushAll: () => {
        if (state.offline) {
          dispatch({ type: "notice", notice: { kind: "err", text: "仍处于断网状态，无法补传" } });
          return;
        }
        let server = state.server;
        let ok = 0;
        let err = 0;
        for (const p of outbox.packets()) {
          try {
            server = ingestPacket(server, p.packet);
            outbox.removePacket(p.packet.deviceSn, p.packet.seq);
            ok += 1;
          } catch {
            err += 1;
          }
        }
        for (const d of outbox.drafts()) {
          try {
            server = submitDraft(server, d);
            outbox.removeDraft(d.clientDraftId);
            ok += 1;
          } catch {
            err += 1;
          }
        }
        dispatch({
          type: "server",
          next: server,
          notice: {
            kind: err ? "err" : "ok",
            text: `本机待补传已合并：成功 ${ok} 条${err ? `，失败保留 ${err} 条` : ""}`,
          },
        });
      },

      publishThreshold: (next) =>
        guard(() => publishThreshold(state.server, next), `阈值 v${next.version} 已发布，待复核读数已重算`),

      signTask: (taskId) => guard(() => signTask(state.server, taskId, state.currentUser), "任务已签认，判定依据已冻结"),

      closeTicket: (ticketId) => guard(() => closeTicket(state.server, ticketId, state.currentUser), "工单已关闭"),

      resetDemo: () => {
        outbox.clear();
        dispatch({ type: "server", next: initialState().server, notice: { kind: "info", text: "演示数据已重置" } });
      },

      dismissNotice: () => dispatch({ type: "notice", notice: undefined }),
    };
  }, [state]);

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
