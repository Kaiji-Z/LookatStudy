/**
 * composer-height —— 输入框随内容自增长的高度决策(纯函数,v0.43)。
 *
 * 配方回流自 dsh 插件(随内容增长/40vh 封顶/发送归位),按主仓 composer 卡形态调整:
 * 双向自适应——删行即回缩(插件的 grow-only 靠手工拖柄补缩,主仓卡式布局不设柄,
 * 自动回缩更稳);封顶后内滚;发送清空文本走 [input] 依赖的 layoutEffect 自然归位。
 */

/** 40vh 封顶换算;极小视口给地板,免得退化成 0 高 */
export function composerCapPx(viewportH: number, ratio = 0.4, floorPx = 120): number {
  if (!Number.isFinite(viewportH) || viewportH <= 0) return floorPx;
  return Math.max(floorPx, Math.round(viewportH * ratio));
}

/**
 * 重置 height:auto 后的目标高:scrollHeight 钳在 [basePx, capPx]。
 * basePx=rows=2 的固有高(挂载时输入为空量得);非有限 scrollHeight 回 basePx 保底。
 */
export function nextComposerHeight(scrollHeight: number, capPx: number, basePx: number): number {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return basePx;
  return Math.max(basePx, Math.min(Math.round(scrollHeight), capPx));
}
