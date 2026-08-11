/**
 * 语言偏好服务 —— 用户持久化语言选择，替代导入时弹窗。
 *
 * 设计:
 *   - 首次启动检测系统语言 → 写 pref_lang 默认值（不覆盖已存在）
 *   - 用户可在 Settings 改（英语 / 简中 / 繁中）
 *   - 导入时读 pref_lang，自动匹配仓库可用翻译（sourceLang 模型）
 *
 * sourceLang 模型（与 pref_lang 配合）:
 *   pref === sourceLang → 用原文，不拉翻译
 *   pref !== sourceLang 且仓库有 pref 翻译 → 拉该翻译
 *   pref !== sourceLang 且无对应翻译 → 用原文（严格 fallback）
 */
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { settings } from "../db/schema.js";

type Db = SQLJsDatabase<typeof schema>;

/** 偏好语言 setting key */
export const PREF_LANG_KEY = "pref_lang";

/** 支持的偏好语言选项 */
export const SUPPORTED_LANGS = [
  { code: "en", name: "English", nativeName: "英语" },
  { code: "zh-CN", name: "简体中文", nativeName: "简体中文" },
  { code: "zh-TW", name: "繁體中文", nativeName: "繁中" },
] as const;

/**
 * 系统语言 → 偏好语言映射。
 * Electron app.getLocale() 返回 ICU locale（如 zh-CN / zh-TW / en-US）。
 */
export function localeToPrefLang(locale: string): string {
  const l = locale.toLowerCase();
  if (l.startsWith("zh-cn") || l.startsWith("zh-hans") || l.startsWith("zh-sg")) return "zh-CN";
  if (l.startsWith("zh-tw") || l.startsWith("zh-hant") || l.startsWith("zh-hk") || l.startsWith("zh-mo")) return "zh-TW";
  return "en";
}

/** 读 pref_lang；未设置返回 null */
export function getPrefLang(db: Db): string | null {
  const row = db.select().from(settings).where(eq(settings.key, PREF_LANG_KEY)).get();
  return row?.value ?? null;
}

/** 写 pref_lang（upsert） */
export function setPrefLang(db: Db, lang: string, markDirty: () => void): void {
  const existing = db.select().from(settings).where(eq(settings.key, PREF_LANG_KEY)).get();
  if (existing) {
    db.update(settings).set({ value: lang }).where(eq(settings.key, PREF_LANG_KEY)).run();
  } else {
    db.insert(settings).values({ key: PREF_LANG_KEY, value: lang }).run();
  }
  markDirty();
}

/**
 * 首次启动初始化：若 pref_lang 不存在，按系统语言写默认值。
 * 已存在则不覆盖（尊重用户已选）。
 */
export function ensurePrefLang(db: Db, systemLocale: string): void {
  const existing = db.select().from(settings).where(eq(settings.key, PREF_LANG_KEY)).get();
  if (existing) return; // 已有，不覆盖
  const defaultLang = localeToPrefLang(systemLocale);
  db.insert(settings).values({ key: PREF_LANG_KEY, value: defaultLang }).run();
}

/**
 * 根据偏好 + 仓库原文语言 + 仓库可用翻译，决定导入时用哪个语言。
 *
 * @returns { langCode, reason } langCode=null 表示用原文不拉翻译
 */
export function resolveImportLang(
  pref: string,
  sourceLang: string | null,
  availableTranslations: { code: string; name: string }[],
): { langCode: string | null; reason: string } {
  const src = sourceLang ?? "en";
  // pref === sourceLang → 用原文
  if (pref === src) {
    return { langCode: null, reason: `偏好(${pref})与仓库原文(${src})一致，直接用原文` };
  }
  // 仓库有 pref 翻译 → 拉该翻译
  const hasTranslation = availableTranslations.some((t) => t.code === pref);
  if (hasTranslation) {
    return { langCode: pref, reason: `仓库原文(${src})，按偏好拉取${pref}翻译` };
  }
  // 严格 fallback → 用原文
  return { langCode: null, reason: `仓库原文(${src})，无${pref}翻译，用原文` };
}
