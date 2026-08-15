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
import { GithubContentSource, LocalContentSource } from "./content-source.js";
import type { PlanStore } from "./import-plan-store.js";
import {
  bestEffortStructure,
  computeTreeHash,
  newPlanId,
  parseGithubUrl,
  planMatchesInventory,
  type ImportPlan,
  type PlanClassification,
} from "./pure/import-plan.js";

type Db = SQLJsDatabase<typeof schema>;

export type ImportSpec =
  | { kind: "github"; url: string }
  | { kind: "folder"; path: string }
  | { kind: "plan"; plan: ImportPlan };

export interface RunImportDeps {
  db: Db;
  store: PlanStore;
  markDirty: () => void;
  onProgress: (msg: string) => void;
  shouldAbort: () => boolean;
  fetchFn?: typeof fetch;
  /** 测试注入桩(生产不传走真 LLM 服务) */
  classify?: typeof classifyFileRoles;
  design?: typeof designCourseStructure;
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
  const fetchFn = deps.fetchFn ?? fetch;
  const shouldAbort = deps.shouldAbort;

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

  if (spec.kind === "github" || (spec.kind === "plan" && spec.plan.kind === "github" && spec.plan.github)) {
    const url = spec.kind === "github" ? spec.url : `https://github.com/${spec.plan.github!.owner}/${spec.plan.github!.repo}`;
    const parsed = parseGithubUrl(url);
    if (!parsed) throw new Error("无效的 GitHub URL");
    gh = parsed;
    send("拉取仓库 README + 完整目录结构");
    const inv = await fetchRepoInventory(gh.owner, gh.repo, "main", fetchFn, send);
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
  } else {
    throw new Error("导入方案格式不完整(缺少来源信息)");
  }

  // ───────────────────────── 快照决策 ─────────────────────────
  const treeHash = computeTreeHash(fullTree);
  const identity = gh
    ? { kind: "github" as const, github: gh }
    : { kind: "folder" as const, folder: { absPath: folderPath! } };

  let plan: ImportPlan | null = spec.kind === "plan" ? spec.plan : store.findByIdentity(identity);
  let hashMatch = plan ? planMatchesInventory(plan, identity, fullTree) : false;
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
      kind: gh ? "github" : "folder",
      ...(gh ? { github: { owner: gh.owner, repo: gh.repo, branch } } : {}),
      ...(folderPath ? { folder: { absPath: folderPath } } : {}),
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

  // 内容漂移:结构尽力保留(零 LLM 仍是默认),分类过滤到仍存在的文件
  if (plan && !hashMatch) {
    if (plan.structure) {
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
      roles = await (deps.classify ?? classifyFileRoles)(db, readmeMd, fileList, fullTree, send);
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
      structure = await (deps.design ?? designCourseStructure)(db, readmeMd, outlines, roles.original, roles.practice, send, standaloneImages);
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
      : new LocalContentSource(folderPath!, docsMap!);
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
}
