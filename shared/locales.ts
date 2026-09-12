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
 *
 * v0.33 语言学习双轴:targetLang(课程教的语言,来自导入时 LLM 判断,courses.language_target)
 * 存在时追加"目标语言 carve-out"——教学语言仍是界面语言,但目标语言素材(课文/例句/题目)
 * 必须保持原文,不许翻译成教学语言来出题。不传 targetLang = 非语言课程,行为逐字节不变。
 */
export function buildLanguageDirective(locale: string, targetLang?: string | null): string {
  const name = localeToLanguageName(locale);
  if (isZhLocale(locale)) {
    const base = "用清晰、鼓励的中文回答。当学习者答错时，先肯定尝试再纠正。";
    if (!targetLang) return base;
    const t = localeToLanguageName(targetLang);
    return (
      base +
      `这是一门${t}学习课程:讲解、指令、反馈用中文,但课文引用、例句、题目中的语言素材必须保持${t}原文` +
      `——不要把目标语言材料翻译成中文来讲解或出题(生词可附中文注释)。`
    );
  }
  const base =
    `Always respond in ${name}. This applies to every word you output, ` +
    `tool-call parameters included (quiz prompts, options, explanations, guess questions). ` +
    `Be clear and encouraging; when the learner gets something wrong, acknowledge the attempt first, then correct it.`;
  if (!targetLang) return base;
  const t = localeToLanguageName(targetLang);
  return (
    base +
    ` This course teaches ${t}: your explanations and instructions stay in ${name}, ` +
    `but reading passages, example sentences, and quiz language material must remain in original ${t} ` +
    `— never translate target-language material into ${name} to teach or quiz (gloss unfamiliar words sparingly).`
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

/**
 * 出题提示词里的语言行(题干/选项语言约束)。
 *
 * v0.33 双轴:语言学习课程(targetLang = 课程教的语言)时,题干/选项中的**语言素材**
 * 保持目标语言原文(考目标语言本身),指令性文字与解析用界面语言——语言课的题
 * 翻成教学语言就失去了考察对象。非语言课程行为逐字节不变。
 */
export function questionLanguageLine(locale: string, targetLang?: string | null): string {
  const name = localeToLanguageName(locale);
  if (isZhLocale(locale)) {
    if (!targetLang) return "- 题干和选项用中文,清晰无歧义";
    const t = localeToLanguageName(targetLang);
    return `- 这是${t}语言学习测验:题干和选项中的语言素材(句子/单词/短语/语法点)用${t}原文出题,指令性文字和解析用中文`;
  }
  if (!targetLang) return `- Write the question stem and options in ${name}, clear and unambiguous`;
  const t = localeToLanguageName(targetLang);
  return `- This is a ${t} language-learning test: language material in stems and options (sentences/words/phrases/grammar points) must be in ${t}; instructions and explanations in ${name}`;
}
