/**
 * locales.ts —— BCP-47 → 人类可读语言名的共享映射(纯函数,主进程 + 渲染层共用)。
 *
 * 用途:
 *   - agent/exam/exercise 提示词里注入输出语言名("Always respond in English")
 *   - 渲染层 🌐 切换器的选项显示名(MapRail 曾有自己的副本,现统一到这)
 *
 * 未知 locale 一律原样返回(如 "pt" → "pt"),不猜名字。
 */

/** locale → 该语言的自称名(尽量用母语写法,语言学习者认得出) */
export const LOCALE_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: "English",
  "zh-CN": "中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  "pt-BR": "Português",
  ru: "Русский",
  it: "Italiano",
  ar: "العربية",
  hi: "हिन्दी",
  tr: "Türkçe",
  pl: "Polski",
  nl: "Nederlands",
  id: "Indonesia",
  vi: "Tiếng Việt",
  th: "ไทย",
  sv: "Svenska",
  fi: "Suomi",
};

/** BCP-47 → 语言名;未映射的 locale 原样返回 */
export function localeToLanguageName(locale: string): string {
  return LOCALE_LANGUAGE_NAMES[locale] ?? locale;
}

/** 是否中文系(zh / zh-CN / zh-TW / zh-HK ...) */
export function isZhLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

/**
 * AI 输出语言指令(注入 agent 基座系统提示词开头)。
 *
 * zh 路径逐字节等同旧硬编码句("用清晰、鼓励的中文回答。...")——默认行为零变化;
 * 非 zh 用英文指令,显式点名工具参数(题干/选项/解析)也必须跟随,
 * 否则 LLM 容易在 generate_quiz 等工具入参里溜回中文。
 */
export function buildLanguageDirective(locale: string): string {
  const name = localeToLanguageName(locale);
  if (isZhLocale(locale)) {
    return "用清晰、鼓励的中文回答。当学习者答错时，先肯定尝试再纠正。";
  }
  return (
    `Always respond in ${name}. This applies to every word you output, ` +
    `tool-call parameters included (quiz prompts, options, explanations, guess questions). ` +
    `Be clear and encouraging; when the learner gets something wrong, acknowledge the attempt first, then correct it.`
  );
}

/**
 * 决定 AI 输出(对话/出题)用的语言:界面语言即偏好——用户把界面切成什么,
 * AI 就说什么。未传(null/缺省/空白)→ zh-CN(历史默认)。
 * 纯函数:界面语言由渲染层(i18n)持有,经 IPC 显式传入,主进程不猜。
 */
export function resolveOutputLang(explicit: string | null | undefined): string {
  if (explicit && explicit.trim()) return explicit;
  return "zh-CN";
}

/** 出题提示词里的语言行(题干/选项语言约束) */
export function questionLanguageLine(locale: string): string {
  const name = localeToLanguageName(locale);
  if (isZhLocale(locale)) return "- 题干和选项用中文,清晰无歧义";
  return `- Write the question stem and options in ${name}, clear and unambiguous`;
}
