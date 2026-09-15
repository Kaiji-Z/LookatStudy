/**
 * 头像 chip 纯函数 —— 称呼 → 稳定底色 + 首字母(个人资料窗口标题栏入口用, SPEC §1)。
 *
 * 设计:名字 hash → 8 色精选盘(明度/饱和受控,双主题下都可读;避开 brand/warning 语义色
 * 的强联想)。同名永远同色("随机感"但跨会话稳定,不闪变);空名 → null(调用方回退
 * User 图标 + 中性底)。
 */

/** 精选 8 色(bg=底色, fg=前景字母色;浅底深字,双主题通用)。 */
const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: "#E8F0FE", fg: "#1a56DB" }, // 蓝
  { bg: "#E6F4EA", fg: "#137333" }, // 绿
  { bg: "#FDF0E6", fg: "#B25000" }, // 橙
  { bg: "#F3E8FD", fg: "#6B21A8" }, // 紫
  { bg: "#FDE8E8", fg: "#B91C1C" }, // 红
  { bg: "#E0F2F1", fg: "#00695C" }, // 青
  { bg: "#FEF9E7", fg: "#92760B" }, // 黄
  { bg: "#ECEFF1", fg: "#455A64" }, // 蓝灰
];

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h);
}

export interface AvatarStyle {
  bg: string;
  fg: string;
  initial: string;
}

/** 称呼 → {底色, 字色, 首字母}。空/纯空白名 → null(调用方回退图标)。 */
export function nameAvatar(name: string | null | undefined): AvatarStyle | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  // 首字母:Latin 取首字符大写;CJK 取第一个字符;emoji 序列由 [...n] 正确取码点
  const first = [...n][0] ?? "";
  const initial = /[a-z]/i.test(first) ? first.toUpperCase() : first;
  const palette = AVATAR_PALETTE[hashString(n.toLowerCase()) % AVATAR_PALETTE.length];
  return { bg: palette.bg, fg: palette.fg, initial };
}
