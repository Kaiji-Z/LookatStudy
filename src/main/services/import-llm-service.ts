/**
 * 智能导入 LLM 服务 —— 新 5 步管线的 Step 2 (文件角色分类) + Step 4 (课程结构设计)。
 *
 * 核心理念: LLM 看到足够上下文 (README 全文 + 目录结构 + 标题大纲) 才做判断。
 * 不靠 preview 猜分类。
 */
import { streamText } from "ai";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { buildLanguageModel, resolveLlm, isLlmReady, type ResolvedLlm } from "./agent/llm-client.js";
import { reasoningPlanFor, withBodyPatch, llmFamilyOf, type ReasoningJsonValue } from "@shared/reasoning-effort";
import type { DiscoveredFile, FileOutline } from "./pure/repo-fetcher.js";
import { createStreamWatchdog } from "./pure/stream-watchdog.js";

type Db = SQLJsDatabase<typeof schema>;

/** 流式活性阈值:无输出超过此时长判死(连接挂起/端点无响应)。 */
// 思考模型(CodingPlan 端点)思考期间**零流事件**(fullStream 也喂不到看门狗),
// 默认档思考静默 >120s 是常态 → 120s 判死会误杀(实测两轮零输出掐点恰在 ~120s)。
// 放宽到 6 分钟;真挂死由 20 分钟硬上限兜底。
const LLM_INACTIVE_TIMEOUT = 360_000;
/** 硬上限:单次调用绝对安全网,防无限生成。 */
const LLM_HARD_CAP = 20 * 60_000;

/**
 * 带活性看门狗的流式 generateText。
 *
 * 旧版是 300s 墙钟 Promise.race,两个问题:
 *   1. 慢模型(glm-5.2)生成大课程结构批本来就可能超 5 分钟但流是活的,墙钟误杀,
 *      整个导入 job 报废(实测 181 文件仓库 Step 4 首批即超时);
 *   2. race 输了以后底层请求没取消,还在后台烧 token。
 * 现在流式消费,每收到 chunk 续命;只有"无输出 120s"或"总时长 20min"才 abort,
 * 且 abort 通过 signal 真正取消请求。
 */
/** 导入类 LLM 调用的输出 token 上限。
 *  不传时吃 provider 默认(常见 4096):thinking 家族的思考与正文**共享**输出额度,
 *  40 文件批的结构 JSON 写一半就被掐断(实测 66s 流正常结束只剩半个 JSON,
 *  触发批内二分连锁,浪费多轮调用)。8192 = DeepSeek 上限、各家通用的安全值,
 *  仍截断时由 designSectionsResilient 二分兜底。 */
export const IMPORT_MAX_OUTPUT_TOKENS = 8192;

/** 家族感知的输出上限:GLM/Qwen 端点强制思考(CodingPlan 无视 disabled,实测
 *  out=8192/8192 打满),思考+正文必须同池预算 → 给到官方上限内的宽裕值
 *  (GLM-5.2 输出上限 128K,Qwen 32K+)。DeepSeek V3 官方 8K、未知自定义端点
 *  保守 8192(请求超上限会 400)。 */
const FAMILY_MAX_OUTPUT_TOKENS: Record<string, number> = {
  glm: 32768,
  qwen: 16384,
  siliconcloud: 16384,
};

export interface ImportCallOpts {
  /** 导入专用模型的 providerOptions(思考关的方言,如 OpenAI reasoningEffort) */
  providerOptions?: Record<string, Record<string, ReasoningJsonValue>>;
  /** 外部取消(导入 job 的取消标志轮询而来)——abort 立即掐断在飞的 LLM 流 */
  signal?: AbortSignal;
  /** 本次调用的输出上限(家族感知:强制思考的端点要给思考留预算);缺省 8192 */
  maxOutputTokens?: number;
}

/**
 * 导入调用的家族感知配置:**输出上限 + 思考压低(fast)**。
 * 思考与正文共享输出额度:默认强度会把预算全用来思考(实测 32K 池思考 6min+ 零正文
 * 被看门狗掐死;8K 池思考挤掉 JSON)——fast(thinking disabled + reasoning_effort low,
 * CodingPlan 认后者)让批 ~1min 完成。用户拍板导入用 low;聊天档位不受影响。
 */
export function buildImportModel(
  llm: ResolvedLlm,
): {
  model: Parameters<typeof streamText>[0]["model"];
  providerOptions?: ImportCallOpts["providerOptions"];
  /** 家族感知输出上限(强思考端点给思考留预算);未知家族 = 保守 8192 */
  maxOutputTokens: number;
} {
  const family = llmFamilyOf(llm.provider.id, llm.provider.baseUrl, llm.model);
  const maxOutputTokens = FAMILY_MAX_OUTPUT_TOKENS[family] ?? IMPORT_MAX_OUTPUT_TOKENS;
  const plan = reasoningPlanFor(llm.provider.id, llm.provider.protocol, "fast", {
    baseUrl: llm.provider.baseUrl,
    model: llm.model,
  });
  if (plan.kind === "bodyPatch") {
    return {
      model: buildLanguageModel(
        llm.provider.protocol,
        llm.provider.baseUrl,
        llm.apiKey,
        llm.model,
        withBodyPatch(globalThis.fetch.bind(globalThis), plan.patch),
      ),
      maxOutputTokens,
    };
  }
  if (plan.kind === "providerOptions") {
    return { model: llm.languageModel, providerOptions: plan.options, maxOutputTokens };
  }
  return { model: llm.languageModel, maxOutputTokens };
}

export async function generateTextWithTimeout(
  model: Parameters<typeof streamText>[0]["model"],
  /** 纯文本 prompt,或完整 messages(v0.20 P6:PDF 公式页 vision 转写喂 图+文)。 */
  prompt: string | NonNullable<Parameters<typeof streamText>[0]["messages"]>,
  opts?: ImportCallOpts,
): Promise<string> {
  // 预取消直接拒绝(SDK 对已 abort 的信号不保证立刻抛,空流会静默成功)
  if (opts?.signal?.aborted) throw new Error("导入已取消");
  const wd = createStreamWatchdog(LLM_INACTIVE_TIMEOUT, LLM_HARD_CAP);
  const signal = opts?.signal ? AbortSignal.any([wd.signal, opts.signal]) : wd.signal;
  try {
    const result = streamText({
      model,
      // typeof 判别(messages 也是数组,Array.isArray 分不开 union)
      ...(typeof prompt === "string" ? { prompt } : { messages: prompt }),
      abortSignal: signal,
      maxOutputTokens: opts?.maxOutputTokens ?? IMPORT_MAX_OUTPUT_TOKENS,
      ...(opts?.providerOptions ? { providerOptions: opts.providerOptions } : {}),
    });
    let text = "";
    // fullStream 而非 textStream:思考模型的**推理增量也喂看门狗** ——
    // textStream 在整个思考阶段是静默的,默认档思考 >120s 就会被 inactive
    // 看门狗误杀(实测:40 文件批两次零输出,掐点恰在 120s)。任何 part 都算活性。
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
      wd.touch();
    }
    // token 用量留痕:每次调用打实际 in/out token + 结束原因(await:流已结束,零额外等待;
    // 读取失败要显式报错,不能吞 —— usage 是定位截断根因的唯一硬数据)
    try {
      const [usage, fr] = await Promise.all([result.usage, result.finishReason]);
      const cap = opts?.maxOutputTokens ?? IMPORT_MAX_OUTPUT_TOKENS;
      if (fr === "length") {
        console.warn(
          `[import-llm] 输出撞 token 上限被截断(out=${usage?.outputTokens ?? "?"}/${cap} in=${usage?.inputTokens ?? "?"};批内二分将兜底)`,
        );
      } else {
        console.error(
          `[import-llm] tokens: in=${usage?.inputTokens ?? "?"} out=${usage?.outputTokens ?? "?"}/${cap} finish=${fr ?? "?"} chars=${text.length}`,
        );
      }
    } catch (ue) {
      console.error(`[import-llm] usage 读取失败: ${ue instanceof Error ? ue.message : String(ue)} chars=${text.length}`);
    }
    // 流中途被取消但静默收尾的兜底:部分文本绝不当完整结果用
    if (opts?.signal?.aborted) throw new Error("导入已取消");
    return text;
  } catch (e) {
    if (wd.signal.aborted) {
      throw new Error(
        wd.reason() === "hard-cap"
          ? `LLM 调用超过硬上限（${LLM_HARD_CAP / 60_000} 分钟），已中止——请重试或换更快的模型`
          : `LLM 调用无输出超过 ${LLM_INACTIVE_TIMEOUT / 1_000}s（连接疑似挂起），已中止——请检查网络/API 端点`,
      );
    }
    if (opts?.signal?.aborted) throw new Error("导入已取消");
    throw e;
  } finally {
    wd.dispose();
  }
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
  opts?: { signal?: AbortSignal },
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
  const im = buildImportModel(llm);

  // 分块。**输出**才是瓶颈:每文件一条 JSON ~50-60 输出 token,thinking 家族的思考
  // 与正文共享输出额度(maxOutputTokens=8192)—— 200 文件批的 JSON 本体就 6-8k token,
  // 加思考必截断(实测 112 文件批只剩半个 JSON)。40/批 + 截断批内二分兜底。
  const CHUNK_SIZE = 40;
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

    if (opts?.signal?.aborted) throw new Error("导入已取消");
    const parsed = await classifyFilesResilient(chunk, {
      buildPrompt: (files) => buildRolePrompt(readmeMd, files, fullTree),
      call: (prompt) => generateTextWithTimeout(im.model, prompt, { providerOptions: im.providerOptions, signal: opts?.signal, maxOutputTokens: im.maxOutputTokens }).then((r) => {
        console.error(`[import] Step 2: 批 ${chunkNum} LLM 返回 ${r.length} 字符`);
        return r;
      }),
      onProgress: send,
      shouldAbort: () => opts?.signal?.aborted === true,
    });

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

export function buildRolePrompt(readmeMd: string, filePaths: string[], fullTree: string[]): string {
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

输出格式(严格遵守,违反即废弃重来):
- 只输出一个 JSON,第一个字符必须是 {,最后一个字符必须是 }
- 不要任何解释、前言、结尾总结、道歉、markdown 代码块围栏或其他文本
- JSON 之外的任何字符(包括换行后的备注)都会导致解析失败
严格返回如下形状的 JSON 对象:
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
  /** true = JSON 截断/形状不对走了兜底(全部当 original)—— 调用方据此拆半重试 */
  degraded: boolean;
} {
  const cleaned = extractJsonBlock(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    // 解析失败: 所有文件当 original（安全降级）。degraded 标记让上层拆半重试救回。
    return {
      sourceLang: "",
      files: validPaths.map((p) => ({ path: p, role: "original" as FileRole })),
      degraded: true,
    };
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
    return { sourceLang: "", files: validPaths.map((p) => ({ path: p, role: "original" as FileRole })), degraded: true };
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
  return { sourceLang, files, degraded: false };
}

/**
 * 一批文件的角色分类,截断自愈(与 Step4 designSectionsResilient 同款):
 * parseRoleResult 走了兜底(degraded:JSON 被 token 上限掐断/形状不对)→ 批拆半各调;
 * 二分到单文件仍 degraded → 兜底当原文(不丢内容,只丢分类精度)。
 * 导出供 verify 注入 call 桩测试。
 */
export async function classifyFilesResilient(
  files: string[],
  deps: {
    buildPrompt: (files: string[]) => string;
    call: (prompt: string) => Promise<string>;
    onProgress?: (msg: string) => void;
    /** 取消轮询:二分级联每级入口检查,点了取消不再发起新 LLM 调用 */
    shouldAbort?: () => boolean;
  },
): Promise<ReturnType<typeof parseRoleResult>> {
  const attempt = async (chunk: string[]): Promise<ReturnType<typeof parseRoleResult>> => {
    const text = await deps.call(deps.buildPrompt(chunk));
    return parseRoleResult(text, chunk);
  };
  const recurse = async (chunk: string[]): Promise<ReturnType<typeof parseRoleResult>> => {
    if (deps.shouldAbort?.()) throw new Error("导入已取消");
    const parsed = await attempt(chunk);
    if (!parsed.degraded) return parsed;
    if (chunk.length === 1) {
      deps.onProgress?.(`⚠ 文件分类输出不完整,单文件兜底当原文: ${chunk[0]}`);
      return parsed;
    }
    deps.onProgress?.(`⚠ 文件分类输出不完整(${chunk.length} 文件),拆半重试`);
    const mid = Math.floor(chunk.length / 2);
    const left = await recurse(chunk.slice(0, mid));
    const right = await recurse(chunk.slice(mid));
    return {
      sourceLang: left.sourceLang || right.sourceLang,
      files: [...left.files, ...right.files],
      degraded: false,
    };
  };
  return recurse(files);
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
  opts?: { signal?: AbortSignal },
): Promise<CourseStructure> {
  const send = (msg: string) => onProgress?.(msg);
  const ready = isLlmReady(db);
  if (!ready.ready) {
    // 无 key: 降级为纯规则结构（按目录分 section，每文件一 lesson）
    return fallbackStructure(readmeMd, outlines, originalFiles, practiceFiles, standaloneImages);
  }

  send("AI 设计课程结构（按字数拆分 + study/practice/附属 三分类）");
  const llm = resolveLlm(db);
  const im = buildImportModel(llm);

  // 构建文件+大纲信息（含字符数 + 正文预览，供 LLM 做长文件拆分与语义分组决策）
  const allFiles = [...originalFiles, ...practiceFiles];
  const fileInfos = allFiles.map((p) => {
    const ol = outlines.get(p);
    const isPractice = practiceFiles.includes(p);
    return {
      file: p,
      role: isPractice ? "practice" : "original",
      h1: ol?.h1 ?? "",
      preview: ol?.bodyPreview ?? "",
      totalChars: ol?.totalChars ?? 0,
      headings: ol?.headings ?? [],
    };
  });

  // 分块:每批(≤40 文件)走 designSectionsResilient —— 截断/解析失败批内二分自愈,
  // 单文件仍失败规则兜底一课。一批失败不再炸整个导入 job。
  const CHUNK_SIZE = 40;
  const allSections: DesignedSection[] = [];
  if (fileInfos.length <= CHUNK_SIZE) {
    allSections.push(
      ...await designSectionsResilient(readmeMd, fileInfos, practiceFiles, standaloneImages, {
        call: (prompt) => generateTextWithTimeout(im.model, prompt, { providerOptions: im.providerOptions, signal: opts?.signal, maxOutputTokens: im.maxOutputTokens }),
        onProgress: send,
        shouldAbort: () => opts?.signal?.aborted === true,
      }),
    );
  } else {
    // 大课程: 分块设计，每块独立分 section
    send(`课程较大（${fileInfos.length} 文件），分 ${Math.ceil(fileInfos.length / CHUNK_SIZE)} 批设计…`);
    for (let i = 0; i < fileInfos.length; i += CHUNK_SIZE) {
      if (opts?.signal?.aborted) throw new Error("导入已取消");
      const chunk = fileInfos.slice(i, i + CHUNK_SIZE);
      const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(fileInfos.length / CHUNK_SIZE);
      send(`AI 设计中（第 ${chunkNum}/${totalChunks} 批）…`);
      allSections.push(
        ...await designSectionsResilient(readmeMd, chunk, practiceFiles, standaloneImages, {
          call: (prompt) => generateTextWithTimeout(im.model, prompt, { providerOptions: im.providerOptions, signal: opts?.signal, maxOutputTokens: im.maxOutputTokens }),
          onProgress: send,
          shouldAbort: () => opts?.signal?.aborted === true,
        }),
      );
    }
  }

  // 课程标题从 README H1
  const h1Match = readmeMd.match(/^#\s+(.+)$/m);
  return { courseTitle: h1Match ? h1Match[1]!.trim() : "Imported Course", sections: allSections };
}

export interface StructureFileInfo {
  file: string;
  role: string;
  h1: string;
  /** 正文开头摘录(≤200 字进 prompt)——同名标题不同物的文件靠它区分内容主题 */
  preview?: string;
  totalChars: number;
  headings: { level: number; title: string; chars: number }[];
}

/**
 * 单批结构设计,失败自愈(导出供 verify 注入 call 桩测试):
 * - StructureParseError(输出截断/形状不对)→ 批拆半各调 —— 输出体量随批指数缩小,
 *   截断概率同步下降;实测 40 文件批在部分 provider 撞输出上限被截成半个 JSON。
 * - 二分到单文件仍失败 → h1/文件名规则兜底一课(与 fallbackStructure 同构),绝不抛。
 * - 网络/看门狗错误不是 StructureParseError → 原样上抛(重试无意义,断点续跑兜住)。
 */
export async function designSectionsResilient(
  readmeMd: string,
  fileInfos: StructureFileInfo[],
  practiceFiles: string[],
  standaloneImages: { path: string; alt: string }[],
  deps: { call: (prompt: string) => Promise<string>; onProgress?: (msg: string) => void; shouldAbort?: () => boolean },
): Promise<DesignedSection[]> {
  const attempt = async (files: StructureFileInfo[]): Promise<DesignedSection[]> => {
    const prompt = buildStructureDesignPrompt(readmeMd, files, standaloneImages);
    const text = await deps.call(prompt);
    return parseStructureDesignResult(text, files.map((f) => f.file), practiceFiles, standaloneImages).sections;
  };
  const recurse = async (files: StructureFileInfo[]): Promise<DesignedSection[]> => {
    if (deps.shouldAbort?.()) throw new Error("导入已取消");
    try {
      return await attempt(files);
    } catch (e) {
      if (!(e instanceof StructureParseError)) throw e;
      const why = e.message.slice(0, 80);
      if (files.length === 1) {
        const f = files[0]!;
        const title = f.h1 || (f.file.split("/").pop() ?? f.file).replace(/\.[^.]+$/, "");
        const world = f.role === "practice" ? ("practice" as const) : ("study" as const);
        deps.onProgress?.(`⚠ 结构设计输出不完整,已按文件标题兜底一课: ${title}(${why})`);
        return [{ title, world, lessons: [{ title, file: f.file, world }] }];
      }
      deps.onProgress?.(`⚠ 结构设计输出不完整(${files.length} 文件),拆半重试: ${why}`);
      const mid = Math.floor(files.length / 2);
      const left = await recurse(files.slice(0, mid));
      const right = await recurse(files.slice(mid));
      return [...left, ...right];
    }
  };
  return recurse(fileInfos);
}

export function buildStructureDesignPrompt(
  readmeMd: string,
  fileInfos: StructureFileInfo[],
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
    "preview": "${(f.preview ?? "").slice(0, 200)}",
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
- **章节标题忠实原则(2026-08-23)**:文件大纲里的标题(书页章名/目录名/文件 H1)是权威——lesson 标题沿用它们
  (可去掉冗余前缀),不要改写成别的主题;原书/仓库自带编号(Chapter N/CHAPTER XX/第N回)则保留原编号。
  原书没有编号章节体系时,**不得发明"第 N 章"式编号**,section 按内容主题命名(如"鲸类学与捕鲸史",
  不是"第 3 章 鲸类")——学习者要靠标题回到原书对应位置,编造的编号会误导
- 代码文件(.py/.js/.go 等): 教程型代码(带详细注释/docstring) → study world; 工具/脚本/练习 → practice world
- 代码文件通常无 H2/H3 标题，totalChars 就是文件大小，不拆分，整体一个 lesson

${readmeSection}

文件标题大纲（totalChars = 文件总字数，每个标题后 [字数] = 该段字数; preview = 正文开头摘录，用于判断文件的内容主题——标题相同的不同文件靠它区分; preview 为空 = 正文为空或纯代码）:
[
${fileList}
]
${imagesSection}

输出格式(严格遵守,违反即废弃重来):
- 只输出一个 JSON,第一个字符必须是 {,最后一个字符必须是 }
- 不要任何解释、前言、结尾总结、道歉、markdown 代码块围栏或其他文本
- JSON 之外的任何字符(包括换行后的备注)都会导致解析失败
严格返回如下形状的 JSON:
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

/**
 * 结构设计输出的"可自愈"错误:JSON 截断 / 缺 sections 数组。
 * 这类错误随批变小概率指数下降 → designSectionsResilient 据此二分重试。
 * 网络/看门狗等基础设施错误不是它的子类 —— 那些 propagate,不重试。
 */
export class StructureParseError extends Error {}

/**
 * 从模型输出里抽取平衡的 JSON 块:模型偶尔在 JSON 前后带说明文字/内联思考
 * (实测 CodingPlan 端点:"Unexpected non-whitespace character after JSON")。
 * 候选顺序:全文 → 第一个平衡 {...} → 最后一个平衡 {...}(前面的当废话丢掉)。
 * 字符串感知(跳过引号内的大括号),扫描失败返回原文让 JSON.parse 报原错。
 */
export function extractJsonBlock(raw: string): string {
  const first = raw.indexOf("{");
  if (first >= 0) {
    const end = scanBalancedBlock(raw, "{", "}", first);
    if (end > 0) return raw.slice(first, end);
  }
  const last = raw.lastIndexOf("{");
  if (last >= 0 && last !== first) {
    const end = scanBalancedBlock(raw, "{", "}", last);
    if (end > 0) return raw.slice(last, end);
  }
  return raw;
}

/**
 * extractJsonBlock 的数组泛化:同时接受 {...} 与 [...] 起始的 JSON 块
 * (world 分类等任务返回 JSON 数组)。取文本中最早出现的 { 或 [,字符串感知
 * 平衡扫描;失败回退同字符最后一次出现;都失败返回原文让 JSON.parse 报原错。
 */
export function extractJsonBlockAny(raw: string): string {
  const firstObj = raw.indexOf("{");
  const firstArr = raw.indexOf("[");
  let start = -1;
  let open = "{";
  let close = "}";
  if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) start = firstObj;
  else if (firstArr >= 0) { start = firstArr; open = "["; close = "]"; }
  if (start < 0) return raw;
  const end = scanBalancedBlock(raw, open, close, start);
  if (end > 0) return raw.slice(start, end);
  const last = raw.lastIndexOf(open);
  if (last > start) {
    const end2 = scanBalancedBlock(raw, open, close, last);
    if (end2 > 0) return raw.slice(last, end2);
  }
  return raw;
}

/** 字符串感知的平衡块扫描:从 from 的 open 字符起,返回配对 close 的下一位置;失配 -1。 */
function scanBalancedBlock(raw: string, open: string, close: string, from: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

export function parseStructureDesignResult(
  raw: string,
  validFiles: string[],
  _practiceFiles: string[],
  standaloneImages: { path: string; alt: string }[] = [],
): CourseStructure {
  const cleaned = extractJsonBlock(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());
  let obj: { sections?: unknown };
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    throw new StructureParseError(
      `LLM 结构设计 JSON 解析失败: ${e instanceof Error ? e.message : String(e)};原文开头200字: ${cleaned.slice(0, 200).replace(/\s+/g, " ")}`,
    );
  }
  if (!Array.isArray(obj.sections)) {
    throw new StructureParseError("LLM 结构设计缺少 sections 数组");
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
