/**
 * selection-popover —— 选区浮按钮(提问这段/加笔记)的定位策略。
 *
 * 手机 Chrome/Safari 的原生文字选择菜单(复制/全选/分享/搜索)锚定在**选区上方**,
 * 浮钮放上侧必然被遮 —— 所以改为优先**选区右侧垂直居中**:
 *   1. 右侧放得下 → 选区右缘 + 8px,垂直居中
 *   2. 右侧放不下(选到行尾) → 选区左侧
 *   3. 两侧都满(整行/整段选满) → 选区下方左对齐(原生菜单在上方,下方安全)
 *
 * 拖选扩展时指针会扫过浮钮(右侧=向右多选的必经之路)→ 选区漂移的根因不在
 * 位置,由组件层解决:拖选手势期间浮层 pointer-events:none 可见但穿透
 * (NotebookPanel/ChatStream 的 popoverSelecting)。别再靠挪位置治拖选
 * 干扰——任何静态位置总有一个拖动方向会撞上。
 *
 * 纯函数;坐标一律相对定位容器(调用方把 viewport 坐标减去容器 rect)。
 */

export interface PopoverPos {
  left: number;
  top: number;
  transform: string;
}

export function selectionPopoverPosition(
  sel: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  /** 定位容器宽度(按钮组绝对定位在容器内) */
  containerWidth: number,
  /** 按钮组预估宽度(两钮 ~200,单钮 ~110) */
  popoverW: number,
  /** 选区末行行盒(多行拖选时右侧锚"最后一个字"而非外接框右缘;缺省=锚 sel 旧行为) */
  endRect?: { left: number; top: number; right: number; bottom: number; width: number; height: number },
): PopoverPos {
  const GAP = 8;
  const anchor = endRect ?? sel;
  const midY = anchor.top + anchor.height / 2;
  if (anchor.right + GAP + popoverW <= containerWidth) {
    return { left: anchor.right + GAP, top: midY, transform: "translate(0, -50%)" };
  }
  if (sel.left - GAP - popoverW >= 0) {
    return { left: sel.left - GAP, top: midY, transform: "translate(-100%, -50%)" };
  }
  return { left: sel.left, top: anchor.bottom + GAP, transform: "translate(0, 0)" };
}
