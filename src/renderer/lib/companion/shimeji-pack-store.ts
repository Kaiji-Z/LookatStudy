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
/** 在途帧去重:50ms 调度循环连续渲染同一未缓存帧时,只发一次 IPC。 */
const pendingFrames = new Set<string>();
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

/** 帧图取回(缓存命中同步返回;未命中发 IPC,到位后 emit 重渲染)。
 *  返回 null ≠ 画空框——渲染层应沿用上一帧(见 ShimejiArt lastSrcRef)。 */
export function getFrameSrc(packId: string, frame: string): string | null {
  const key = `${packId}/${frame}`;
  const hit = frameCache.get(key);
  if (hit) return hit;
  if (!pendingFrames.has(key)) {
    pendingFrames.add(key);
    void window.api
      ?.shimejiGetFrame?.({ packId, frame })
      .then((src) => {
        if (src) {
          frameCache.set(key, src);
          emit();
        }
      })
      .catch(() => undefined)
      .finally(() => pendingFrames.delete(key));
  }
  return null;
}

/** 激活包帧预取(v0.37.1):manifest 全部 pose 帧并发拉回。
 *  修"空方框"——随机选播让长尾动作轮上场,每张首播帧都撞一次"IPC 在途→空框"
 *  的时序洞;包激活时把帧全部拉进缓存,首播即命中,闪框从根上消失。 */
export async function prefetchFrames(view: ActiveShimejiView): Promise<void> {
  const frames = new Set<string>();
  for (const a of view.manifest.actions ?? []) {
    for (const pose of a.poses ?? []) {
      if (pose?.image) frames.add(pose.image);
    }
  }
  await Promise.all(
    [...frames].map((f) => {
      const key = `${view.id}/${f}`;
      if (frameCache.has(key)) return Promise.resolve();
      if (pendingFrames.has(key)) return Promise.resolve();
      pendingFrames.add(key);
      return window.api
        ?.shimejiGetFrame?.({ packId: view.id, frame: f })
        .then((src) => {
          if (src) frameCache.set(key, src);
        })
        .catch(() => undefined)
        .finally(() => pendingFrames.delete(key));
    }),
  );
  emit();
}

/** 重拉激活包(导入/删除/激活后调用;无 api=lab 环境 → 空缓存诚实占位)。 */
export async function refreshActiveShimeji(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const res = await window.api?.shimejiGetActive?.();
    cache = res ? { id: res.id, name: res.name, manifest: res } : null;
    emit();
    if (cache) void prefetchFrames(cache);
  } finally {
    inflight = false;
  }
}
