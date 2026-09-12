/**
 * shimeji-pack-store —— Shimeji 激活包的渲染层数据源(第七形态,
 * 模式与 custom-pack-store 相同:模块级单例 + useSyncExternalStore 订阅)。
 * 帧图惰性取回并缓存(同帧跨动作复用);动作/行为来自包 manifest。
 */
import type { ShimejiPackManifestT } from "@shared/types.ts";

export interface ActiveShimejiView {
  id: string;
  name: string;
  manifest: ShimejiPackManifestT;
}

let cache: ActiveShimejiView | null = null;
const frameCache = new Map<string, string>();
let inflight = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function getActiveShimeji(): ActiveShimejiView | null {
  return cache;
}

export function subscribeActiveShimeji(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 帧图取回(缓存命中同步返回;未命中发 IPC,到位后 emit 重渲染)。 */
export function getFrameSrc(packId: string, frame: string): string | null {
  const key = `${packId}/${frame}`;
  const hit = frameCache.get(key);
  if (hit) return hit;
  void window.api
    ?.shimejiGetFrame?.({ packId, frame })
    .then((src) => {
      if (src) {
        frameCache.set(key, src);
        emit();
      }
    })
    .catch(() => undefined);
  return null;
}

/** 重拉激活包(导入/删除/激活后调用;无 api=lab 环境 → 空缓存诚实占位)。 */
export async function refreshActiveShimeji(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const res = await window.api?.shimejiGetActive?.();
    cache = res ? { id: res.id, name: res.name, manifest: res } : null;
    emit();
  } finally {
    inflight = false;
  }
}
