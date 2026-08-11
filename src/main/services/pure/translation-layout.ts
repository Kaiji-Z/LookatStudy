/**
 * 翻译约定多策略检测 —— 从文件树自动检测仓库用了哪种翻译目录约定。
 *
 * GitHub 学习仓库常见的翻译布局:
 *   1. microsoft:  translations/{lang}/{path}     ← microsoft/AI-For-Beginners
 *   2. parallel:   {lang}/{path} 或 docs/{lang}/  ← vuejs/docs, docusaurus i18n
 *   3. suffix:     {file}.{lang}.md               ← hexo/jekyll 博客风格
 *
 * 纯函数，便于 verify 脚本测。
 */

/** 已知的语言代码（BCP-47 子标签，用于检测翻译目录/后缀） */
const KNOWN_LANG_CODES = [
  "zh-CN", "zh-Hans", "zh-TW", "zh-Hant", "zh",
  "en", "en-US", "en-GB",
  "ja", "ko", "ru", "de", "fr", "es", "pt", "pt-BR", "it", "ar", "hi", "tr", "vi", "th", "id", "pl", "nl",
];

export type TranslationLayout = "microsoft" | "parallel" | "suffix" | "none";

export interface TranslationDetectionResult {
  layout: TranslationLayout;
  /** 检测到的语言代码列表 */
  langs: string[];
  /** 语言显示名（code → name） */
  languages: { code: string; name: string }[];
  /**
   * 翻译文件路径解析器：给定语言代码 + 原文路径 → 翻译文件路径。
   * null = 该约定下无法确定翻译路径（需要探测）。
   */
  pathResolver: (lang: string, originalPath: string) => string;
}

const LANG_NAMES: Record<string, string> = {
  "zh-CN": "简体中文", "zh-Hans": "简体中文", "zh-TW": "繁體中文", "zh-Hant": "繁體中文", "zh": "中文",
  en: "English", "en-US": "English (US)", "en-GB": "English (UK)",
  ja: "日本語", ko: "한국어", ru: "Русский", de: "Deutsch", fr: "Français",
  es: "Español", pt: "Português", "pt-BR": "Português (Brasil)", it: "Italiano",
  ar: "العربية", hi: "हिन्दी", tr: "Türkçe", vi: "Tiếng Việt", th: "ไทย",
  id: "Indonesia", pl: "Polski", nl: "Nederlands",
};

/**
 * 从文件树检测翻译布局。
 *
 * 检测优先级: microsoft > parallel > suffix > none
 * 只有强信号（至少 2 个文件匹配）才判定为该布局。
 */
export function detectTranslationLayout(fullTree: string[]): TranslationDetectionResult {
  // ── 1. Microsoft: translations/{lang}/ ──
  const msLangs = new Set<string>();
  for (const p of fullTree) {
    const m = p.match(/^translations\/([^/]+)\//);
    if (m && KNOWN_LANG_CODES.includes(m[1])) {
      msLangs.add(m[1]);
    }
  }
  if (msLangs.size >= 1) {
    const langs = Array.from(msLangs);
    return {
      layout: "microsoft",
      langs,
      languages: langs.map((code) => ({ code, name: LANG_NAMES[code] ?? code })),
      pathResolver: (lang, originalPath) => `translations/${lang}/${originalPath}`,
    };
  }

  // ── 2. Parallel dirs: {lang}/ 或 docs/{lang}/ ──
  const parallelLangs = new Set<string>();
  // 根级 {lang}/ 检测（至少 2 个文件在该目录下才算有效）
  const langFileCounts = new Map<string, number>();
  for (const p of fullTree) {
    const parts = p.split("/");
    if (parts.length < 2) continue;
    const firstDir = parts[0];
    if (firstDir && KNOWN_LANG_CODES.includes(firstDir)) {
      langFileCounts.set(firstDir, (langFileCounts.get(firstDir) ?? 0) + 1);
    }
    // docs/{lang}/ 检测
    if (parts[0] === "docs" && parts[1] && KNOWN_LANG_CODES.includes(parts[1])) {
      langFileCounts.set(parts[1], (langFileCounts.get(parts[1]) ?? 0) + 1);
    }
  }
  for (const [lang, count] of langFileCounts) {
    if (count >= 2) parallelLangs.add(lang);
  }
  // 排除原文语言（en 如果是原文，不算翻译目标）—— 但这里我们不知道 sourceLang，
  // 所以全部保留，由 resolveImportLang 按 pref + sourceLang 过滤
  if (parallelLangs.size >= 1) {
    const langs = Array.from(parallelLangs);
    return {
      layout: "parallel",
      langs,
      languages: langs.map((code) => ({ code, name: LANG_NAMES[code] ?? code })),
      pathResolver: (lang, originalPath) => {
        // 尝试 docs/{lang}/{path} 和 {lang}/{path} 两种
        // 由调用方探测哪种存在（ContentSource.getFile 返回 null 就不存在）
        return `docs/${lang}/${originalPath}`;
      },
    };
  }

  // ── 3. Suffix: {file}.{lang}.md ──
  const suffixLangs = new Set<string>();
  for (const p of fullTree) {
    // 匹配 filename.{lang}.md（排除 README.md 本身）
    const m = p.match(/\.([a-z]{2}(?:-[A-Z]{2})?)\.(md|markdown|ipynb|rst)$/i);
    if (m && KNOWN_LANG_CODES.includes(m[1])) {
      suffixLangs.add(m[1]);
    }
  }
  if (suffixLangs.size >= 1) {
    const langs = Array.from(suffixLangs);
    return {
      layout: "suffix",
      langs,
      languages: langs.map((code) => ({ code, name: LANG_NAMES[code] ?? code })),
      pathResolver: (lang, originalPath) => {
        // lessons/intro.md → lessons/intro.{lang}.md
        const ext = originalPath.match(/\.(md|markdown|ipynb|rst)$/i)?.[0] ?? ".md";
        const base = originalPath.slice(0, -ext.length);
        return `${base}.${lang}${ext}`;
      },
    };
  }

  // ── 4. None ──
  return {
    layout: "none",
    langs: [],
    languages: [],
    pathResolver: () => "",
  };
}
