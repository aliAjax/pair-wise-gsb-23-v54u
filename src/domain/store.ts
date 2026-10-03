import { buildSeedState } from "./seed";
import { AppState } from "./types";

const STORAGE_KEY = "hxwl09-cleanroom-v1";

// 整棵状态树（含待补传草稿）持久化到本机：草稿保存失败后刷新页面也不丢
export const loadState = (): AppState => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch {
    // 存储不可用或数据损坏时回退到种子
  }
  return buildSeedState();
};

export const persistState = (state: AppState): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 本机存储写失败不阻断业务流转
  }
};

export const resetState = (): AppState => {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return buildSeedState();
};
