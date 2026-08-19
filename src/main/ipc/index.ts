/**
 * IPC handlers 注册 —— 主进程对渲染层暴露的所有方法。
 *
 * 组织方式：按领域分 register* 函数，由 main/index.ts 统一调用。
 * 通道名规范：domain:action（如 course:list, streak:touch）
 */
import type { RuntimeDeps, IpcHandlerFn } from "./runtime.js";
import { join } from "node:path";
import { getDb, markDirty } from "../db/index.js";
import {
  courses,
  contentNodes,
  settings as settingsTable,
  progress as progressTable,
  srsItems,
  exercises,
  chatSessions,
  proposals,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createPlanStore } from "../services/import-plan-store.js";
import { runSmartImport, planIdOf } from "../services/import-job-service.js";
import type {
  ApiExpose,
  ExportPackResult,
  Course,
  ContentNode,
  Progress,
  Streak,
  ReviewQuality,
  SettingKey,
  ExerciseType,
  CustomProviderInput,
  RepoAnalysis,
  ImportJobHandle,
  ChatAttachmentInput,
} from "@shared/types";
import {
  getDueReviewNodeIds,
  getAllSrsItems,
  recordReview,
} from "../services/srs.js";
import {
  saveCanvasItem,
  listCanvasItems,
  deleteCanvasItem,
  togglePinCanvasItem,
  saveUserNote,
  recordQuizResult,
  updateUserNoteComment,
  type CanvasZone,
} from "../services/canvas-service.js";

type CanvasZoneOpt = CanvasZone | undefined;

/* ── 共享 handler 注册表 ──
 * Electron 壳(ipc/electron-wiring.ts)和 serve 壳(serve/server.ts)消费同一张表:
 * 通道名即 method 名,两个运行时的 API 面由同一份代码保证不漂移。 */
const handlerTable = new Map<string, IpcHandlerFn>();
function handle(channel: string, fn: IpcHandlerFn): void {
  if (handlerTable.has(channel)) throw new Error(`handler 重复注册: ${channel}`);
  handlerTable.set(channel, fn);
}

/** 构建(并返回)当前进程的完整 handler 表。重复调用先清空(测试用)。 */
export function collectHandlers(deps: RuntimeDeps): Map<string, IpcHandlerFn> {
  handlerTable.clear();
  registerAllHandlers(deps);
  return handlerTable;
}
import {
  listThreads,
  createThread,
  updateThread,
  deleteThread,
  getThreadMessagesForDisplay,
  findRecentThreadByNode,
} from "../services/thread-service.js";
import { getStreak, touchStreakToday } from "../services/streak.js";
// v0.12 语音:TTS 朗读编排 + 模型管理
import {
  ensureSpeechModelEmitting,
  speakMessage,
  speechModelsStatusSnapshot,
  stopSpeaking,
} from "../services/speech/tts-service.js";
import { deleteSpeechModel } from "../services/speech/speech-model-service.js";
import type { SpeechModelId } from "@shared/speech-types";
import { invalidateSpeechEngines } from "../services/speech/speech-engine.js";
import { transcribeAudio } from "../services/speech/asr-service.js";
// 业务逻辑抽出到 services，让无头测试能直接覆盖（不再只能在 UI 点）
import {
  getProgress as getProgressService,
  updateProgress as updateProgressService,
  markNodeAttempted as markNodeAttemptedService,
} from "../services/progress-service.js";
// 两个世界:学习 ↔ 实操 关联查询
import {
  findPracticeForLesson,
  findLessonForPractice,
} from "../services/practice-service.js";
// Soul 系统（教学人设）—— 业务逻辑在 soul-service，IPC 是薄壳
import {
  listSouls as listSoulsService,
  getSoul as getSoulService,
  createSoul as createSoulService,
  setActiveSoul as setActiveSoulService,
  getActiveSoul as getActiveSoulService,
} from "../services/souls/soul-service.js";
// Agent 引擎 + Proposal（M2）
import { handleAgentChat, abortAgentChat, getChatHistory, clearChatHistory, handleAgentChatThread, abortAgentChatThread } from "../services/agent/agent-engine.js";
import { getContextUsage } from "../services/agent/context-usage.js";
import { readAttachmentDataUrl } from "../services/attachment-store.js";
import { isLlmReady, testLlmConnection, testCustomProvider, fetchOpenRouterModels, fetchProviderModels, resolveLlm, readSettingsMap } from "../services/agent/llm-client.js";
import { gatherConsolidationWindow, consolidate, defaultLlmConsolidate, getConsolidationWatermark, setConsolidationWatermark } from "../services/memory-service.js";
import { PROVIDER_PRESETS } from "../services/agent/llm-presets.js";
// 自定义 Provider
import {
  listCustomProviders as listCustomProvidersService,
  createCustomProvider as createCustomProviderService,
  updateCustomProvider as updateCustomProviderService,
  deleteCustomProvider as deleteCustomProviderService,
} from "../services/custom-provider-service.js";
import {
  listPendingProposals as listPendingProposalsService,
  applyProposal as applyProposalService,
  rejectProposal as rejectProposalService,
  createProposal as createProposalService,
} from "../services/proposal-service.js";
// Per-KC BKT: KC 标题 → 下标解析
import { getKnowledgePoints } from "../services/kc-service.js";
// M3：仪表盘 + 检索 + 记忆
import { getDashboard as getDashboardService } from "../services/dashboard-service.js";
import { searchContent as searchContentService } from "../services/search-service.js";
import {
  updateMemory as updateMemoryService,
  getMemory as getMemoryService,
} from "../services/search-service.js";
// P3: friction_log 写入(纯函数,db 注入)
import { insertFrictionDb } from "../services/pure/friction-context.js";
import type { HumanFrictionCategory } from "@shared/types";
// M4：Course Generator
import { generateCourseFromMarkdown as generateCourseFromMarkdownService, generateCourseFromRepoFiles as generateCourseFromRepoFilesService, ensureExamNodesForExistingCourses } from "../services/course-generator.js";
import {
  importRepoToParsedCourse,
} from "../services/pure/repo-fetcher.js";
// Feature flags
import { isFlagOn } from "../services/flags.js";
// 多模态资源服务(node_assets)
import {
  listAssetsByNode,
  listAssetsByCourse,
  getAssetDataUrl,
} from "../services/asset-service.js";
// 课程结构化服务（LLM）
import {
  analyzeCourseStructure,
  applyCourseStructure,
  generateLessonSummaries,
  generateLessonSummary,
  generateLessonSummaryEn,
} from "../services/course-structure-service.js";
// Starter prompts
import { getStarterPrompts } from "../services/starter-prompts-service.js";
// XP 系统
import { getXpStatus, addXpCorrect, addXpWrong } from "../services/xp-service.js";
// 导出
import { collectExportData, exportJson, exportMarkdown } from "../services/export-service.js";
// 练习题服务
import {
  generateExercise as generateExerciseService,
  listExercises as listExercisesService,
  submitExerciseAnswer as submitExerciseAnswerService,
} from "../services/exercise-service.js";
// 章节考试服务 v2(后台生成 + KC 出题 + attempt 档案)
import {
  prepareExam,
  regenerateExam,
  getExamStatusView,
  startExamAttempt,
  recordExamAnswer,
  submitExamAttempt,
} from "../services/exam-service.js";

/* ---------- 课程 ---------- */

export function registerCourseHandlers(deps: RuntimeDeps): void {
  const emitter = deps.emitter;
  handle("course:list", async (): Promise<Course[]> => {
    const db = getDb();
    return db.select().from(courses).all() as Course[];
  });

  handle(
    "course:getTree",
    async (_e, courseId: string, locale?: string): Promise<ContentNode[]> => {
      const db = getDb();
      const nodes = db
        .select()
        .from(contentNodes)
        .where(eq(contentNodes.courseId, courseId))
        .all() as ContentNode[];
      // 如果有 locale，用翻译版标题替换（content/summary 仍按需调 getNodeContent）
      if (locale) {
        const { getCourseTitleTranslations } = await import("../services/translation-service.js");
        const titleMap = getCourseTitleTranslations(db, courseId, locale);
        for (const node of nodes) {
          const transTitle = titleMap.get(node.id);
          if (transTitle) node.title = transTitle;
        }
      }
      return nodes;
    },
  );

  // 全仓库导入：从 GitHub repo 拉 README → 检测形态 → 拉所有课时 .md → 落库。
  // 支持:形态 A（课程型，README 链接发现子文件）+ 形态 B（单文件型，README 自身够长）。
  // 进度通过 import:progress 事件推给渲染层。
  handle(
    "course:importFromRepo",
    async (_e, repoUrl: string, langCode?: string): Promise<Course> => {
      const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!m) throw new Error(`无效 GitHub URL：${repoUrl}`);
      const [, owner, repoRaw] = m;
      const cleanRepo = repoRaw.replace(/\.git$/, "");

      const send = (msg: string) =>
        emitter?.send("import:progress", msg);

      // 用纯编排函数拉取 + 解析（复用种子脚本同一条路径）
      let importResult;
      try {
        importResult = await importRepoToParsedCourse(
          owner, cleanRepo, "main", fetch, send,
        );
      } catch (e) {
        // README 拉取失败等 → 提示用户改用粘贴
        throw new Error(
          `${e instanceof Error ? e.message : "导入失败"}。` +
            "可能是网络受限或仓库私有，请改用「粘贴 Markdown」方式手动导入。",
        );
      }

      const { course: parsed, fetchedFiles, readmeMd } = importResult;

      // 落库
      let result;
      if (importResult.detection.pattern === "single-file" || parsed.sections.length === 0) {
        send("用 README 正文构建课程…");
        result = generateCourseFromMarkdownService(getDb(), readmeMd, {
          repoUrl,
          repoName: cleanRepo,
        });
      } else {
        result = generateCourseFromRepoFilesService(getDb(), parsed, {
          repoUrl,
          repoName: cleanRepo,
        });
      }
      markDirty();

      send(`导入完成：${result.sectionCount} 章 / ${result.lessonCount} 课`);

      // 多语言:如果用户选了翻译语言，拉翻译版内容存入 translations 表
      if (langCode && fetchedFiles.length > 0) {
        try {
          send(`拉取翻译版内容 (${langCode})…`);
          const { fetchTranslatedContent } = await import("../services/pure/repo-fetcher.js");
          const { persistTranslations } = await import("../services/translation-service.js");
          const translations = await fetchTranslatedContent(
            owner, cleanRepo, importResult.readmeBranch, langCode,
            fetchedFiles, fetch, send,
          );
          if (translations.size > 0) {
            const transResult = await persistTranslations(getDb(), result.courseId, langCode, translations);
            markDirty();
            send(`翻译完成: ${transResult.written} 课有翻译, ${transResult.skipped} 课无翻译`);
          } else {
            send("翻译版内容为空（该语言可能只有 README 翻译，lesson 未翻译）");
          }
        } catch (e) {
          send(`翻译拉取跳过(${e instanceof Error ? e.message : "出错"})`);
        }
      }

      // 自动 AI 结构化(有 key 时)。失败不阻塞,降级到纯确定性导入结果。
      // 必须在图片下载之前:LLM 可能 skip 一些 lesson(FK CASCADE 删 node_assets),
      // 结构化后 lesson 列表稳定了再关联图片才不会丢。
      await autoStructureCourse(result.courseId, send, importResult.detection.pattern).catch((e) => {
        send(`AI 结构化跳过(${e instanceof Error ? e.message : "无 key 或出错"})`);
      });

      // 图片下载:image_download flag(默认 on)控制。
      // 放在结构化之后:lesson 列表已稳定(skip 的已删),用 sourcePath 匹配不会丢图。
      if (isFlagOn("image_download") && fetchedFiles.length > 0) {
        try {
          send("正在收集课程图片(CDN)…");
          const { fetchRepoImages } = await import("../services/pure/repo-fetcher.js");
          const { writeBufferToAssets, persistAssetRecord } = await import("../services/asset-service.js");
          const downloaded = await fetchRepoImages(
            fetchedFiles, owner, cleanRepo, importResult.readmeBranch, fetch,
            (done, total, _path) => {
              if (done % 10 === 0) send(`下载图片 ${done}/${total}…`);
            },
          );
          if (downloaded.length > 0) {
            const nodes = getDb().select().from(contentNodes).where(eq(contentNodes.courseId, result.courseId)).all();
            const lessons = nodes.filter((n) => n.type === "lesson");
            let imgCount = 0;
            for (let idx = 0; idx < downloaded.length; idx++) {
              const img = downloaded[idx];
              // 用 sourcePath 匹配(而非 title):sourcePath 格式 "文件路径#anchor",
              // 取 # 前面的文件路径和 img.docPath 比较
              const lesson = lessons.find((l) => {
                const sp = (l.sourcePath ?? "").split("#")[0];
                return sp === img.docPath;
              }) ?? lessons.find((l) => {
                // 兜底:title 包含匹配
                const docFile = fetchedFiles.find((f) => f.path === img.docPath);
                return docFile && (l.title === docFile.title || l.title.includes(docFile.title));
              });
              const nodeId = lesson?.id ?? lessons[0]?.id;
              if (!nodeId) continue;
              const destName = `${String(idx).padStart(3, "0")}-${img.repoPath.split("/").pop()}`;
              try {
                writeBufferToAssets(img.buffer, result.courseId, destName);
                persistAssetRecord(getDb(), {
                  nodeId,
                  courseId: result.courseId,
                  filename: destName,
                  mimeType: img.mimeType,
                  sourcePath: img.repoPath,
                  sourceKind: "markdown_ref",
                  altText: img.altText,
                });
                imgCount++;
              } catch {
                /* 单张图失败跳过 */
              }
            }
            markDirty();
            send(`图片收集完成:${imgCount} 张`);
          }
        } catch (e) {
          send(`图片收集跳过(${e instanceof Error ? e.message : "出错"})`);
        }
      }

      const course = getDb().select().from(courses).where(eq(courses.id, result.courseId)).get();
      return course as unknown as Course;
    },
  );

  // 多语言:检测仓库可用翻译语言
  handle(
    "course:detectLanguages",
    async (_e, repoUrl: string): Promise<{ code: string; name: string }[]> => {
      const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!m) return [];
      const [, owner, repoRaw] = m;
      const cleanRepo = repoRaw.replace(/\.git$/, "");
      const { detectRepoLanguages } = await import("../services/pure/repo-fetcher.js");
      return detectRepoLanguages(owner, cleanRepo, "main", fetch);
    },
  );

  // 新智能管线 Step 1+2: 分析仓库
  handle(
    "course:analyzeRepo",
    async (_e, repoUrl: string) => {
      const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!m) throw new Error("无效的 GitHub URL");
      const [, owner, repoRaw] = m;
      const cleanRepo = repoRaw.replace(/\.git$/, "");

      const send = (msg: string) => emitter?.send("import:progress", msg);

      // Step 1: 拉取 README + 文件列表 + 完整目录树
      send("拉取仓库 README + 完整目录结构");
      const { fetchRepoInventory } = await import("../services/pure/repo-fetcher.js");
      const inventory = await fetchRepoInventory(owner, cleanRepo, "main", fetch, send);
      send(`✓ README ${inventory.readmeMd.length} 字 · ${inventory.fileList.length} 个课程文件 · ${inventory.fullTree.length} 个目录路径`);

      // Step 2: LLM 判文件角色 + sourceLang
      const { classifyFileRoles } = await import("../services/import-llm-service.js");
      console.error("[import] Step 2: LLM 文件角色分类 + 原文语言判断…");
      const roles = await classifyFileRoles(getDb(), inventory.readmeMd, inventory.fileList, inventory.fullTree, send);
      send(`✓ 文件分类: ${roles.original.length} 原文 · ${roles.practice.length} 实操 · ${roles.skip.length} 跳过 · 原文语言 ${roles.sourceLang}`);
      console.error(`[import] Step 2 完成: ${roles.original.length} original, ${roles.practice.length} practice, ${roles.skip.length} skip, sourceLang=${roles.sourceLang}, ${roles.languages.length} 翻译语言`);

      // 读用户语言偏好，按 sourceLang 模型自动决定导入语言（不弹窗）
      const { getPrefLang, resolveImportLang } = await import("../services/lang-pref.js");
      const pref = getPrefLang(getDb()) ?? "en";
      const { langCode: selectedLang, reason } = resolveImportLang(pref, roles.sourceLang, roles.languages);
      console.error(`[import] 语言决策: pref=${pref}, sourceLang=${roles.sourceLang} → selectedLang=${selectedLang ?? "(原文)"}, ${reason}`);
      send(`语言决策: ${reason}`);

      // 转换 translationFiles Map 为 Record（IPC 序列化）
      const translationFiles: Record<string, string[]> = {};
      for (const [code, paths] of roles.translations) {
        translationFiles[code] = paths;
      }
      // 显式翻译配对（规则/LLM 判出的原文→翻译精确对）
      const translationPairs: Record<string, string> = {};
      for (const [orig, trans] of roles.translationPairs) {
        translationPairs[orig] = trans;
      }

      return {
        repoUrl,
        readmeMd: inventory.readmeMd,
        branch: inventory.branch,
        sourceLang: roles.sourceLang,
        languages: roles.languages,
        selectedLang,
        importReason: reason,
        originalFiles: roles.original,
        practiceFiles: roles.practice,
        skipFiles: roles.skip,
        translationFiles,
        translationPairs,
        translationLayout: roles.translationLayout,
      };
    },
  );

  // 新智能管线 Step 3+4+5: 按分析结果导入（langCode 从 analysis.selectedLang 取）
  handle(
    "course:importAnalyzed",
    async (_e, repoUrl: string, analysis: RepoAnalysis) => {
      const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!m) throw new Error("无效的 GitHub URL");
      const [, owner, repoRaw] = m;
      const cleanRepo = repoRaw.replace(/\.git$/, "");

      const send = (msg: string) => emitter?.send("import:progress", msg);
      const langCode = analysis.selectedLang; // analyzeRepo 已按 pref_lang + sourceLang 自动决定

      // Step 3: 提取标题大纲（拉完整文件，算每段字符数供 LLM 拆分决策）
      const { fetchFileOutlines } = await import("../services/pure/repo-fetcher.js");
      const allFiles = [...analysis.originalFiles, ...analysis.practiceFiles];
      send(`提取 ${allFiles.length} 个文件的标题大纲 + 字数`);
      const outlines = await fetchFileOutlines(
        allFiles, owner, cleanRepo, analysis.branch, fetch,
        (done, total) => send(`提取大纲 ${done}/${total}`),
      );

      // Step 4: LLM 设计课程结构（study/practice/附属 三分类 + 字数驱动拆分）
      const { designCourseStructure } = await import("../services/import-llm-service.js");
      const structure = await designCourseStructure(
        getDb(), analysis.readmeMd, outlines,
        analysis.originalFiles, analysis.practiceFiles, send,
      );
      const lessonCount = structure.sections.reduce((n, s) => n + s.lessons.length, 0);
      send(`✓ 课程结构: ${structure.sections.length} 章 · ${lessonCount} 课`);

      // Step 5: 拉正文 + 图片内联 + 落库 + 验证
      const { executeImport } = await import("../services/import-pipeline.js");
      const { GithubContentSource } = await import("../services/content-source.js");
      const translationFilesMap = langCode && analysis.translationFiles[langCode]
        ? new Map([[langCode, analysis.translationFiles[langCode]!]])
        : null;
      const translationPairsMap = analysis.translationPairs
        ? new Map(Object.entries(analysis.translationPairs))
        : null;

      const result = await executeImport(
        getDb(), structure,
        {
          source: new GithubContentSource(owner, cleanRepo, analysis.branch, fetch),
          repoUrl, repoName: cleanRepo,
          langCode,
          translationFiles: translationFilesMap,
          translationPairs: translationPairsMap,
          sourceLang: analysis.sourceLang,
          translationLayout: analysis.translationLayout,
          markDirty,
        },
        send,
      );

      const course = getDb().select().from(courses).where(eq(courses.id, result.courseId)).get();
      return course as unknown as Course;
    },
  );

  // 多语言:获取课程已导入的翻译语言
  handle(
    "course:getLanguages",
    async (_e, courseId: string): Promise<string[]> => {
      const { getCourseLanguages } = await import("../services/translation-service.js");
      return getCourseLanguages(getDb(), courseId);
    },
  );

  // 多语言:设置/获取课程当前显示语言（存 settings 表）
  handle(
    "course:setLanguage",
    async (_e, courseId: string, locale: string | null): Promise<void> => {
      const key = `course:${courseId}:locale`;
      if (locale === null) {
        getDb().delete(settingsTable).where(eq(settingsTable.key, key)).run();
      } else {
        // upsert
        const existing = getDb().select().from(settingsTable).where(eq(settingsTable.key, key)).get();
        if (existing) {
          getDb().update(settingsTable).set({ value: locale }).where(eq(settingsTable.key, key)).run();
        } else {
          getDb().insert(settingsTable).values({ key, value: locale }).run();
        }
      }
      markDirty();
    },
  );

  handle(
    "course:getLanguage",
    async (_e, courseId: string): Promise<string | null> => {
      const key = `course:${courseId}:locale`;
      const row = getDb().select().from(settingsTable).where(eq(settingsTable.key, key)).get();
      return row?.value ?? null;
    },
  );

  // M4：从 markdown 字符串生成课程（无网络依赖，给 UI 的"粘贴 markdown"入口）
  handle(
    "course:generateFromMarkdown",
    async (
      _e,
      md: string,
      repoName: string,
      repoUrl?: string,
    ): Promise<Course> => {
      const result = generateCourseFromMarkdownService(getDb(), md, {
        repoUrl: repoUrl ?? null,
        repoName,
      });
      markDirty();
      const course = getDb()
        .select()
        .from(courses)
        .where(eq(courses.id, result.courseId))
        .get();
      return course as unknown as Course;
    },
  );

  // ── 后台导入任务（单飞 + 可取消）──
  // 导入是分钟级重管线（扫描→LLM 分类→LLM 结构设计→拉正文→落库）。job 化后
  // renderer 拿到 jobId 立即返回，用户可继续浏览其他课程；进度走 import:progress，
  // 结束走 import:done。取消只拦"写库前"的拉取阶段（executeImport 两阶段保证零残留）。
  let importCancelRequested = false;
  let importRunning = false;
  // 导入方案快照(断点续跑 + 课程包):userData/import-plans/*.json
  const planStore = createPlanStore(join(deps.dataDir, "import-plans"));

  /** 后台跑一个导入管线，结束统一发 import:done。work 返回值随 ok:true 透传(planId/packable 等)。 */
  const runImportJob = (jobId: string, work: () => Promise<{ courseId: string; title: string } & Record<string, unknown>>) => {
    void (async () => {
      try {
        const result = await work();
        emitter?.send("import:done", { ok: true, ...result });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[import] 后台导入失败(job ${jobId.slice(0, 8)}): ${msg}`);
        const planId = planIdOf(e) ?? undefined;
        emitter?.send("import:done", { ok: false, error: msg, cancelled: importCancelRequested, ...(planId ? { planId } : {}) });
      } finally {
        importRunning = false;
      }
    })();
  };

  // 导入本地文件夹 —— 走新 5 步管线(和 GitHub 对齐)，后台 job
  // Step1 buildLocalInventory → Step2 classifyFileRoles → Step3 extractOutlines
  // → Step4 designCourseStructure → Step5 executeImport
  handle("import:localFolder", async (_e, folderPath?: string): Promise<ImportJobHandle | null> => {
    const send = (msg: string) => emitter?.send("import:progress", msg);
    // 1. 文件夹来源:web 模式由渲染层传服务器侧路径(浏览器没有原生对话框);
    //    electron 模式无参调用 → 原生目录选择
    if (!folderPath && deps.ui === "web") {
      throw new Error("web 模式需要传入服务器侧文件夹路径");
    }
    const resolved = folderPath ?? (await deps.dialog.pickFolder("选择要导入的课程文件夹"));
    if (!resolved) return null;

    if (importRunning) throw new Error("已有导入任务在进行中，请等它结束或先取消");
    const jobId = randomUUID();
    importRunning = true;
    importCancelRequested = false;
    const shouldAbort = () => importCancelRequested;

    runImportJob(jobId, async () => {
      const r = await runSmartImport(
        { kind: "folder", path: resolved },
        { db: getDb(), store: planStore, markDirty, onProgress: send, shouldAbort },
      );
      const packable = planStore.findByCourse(r.courseId)?.kind === "github";
      return { courseId: r.courseId, title: r.title, planId: r.planId, reused: r.reused, packable };
    });

    return { jobId };
  });

  // 从 GitHub 仓库导入（后台 job）：analyzeRepo + importAnalyzed 合一，
  // renderer 立即返回，全部步骤的进度连续推 import:progress，结束推 import:done。
  handle("import:github", async (_e, repoUrl: string): Promise<ImportJobHandle> => {
    if (!/github\.com\/([^/]+)\/([^/]+)/.test(repoUrl)) throw new Error("无效的 GitHub URL");

    if (importRunning) throw new Error("已有导入任务在进行中，请等它结束或先取消");
    const jobId = randomUUID();
    importRunning = true;
    importCancelRequested = false;
    const shouldAbort = () => importCancelRequested;
    const send = (msg: string) => emitter?.send("import:progress", msg);

    runImportJob(jobId, async () => {
      const r = await runSmartImport(
        { kind: "github", url: repoUrl },
        { db: getDb(), store: planStore, markDirty, onProgress: send, shouldAbort },
      );
      const packable = planStore.findByCourse(r.courseId)?.kind === "github";
      return { courseId: r.courseId, title: r.title, planId: r.planId, reused: r.reused, packable };
    });

    return { jobId };
  });

  // 请求取消进行中的后台导入（拉取阶段生效，写库前零残留）
  handle("import:cancel", async (): Promise<boolean> => {
    if (!importRunning) return false;
    importCancelRequested = true;
    emitter?.send("import:progress", "正在取消导入…");
    return true;
  });

  // 从断点重试:上次失败/中断的导入带着已落盘的方案快照续跑(已完成步骤零重烧)
  handle("import:resume", async (_e, planId: string): Promise<ImportJobHandle> => {
    const plan = planStore.load(planId);
    if (!plan) throw new Error("找不到对应的导入方案快照(可能已过期)");
    if (importRunning) throw new Error("已有导入任务在进行中，请等它结束或先取消");
    const jobId = randomUUID();
    importRunning = true;
    importCancelRequested = false;
    const shouldAbort = () => importCancelRequested;
    const send = (msg: string) => emitter?.send("import:progress", msg);

    runImportJob(jobId, async () => {
      const r = await runSmartImport(
        { kind: "plan", plan },
        { db: getDb(), store: planStore, markDirty, onProgress: send, shouldAbort },
      );
      const packable = planStore.findByCourse(r.courseId)?.kind === "github";
      return { courseId: r.courseId, title: r.title, planId: r.planId, reused: r.reused, packable };
    });
    return { jobId };
  });

  // 导入课程包:选 .lookatstudy-pack.json → 校验 → 走编排器(命中则零 AI 调用)
  handle("import:importPack", async (_e, pack?: { fileName: string; content: string }): Promise<ImportJobHandle | null> => {
    let packJson: string | null;
    if (pack?.content) {
      packJson = pack.content; // web 模式:浏览器文件选择器读好内容传上来
    } else if (deps.ui === "web") {
      throw new Error("web 模式需要传入课程包文件内容");
    } else {
      const picked = await deps.dialog.openPack();
      if (!picked) return null;
      packJson = picked.content;
    }
    const { parsePlan } = await import("../services/pure/import-plan.js");
    const plan = parsePlan(packJson);
    if (!plan) throw new Error("课程包格式不识别(版本过旧或文件损坏)");
    if (!plan.structure) throw new Error("课程包不含课程结构,无法直接导入");

    if (importRunning) throw new Error("已有导入任务在进行中，请等它结束或先取消");
    const jobId = randomUUID();
    importRunning = true;
    importCancelRequested = false;
    const shouldAbort = () => importCancelRequested;
    const send = (msg: string) => emitter?.send("import:progress", msg);
    send(`课程包:${plan.kind === "github" ? `${plan.github?.owner}/${plan.github?.repo}` : plan.folder?.absPath ?? "(本地)"}`);

    runImportJob(jobId, async () => {
      // 包导入:存一份到本机 plans(成为本机的复用方案),再走编排器
      planStore.save(plan);
      const r = await runSmartImport(
        { kind: "plan", plan },
        { db: getDb(), store: planStore, markDirty, onProgress: send, shouldAbort },
      );
      const packable = planStore.findByCourse(r.courseId)?.kind === "github";
      return { courseId: r.courseId, title: r.title, planId: r.planId, reused: r.reused, packable };
    });
    return { jobId };
  });

  // 导出课程包:把某课程的导入方案另存为可分享文件(仅 github 来源;folder 含私有路径不导出)
  handle("import:exportPack", async (
    _e, courseId: string,
  ): Promise<ExportPackResult | null> => {
    const plan = planStore.findByCourse(courseId);
    if (!plan) throw new Error("这门课没有可导出的导入方案(旧版本导入的课程)");
    if (plan.kind !== "github" || !plan.github) {
      throw new Error("本地文件夹导入的课程不支持导出课程包(包含本机私有路径)");
    }
    const { serializePlan } = await import("../services/pure/import-plan.js");
    const fileName = `${plan.github.owner}-${plan.github.repo}.lookatstudy-pack.json`;
    const content = serializePlan(plan);
    if (deps.ui === "web") {
      // web 模式:内容直接回传,渲染层用浏览器下载落盘
      return { path: null, fileName, content };
    }
    const path = await deps.dialog.savePack(fileName, content);
    return path ? { path } : null;
  });

  // 删除课程 + 其下全部节点/进度/练习/聊天（级联清理由 services 负责）
  handle("course:delete", async (_e, courseId: string) => {
    const db = getDb();
    // 先收所有 nodeId（删 progress/exercises/chat_sessions 用）
    const nodes = db
      .select({ id: contentNodes.id })
      .from(contentNodes)
      .where(eq(contentNodes.courseId, courseId))
      .all();
    const nodeIds = nodes.map((n) => n.id);
    db.delete(courses).where(eq(courses.id, courseId)).run();
    db.delete(contentNodes).where(eq(contentNodes.courseId, courseId)).run();
    planStore.deleteByCourse(courseId); // 导入方案快照随课程一起清
    // 关联数据：逐表按 nodeId 删（sql.js/drizzle 不支持复合 IN，逐条删够用）
    if (nodeIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      try {
        db.delete(progressTable).where(inArray(progressTable.nodeId, nodeIds)).run();
      } catch {
        /* 表可能空 */
      }
      try {
        db.delete(srsItems).where(inArray(srsItems.nodeId, nodeIds)).run();
      } catch {
        /* 忽略 */
      }
      try {
        db.delete(exercises).where(inArray(exercises.nodeId, nodeIds)).run();
      } catch {
        /* 忽略 */
      }
      try {
        db.delete(chatSessions).where(inArray(chatSessions.nodeId, nodeIds)).run();
      } catch {
        /* 忽略 */
      }
    }
    markDirty();
  });

  // 取某节点完整内容（课程详情 / 练习生成上下文用）。有 locale 时返回翻译版。
  handle("course:getNodeContent", async (_e, nodeId: string, locale?: string) => {
    const db = getDb();
    if (locale) {
      const { getNodeTranslation } = await import("../services/translation-service.js");
      const trans = getNodeTranslation(db, nodeId, locale);
      if (trans?.content) return trans.content;
    }
    const node = db
      .select({ content: contentNodes.content })
      .from(contentNodes)
      .where(eq(contentNodes.id, nodeId))
      .get();
    return node?.content ?? null;
  });

  // 取节点摘要(懒生成:DB 没有则实时生成 lesson 摘要并缓存;section 用结构化时的摘要)。
  // locale = 界面语言(zh-CN/en):摘要随界面语言切换——en 优先 summary_en,
  // 历史节点没有英文摘要时单独补一次(不动已有 KC),全部缺失时回退中文 summary。
  handle("course:getNodeSummary", async (_e, nodeId: string, locale?: string | null) => {
    const db = getDb();
    const node = db
      .select()
      .from(contentNodes)
      .where(eq(contentNodes.id, nodeId))
      .get();
    if (!node) return null;
    const wantEn = locale === "en";
    // 已有摘要:按界面语言选版本
    if (node.summary) {
      if (wantEn) {
        if (node.summaryEn) return node.summaryEn;
        // 历史 lesson(只有中文摘要):补齐英文版,不重写已有 summary/KC
        if (node.type === "lesson") {
          try {
            const en = await generateLessonSummaryEn(db, nodeId, markDirty);
            if (en) return en;
          } catch { /* 补齐失败回退中文 */ }
        }
      }
      return node.summary;
    }
    // section 节点:结构化时已带 summary,没有就不生成(避免空 section 调 LLM)
    if (node.type !== "lesson") return null;
    // lesson 节点:懒生成(一次 LLM 调用同时产出中+英摘要+KC,落库+markDirty)
    try {
      const summary = await generateLessonSummary(db, nodeId, markDirty);
      if (!summary) return null;
      if (wantEn) {
        const fresh = db.select().from(contentNodes).where(eq(contentNodes.id, nodeId)).get();
        if (fresh?.summaryEn) return fresh.summaryEn;
      }
      return summary;
    } catch {
      return null; // 生成失败不阻塞,中栏显示"暂无摘要"
    }
  });

  // LLM 课程结构化：把导入的碎片节点重组成教学结构
  handle("course:restructure", async (_e, courseId: string) => {
    const restructureSend = (msg: string) => emitter?.send("import:progress", msg);
    restructureSend("AI 正在分析课程结构…");
    const proposal = await analyzeCourseStructure(getDb(), courseId, restructureSend);
    emitter?.send(
      "import:progress",
      `分析完成：${proposal.sections.length} 章节，重新组织中…`,
    );
    const result = applyCourseStructure(getDb(), courseId, proposal);
    markDirty();
    emitter?.send(
      "import:progress",
      `结构化完成：${result.sectionCount} 章 / ${result.lessonCount} 课 / 跳过 ${result.skippedCount} 个练习节点`,
    );
    return result;
  });

  // 两个世界:查某学习课对应的实操节点(同 source_path 目录)
  handle("course:getPracticeForLesson", (_e, nodeId: string) => {
    return findPracticeForLesson(getDb(), nodeId);
  });
  // 两个世界:查某实操节点对应的学习课(反向跳转)
  handle("course:getLessonForPractice", (_e, nodeId: string) => {
    return findLessonForPractice(getDb(), nodeId);
  });

  // LLM 生成章节摘要 + 前置依赖标记
  handle("course:generateSummaries", async (_e, courseId: string) => {
    emitter?.send("import:progress", "AI 正在生成章节摘要…");
    const result = await generateLessonSummaries(getDb(), courseId);
    markDirty();
    emitter?.send("import:progress", `摘要生成完成: ${result.sectionsUpdated} 章节 / ${result.lessonsUpdated} 课时`);
    return result;
  });

  // Starter prompts: 给学习者提供开始引导按钮
  handle("course:getStarterPrompts", async (_e, nodeId: string) => {
    return getStarterPrompts(getDb(), nodeId);
  });

  /* ---------- 多模态资源(node_assets)---------- */

  handle("asset:listByNode", async (_e, nodeId: string) => {
    return listAssetsByNode(getDb(), nodeId);
  });

  handle("asset:listByCourse", async (_e, courseId: string) => {
    return listAssetsByCourse(getDb(), courseId);
  });

  handle("asset:getDataUrl", async (_e, assetId: string): Promise<string | null> => {
    return getAssetDataUrl(getDb(), assetId);
  });
}

export function registerProgressHandlers(): void {
  handle(
    "progress:get",
    async (_e, nodeId: string): Promise<Progress | null> => {
      return getProgressService(getDb(), nodeId);
    },
  );

  handle(
    "progress:update",
    async (
      _e,
      nodeId: string,
      patch: Partial<Progress>,
    ): Promise<Progress> => {
      const result = updateProgressService(getDb(), nodeId, patch);
      markDirty();
      return result;
    },
  );

  handle("progress:markAttempted", async (_e, nodeId: string) => {
    markNodeAttemptedService(getDb(), nodeId, () => {
      markDirty();
      // 标记 attempted 即打卡（原行为保留）
      touchStreakToday();
    });
  });
}

/* ---------- SRS ---------- */

export function registerSrsHandlers(): void {
  handle("srs:getDue", async (): Promise<string[]> => {
    return getDueReviewNodeIds();
  });

  // v0.2: 详细 SRS 项(供四象限复习面板)
  handle("srs:getAll", async () => {
    return getAllSrsItems();
  });

  handle(
    "srs:record",
    async (_e, nodeId: string, quality: ReviewQuality) => {
      recordReview(nodeId, quality);
      // Phase A: 复习自评也给 XP（复习也是学习，应该有能量反馈）
      if (quality >= 4) addXpCorrect(getDb());
      else if (quality <= 2) addXpWrong(getDb());
      // Phase D: 自评只影响 SRS 排期，不影响 BKT mastery。
      // 自评是主观的，不应直接影响 BKT 概率。mastery 只由客观答题驱动（quiz/exercise/record_answer）。
    },
  );
}

/* ---------- 打卡 ---------- */

export function registerStreakHandlers(): void {
  handle("streak:get", async (): Promise<Streak> => getStreak());

  handle("streak:touchToday", async (): Promise<Streak> =>
    touchStreakToday(),
  );
}

/* ---------- 设置 ---------- */

export function registerSettingsHandlers(): void {
  handle(
    "settings:get",
    async (_e, key: SettingKey): Promise<string | null> => {
      const db = getDb();
      const row = db
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, key))
        .get();
      // v0.1: API key 类敏感字段用 electron safeStorage 加密（M2 接入）
      // 这里先明文返回，因为设置页本身就在本地
      return row?.value ?? null;
    },
  );

  handle(
    "settings:set",
    async (_e, key: SettingKey, value: string) => {
      const db = getDb();
      const isSecret = key.endsWith("api_key");
      db.insert(settingsTable)
        .values({ key, value, isSecret })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value, isSecret },
        })
        .run();
      markDirty();
    },
  );

  // XP 状态（今日 XP + 每日目标 + 达成百分比）
  handle("xp:getStatus", async () => {
    return getXpStatus(getDb());
  });

  // 导出学习记录（JSON / Markdown）
  handle("course:export", async (_e, courseId: string, format: "json" | "markdown") => {
    const data = collectExportData(getDb(), courseId);
    if (!data) throw new Error(`课程不存在: ${courseId}`);
    return format === "json" ? exportJson(data) : exportMarkdown(data);
  });
}

/* ---------- Soul 系统（教学人设/persona） ---------- */

export function registerSoulHandlers(): void {
  handle("soul:list", async () => listSoulsService(getDb()));

  handle("soul:get", async (_e, name: string) =>
    getSoulService(getDb(), name),
  );

  handle(
    "soul:create",
    async (
      _e,
      input: { name: string; description: string; type: string; body: string },
    ) => {
      const result = createSoulService(getDb(), {
        name: input.name,
        description: input.description,
        type: input.type as "builtin" | "custom",
        body: input.body,
      });
      markDirty();
      return result;
    },
  );

  handle("soul:setActive", async (_e, name: string) => {
    setActiveSoulService(getDb(), name);
    markDirty();
  });

  handle("soul:getActive", async () => getActiveSoulService(getDb()));
}

/* ---------- Agent 引擎 + Proposal（M2） ---------- */

export function registerAgentHandlers(deps: RuntimeDeps): void {
  // agent 对话：流式 token 通过 chat:token 事件推（mainWindow 注入到 handleAgentChat）
  handle(
    "agent:chat",
    async (_e, nodeId: string, userMessage: string, locale?: string | null) => {
      return handleAgentChat(deps.emitter, nodeId, userMessage, locale);
    },
  );

  // 中断当前 agent 回复（Stop 按钮）
  handle("agent:abort", async (_e, nodeId: string) => {
    abortAgentChat(nodeId);
  });

  // v0.4: Thread 模式 agent 对话(传 threadId,从 thread 装配上下文)
  handle(
    "agent:chatThread",
    async (
      _e,
      threadId: string,
      userMessage: string,
      displayText?: string | null,
      locale?: string | null,
      attachments?: ChatAttachmentInput[],
    ) => {
      return handleAgentChatThread(deps.emitter, threadId, userMessage, displayText, locale, attachments);
    },
  );
  handle("agent:abortThread", async (_e, threadId: string) => {
    abortAgentChatThread(threadId);
  });

  // v0.10: 输入框上下文表的"固定开销"(system/课文/学习者) + 模型窗口/看图能力
  handle("agent:getContextUsage", async (_e, nodeId: string, locale?: string | null) => {
    return getContextUsage(getDb(), nodeId, locale);
  });
  // v0.10: 聊天图片附件的 data-url(渲染层历史缩略图;文件名守卫在 store 内)
  handle("attachment:getDataUrl", async (_e, file: string) => {
    return readAttachmentDataUrl(file);
  });

  // 取某节点聊天历史（持久化在 chat_sessions 表）
  handle("agent:getHistory", async (_e, nodeId: string) => {
    return getChatHistory(nodeId);
  });

  // 清空某节点聊天历史
  handle("agent:clearHistory", async (_e, nodeId: string) => {
    clearChatHistory(nodeId);
  });

  // provider 是否就绪（渲染层只见布尔）
  handle("agent:isReady", async () => isLlmReady(getDb()));

  // 返回所有 provider 预设元数据（给 Settings 页做 provider/model 选择器，不含 key）
  handle("agent:getProviderPresets", async () => {
    // 剥成 ApiExpose 契约里的 ProviderPresetInfo（不含 key 字段）
    return PROVIDER_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      defaultModel: p.defaultModel,
      models: p.models,
      apiKeySetting: p.apiKeySetting,
      keyUrl: p.keyUrl,
      note: p.note,
    }));
  });

  // 测试当前 provider 连接（Settings 页"测试连接"按钮;vision=true 测识图覆盖链路）
  handle("agent:testConnection", async (_e, opts?: { vision?: boolean }) => {
    return testLlmConnection(getDb(), opts);
  });

  // 测试自定义 provider 配置（不保存，临时验证）
  handle("agent:testCustomProvider", async (_e, input: CustomProviderInput) => {
    return testCustomProvider(input);
  });

  // OpenRouter 模型自动发现（公开 API，无需 key）
  handle("agent:discoverModels", async () => {
    return fetchOpenRouterModels();
  });

  // Provider 直连模型发现（用用户已配的 key 拉取 /v1/models）
  handle("agent:discoverProviderModels", async (_e, baseUrl: string, apiKey: string) => {
    return fetchProviderModels(baseUrl, apiKey);
  });

  // 自定义 provider CRUD
  handle("customProvider:list", async () => {
    return listCustomProvidersService(getDb());
  });
  handle("customProvider:create", async (_e, input: CustomProviderInput) => {
    const result = createCustomProviderService(getDb(), input);
    markDirty();
    return result;
  });
  handle("customProvider:update", async (_e, id: string, input: Partial<CustomProviderInput>) => {
    const result = updateCustomProviderService(getDb(), id, input);
    markDirty();
    return result;
  });
  handle("customProvider:delete", async (_e, id: string) => {
    deleteCustomProviderService(getDb(), id);
    markDirty();
  });

  // Proposal 流水线
  handle("proposal:listPending", async () =>
    listPendingProposalsService(getDb()),
  );
  handle("proposal:apply", async (_e, id: string) => {
    const db = getDb();
    // 拿皇冠过渡检测:apply 前该 proposal 节点是否已 mastered(已 mastered 就不算"首次拿皇冠")
    const prop = db.select().from(proposals).where(eq(proposals.id, id)).get();
    const wasMastered = !!prop?.nodeId
      && db.select().from(progressTable).where(eq(progressTable.nodeId, prop.nodeId)).get()?.status === "mastered";
    const result = applyProposalService(db, id);
    // P2 闭环:应用掌握度观测 → 同步写 SRS(答对推迟复习,答错提前重练)。
    // 覆盖 exercise:submit / AI record_answer 的 pending 提议在此 apply 的路径。
    for (const op of result.operations ?? []) {
      if (op.type === "update_mastery" && op.nodeId) {
        recordReview(op.nodeId, ((op.correct ?? false) ? 5 : 2) as ReviewQuality);
      } else if (op.type === "mark_mastered" && result.nodeId) {
        recordReview(result.nodeId, 5 as 5);
        // 里程碑(拿皇冠):仅首次掌握(!wasMastered)触发固化——一个节点只拿一次皇冠
        if (!wasMastered) triggerConsolidationOnMilestone(result.nodeId);
      }
    }
    markDirty();
    return result;
  });
  handle("proposal:reject", async (_e, id: string) => {
    const result = rejectProposalService(getDb(), id);
    markDirty();
    return result;
  });
  // quiz 产物本地评分 → 自动建+应用 update_mastery 提案。
  // 答题观测是确定性的(无需 LLM 判断/人审),直接 apply。
  handle("quiz:recordAnswer", async (_e, nodeId: string, correct: boolean, kc?: string) => {
    if (!nodeId) return { applied: false };
    // XP 即时反馈(与 exercise:submit 对齐:答对+10/答错+1)。
    correct ? addXpCorrect(getDb()) : addXpWrong(getDb());
    // Per-KC BKT: 将 KC 标题解析为下标（proposal 用 kcIndex 归因）
    let kcIndex: number | undefined;
    if (kc) {
      const kps = getKnowledgePoints(getDb(), nodeId);
      const idx = kps.findIndex((k) => k.title === kc);
      if (idx >= 0) kcIndex = idx;
    }
    // P4: 记录应用前 status,用于检测"毕业时刻"过渡(mastered flag 驱动庆祝)。
    const prevRow = getDb().select().from(progressTable).where(eq(progressTable.nodeId, nodeId)).get();
    const wasMastered = prevRow?.status === "mastered";
    const proposal = createProposalService(getDb(), {
      nodeId,
      operations: [{ type: "update_mastery", nodeId, correct, kcIndex }],
      rationale: correct ? "quiz 产物答对" : "quiz 产物答错",
    });
    applyProposalService(getDb(), proposal.id);
    // P2 闭环:quiz 答题经 service 直接 apply(不经 proposal:apply IPC),这里补 SRS 写。
    recordReview(nodeId, (correct ? 5 : 2) as ReviewQuality);
    markDirty();
    // 读回新 mastery + 检测毕业过渡(mastered=true 仅在本次从非 mastered → mastered)
    const row = getDb().select().from(progressTable).where(eq(progressTable.nodeId, nodeId)).get();
    const mastered = !wasMastered && row?.status === "mastered";
    // 里程碑(拿皇冠):首次 mastered → 触发记忆固化该课程
    if (mastered) triggerConsolidationOnMilestone(nodeId);
    return { applied: true, newMastery: row?.mastery ?? undefined, mastered };
  });
}

/* ---------- 仪表盘 + 检索 + 记忆（M3） ---------- */

/**
 * 里程碑触发记忆固化:节点首次 mastered(拿皇冠/通关)时,固化该课程的学习者记忆。
 * 里程碑稀有 → 不像时间节流那样无脑烧 token;且"刚完成一件有意义的事"是最自然的固化时机。
 * flag 门控,fire-and-forget(不阻塞答题响应),错误只记日志。
 */
function triggerConsolidationOnMilestone(nodeId: string): void {
  try {
    if (!isFlagOn("memory_system")) return;
    const db = getDb();
    const node = db.select().from(contentNodes).where(eq(contentNodes.id, nodeId)).get();
    const courseId = node?.courseId;
    if (!courseId) return;
    const llm = resolveLlm(db);
    // 增量:只采上次固化水位之后的新数据(避免重复处理历史)
    const since = getConsolidationWatermark(db, courseId) ?? undefined;
    const win = gatherConsolidationWindow(db, { courseId, since });
    void consolidate(db, win, defaultLlmConsolidate(llm.languageModel))
      .then(() => {
        // 推进水位(无论是否写入新 memory,都标记"已处理到此刻",下次只采增量)
        setConsolidationWatermark(db, courseId);
        markDirty();
      })
      .catch((e) => console.error("[consolidate] milestone failed", e));
  } catch (e) {
    console.error("[consolidate] milestone trigger error", e);
  }
}

export function registerM3Handlers(): void {
  handle("dashboard:get", async (_e, courseId: string) => {
    return getDashboardService(getDb(), courseId);
  });

  handle("search:content", async (_e, query: string) => {
    // searchContent 需要原生 sqljs 句柄走 LIKE；从 drizzle $client 拿
    const sqljs = getDb() as unknown as {
      exec: (sql: string, params?: unknown[]) => Array<{ values: unknown[][] }>;
    };
    return searchContentService(sqljs, query);
  });

  // P3: 学习者主动报"卡点" → 写 friction_log(供 agent 上下文自适应)。
  handle(
    "friction:log",
    async (
      _e,
      nodeId: string | null,
      category: HumanFrictionCategory,
      summary: string | null,
    ) => {
      insertFrictionDb(getDb(), nodeId, category, summary);
      markDirty();
    },
  );

  handle(
    "memory:update",
    async (
      _e,
      input: { nodeId?: string | null; summary: string; category: string },
    ) => {
      const result = updateMemoryService(getDb(), {
        nodeId: input.nodeId,
        summary: input.summary,
        category: input.category as "global" | "node" | "friction_pattern",
      });
      markDirty();
      return result;
    },
  );

  handle(
    "memory:get",
    async (
      _e,
      nodeId: string | null,
      category?: "global" | "node" | "friction_pattern",
    ) => getMemoryService(getDb(), nodeId, category),
  );

  // 记忆固化:从课程的对话+friction 采集窗口 → LLM 提炼+合并进全三类 memory。
  // memory_system flag off 时 no-op(off=baseline)。返回写入的类别。
  handle("consolidate:run", async (_e, courseId: string) => {
    if (!isFlagOn("memory_system")) {
      return { ok: false, reason: "memory_system flag off" };
    }
    const db = getDb();
    const llm = resolveLlm(db);
    const win = gatherConsolidationWindow(db, { courseId });
    const result = await consolidate(db, win, defaultLlmConsolidate(llm.languageModel));
    markDirty();
    return { ok: true, written: Object.keys(result) };
  });
}

/**
 * 导入后自动 AI 结构化(有 API key 时)。
 *
 * 两条路径:
 *   - well-organized: 只判 world(study/practice/skip),保留原始目录结构
 *   - 其他: LLM 重组章节(analyzeCourseStructure → applyCourseStructure)
 *
 * 失败不阻塞(调用方 catch),用户仍得到纯确定性导入的课程。
 * 无 key → 直接返回(降级)。
 */
async function autoStructureCourse(
  courseId: string,
  send: (msg: string) => void,
  repoPattern?: string,
): Promise<void> {
  const ready = isLlmReady(getDb());
  if (!ready.ready) {
    return; // 无 key,跳过(不报错,用户可后续手动结构化)
  }

  if (repoPattern === "well-organized") {
    // 路径 A:只判 world,保留原始章节结构
    send("AI 正在分类学习/实操内容（保留原始章节）…");
    const { classifyWorldsOnly, applyWorldClassification } = await import("../services/course-structure-service.js");
    const classifications = await classifyWorldsOnly(getDb(), courseId, send);
    const result = applyWorldClassification(getDb(), courseId, classifications);
    markDirty();
    ensureExamNodesForExistingCourses(getDb());
    markDirty();
    send(`AI 分类完成：📚 学习 ${result.studyCount} 课 / 🔧 实操 ${result.practiceCount} 课 / 跳过 ${result.skippedCount}`);
    // Per-KC BKT: 提取知识点(KC) + 摘要 → per-KC BKT 毕业门控的基础
    send("AI 正在提取知识点…");
    await generateLessonSummaries(getDb(), courseId).catch(() => {});
    send("知识点提取完成");
    return;
  }

  // 路径 B:LLM 重组章节(杂乱仓库)
  send("AI 正在分析课程结构…");
  const proposal = await analyzeCourseStructure(getDb(), courseId, send);
  send(`AI 重组章节(${proposal.sections.length} 章)…`);
  applyCourseStructure(getDb(), courseId, proposal);
  markDirty();
  ensureExamNodesForExistingCourses(getDb());
  markDirty();
  send("AI 结构化完成");
  // Per-KC BKT: 提取知识点(KC) + 摘要
  send("AI 正在提取知识点…");
  await generateLessonSummaries(getDb(), courseId).catch(() => {});
  send("知识点提取完成");
}

/* ---------- v0.12:语音(朗读/模型管理) ---------- */

export function registerSpeechHandlers(deps: RuntimeDeps): void {
  const emit = (channel: string, payload: unknown) => deps.emitter.send(channel, payload);

  handle("speech:getModelStatus", async () => speechModelsStatusSnapshot(deps.dataDir));

  handle("speech:ensureModel", async (_e, id: SpeechModelId) => {
    await ensureSpeechModelEmitting(emit, deps.dataDir, id);
    // 落盘后变体可能变化(如 fp32 兜底 → int8),引擎单例按旧目录内容建的必须失效
    invalidateSpeechEngines();
    return speechModelsStatusSnapshot(deps.dataDir);
  });

  handle("speech:deleteModel", async (_e, id: SpeechModelId) => {
    stopSpeaking();
    invalidateSpeechEngines();
    await deleteSpeechModel(deps.dataDir, id);
  });

  handle("speech:ttsSpeak", async (_e, text: string, messageId: string) => {
    const settings = readSettingsMap(getDb());
    const result = await speakMessage(emit, deps.dataDir, settings, messageId, text);
    // edge 档首次使用:回执带 firstUse(渲染层一次性披露),落 disclosed 标记
    if (result.ok && result.engine === "edge" && settings.tts_edge_disclosed !== "1") {
      const db = getDb();
      db.insert(settingsTable)
        .values({ key: "tts_edge_disclosed", value: "1", isSecret: false })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value: "1" } })
        .run();
      markDirty();
      return { ...result, firstUse: true };
    }
    return result;
  });

  handle("speech:ttsStop", async () => {
    stopSpeaking();
  });

  handle("speech:asrTranscribe", async (_e, wavBytes: ArrayBuffer, locale?: string) => {
    const settings = readSettingsMap(getDb());
    return transcribeAudio(deps.dataDir, settings, wavBytes, locale);
  });
}

export function registerAllHandlers(deps: RuntimeDeps): void {
  registerCourseHandlers(deps);
  registerProgressHandlers();
  registerSrsHandlers();
  registerStreakHandlers();
  registerSettingsHandlers();
  registerSoulHandlers();
  registerAgentHandlers(deps);
  registerM3Handlers();
  registerExerciseHandlers();
  registerExamHandlers();
  registerCanvasHandlers();
  registerThreadHandlers();
  registerSpeechHandlers(deps);
}

/* ---------- v0.4: Thread 会话 ---------- */

export function registerThreadHandlers(): void {
  handle(
    "thread:list",
    async (_e, courseId: string, status?: "active" | "archived") => {
      return listThreads(courseId, status);
    },
  );
  handle("thread:create", async (_e, input) => {
    return createThread(input);
  });
  handle("thread:update", async (_e, id: string, patch) => {
    return updateThread(id, patch);
  });
  handle("thread:delete", async (_e, id: string) => {
    deleteThread(id);
  });
  handle("thread:getMessages", async (_e, threadId: string) => {
    return getThreadMessagesForDisplay(threadId);
  });
  handle(
    "thread:findRecentByNode",
    async (_e, courseId: string, nodeId: string) => {
      return findRecentThreadByNode(courseId, nodeId);
    },
  );
  // 注:发消息走 agent:chat(threadId, msg)——在 registerAgentHandlers 里桥接,
  // 因为要复用 streamText + chat:part 流式协议(M1 改造)。
}

/* ---------- v0.3: Canvas 画布(黑板笔记本) ---------- */

export function registerCanvasHandlers(): void {
  // zone 可选:undefined=全部 / 'understand'=理解区 / 'note'=笔记区 / 'practice'=练习区
  handle(
    "canvas:list",
    async (_e, courseId: string, nodeId?: string | null, zone?: string) => {
      return listCanvasItems(courseId, nodeId ?? undefined, zone as CanvasZoneOpt);
    },
  );
  handle(
    "canvas:save",
    async (_e, input) => {
      return saveCanvasItem(input);
    },
  );
  handle("canvas:delete", async (_e, id: string) => {
    deleteCanvasItem(id);
  });
  handle("canvas:togglePin", async (_e, id: string) => {
    return togglePinCanvasItem(id);
  });
  // 用户画线加笔记(user_note),带溯源
  handle("canvas:saveUserNote", async (_e, input) => {
    return saveUserNote(input);
  });
  // quiz 重做后更新 last_result(只保留最近一次)
  handle("canvas:recordQuizResult", async (_e, id: string, correct: boolean) => {
    return recordQuizResult(id, correct);
  });
  // 更新 user_note 的用户注释(canvas_items.notes 列)
  handle("canvas:updateUserNoteComment", async (_e, id: string, comment: string) => {
    return updateUserNoteComment(id, comment);
  });
}

/* ---------- 练习题 ---------- */

export function registerExerciseHandlers(): void {
  // AI 生题（缓存到 exercises 表）
  handle(
    "exercise:generate",
    async (_e, nodeId: string, type?: ExerciseType, locale?: string | null) => {
      const result = await generateExerciseService(getDb(), nodeId, type, locale);
      markDirty();
      return result;
    },
  );

  // 列出某节点缓存的练习题
  handle("exercise:list", async (_e, nodeId: string) => {
    return listExercisesService(getDb(), nodeId);
  });

  // 提交答案 + 判分（触发掌握度更新 Proposal）
  handle(
    "exercise:submit",
    async (_e, exerciseId: string, userAnswer: string) => {
      const result = submitExerciseAnswerService(getDb(), exerciseId, userAnswer);
      markDirty();
      return result;
    },
  );
}

/** 章节考试(关底 boss)IPC handlers */
export function registerExamHandlers(): void {
  // 幂等启动题目生成(后台进行,进度走 exam:status 事件)
  handle("exam:prepare", (_e, examNodeId: string, locale?: string | null) => {
    return prepareExam(getDb(), examNodeId, locale);
  });

  // 重新生成题库:删旧题重启生成(在飞 no-op;悬挂 attempt 判死;历史星数保留)
  handle("exam:regenerate", (_e, examNodeId: string, locale?: string | null) => {
    return regenerateExam(getDb(), examNodeId, locale);
  });

  // 查状态 + 就绪元信息 + 最新 attempt(悬挂 attempt 在此自动判死)
  handle("exam:getStatus", (_e, examNodeId: string) => {
    return getExamStatusView(getDb(), examNodeId);
  });

  // 开始/重新考试:建 attempt 行
  handle("exam:startAttempt", (_e, examNodeId: string) => {
    const result = startExamAttempt(getDb(), examNodeId);
    markDirty();
    return result;
  });

  // 逐题增量持久化答案(崩溃安全)
  handle(
    "exam:recordAnswer",
    (_e, examNodeId: string, attemptId: string, exerciseId: string, answer: string) => {
      recordExamAnswer(getDb(), examNodeId, attemptId, exerciseId, answer);
      markDirty();
    },
  );

  // 提交考试:判分 + 算星数 + 写 attempt 结算 + progress.crownLevel
  handle(
    "exam:submitAttempt",
    (
      _e,
      examNodeId: string,
      attemptId: string,
      answers: Record<string, string>,
      opts?: { terminated?: boolean },
    ) => {
      const result = submitExamAttempt(getDb(), examNodeId, attemptId, answers, opts);
      markDirty();
      return result;
    },
  );
}

/**
 * 类型断言：确保我们的 IPC 通道实现覆盖 ApiExpose 全部方法。
 * 后续 M2/M4 实现 chat/import 时，这里会变成实际函数。
 */
export type { ApiExpose };
