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

/** suffix 布局认的文件扩展名（双语对常见载体：md 系 + txt 转写 + html 页面） */
const SUFFIX_EXTS = "md|markdown|ipynb|rst|txt|html";

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

/** 语言显示名（code → name，导出供 LLM 检出语言合并显示名用） */
export const LANG_NAMES: Record<string, string> = {
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

  // ── 3. Suffix: {file}.{lang}.{ext}（md 系 + txt/html；xxx.en.txt ↔ xxx.zh-CN.txt 成对也在此列）──
  const suffixLangs = new Set<string>();
  for (const p of fullTree) {
    // 匹配 filename.{lang}.{ext}（排除 README.md 本身）
    const m = p.match(new RegExp(`\\.([a-z]{2}(?:-[A-Z]{2})?)\\.(${SUFFIX_EXTS})$`, "i"));
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
      pathResolver: (lang, originalPath) => resolveSuffixTranslationPath(lang, originalPath),
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

/**
 * suffix 布局的翻译路径解析（detectTranslationLayout 的 pathResolver 与
 * 导入落库 resolveTransPath 共用，单一实现防两处漂移）:
 *   intro.md → intro.{lang}.md（经典 hexo 风格）
 *   原文自带语言后缀时先剥掉: xxx.en.txt → xxx.{lang}.txt（不是 xxx.en.{lang}.txt）
 */
export function resolveSuffixTranslationPath(lang: string, originalPath: string): string {
  const ext = originalPath.match(new RegExp(`\\.(${SUFFIX_EXTS})$`, "i"))?.[0] ?? ".md";
  let base = originalPath.slice(0, -ext.length);
  const ownLang = base.match(/\.([a-z]{2}(?:-[A-Z]{2})?)$/i)?.[1];
  if (ownLang && KNOWN_LANG_CODES.includes(ownLang)) {
    base = base.slice(0, -(ownLang.length + 1));
  }
  return `${base}.${lang}${ext}`;
}

/**
 * suffix 布局的规则排除（高置信度）：把 xxx.{lang}.{ext} 的翻译文件从原文候选里分流。
 *
 * 用于 classifyFileRoles 在 LLM 之前做规则预处理（规则判高置信度原则）：
 * 成对双语（xxx.en.txt ↔ xxx.zh-CN.txt）若不分流，两种语言都会被判 original
 * → 中英重复成课 + 翻译表空（历史 Bug）。
 *
 * 原文候选两种形态：xxx.{sourceLang}.{ext}（原文自身带语言后缀）或 xxx.{ext}（无后缀）。
 * 孤儿翻译（配不上任何原文）保守留在原文列表——宁可重复不可丢内容。
 *
 * @returns originals 剩余原文候选 / translations 语言→翻译文件 / pairs 原文→翻译配对
 */
export function excludeSuffixTranslations(
  paths: string[],
  langs: string[],
  sourceLang: string,
): { originals: string[]; translations: Map<string, string[]>; pairs: Map<string, string> } {
  const translations = new Map<string, string[]>();
  const pairs = new Map<string, string>();
  const originals: string[] = [];
  const pathSet = new Set(paths);
  const suffixRe = new RegExp(`^(.*)\\.([a-z]{2}(?:-[A-Z]{2})?)\\.(${SUFFIX_EXTS})$`, "i");

  for (const p of paths) {
    const m = p.match(suffixRe);
    if (m) {
      const [, base, lang, ext] = m as unknown as [string, string, string, string];
      if (langs.includes(lang) && lang !== sourceLang) {
        const orig = pathSet.has(`${base}.${sourceLang}.${ext}`)
          ? `${base}.${sourceLang}.${ext}`
          : pathSet.has(`${base}.${ext}`)
            ? `${base}.${ext}`
            : null;
        if (orig) {
          if (!translations.has(lang)) translations.set(lang, []);
          translations.get(lang)!.push(p);
          pairs.set(orig, p);
          continue; // 分流成功，不进原文
        }
        // 孤儿翻译：配不上原文，保守留原文
      }
    }
    originals.push(p);
  }
  return { originals, translations, pairs };
}
