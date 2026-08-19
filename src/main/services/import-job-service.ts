/**
 * 导入编排器 —— 5 步管线的单一入口(断点续跑 + 方案复用 + 课程包共用)。
 *
 * 从原 import:github / import:localFolder 两个 IPC handler 内联的步骤序列抽出,
 * 三种 spec 共用一条代码路径:
 *   {kind:"github",url}   正常 GitHub 导入
 *   {kind:"folder",path}  正常本地文件夹导入
 *   {kind:"plan",plan}    断点续跑 / 课程包导入(带着已有快照进来)
 *
 * 确定性来源:每个步骤边界把产物写进 ImportPlan 落盘(原子写);进入 Step5 前若
 * 快照里已有该步产物则直接复用(零 LLM)。身份匹配 + treeHash 一致 = 完全复用;
 * 内容漂移 = 结构尽力保留(bestEffort) + 分类重判;漂移到无可保留 = 重新走 AI。
 * Step1 清点永远现拉(身份/漂移检测需要新鲜 tree,几个请求的成本)。
 */
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { executeImport } from "./import-pipeline.js";
import {
  classifyFileRoles,
  designCourseStructure,
  type FileClassificationResult,
} from "./import-llm-service.js";
import type { CourseStructure } from "./import-llm-service.js";
import { buildLocalInventory } from "./pure/local-folder-scanner.js";
import {
  docsToDiscoveredFiles,
  extractOutlineWithCharCounts,
  fetchFileOutlines,
  fetchRepoInventory,
  type DiscoveredFile,
  type FileOutline,
} from "./pure/repo-fetcher.js";
import { getPrefLang, resolveImportLang } from "./lang-pref.js";
import { GithubContentSource, LocalContentSource, MemoryContentSource } from "./content-source.js";
import type { PlanStore } from "./import-plan-store.js";
import {
  bestEffortStructure,
  computeContentHash,
  computeTreeHash,
  newPlanId,
  parseGithubUrl,
  planMatchesInventory,
  type ImportPlan,
  type PlanClassification,
  type PlanIdentity,
} from "./pure/import-plan.js";
import { routeImportUrl, normalizeUrlIdentity } from "./pure/url-route.js";
import { prepareSingleDoc, chunkHeadinglessText } from "./pure/text-chunk.js";
import { fetchArticleMarkdown, fetchArxivMarkdown } from "./url-import-service.js";
import { parseEpub } from "../lib/epub-parser.js";
import { decodeAudioTo16kMono, AUDIO_IMPORT_EXTS } from "./speech/audio-file-decode.js";
import { readSettingsMap } from "./agent/llm-client.js";

type Db = SQLJsDatabase<typeof schema>;

/** 音频文件的转录编排(decode + 模型就绪 + transcribePcmChunked)。 */
export type AudioTranscribeFn = (
  bytes: Uint8Array,
  fileName: string,
  ctx: { dataDir: string; settings: Record<string, string | null>; signal?: AbortSignal; send: (msg: string) => void },
) => Promise<string>;

export type ImportSpec =
  | { kind: "github"; url: string }
  | { kind: "folder"; path: string }
  /** 智能链接:github.com → 仓库路径内部分流;arxiv.org → 论文;其余 → 网页文章 */
  | { kind: "url"; url: string }
  /** 粘贴长文(无标题时自动按句子边界分段) */
  | { kind: "text"; name?: string; text: string }
  /** 电子书(内容哈希做身份,重打包不换课程) */
  | { kind: "epub"; fileName: string; bytes: Uint8Array }
  /** 本地音频(播客/讲座,本地 Whisper 转写;多文件=多集,身份=各文件字节哈希) */
  | { kind: "audio"; files: { fileName: string; bytes: Uint8Array }[] }
  /** 视频链接(B站直连 / YouTube 等走 yt-dlp 字幕优先;转写复用本地 Whisper) */
  | { kind: "video"; url: string }
  | { kind: "plan"; plan: ImportPlan };

export interface RunImportDeps {
  db: Db;
  store: PlanStore;
  markDirty: () => void;
  onProgress: (msg: string) => void;
  shouldAbort: () => boolean;
  fetchFn?: typeof fetch;
  /** 本地模型目录(音频转录的 Whisper 模型;IPC 层注入 userData) */
  dataDir?: string;
  /** 测试注入桩(生产不传走真 LLM 服务) */
  classify?: typeof classifyFileRoles;
  design?: typeof designCourseStructure;
  /** 音频转录桩(verify 注入;生产走 decode+ensureModel+transcribePcmChunked) */
  transcribeAudioFile?: AudioTranscribeFn;
  /** 视频获取桩(verify 注入;生产走 B站直连/yt-dlp) */
  fetchVideo?: (url: string, ctx: { send: (msg: string) => void; signal?: AbortSignal }) => Promise<{ source: "subtitle" | "audio"; title: string; text?: string; bytes?: Uint8Array; ext?: string }>;
}

export interface SmartImportResult {
  courseId: string;
  title: string;
  planId: string;
  /** true = Step 2-4 全部来自快照,本次零 LLM 调用 */
  reused: boolean;
}

/** 失败的导入错误里带出的 planId(渲染层"从断点重试"用) */
export function planIdOf(e: unknown): string | null {
  if (e && typeof e === "object" && "planId" in e && typeof (e as { planId?: unknown }).planId === "string") {
    return (e as { planId: string }).planId;
  }
  return null;
}

/** FileClassificationResult(Maps) → 可 JSON 序列化的 PlanClassification */
function rolesToPlan(r: FileClassificationResult): PlanClassification {
  return {
    original: r.original,
    practice: r.practice,
    skip: r.skip,
    translationFiles: Object.fromEntries(r.translations),
    translationPairs: Object.fromEntries(r.translationPairs),
    languages: r.languages,
    sourceLang: r.sourceLang,
    translationLayout: r.translationLayout,
  };
}

/** PlanClassification(Records) → 管线要的 Maps 形状 */
function planToRoles(p: PlanClassification): FileClassificationResult {
  return {
    original: p.original,
    practice: p.practice,
    skip: p.skip,
    translations: new Map(Object.entries(p.translationFiles)),
    translationPairs: new Map(Object.entries(p.translationPairs)),
    languages: p.languages,
    sourceLang: p.sourceLang,
    translationLayout: p.translationLayout,
  };
}

/** 漂移后把分类里的路径过滤到仍存在的文件(翻译路径失效就不导入翻译,不崩) */
function filterClassificationToTree(p: PlanClassification, tree: string[]): PlanClassification {
  const exist = new Set(tree);
  const filterPaths = (arr: string[]) => arr.filter((x) => exist.has(x));
  const translationFiles: Record<string, string[]> = {};
  for (const [lang, paths] of Object.entries(p.translationFiles)) {
    const kept = filterPaths(paths);
    if (kept.length > 0) translationFiles[lang] = kept;
  }
  const translationPairs: Record<string, string> = {};
  for (const [orig, trans] of Object.entries(p.translationPairs)) {
    if (exist.has(orig) && exist.has(trans)) translationPairs[orig] = trans;
  }
  return {
    ...p,
    original: filterPaths(p.original),
    practice: filterPaths(p.practice),
    skip: filterPaths(p.skip),
    translationFiles,
    translationPairs,
  };
}

export async function runSmartImport(spec: ImportSpec, deps: RunImportDeps): Promise<SmartImportResult> {
  const { db, store, markDirty } = deps;
  const send = deps.onProgress;
  const shouldAbort = deps.shouldAbort;

  // 取消通道:shouldAbort 是轮询式回调,LLM 调用和网络请求需要 AbortSignal 才能掐断在飞的流。
  // 300ms 轮询把回调折叠成信号,传给 Step2/4 的每一次 LLM 调用 + 所有网络层 ——
  // 点取消后当前调用立即中止(此前要等它跑完,最长 20 分钟 LLM / 240s 树扫描,
  // 且二分还会继续发新调用)。
  const cancelCtl = new AbortController();
  const cancelPoll = setInterval(() => {
    if (shouldAbort()) cancelCtl.abort();
  }, 300);

  // 取消穿透的收口点:所有 fetchFn 走 CDN 的请求(Step1 README / Step3 大纲 /
  // Step5 正文+图片,经 GithubContentSource)统一注入 signal —— 在飞请求被
  // undici 立即撕断,而不是等 25s 截止或当前批次自然跑完。
  const rawFetch = deps.fetchFn ?? fetch;
  const fetchFn = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    rawFetch(input, { ...init, signal: init?.signal ?? cancelCtl.signal })) as typeof fetch;

  try {
    // ───────────────────────── Step 1: 清点(永远现拉) ─────────────────────────
    let readmeMd: string;
    let fileList: DiscoveredFile[];
    let fullTree: string[];
    let branch: string;
    let repoUrl: string | null;
    let repoName: string;
    let gh: { owner: string; repo: string } | null = null;
    let folderPath: string | null = null;
    let docsMap: Map<string, string> | null = null;
    let standaloneImages: { path: string; alt: string }[] = [];
    let localTranslationLangs: { code: string; name: string }[] | null = null;
    /** url/text/epub/audio 的身份哈希(text=原文 sha1;epub=章节内容哈希;audio=文件字节哈希聚合) */
    let textSha: string | null = null;
    let epubSha: string | null = null;
    let audioSha: string | null = null;

    if (spec.kind === "github" || (spec.kind === "plan" && spec.plan.kind === "github" && spec.plan.github)) {
      const url = spec.kind === "github" ? spec.url : `https://github.com/${spec.plan.github!.owner}/${spec.plan.github!.repo}`;
      const parsed = parseGithubUrl(url);
      if (!parsed) throw new Error("无效的 GitHub URL");
      gh = parsed;
      send("拉取仓库 README + 完整目录结构");
      const inv = await fetchRepoInventory(gh.owner, gh.repo, "main", fetchFn, send, cancelCtl.signal);
      readmeMd = inv.readmeMd;
      fileList = inv.fileList;
      fullTree = inv.fullTree;
      branch = inv.branch;
      repoUrl = url;
      repoName = gh.repo;
      send(`✓ README ${readmeMd.length} 字 · ${fileList.length} 个课程文件`);
    } else if (spec.kind === "folder" || (spec.kind === "plan" && spec.plan.kind === "folder" && spec.plan.folder)) {
      const path = spec.kind === "folder" ? spec.path : spec.plan.folder!.absPath;
      if (!existsSync(path)) {
        throw new Error("课程包对应的本地文件夹已不存在,请重新选择文件夹导入");
      }
      folderPath = path;
      send("正在扫描文件夹…");
      const inv = await buildLocalInventory(path, (n) => {
        if (n % 20 === 0) send(`已扫描 ${n} 个文件…`);
      });
      if (inv.docs.length === 0) {
        throw new Error("文件夹里没有找到可识别的文本内容(.txt/.md/.html/.pdf)");
      }
      send(`✓ 扫描完成:${inv.docs.length} 文档 · ${inv.images.length} 图 · ${inv.translations.length} 翻译文件`);
      docsMap = new Map<string, string>();
      for (const doc of inv.docs) docsMap.set(doc.path, doc.content);
      for (const tr of inv.translations) docsMap.set(tr.path, tr.content);
      // 本地路径直接用扫描器已解析的 docs 建 fileList(pathsToDiscoveredFiles 会丢 .txt/.html/.pdf)
      fileList = docsToDiscoveredFiles(inv.docs);
      readmeMd = inv.readmeMd;
      fullTree = inv.fullTree;
      branch = "";
      repoUrl = null;
      repoName = path.split(/[\\/]/).pop() ?? "local-course";
      standaloneImages = inv.standaloneImages.map((img) => ({ path: img.path, alt: img.altText }));
      localTranslationLangs = inv.translationLangs.map((code) => ({ code, name: code }));
    } else if (
      spec.kind === "url" || spec.kind === "text" || spec.kind === "epub" || spec.kind === "audio" || spec.kind === "video"
      || (spec.kind === "plan" && (spec.plan.kind === "url" || spec.plan.kind === "text" || spec.plan.kind === "epub" || spec.plan.kind === "audio" || spec.plan.kind === "video"))
    ) {
      // ── 虚拟文档源:url(文章/arXiv) / text(粘贴) / epub(章节) / audio(转写) ──
      // 与 github(CDN 现拉)/folder(磁盘现扫)不同,这类源的内容无法事后重取
      // → Step1 产物连同正文一起进 plan.docCache,断点续跑({kind:"plan"})靠缓存。
      const resume = spec.kind === "plan" ? spec.plan : null;
      let entries: [string, string][] = [];
      let displayName: string | null = null;
      repoUrl = null;
      if (resume?.kind === "url" && resume.url) repoUrl = resume.url.url;
      if (resume?.kind === "video" && resume.video) repoUrl = resume.video.url;

      if (resume?.docCache && Object.keys(resume.docCache).length > 0) {
        entries = Object.entries(resume.docCache);
        send(`✓ 从快照恢复正文缓存(${entries.length} 个文档)`);
      } else if (spec.kind === "url") {
        const route = routeImportUrl(spec.url);
        if (!route) throw new Error("无法识别的链接:请粘贴 http(s) 网址");
        if (route.kind === "github") {
          // GitHub 链接 → 既有仓库导入路径(智能 URL 框的路由结果)
          return await runSmartImport({ kind: "github", url: route.url }, deps);
        }
        if (route.kind === "video") {
          // 视频链接 → video spec(IPC 层已分流;直接调本函数时递归走正路)
          return await runSmartImport({ kind: "video", url: route.url }, deps);
        }
        if (route.flavor === "arxiv") {
          const { title, markdown } = await fetchArxivMarkdown(route.arxivId, route.pdfUrl, route.url, fetchFn, send, cancelCtl.signal);
          entries = prepareSingleDoc(title, markdown, `arxiv-${route.arxivId}`).map((p) => [p.path, p.content] as [string, string]);
          displayName = title;
        } else {
          send("抓取网页正文…");
          const { title, markdown } = await fetchArticleMarkdown(route.url, fetchFn, cancelCtl.signal);
          const stem = title.replace(/\s+/g, "-").slice(0, 40) || "article";
          entries = prepareSingleDoc(title, markdown, stem).map((p) => [p.path, p.content] as [string, string]);
          displayName = title;
        }
        repoUrl = route.url;
      } else if (spec.kind === "text") {
        const name = (spec.name ?? "").trim() || "我的笔记";
        const parts = prepareSingleDoc(name, spec.text, name.replace(/\s+/g, "-").slice(0, 40) || "text");
        if (parts.length === 0) throw new Error("没有可导入的文本内容");
        entries = parts.map((p) => [p.path, p.content] as [string, string]);
        displayName = name;
        textSha = createHash("sha1").update(spec.text, "utf8").digest("hex");
      } else if (spec.kind === "video") {
        const route = routeImportUrl(spec.url);
        if (route?.kind !== "video") throw new Error("不是可识别的视频链接(B站/YouTube,或安装 yt-dlp 后支持更多站点)");
        const fetchVideo = deps.fetchVideo ?? (async (u: string, ctx: { send: (m: string) => void; signal?: AbortSignal }) => {
          const { fetchBilibiliAudio, fetchViaYtDlp } = await import("./video-import-service.js");
          if (!deps.dataDir) throw new Error("导入环境缺少数据目录,无法获取视频");
          return route.source === "bilibili"
            ? fetchBilibiliAudio(u, fetchFn, ctx.send, ctx.signal)
            : fetchViaYtDlp(u, deps.dataDir, ctx.send, ctx.signal);
        });
        const fetched = await fetchVideo(spec.url, { send, signal: cancelCtl.signal });
        // 统一成宽松形状(真 VideoFetchResult 与 verify 桩都满足)
        const v = fetched as { source: string; title: string; text?: string; bytes?: Uint8Array; ext?: string };
        displayName = v.title;
        repoUrl = spec.url;
        if (v.source === "subtitle" && v.text) {
          // 有字幕:零转写零模型,直接分段成课
          send("使用视频字幕成文(零转写)…");
          const stem = v.title.replace(/\s+/g, "-").slice(0, 40) || "video";
          for (const part of chunkHeadinglessText(v.text, stem)) {
            entries.push([part.path, part.content] as [string, string]);
          }
        } else if (v.bytes) {
          // 无字幕:走音频转写全套(与 {kind:"audio"} 同款,模型自动下载可取消)
          const ext = v.ext ?? "m4a";
          const fileName = `${(v.title.replace(/\s+/g, "-").slice(0, 40) || "video")}.${ext}`;
          const settings = readSettingsMap(db);
          const transcribe = deps.transcribeAudioFile ?? defaultAudioTranscribe;
          if (!deps.dataDir && !deps.transcribeAudioFile) throw new Error("导入环境缺少数据目录,无法转录视频音轨");
          const text = await transcribe(v.bytes, fileName, { dataDir: deps.dataDir ?? "", settings, signal: cancelCtl.signal, send });
          const stem = fileName.replace(/\.[^.]+$/, "");
          for (const part of chunkHeadinglessText(text, stem)) {
            entries.push([part.path, part.content] as [string, string]);
          }
        } else {
          throw new Error("视频获取结果异常(既无字幕也无音轨)");
        }
      } else if (spec.kind === "audio") {
        // 多文件=多集播客:每集一个虚拟目录,Step 4 自然按集成章
        const settings = readSettingsMap(db);
        if (!deps.dataDir) throw new Error("导入环境缺少数据目录,无法转录音频");
        const transcribe = deps.transcribeAudioFile ?? defaultAudioTranscribe;
        const fileHashes: string[] = [];
        for (const f of spec.files) {
          send(`处理 ${f.fileName}…`);
          const text = await transcribe(f.bytes, f.fileName, {
            dataDir: deps.dataDir, settings, signal: cancelCtl.signal, send,
          });
          const stem = (f.fileName.replace(/\.[^.]+$/, "").replace(/\s+/g, "-").slice(0, 40)) || "audio";
          for (const part of chunkHeadinglessText(text, stem)) {
            entries.push([`${stem}/${part.path}`, part.content] as [string, string]);
          }
          if (!displayName) displayName = spec.files.length > 1 ? `${stem} 等 ${spec.files.length} 个音频` : stem;
          fileHashes.push(createHash("sha1").update(f.bytes).digest("hex"));
        }
        audioSha = createHash("sha1").update([...fileHashes].sort().join("\n"), "utf8").digest("hex");
      } else {
        // {kind:"epub"} 或 docCache 被清空的 plan
        const bytes = spec.kind === "epub" ? spec.bytes : null;
        if (!bytes) throw new Error("导入方案缺少正文缓存,请重新选择文件导入");
        send("解析电子书章节…");
        const book = await parseEpub(bytes);
        entries = book.chapters.map((c) => [c.path, c.markdown] as [string, string]);
        displayName = book.title;
      }

      if (entries.length === 0) throw new Error("没有解析出可导入的内容");
      docsMap = new Map(entries);
      fileList = docsToDiscoveredFiles(entries.map(([path]) => ({ path })));
      fullTree = entries.map(([path]) => path);
      branch = "";
      // 身份哈希:text=原文 sha1;epub=章节内容哈希;audio=各文件字节哈希的聚合
      if (!textSha && spec.kind === "plan" && spec.plan.kind === "text" && spec.plan.text) textSha = spec.plan.text.sha1;
      if (!epubSha && (spec.kind === "epub" || (spec.kind === "plan" && spec.plan.kind === "epub"))) {
        epubSha = computeContentHash(docsMap);
      }
      if (!audioSha && spec.kind === "plan" && spec.plan.kind === "audio" && spec.plan.audio) audioSha = spec.plan.audio.sha1;
      const firstH1 = entries[0]?.[1].match(/^#\s+(.+)$/m)?.[1]?.trim();
      repoName = displayName ?? firstH1 ?? "导入内容";
      readmeMd = `# ${repoName}\n\n${(entries[0]?.[1] ?? "").slice(0, 2000)}`;
      send(`✓ ${repoName}:${entries.length} 个文档`);
    } else {
      throw new Error("导入方案格式不完整(缺少来源信息)");
    }

    // ───────────────────────── 快照决策 ─────────────────────────
    // github/folder 漂移看路径集合;url/text/epub 改内容不改路径,漂移必须看正文
    const treeHash = gh || folderPath ? computeTreeHash(fullTree) : computeContentHash(docsMap!);
    let identity: PlanIdentity;
    if (gh) identity = { kind: "github", github: gh };
    else if (folderPath) identity = { kind: "folder", folder: { absPath: folderPath } };
    else if (spec.kind === "video" || (spec.kind === "plan" && spec.plan.kind === "video")) {
      identity = { kind: "video", video: { url: normalizeUrlIdentity(repoUrl ?? "") } };
    } else if (repoUrl) identity = { kind: "url", url: { url: normalizeUrlIdentity(repoUrl) } };
    else if (textSha) identity = { kind: "text", text: { sha1: textSha } };
    else if (audioSha) identity = { kind: "audio", audio: { sha1: audioSha } };
    else identity = { kind: "epub", epub: { sha1: epubSha! } };

    let plan: ImportPlan | null = spec.kind === "plan" ? spec.plan : store.findByIdentity(identity);
    // url/text/epub 用内容哈希比对(路径不变内容会变);github/folder 用路径集合哈希
    let hashMatch = plan ? planMatchesInventory(plan, identity, fullTree, gh || folderPath ? undefined : treeHash) : false;
    let reused = false;

    const now = () => new Date().toISOString();
    const savePlan = () => {
      plan!.treeHash = treeHash;
      plan!.readmeMd = readmeMd;
      plan!.fileList = fileList;
      plan!.fullTree = fullTree;
      plan!.branch = branch;
      if (gh) plan!.github = { owner: gh.owner, repo: gh.repo, branch };
      if (folderPath) plan!.folder = { absPath: folderPath };
      if (!gh && !folderPath) {
        // 虚拟文档源:身份 + 正文缓存(断点续跑的正文来源)
        if (identity.kind === "url" && identity.url) plan!.url = identity.url;
        if (identity.kind === "text" && identity.text) plan!.text = identity.text;
        if (identity.kind === "epub" && identity.epub) plan!.epub = identity.epub;
        if (identity.kind === "audio" && identity.audio) plan!.audio = identity.audio;
        if (identity.kind === "video" && identity.video) plan!.video = identity.video;
        if (docsMap) plan!.docCache = Object.fromEntries(docsMap);
      }
      plan!.updatedAt = now();
      store.save(plan!);
      // 落盘审计:console.error 已被主进程重定向进 lookatstudy-import.log,
      // 快照没写成时日志里直接可见(不用再猜"plan 为什么没了")。
      console.error(`[import-plan] saved id=${plan!.planId.slice(0, 8)} step=${plan!.reachedStep} dir=${store.dir()}`);
    };

    if (!plan) {
      plan = {
        formatVersion: 1,
        planId: newPlanId(),
        kind: identity.kind,
        ...(gh ? { github: { owner: gh.owner, repo: gh.repo, branch } } : {}),
        ...(folderPath ? { folder: { absPath: folderPath } } : {}),
        ...(identity.kind === "url" && identity.url ? { url: identity.url } : {}),
        ...(identity.kind === "text" && identity.text ? { text: identity.text } : {}),
        ...(identity.kind === "epub" && identity.epub ? { epub: identity.epub } : {}),
        ...(identity.kind === "audio" && identity.audio ? { audio: identity.audio } : {}),
        ...(identity.kind === "video" && identity.video ? { video: identity.video } : {}),
        treeHash,
        createdAt: now(),
        updatedAt: now(),
        reachedStep: 1,
        readmeMd,
        fileList,
        fullTree,
        branch,
      };
      savePlan();
    }

    // 内容漂移:url/text/epub 这些"改内容不改路径"的源,哈希不匹配 = 正文变了
    // → 整体重走 AI(bestEffort 是给路径漂移设计的,路径不变时它会静默保留旧结构)。
    // github/folder 维持原语义:结构尽力保留(零 LLM 仍是默认),分类过滤到仍存在的文件。
    if (plan && !hashMatch) {
      const virtualKind = plan.kind === "url" || plan.kind === "text" || plan.kind === "epub" || plan.kind === "audio" || plan.kind === "video";
      if (virtualKind) {
        send("⚠ 内容与方案快照不一致(正文已更新),重新走 AI 流程");
        plan.classification = undefined;
        plan.outlines = undefined;
        plan.structure = undefined;
        plan.reachedStep = 1;
        savePlan();
      } else if (plan.structure) {
        const be = bestEffortStructure(plan.structure, fullTree);
        if (be) {
          send(`⚠ 仓库内容与方案快照不一致:保留结构,丢弃 ${be.dropped} 节引用已消失文件的课`);
          plan.structure = be.structure;
          plan.classification = plan.classification
            ? filterClassificationToTree(plan.classification, fullTree)
            : undefined;
          reused = true;
        } else {
          send("⚠ 仓库内容与方案快照不一致且无可保留结构,重新走 AI 流程");
          plan.classification = undefined;
          plan.outlines = undefined;
          plan.structure = undefined;
          plan.reachedStep = 1;
        }
      } else if (plan.reachedStep > 1) {
        send("⚠ 仓库内容与方案快照不一致,已保存的中间产物作废");
        plan.classification = undefined;
        plan.outlines = undefined;
        plan.reachedStep = 1;
      }
      if (!reused) savePlan();
    }

    // ── Steps 2-5:planId 标注包住全部步骤 —— 任何一步失败,"从断点重试"都能用 ──
    const planId = plan.planId;
    try {
      // ───────────────────────── Step 2: 文件分类(LLM) ─────────────────────────
      let roles: FileClassificationResult;
      if (plan.classification) {
        roles = planToRoles(plan.classification);
        send(`✓ 文件分类:复用快照(${roles.original.length} 原文 · ${roles.practice.length} 实操 · 原文语言 ${roles.sourceLang})`);
      } else {
        roles = await (deps.classify ?? classifyFileRoles)(db, readmeMd, fileList, fullTree, send, { signal: cancelCtl.signal });
        send(`✓ 文件分类:${roles.original.length} 原文 · ${roles.practice.length} 实操 · ${roles.skip.length} 跳过 · 原文语言 ${roles.sourceLang}`);
        plan.classification = rolesToPlan(roles);
        plan.reachedStep = 2;
        savePlan();
      }

      // 语言决策(运行时重算:pref 可能已变,不进快照)
      const pref = getPrefLang(db) ?? "en";
      const languages = localTranslationLangs
        ? Array.from(new Map([...localTranslationLangs, ...roles.languages].map((l) => [l.code, l])).values())
        : roles.languages;
      const { langCode: selectedLang, reason } = resolveImportLang(pref, roles.sourceLang, languages);
      send(`语言决策:${reason}`);
      if (shouldAbort()) throw new Error("导入已取消");

      // ───────────────────────── Step 3: 标题大纲 ─────────────────────────
      let outlines: Map<string, FileOutline>;
      if (plan.outlines && Object.keys(plan.outlines).length > 0) {
        outlines = new Map(Object.entries(plan.outlines));
        send(`✓ 提取大纲:复用快照(${outlines.size} 文件)`);
      } else {
        const allFiles = [...roles.original, ...roles.practice];
        if (gh) {
          send(`提取 ${allFiles.length} 个文件的标题大纲 + 字数`);
          outlines = await fetchFileOutlines(
            allFiles, gh.owner, gh.repo, branch, fetchFn,
            (done, total) => send(`提取大纲 ${done}/${total}`),
            cancelCtl.signal,
          );
        } else {
          outlines = new Map<string, FileOutline>();
          for (const path of allFiles) {
            const content = docsMap!.get(path);
            if (content) outlines.set(path, extractOutlineWithCharCounts(content, path));
          }
        }
        plan.outlines = Object.fromEntries(outlines);
        plan.reachedStep = 3;
        savePlan();
      }
      if (shouldAbort()) throw new Error("导入已取消");

      // ───────────────────────── Step 4: 结构设计(LLM) ─────────────────────────
      let structure: CourseStructure;
      if (plan.structure) {
        structure = plan.structure;
        const lessonCount = structure.sections.reduce((n, s) => n + s.lessons.length, 0);
        send(`✓ 课程结构:复用快照(${structure.sections.length} 章 · ${lessonCount} 课)`);
        reused = true;
      } else {
        structure = await (deps.design ?? designCourseStructure)(db, readmeMd, outlines, roles.original, roles.practice, send, standaloneImages, { signal: cancelCtl.signal });
        const lessonCount = structure.sections.reduce((n, s) => n + s.lessons.length, 0);
        send(`✓ 课程结构:${structure.sections.length} 章 · ${lessonCount} 课`);
        plan.structure = structure;
        plan.reachedStep = 4;
        savePlan();
      }
      if (shouldAbort()) throw new Error("导入已取消");

      // ───────────────────────── Step 5: 拉正文 + 落库(原两阶段管线) ─────────────────────────
      const source = gh
        ? new GithubContentSource(gh.owner, gh.repo, branch, fetchFn)
        : folderPath
          ? new LocalContentSource(folderPath, docsMap!)
          : new MemoryContentSource(docsMap!);
      const translationFilesMap = selectedLang
        ? new Map([[selectedLang, roles.translations.get(selectedLang) ?? []]])
        : null;

      const result = await executeImport(
        db,
        structure,
        {
          source,
          repoUrl,
          repoName,
          langCode: selectedLang,
          translationFiles: translationFilesMap,
          translationPairs: roles.translationPairs,
          sourceLang: roles.sourceLang,
          translationLayout: roles.translationLayout,
          shouldAbort,
          markDirty,
        },
        send,
      );
      plan.courseId = result.courseId;
      plan.courseTitle = result.title;
      plan.updatedAt = now();
      store.save(plan);
      console.error(`[import-plan] course stamped id=${planId.slice(0, 8)} course=${result.courseId}`);
      markDirty();
      send(reused ? "✓ 导入完成(复用方案,零 AI 调用)" : "✓ 导入完成");
      return { courseId: result.courseId, title: result.title, planId, reused };
  } catch (e) {
    // 失败也带 planId 出去:渲染层"从断点重试"直接用
    if (e instanceof Error) (e as Error & { planId?: string }).planId = planId;
    throw e;
  }
  } finally {
    // 外层兜底:Step1(网络层取消也在这里抛)在任何路径下都必须清掉轮询,
    // 否则每次取消泄漏一个 300ms interval(Electron 主进程永不退出 → 永久句柄)
    clearInterval(cancelPoll);
  }
}

/**
 * 生产环境的音频转录:解码 → 模型就绪(缺则自动下载 Whisper Turbo,可取消)
 * → 分段转录(60s/段,进度滚动,段间响应取消)。verify 通过 deps.transcribeAudioFile
 * 注入桩绕开本地引擎,不触本函数。
 */
const defaultAudioTranscribe: AudioTranscribeFn = async (bytes, fileName, ctx) => {
  const ext = (fileName.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "").trim();
  if (!(AUDIO_IMPORT_EXTS as readonly string[]).includes(ext)) {
    throw new Error(`暂不支持 .${ext} 音频(支持 ${AUDIO_IMPORT_EXTS.join("/")})`);
  }
  const samples = await decodeAudioTo16kMono(bytes, ext);
  const minutes = Math.max(1, Math.round(samples.length / 16000 / 60));
  ctx.send(`转录 ${fileName}(约 ${minutes} 分钟)…`);

  const { pickLocalWhisperEntry, transcribePcmChunked } = await import("./speech/asr-service.js");
  let entry = pickLocalWhisperEntry(ctx.dataDir, ctx.settings);
  if (!entry) {
    const { isSpeechEngineLoadable } = await import("./speech/speech-engine.js");
    if (!isSpeechEngineLoadable()) {
      throw new Error("当前平台不支持本地语音引擎,无法转录音频(Termux 手机端暂不支持)");
    }
    const { SPEECH_MODELS_MANIFEST } = await import("./speech/speech-model-manifest.js");
    const turbo = SPEECH_MODELS_MANIFEST.models.find((m) => m.id === "asr-whisper-turbo");
    if (!turbo) throw new Error("语音模型清单里找不到 asr-whisper-turbo");
    ctx.send("本地听写模型未就绪,自动下载 Whisper Turbo(约 1GB,期间可取消)…");
    const { ensureSpeechModel } = await import("./speech/speech-model-service.js");
    await ensureSpeechModel(ctx.dataDir, turbo, {}, ctx.signal);
    entry = pickLocalWhisperEntry(ctx.dataDir, ctx.settings);
    if (!entry) throw new Error("语音模型下载完成但未就绪,请到「设置 → 语音」检查");
  }

  const r = await transcribePcmChunked(ctx.dataDir, ctx.settings, samples, undefined, {
    signal: ctx.signal,
    onProgress: (done, total) => ctx.send(`转录 ${fileName} ${done}/${total} 段`),
  });
  if (!r.text.trim()) throw new Error(`${fileName} 没有转写出任何内容(可能整段无人声)`);
  return r.text;
};
