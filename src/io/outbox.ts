import type { DevicePacket, OfflineDraft, PendingPacket } from "../domain/types";

// 本机待补传队列：草稿保存（或服务器确认）失败时绝不丢数据，先落本机持久化
const DRAFTS_KEY = "hxwl09.outbox.drafts";
const PACKETS_KEY = "hxwl09.outbox.packets";

const hasStorage = typeof localStorage !== "undefined";

function read<T>(key: string): T[] {
  if (!hasStorage) return [];
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown): void {
  if (!hasStorage) {
    throw new Error("本机存储不可用");
  }
  localStorage.setItem(key, JSON.stringify(value));
}

export const outbox = {
  drafts(): OfflineDraft[] {
    return read<OfflineDraft>(DRAFTS_KEY).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  },

  packets(): PendingPacket[] {
    return read<PendingPacket>(PACKETS_KEY).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  },

  /** 保存草稿：成功持久化才算保存成功；返回 false 时调用方应提示且数据仍保留在表单/内存 */
  saveDraft(draft: OfflineDraft): boolean {
    try {
      const list = read<OfflineDraft>(DRAFTS_KEY);
      if (!list.some((d) => d.clientDraftId === draft.clientDraftId)) {
        write(DRAFTS_KEY, [...list, draft]);
      }
      return true;
    } catch {
      return false;
    }
  },

  queuePacket(packet: DevicePacket): PendingPacket {
    const item: PendingPacket = {
      id: `PQ-${packet.deviceSn}-${packet.seq}`,
      packet,
      queuedAt: new Date().toISOString(),
    };
    const list = read<PendingPacket>(PACKETS_KEY);
    if (!list.some((p) => p.packet.deviceSn === packet.deviceSn && p.packet.seq === packet.seq)) {
      write(PACKETS_KEY, [...list, item]);
    }
    return item;
  },

  removeDraft(clientDraftId: string): void {
    write(DRAFTS_KEY, read<OfflineDraft>(DRAFTS_KEY).filter((d) => d.clientDraftId !== clientDraftId));
  },

  removePacket(deviceSn: string, seq: number): void {
    write(
      PACKETS_KEY,
      read<PendingPacket>(PACKETS_KEY).filter(
        (p) => !(p.packet.deviceSn === deviceSn && p.packet.seq === seq),
      ),
    );
  },

  clear(): void {
    if (!hasStorage) return;
    localStorage.removeItem(DRAFTS_KEY);
    localStorage.removeItem(PACKETS_KEY);
  },
};
