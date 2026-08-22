/**
 * selection-popover —— 选区浮按钮(提问这段/加笔记)的定位策略。
 *
 * fine 指针(桌面):右侧优先——手机原生菜单在上方的那条理由对桌面不成立,
 * 但右侧与选区末端平齐最顺手:
 *   1. 右侧放得下 → 选区末行右缘 + 8px,末行垂直居中
 *   2. 右侧放不下(选到行尾) → 选区左侧
 *   3. 两侧都满(整行/整段选满) → 选区下方左对齐
 *
 * coarse 指针(手机,preferBelow):**选区下方左对齐**——不能锚末端右侧:
 * 那正是拖选手柄的位置(长按出柄→拖柄调整是手机选字的必经动作),
 * 按钮贴着手柄放,手指去抓柄会误触按钮;下方同时避开上方原生菜单
 * (复制/全选/分享)和两端手柄。调整选区途中按钮隐藏,松手/停稳才显示
 * (组件层 settle 门控)。
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
  /** 按钮组预估宽度(两钮 ~150,单钮 ~110;粗指针 44px 级再放大) */
  popoverW: number,
  /** 选区末行行盒(多行拖选时右侧锚"最后一个字"而非外接框右缘;缺省=锚 sel 旧行为) */
  endRect?: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  /** 粗指针(手机):跳过右侧/左侧直接落选区下方——避开拖选手柄与原生菜单 */
  preferBelow?: boolean,
): PopoverPos {
  const GAP = 8;
  const anchor = endRect ?? sel;
  const midY = anchor.top + anchor.height / 2;
  if (!preferBelow && anchor.right + GAP + popoverW <= containerWidth) {
    return { left: anchor.right + GAP, top: midY, transform: "translate(0, -50%)" };
  }
  if (!preferBelow && sel.left - GAP - popoverW >= 0) {
    return { left: sel.left - GAP, top: midY, transform: "translate(-100%, -50%)" };
  }
  return { left: Math.min(Math.max(sel.left, 0), Math.max(0, containerWidth - popoverW)), top: anchor.bottom + GAP, transform: "translate(0, 0)" };
}
