/**
 * selection-popover —— 选区浮按钮(提问这段/加笔记)的定位策略。
 *
 * 用户拍板:浮钮出现在**选区正上方**——水平居中于选区中心(两端钳制在容器内),
 * 垂直贴选区顶 -8px;选区贴容器顶放不下时,回退选区下方左对齐。
 *
 * 已知取舍:手机 Chrome/Safari 原生选择菜单(复制/全选/分享)也锚在选区上方,
 * 手机端可能与浮钮叠位——实测碍事再加 coarse-pointer 侧位回退,先不过度设计。
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
  /** 按钮组预估宽度(讲解区两钮 ~150,对话区单钮 ~110) */
  popoverW: number,
  /** 按钮组预估高度(px-2 py-1.5 text-label ≈ 36) */
  popoverH: number,
): PopoverPos {
  const GAP = 8;
  if (sel.top - GAP - popoverH >= 0) {
    /* 上方:水平居中于选区中心,钳制不溢出容器(选区靠边时向内收)。
       内层 max 保证容器比按钮还窄的退化场景钳制序不倒挂。 */
    const center = sel.left + sel.width / 2;
    const left = Math.min(Math.max(center, popoverW / 2), Math.max(popoverW / 2, containerWidth - popoverW / 2));
    return { left, top: sel.top - GAP, transform: "translate(-50%, -100%)" };
  }
  /* 上方放不下(选区贴容器顶,如首段):选区下方左对齐,左缘同样钳制。 */
  const left = Math.min(Math.max(sel.left, 0), Math.max(0, containerWidth - popoverW));
  return { left, top: sel.bottom + GAP, transform: "translate(0, 0)" };
}
