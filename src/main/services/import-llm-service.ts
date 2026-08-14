/**
 * 智能导入 LLM 服务 —— 新 5 步管线的 Step 2 (文件角色分类) + Step 4 (课程结构设计)。
 *
 * 核心理念: LLM 看到足够上下文 (README 全文 + 目录结构 + 标题大纲) 才做判断。
 * 不靠 preview 猜分类。
 */
import { generateText } from "ai";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { resolveLlm, isLlmReady } from "./agent/llm-client.js";
import type { DiscoveredFile, FileOutline } from "./pure/repo-fetcher.js";

type Db = SQLJsDatabase<typeof schema>;

/** LLM 调用超时(ms)。超时后抛错让上层降级。
 *  Step 2(文件分类+sourceLang) 和 Step 4(课程结构设计) prompt 较大，
 *  GLM 等模型响应可能需 2-4 分钟，给 5 分钟余量。 */
const LLM_TIMEOUT = 300_000; // 5 分钟

/**
 * 带 timeout 的 generateText wrapper。
 * 防止 LLM 端点不通时永久挂起（electron UI 卡死）。
 */
async function generateTextWithTimeout(
  model: Parameters<typeof generateText>[0]["model"],
  prompt: string,
): Promise<string> {
  const result = await Promise.race([
    generateText({ model, prompt }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM 调用超时（${LLM_TIMEOUT / 1000}s）`)), LLM_TIMEOUT),
    ),
  ]);
  return result.text;
}

/* ============================================================
 * Step 2: 文件角色分类
 * ============================================================ */

export type FileRole = "original" | "translation" | "practice" | "skip";

export interface FileClassificationResult {
  /** 原文课程文件路径 */
  original: string[];
  /** 翻译文件: 语言代码 → 文件路径列表 */
  translations: Map<string, string[]>;
  /** 显式翻译配对: 原文路径 → 翻译文件路径（规则配对 + LLM 配对；落库优先于布局猜路径） */
  translationPairs: Map<string, string>;
  /** 实操文件路径 */
  practice: string[];
  /** 噪声文件路径（跳过） */
  skip: string[];
  /** 检测到的翻译语言列表（供用户选择） */
  languages: { code: string; name: string }[];
  /** 仓库原文语言 (en / zh-CN / zh-TW / ...), LLM 判断 */
  sourceLang: string;
  /** 检测到的翻译布局约定 (microsoft/parallel/suffix/none) */
  translationLayout: "microsoft" | "parallel" | "suffix" | "none";
}

/**
 * Step 2: 用 LLM 判断仓库里每个文件的角色。
 *
 * 规则预处理（高置信度）:
 *   - README 翻译链接 → 翻译语言列表（extractLanguagesFromReadme）
 *   - LICENSE/CONTRIBUTING 等 → skip
 *
 * LLM 判断（不确定的）:
 *   课程文件列表交给 LLM，看 README + 完整目录树判 original/practice/skip
 */
export async function classifyFileRoles(
  db: Db,
  readmeMd: string,
  fileList: DiscoveredFile[],
  fullTree: string[],
  onProgress?: (msg: string) => void,
): Promise<FileClassificationResult> {
  const send = (msg: string) => onProgress?.(msg);
  const allPaths = fileList.map((f) => f.path);

  // ── 规则预处理: 翻译布局检测 ──
  // 从文件树检测翻译约定（microsoft/parallel/suffix），替代仅靠 README 正则。
  const { detectTranslationLayout, excludeSuffixTranslations, LANG_NAMES } = await import("./pure/translation-layout.js");
  const { extractLanguagesFromReadme } = await import("./pure/repo-fetcher.js");
  const layoutResult = detectTranslationLayout(fullTree);
  // README 正则检测作为补充（有些仓库 README 有翻译链接但文件树结构不同）
  const readmeLanguages = extractLanguagesFromReadme(readmeMd);

  // 合并两种检测结果（去重）
  const allLangs = new Map<string, string>();
  for (const lang of [...layoutResult.languages, ...readmeLanguages]) {
    allLangs.set(lang.code, lang.name);
  }
  const validLangs = Array.from(allLangs, ([code, name]) => ({ code, name }));

  // 构建 translations map（所有检测到的语言）
  const translations = new Map<string, string[]>();
  for (const lang of validLangs) {
    translations.set(lang.code, []);
  }

  // ── 规则预处理: suffix 布局成对翻译分流（高置信度规则，LLM 之前）──
  // 成对双语（xxx.en.txt ↔ xxx.zh-CN.txt）若不分流，两种语言都会被判 original
  // → 中英重复成课 + 翻译表空（历史 Bug）。配不上的孤儿保守留原文。
  const translationPairs = new Map<string, string>();
  let candidates = allPaths;
  if (layoutResult.layout === "suffix") {
    const ruleSourceLang = detectSourceLangByRule(readmeMd);
    const split = excludeSuffixTranslations(allPaths, layoutResult.langs, ruleSourceLang);
    for (const [lang, files] of split.translations) {
      if (!translations.has(lang)) translations.set(lang, []);
      translations.set(lang, [...translations.get(lang)!, ...files]);
    }
    for (const [orig, trans] of split.pairs) translationPairs.set(orig, trans);
    const splitCount = [...split.translations.values()].reduce((n, arr) => n + arr.length, 0);
    if (splitCount > 0) send(`规则分流: ${splitCount} 个翻译文件不进原文候选(${[...split.translations.keys()].join("/")})`);
    candidates = split.originals;
  }

  const remaining: string[] = [];
  const skip: string[] = [];

  for (const p of candidates) {
    // 元数据文件
    const stem = p.split("/").pop()?.replace(/\.[^.]+$/, "").toLowerCase() ?? "";
    if (["license", "licence", "contributing", "code_of_conduct", "security", "changelog", "authors", "maintainers", "pull_request_template", "issue_template", "support", "faq", "citation", "codeowners"].includes(stem)) {
      skip.push(p);
      continue;
    }
    remaining.push(p);
  }

  send(`规则预分类: ${remaining.length} 待判, ${validLangs.length} 翻译语言(${layoutResult.layout}), ${skip.length} 噪声`);

  // ── LLM 判断剩余文件 + sourceLang ──
  const ready = isLlmReady(db);
  if (!ready.ready || remaining.length === 0) {
    // 无 key 或无待判文件: 所有 remaining 当 original, sourceLang 规则推断
    return {
      original: remaining,
      translations,
      translationPairs,
      practice: [],
      skip,
      languages: validLangs,
      sourceLang: detectSourceLangByRule(readmeMd),
      translationLayout: layoutResult.layout,
    };
  }

  send(`AI 判断 ${remaining.length} 个文件角色 + 原文语言（看 README + 目录树）`);
  const llm = resolveLlm(db);

  // 分块（防 prompt 过大）—— 68 个文件 + 3000 字 README 约 5K token，一次性发没问题
  const CHUNK_SIZE = 200;
  const original: string[] = [];
  const practice: string[] = [];
  const allPathSet = new Set(allPaths);
  const llmLangs = new Set<string>();
  let sourceLang = "";

  for (let i = 0; i < remaining.length; i += CHUNK_SIZE) {
    const chunk = remaining.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(remaining.length / CHUNK_SIZE);
    if (totalChunks > 1) send(`AI 文件分类（第 ${chunkNum}/${totalChunks} 批）…`);
    console.error(`[import] Step 2: 调 LLM (批 ${chunkNum}/${totalChunks}, ${chunk.length} 文件)…`);

    const prompt = buildRolePrompt(readmeMd, chunk, fullTree);
    const result = await generateTextWithTimeout(llm.languageModel, prompt);
    console.error(`[import] Step 2: 批 ${chunkNum} LLM 返回 ${result.length} 字符`);
    const parsed = parseRoleResult(result, chunk);

    // sourceLang 取第一块的（整个仓库一致）
    if (!sourceLang && parsed.sourceLang) sourceLang = parsed.sourceLang;

    for (const { path, role, lang, translates } of parsed.files) {
      if (role === "translation") {
        // 防幻觉: lang/translates 必填且 translates 指向真实文件
        // （跨批配对用全量集合校验，不用本 chunk 列表）
        if (lang && translates && allPathSet.has(translates)) {
          if (!translations.has(lang)) translations.set(lang, []);
          translations.get(lang)!.push(path);
          translationPairs.set(translates, path);
          llmLangs.add(lang);
        } else {
          original.push(path); // 校验不过 → 保守当原文（不丢内容）
        }
      } else if (role === "practice") practice.push(path);
      else if (role === "skip") skip.push(path);
      else original.push(path);
    }
  }

  if (!sourceLang) sourceLang = detectSourceLangByRule(readmeMd);

  // LLM 判出的翻译语言并入语言列表（供 resolveImportLang 决策 + 用户选择）
  for (const code of llmLangs) {
    if (!validLangs.some((l) => l.code === code)) {
      validLangs.push({ code, name: LANG_NAMES[code] ?? code });
    }
  }

  return { original, translations, translationPairs, practice, skip, languages: validLangs, sourceLang, translationLayout: layoutResult.layout };
}

/**
 * 规则推断仓库原文语言（无 LLM 降级时用）。
 * 粗略：README 中文字符占比 > 30% → zh-CN，否则 en。
 */
/**
 * 规则推断仓库原文语言（无 LLM 降级时用）。
 * 按 Unicode 脚本区域统计字符占比，区分日/韩/中/俄/英。
 */
function detectSourceLangByRule(readmeMd: string): string {
  const total = Math.max(readmeMd.length, 1);
  // ひらがな + カタカナ → 日文
  const jpCount = (readmeMd.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  if (jpCount / total > 0.05) return "ja";
  // Hangul → 韩文
  const koCount = (readmeMd.match(/[\uac00-\ud7af]/g) || []).length;
  if (koCount / total > 0.05) return "ko";
  // 西里尔字母 → 俄文
  const ruCount = (readmeMd.match(/[\u0400-\u04ff]/g) || []).length;
  if (ruCount / total > 0.1) return "ru";
  // CJK 汉字（排除日韩已处理的）→ 中文
  const cjkCount = (readmeMd.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjkCount / total > 0.15) return "zh-CN";
  return "en";
}

/**
 * 把扁平路径列表转成 tree 命令风格的树状结构（带缩进 + 深度限制 + 折叠）。
 * - 每个目录子项超过 maxPerDir 时，显示前几个 + "...及 N 个"
 * - 超过 maxDepth 层的目录不展开，只显示"... 及 N 个文件（深层省略）"
 * LLM 判断文件角色只需要仓库组织概览，不需要看每个叶子文件。
 */
function buildTreeString(paths: string[], maxPerDir = 10, maxDepth = 3): string {
  interface TreeNode { dirs: Map<string, TreeNode>; files: string[]; }
  const root: TreeNode = { dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1) {
        node.files.push(parts[i]!);
      } else {
        if (!node.dirs.has(parts[i]!)) node.dirs.set(parts[i]!, { dirs: new Map(), files: [] });
        node = node.dirs.get(parts[i]!)!;
      }
    }
  }
  /** 递归统计一个节点下的全部文件数 */
  function countAll(node: TreeNode): number {
    let n = node.files.length;
    for (const child of node.dirs.values()) n += countAll(child);
    return n;
  }
  const lines: string[] = [];
  function render(node: TreeNode, indent: string, depth: number) {
    const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const files = [...node.files].sort();
    const items: { name: string; isDir: boolean; child?: TreeNode }[] = [
      ...dirs.map(([name, child]) => ({ name: name + "/", isDir: true, child })),
      ...files.map((f) => ({ name: f, isDir: false })),
    ];
    const shown = items.slice(0, maxPerDir);
    for (const it of shown) {
      lines.push(indent + it.name);
      if (it.isDir && it.child) {
        if (depth < maxDepth) {
          render(it.child, indent + "  ", depth + 1);
        } else {
          // 超过深度限制：只统计不展开
          const total = countAll(it.child);
          if (total > 0) lines.push(indent + `  ... 及 ${total} 个文件（深层省略）`);
        }
      }
    }
    if (items.length > maxPerDir) {
      lines.push(indent + `... 及其他 ${items.length - maxPerDir} 个`);
    }
  }
  render(root, "", 0);
  return lines.join("\n");
}

function buildRolePrompt(readmeMd: string, filePaths: string[], fullTree: string[]): string {
  // README 截取前 3000 字（大纲部分够了）
  const readmeExcerpt = readmeMd.slice(0, 3000);
  const fileList = filePaths.map((p) => `  "${p}"`).join(",\n");

  // 完整目录树（树状结构 + 折叠，不截断——LLM 能看到完整仓库组织）
  const treeStr = buildTreeString(fullTree);

  const hasReadme = readmeMd.trim().length > 0;
  const readmeSection = hasReadme
    ? `README 内容:\n---\n${readmeExcerpt}\n---`
    : "（无 README 文件，请根据文件名、目录结构、文件类型判断原文语言和文件角色）";

  return `你是课程仓库分析专家。下面是一个学习仓库的 README（前3000字）、完整目录树和待分类的文件列表。

请完成两个任务:

1. 判断 README 的**原文语言**（不是翻译语言）。看 README 正文是什么语言写的:
   - 英文 → "en"
   - 简体中文 → "zh-CN"
   - 繁体中文 → "zh-TW"
   - 日文 → "ja"，其他语言用对应 BCP-47 子标签
   - 无 README 时看文件名/目录名用的语言

2. 判断每个文件的角色:
   - **original**: 原文课程讲解（README.md 教程、概念讲解）
   - **practice**: 实操资源（notebook .ipynb、lab 练习、示例代码）
   - **translation**: 是另一个文件的翻译版本（文件名/目录常带语言码，如 xxx.zh-CN.txt、
     xxx.en.md、zh-CN/guide.md）。必须同时给 "lang"(BCP-47 语言码，如 "zh-CN"/"en")
     和 "translates"(它翻译的原文文件路径，必须是文件列表或目录树里真实存在的文件)
   - **skip**: 噪声（纯配置、空文件、非学习内容）

${readmeSection}

仓库完整目录树（树状结构，最多展开 3 层，每目录最多 10 项，超出折叠）:
---
${treeStr}
---

需要分类的文件列表:
[
${fileList}
]

注意:
- README 大纲表格通常标明了文件角色（Lesson Link = original, Notebook = practice, Lab = practice）
- .ipynb 文件大概率是 practice（除非是 notebook 风格的主课程如 fast.ai/d2l）
- 路径含 /lab/ /exercise/ → 大概率 practice
- 代码文件(.py/.js/.go 等): 教程型(带大量注释/docstring, 如 nanoGPT) → original; 实操/练习型 → practice; 配置脚本(setup.py/config.js) → skip
- 同名不同语言码的成对文件（如 intro.en.txt 与 intro.zh-CN.txt）: 原文语言侧 → original，其余语言侧 → translation

严格返回 JSON 对象，不要 markdown 代码块标记:
{
  "sourceLang": "en",
  "files": [
    { "path": "lessons/1-Intro/README.md", "role": "original" },
    { "path": "lessons/2-Symbolic/Animals.ipynb", "role": "practice" },
    { "path": "src/nanoGPT.py", "role": "original" },
    { "path": "lessons/1-Intro/README.zh-CN.md", "role": "translation", "lang": "zh-CN", "translates": "lessons/1-Intro/README.md" }
  ]
}`;
}

export function parseRoleResult(raw: string, validPaths: string[]): {
  sourceLang: string;
  files: { path: string; role: FileRole; lang?: string; translates?: string }[];
} {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    // 解析失败: 所有文件当 original（安全降级）
    return { sourceLang: "", files: validPaths.map((p) => ({ path: p, role: "original" as FileRole })) };
  }
  // 兼容: LLM 可能返回数组（旧格式）或对象（新格式）
  let sourceLang = "";
  let filesRaw: unknown[];
  if (Array.isArray(obj)) {
    filesRaw = obj;
  } else if (obj && typeof obj === "object" && Array.isArray((obj as Record<string, unknown>).files)) {
    const o = obj as Record<string, unknown>;
    if (typeof o.sourceLang === "string") sourceLang = o.sourceLang;
    filesRaw = o.files as unknown[];
  } else {
    return { sourceLang: "", files: validPaths.map((p) => ({ path: p, role: "original" as FileRole })) };
  }
  const validSet = new Set(validPaths);
  const files = (filesRaw as Array<Record<string, unknown>>)
    .filter((item) => typeof item.path === "string" && validSet.has(item.path as string))
    .map((item) => ({
      path: item.path as string,
      role: (item.role === "practice" || item.role === "skip" || item.role === "translation" ? item.role : "original") as FileRole,
      // translation 角色的配对信息透传（translates 指向的原文可能跨批，校验在 classifyFileRoles 用全量集合做）
      lang: typeof item.lang === "string" ? item.lang : undefined,
      translates: typeof item.translates === "string" ? item.translates : undefined,
    }));
  return { sourceLang, files };
}

/* ============================================================
 * Step 4: 课程结构设计
 * ============================================================ */

export interface DesignedLesson {
  /** lesson 标题（中文或原文） */
  title: string;
  /** 来自哪个源文件 */
  file: string;
  /** 可选: 文件内的 H2/H3 锚点（按标题拆分时用） */
  anchor?: string;
  /** 世界 */
  world: "study" | "practice";
  /** 可选: LLM 关联的独立图片路径（未被任何 md 引用的孤儿图，挂到本 lesson 正文末尾） */
  attachImages?: string[];
}

export interface DesignedSection {
  /** section 标题 */
  title: string;
  /** 世界 */
  world: "study" | "practice";
  /** 1-2 句摘要 */
  summary?: string;
  /** 该 section 下的 lesson */
  lessons: DesignedLesson[];
}

export interface CourseStructure {
  /** 课程标题（从 README H1 或 LLM 生成） */
  courseTitle: string;
  /** section 列表 */
  sections: DesignedSection[];
}

/**
 * Step 4: LLM 设计课程结构。
 *
 * 输入: README + 标题大纲（原文 + 可选翻译）
 * 输出: section/lesson/world 结构
 *
 * LLM 有 README 大纲（理解全局）+ 每个文件的 H1/H2/H3 标题（理解文件内部结构）。
 * 这足够让 LLM 做精确判断。
 */
export async function designCourseStructure(
  db: Db,
  readmeMd: string,
  outlines: Map<string, FileOutline>,
  originalFiles: string[],
  practiceFiles: string[],
  onProgress?: (msg: string) => void,
  standaloneImages: { path: string; alt: string }[] = [],
): Promise<CourseStructure> {
  const send = (msg: string) => onProgress?.(msg);
  const ready = isLlmReady(db);
  if (!ready.ready) {
    // 无 key: 降级为纯规则结构（按目录分 section，每文件一 lesson）
    return fallbackStructure(readmeMd, outlines, originalFiles, practiceFiles, standaloneImages);
  }

  send("AI 设计课程结构（按字数拆分 + study/practice/附属 三分类）");
  const llm = resolveLlm(db);

  // 构建文件+大纲信息（含字符数，供 LLM 做长文件拆分决策）
  const allFiles = [...originalFiles, ...practiceFiles];
  const fileInfos = allFiles.map((p) => {
    const ol = outlines.get(p);
    const isPractice = practiceFiles.includes(p);
    return {
      file: p,
      role: isPractice ? "practice" : "original",
      h1: ol?.h1 ?? "",
      totalChars: ol?.totalChars ?? 0,
      headings: ol?.headings ?? [],
    };
  });

  // 分块
  const CHUNK_SIZE = 40;
  if (fileInfos.length <= CHUNK_SIZE) {
    const prompt = buildStructureDesignPrompt(readmeMd, fileInfos, standaloneImages);
    const text = await generateTextWithTimeout(llm.languageModel, prompt);
    return parseStructureDesignResult(text, allFiles, practiceFiles, standaloneImages);
  }

  // 大课程: 分块设计，每块独立分 section
  send(`课程较大（${fileInfos.length} 文件），分 ${Math.ceil(fileInfos.length / CHUNK_SIZE)} 批设计…`);
  const allSections: DesignedSection[] = [];
  for (let i = 0; i < fileInfos.length; i += CHUNK_SIZE) {
    const chunk = fileInfos.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(fileInfos.length / CHUNK_SIZE);
    send(`AI 设计中（第 ${chunkNum}/${totalChunks} 批）…`);
    const prompt = buildStructureDesignPrompt(readmeMd, chunk, standaloneImages);
    const text = await generateTextWithTimeout(llm.languageModel, prompt);
    const structure = parseStructureDesignResult(text, chunk.map((f) => f.file), practiceFiles, standaloneImages);
    allSections.push(...structure.sections);
  }

  // 课程标题从 README H1
  const h1Match = readmeMd.match(/^#\s+(.+)$/m);
  return { courseTitle: h1Match ? h1Match[1]!.trim() : "Imported Course", sections: allSections };
}

function buildStructureDesignPrompt(
  readmeMd: string,
  fileInfos: { file: string; role: string; h1: string; totalChars: number; headings: { level: number; title: string; chars: number }[] }[],
  standaloneImages: { path: string; alt: string }[] = [],
): string {
  const readmeExcerpt = readmeMd.slice(0, 4000);
  const fileList = fileInfos.map((f) => {
    const headingsStr = f.headings.length > 0
      ? f.headings.map((h) => `    ${"#".repeat(h.level)} ${h.title} [${h.chars}字]`).join("\n")
      : "    (无子标题)";
    return `  {
    "file": "${f.file}",
    "role": "${f.role}",
    "h1": "${f.h1}",
    "totalChars": ${f.totalChars},
    "headlines":
${headingsStr}
  }`;
  }).join(",\n");

  const hasReadme = readmeMd.trim().length > 0;
  const readmeSection = hasReadme
    ? `README:\n---\n${readmeExcerpt}\n---`
    : "（无 README，请根据文件名、目录结构、文件类型设计课程结构）";

  // 独立图片列表（给 LLM 关联到 lesson 用）
  const imagesSection = standaloneImages.length > 0
    ? `\n\n## 独立图片（未被任何文件引用的孤儿图片，请关联到最相关的 lesson）\n${
        standaloneImages.map((img) => `- "${img.path}" (描述: ${img.alt})`).join("\n")
      }\n\n在 lesson 的 JSON 里加 "attachImages": ["图片路径"] 把图片关联到该 lesson。`
    : "";

  return `你是课程设计专家。下面是一个学习仓库的 README（前4000字）和每个文件的标题大纲（含每段字符数）。

你的任务: 设计课程结构（section → lesson），给每个 lesson 标 world，并决定长文件如何拆分。

## lesson 三分类（每个 lesson 必须是其一）
- **study**: 讲解正文（概念/理论/教程）→ 学习世界主线，独立成 lesson
- **practice**: Exercise / Lab / notebook 实操 → 实操世界，独立成 lesson
- **附属**（不独立成 lesson）: quiz 链接 / Conclusion 总结 / Challenge 挑战 / Review 参考文献
  → 这些内容**不要丢**，归入相邻 study lesson 的正文（用户在 lesson 里能看到、能点击）
  → 实现方式：不给附属 H2 单独的 lesson，让它被前一个 study lesson 的 anchor 截取范围自然包含

## 长文件拆分规则（按字数自适应，目标每 lesson 3000-8000 字）
1. 文件 totalChars < 3000 → 整体一个 study lesson，不拆
2. 文件有多个 H2（每个 H2 后面标了 [字数]）:
   - 讲解类 H2（含其 H3 子段）字数 < 8000 → 一个 study lesson，anchor = 该 H2 标题
   - 讲解类 H2 字数 > 8000 且有 H3 → 按 H3 拆成多个 study lesson，anchor = 各 H3 标题
   - 讲解类 H2 字数 > 8000 且无 H3 → 整体一个 study lesson（接受超长）
   - Exercise/Lab 类 H2 → 一个 practice lesson
   - quiz链接/总结/挑战/参考类 H2 → 附属，不独立成 lesson
3. 拆完检查:
   - 某 lesson 字数 < 1000 → 与相邻同 world 的 lesson 合并（避免过度碎片）
   - anchor 字段填 H2 或 H3 的完整标题文字（用于正文截取定位）

## 其他
- role 字段是 Step 2 的文件类型（original/practice），作为参考但不是唯一依据
- 如果仓库目录结构已清晰（如 lessons/N-Topic/），保留原有章节，不过度重组
- 每个 section 给中文标题
- 代码文件(.py/.js/.go 等): 教程型代码(带详细注释/docstring) → study world; 工具/脚本/练习 → practice world
- 代码文件通常无 H2/H3 标题，totalChars 就是文件大小，不拆分，整体一个 lesson

${readmeSection}

文件标题大纲（totalChars = 文件总字数，每个标题后 [字数] = 该段字数）:
[
${fileList}
]
${imagesSection}

严格返回 JSON，不要 markdown 代码块标记:
{
  "sections": [
    {
      "title": "中文章节标题",
      "summary": "一句话描述",
      "lessons": [
        { "title": "课时标题", "file": "lessons/1-Intro/README.md", "world": "study" },
        { "title": "课时标题2", "file": "lessons/1-Intro/README.md", "anchor": "## The Top-Down Approach", "world": "study" },
        { "title": "动物推理练习", "file": "lessons/2-Symbolic/README.md", "anchor": "## ✍️ Exercise: Animal Inference", "world": "practice", "attachImages": ["images/diagram.png"] }
      ]
    }
  ]
}`;
}

function parseStructureDesignResult(
  raw: string,
  validFiles: string[],
  _practiceFiles: string[],
  standaloneImages: { path: string; alt: string }[] = [],
): CourseStructure {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let obj: { sections?: unknown };
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`LLM 结构设计 JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(obj.sections)) {
    throw new Error("LLM 结构设计缺少 sections 数组");
  }
  const validSet = new Set(validFiles);
  const validImgPaths = new Set(standaloneImages.map((i) => i.path));
  const assignedImgPaths = new Set<string>();

  const sections = (obj.sections as Array<Record<string, unknown>>)
    .map((sec) => {
      const lessonsRaw = Array.isArray(sec.lessons) ? sec.lessons as Array<Record<string, unknown>> : [];
      const lessons = lessonsRaw
        .filter((l) => typeof l.file === "string" && validSet.has(l.file as string))
        .map((l) => {
          // 解析 attachImages（只接受 validImgPaths 里的路径，防幻觉）
          let attachImages: string[] | undefined;
          if (Array.isArray(l.attachImages)) {
            const valid = (l.attachImages as unknown[])
              .filter((p): p is string => typeof p === "string" && validImgPaths.has(p as string))
              .filter((p) => !assignedImgPaths.has(p)); // 防重复分配
            if (valid.length > 0) {
              valid.forEach((p) => assignedImgPaths.add(p));
              attachImages = valid;
            }
          }
          return {
            title: typeof l.title === "string" ? l.title : "未命名",
            file: l.file as string,
            anchor: typeof l.anchor === "string" ? l.anchor : undefined,
            // world 由 LLM 在 Step 4 判断（不是 Step 2 的 role）
            world: (l.world === "practice" ? "practice" : "study") as "study" | "practice",
            attachImages,
          };
        });
      // section.world 按子节点多数派
      const practiceCount = lessons.filter((l) => l.world === "practice").length;
      const studyCount = lessons.filter((l) => l.world === "study").length;
      const secWorld = (practiceCount > 0 && studyCount === 0 ? "practice" : "study") as "study" | "practice";
      return {
        title: typeof sec.title === "string" ? sec.title : "未命名章节",
        world: secWorld,
        summary: typeof sec.summary === "string" ? sec.summary : undefined,
        lessons,
      };
    })
    .filter((s) => s.lessons.length > 0);

  return { courseTitle: "", sections };
}

/**
 * 无 LLM 时的降级: 纯规则结构。
 * 按文件路径第一个非通用目录分 section，每文件一个 lesson。
 * 独立图片按路径前缀匹配挂到同目录 lesson（LLM 关联的规则降级）。
 */
function fallbackStructure(
  readmeMd: string,
  outlines: Map<string, FileOutline>,
  originalFiles: string[],
  practiceFiles: string[],
  standaloneImages: { path: string; alt: string }[] = [],
): CourseStructure {
  const GENERIC_DIRS = new Set(["lessons", "docs", "doc", "src", "content", "modules", "chapters", "tutorials", "guide", "week", "unit", "part", "topic", "lecture", "session", "day", "step"]);
  const allFiles = [...originalFiles.map((f) => ({ file: f, world: "study" as const })), ...practiceFiles.map((f) => ({ file: f, world: "practice" as const }))];

  // 按 sectionKeyOf 逻辑分组
  const groups = new Map<string, { title: string; lessons: DesignedLesson[] }>();
  for (const { file, world } of allFiles) {
    const parts = file.split("/").filter(Boolean);
    const dirParts = parts[parts.length - 1]?.match(/^readme/i) || parts[parts.length - 1] === "index.md"
      ? parts.slice(0, -1) : parts;
    const specificDir = dirParts.find((p) => !GENERIC_DIRS.has(p.toLowerCase()) && !/\.(md|mdx)$/i.test(p));
    const sectionKey = specificDir ?? file;
    if (!groups.has(sectionKey)) groups.set(sectionKey, { title: sectionKey, lessons: [] });
    const ol = outlines.get(file);
    groups.get(sectionKey)!.lessons.push({
      title: ol?.h1 ?? file.split("/").pop() ?? file,
      file,
      world,
    });
  }

  // 独立图片按路径前缀匹配挂到同目录 lesson
  const allLessons = Array.from(groups.values()).flatMap((g) => g.lessons);
  for (const img of standaloneImages) {
    const imgDir = img.path.includes("/") ? img.path.slice(0, img.path.lastIndexOf("/")) : "";
    // 找路径前缀最匹配的 lesson
    let bestLesson: DesignedLesson | null = null;
    let bestOverlap = -1;
    for (const lesson of allLessons) {
      const lessonDir = lesson.file.includes("/") ? lesson.file.slice(0, lesson.file.lastIndexOf("/")) : "";
      if (imgDir === lessonDir || (lessonDir && imgDir.startsWith(lessonDir + "/"))) {
        const overlap = lessonDir.split("/").length;
        if (overlap > bestOverlap) { bestOverlap = overlap; bestLesson = lesson; }
      }
    }
    if (bestLesson) {
      if (!bestLesson.attachImages) bestLesson.attachImages = [];
      bestLesson.attachImages.push(img.path);
    }
  }

  const h1Match = readmeMd.match(/^#\s+(.+)$/m);
  return {
    courseTitle: h1Match ? h1Match[1]!.trim() : "Imported Course",
    sections: Array.from(groups.values()).map((g) => ({
      title: g.title,
      world: g.lessons.every((l) => l.world === "practice") ? "practice" as const : "study" as const,
      lessons: g.lessons,
    })),
  };
}
