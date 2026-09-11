/**
 * custom-pack-store —— 自定义纸偶包的渲染层数据源(模块级单例,新文件零既有 diff)。
 *
 * 包文件由主进程持有(userData/companion-packs/);渲染层启动与包变更时各拉一次
 * 激活包(manifest + 部件 dataURL),CustomPuppetArt 经 useSyncExternalStore 订阅。
 * CustomBotsSection 应用/删除后调 refreshActivePack()。布局(layoutParts)在拉取时
 * 算好缓存——切分件原图坐标 → 伴学 svg 200×200 舞台,确定性纯函数。
 */
import { figureBoxOfParts, layoutParts, type CutPackManifest, type PuppetPartLayout } from "@shared/companion-cut.ts";

export interface ActivePackView {
  id: string;
  name: string;
  manifest: CutPackManifest;
  /** 部件名 → dataURL(key=PartName|"sticker") */
  srcs: Record<string, string>;
  layout: PuppetPartLayout[];
}

let cache: ActivePackView | null = null;
let inflight = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function getActivePack(): ActivePackView | null {
  return cache;
}

export function subscribeActivePack(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 重拉激活包(无 api=lab 环境 / 读取失败 → 空缓存,纸偶渲染诚实占位)。 */
export async function refreshActivePack(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const res = await window.api?.companionPackGetActive?.();
    cache =
      res && res.manifest && Object.keys(res.srcs ?? {}).length > 0
        ? {
            id: res.id,
            name: res.name,
            manifest: res.manifest,
            srcs: res.srcs,
            // 标定框=部件盒并集,原样传入(2026-09-10 修:曾把 width/height 回写成
            // 画布尺寸——平移按部件框原点、缩放按整画布,两坐标系混杂,纸偶整体左偏);
            // 底部锚定(2026-09-11):任何宽高比素材脚都踩在舞台底线上,不悬空
            layout: layoutParts(figureBoxOfParts(res.manifest.parts), res.manifest.parts, { x: 24, y: 22, w: 152, h: 154 }, "bottom"),
          }
        : null;
    emit();
  } catch {
    /* 保留旧值 */
  } finally {
    inflight = false;
  }
}

/** 切换激活包(多 bot 卡片"使用"按钮):切指针 + 重拉 + 广播。 */
export async function activatePack(id: string): Promise<void> {
  await window.api?.companionPackActivate?.({ id });
  await refreshActivePack();
  window.dispatchEvent(new Event("companion-config-changed"));
}

// 模块自启:forms 链首次 import 即拉(启动时设置项读取走 IPC,异步到达后 emit 重渲染)
void refreshActivePack();
// 包激活/删除都会广播 companion-config-changed(CustomBotsSection 与 ui-test 探针同款)——
// store 跟着 bus 一起自维护,渲染层任何角落都不需要手动刷新
if (typeof window !== "undefined") {
  window.addEventListener("companion-config-changed", () => {
    void refreshActivePack();
  });
}
