/**
 * forms-index —— 伴学伙伴形象注册表的纯逻辑层(零 DOM/零 React,verify 直测)。
 *
 * 形象=同一 cel-shading 设计语法(墨描边+同形错位硬阴影+色阶带)下的不同物种,
 * 共享一套生命系统(姿势/表情/口型/逐键按压/麦克风弧)。组件注册在
 * components/companion/forms/registry.tsx;本文件只放可 headless 验证的
 * id 清单与设置回退逻辑——垃圾值/未设置都回退默认形态,绝不白屏。
 */
export const COMPANION_FORM_IDS = ["ember", "frost", "moss", "astro", "ink"] as const;

export type CompanionFormId = (typeof COMPANION_FORM_IDS)[number];

export const DEFAULT_COMPANION_FORM: CompanionFormId = "ember";

/** companion_form 设置值 → 形象 id。未知/空/垃圾值 → 默认(小焰)。 */
export function formIdFromSetting(stored: string | null | undefined): CompanionFormId {
  return (COMPANION_FORM_IDS as readonly string[]).includes(stored ?? "")
    ? (stored as CompanionFormId)
    : DEFAULT_COMPANION_FORM;
}
