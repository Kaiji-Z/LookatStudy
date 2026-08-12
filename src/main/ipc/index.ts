/**
 * IPC handlers 注册 —— 主进程对渲染层暴露的所有方法。
 *
 * 组织方式：按领域分 register* 函数，由 main/index.ts 统一调用。
 * 通道名规范：domain:action（如 course:list, streak:touch）
 */
import { ipcMain, type BrowserWindow, dialog } from "electron";
import { getDb, markDirty } from "../db/index.js";
import {
  courses,
  contentNodes,
  settings as settingsTable,
  progress as progressTable,
  srsItems,
  exercises,
  chatSessions,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import type {
  ApiExpose,
  Course,
  ContentNode,
  Progress,
  Streak,
  ReviewQuality,
  SettingKey,
  ExerciseType,
  CustomProviderInput,
  RepoAnalysis,
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
import {
  listThreads,
  createThread,
  updateThread,
  deleteThread,
  getThreadMessages,
  findRecentThreadByNode,
} from "../services/thread-service.js";
import { getStreak, touchStreakToday } from "../services/streak.js";
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
// Skill 系统（M1）—— 业务逻辑在 skill-service，IPC 是薄壳
import {
  listSkills as listSkillsService,
  getSkill as getSkillService,
  createSkill as createSkillService,
  setActiveSkill as setActiveSkillService,
  getActiveSkill as getActiveSkillService,
} from "../services/skills/skill-service.js";
// Agent 引擎 + Proposal（M2）
import { handleAgentChat, abortAgentChat, getChatHistory, clearChatHistory, handleAgentChatThread, abortAgentChatThread } from "../services/agent/agent-engine.js";
import { isLlmReady, testLlmConnection, testCustomProvider, fetchOpenRouterModels, fetchProviderModels } from "../services/agent/llm-client.js";
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
// M3：仪表盘 + 检索 + 记忆
import { getDashboard as getDashboardService } from "../services/dashboard-service.js";
import { searchContent as searchContentService } from "../services/search-service.js";
import {
  updateMemory as updateMemoryService,
  getMemory as getMemoryService,
} from "../services/search-service.js";
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
} from "../services/course-structure-service.js";
// Starter prompts
import { getStarterPrompts } from "../services/starter-prompts-service.js";
// XP 系统
import { getXpStatus } from "../services/xp-service.js";
// 导出
import { collectExportData, exportJson, exportMarkdown } from "../services/export-service.js";
// 练习题服务
import {
  generateExercise as generateExerciseService,
  listExercises as listExercisesService,
  submitExerciseAnswer as submitExerciseAnswerService,
} from "../services/exercise-service.js";
// 章节考试服务(关底 boss)
import {
  startExam,
  submitExam,
} from "../services/exam-service.js";

/* ---------- 课程 ---------- */

export function registerCourseHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle("course:list", async (): Promise<Course[]> => {
    const db = getDb();
    return db.select().from(courses).all() as Course[];
  });

  ipcMain.handle(
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
  ipcMain.handle(
    "course:importFromRepo",
    async (_e, repoUrl: string, langCode?: string): Promise<Course> => {
      const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!m) throw new Error(`无效 GitHub URL：${repoUrl}`);
      const [, owner, repoRaw] = m;
      const cleanRepo = repoRaw.replace(/\.git$/, "");

      const send = (msg: string) =>
        mainWindow?.webContents.send("import:progress", msg);

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
  ipcMain.handle(
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
  ipcMain.handle(
    "course:analyzeRepo",
    async (_e, repoUrl: string) => {
      const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!m) throw new Error("无效的 GitHub URL");
      const [, owner, repoRaw] = m;
      const cleanRepo = repoRaw.replace(/\.git$/, "");

      const send = (msg: string) => mainWindow?.webContents.send("import:progress", msg);

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
        translationLayout: roles.translationLayout,
      };
    },
  );

  // 新智能管线 Step 3+4+5: 按分析结果导入（langCode 从 analysis.selectedLang 取）
  ipcMain.handle(
    "course:importAnalyzed",
    async (_e, repoUrl: string, analysis: RepoAnalysis) => {
      const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!m) throw new Error("无效的 GitHub URL");
      const [, owner, repoRaw] = m;
      const cleanRepo = repoRaw.replace(/\.git$/, "");

      const send = (msg: string) => mainWindow?.webContents.send("import:progress", msg);
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

      const result = await executeImport(
        getDb(), structure,
        {
          source: new GithubContentSource(owner, cleanRepo, analysis.branch, fetch),
          repoUrl, repoName: cleanRepo,
          langCode,
          translationFiles: translationFilesMap,
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
  ipcMain.handle(
    "course:getLanguages",
    async (_e, courseId: string): Promise<string[]> => {
      const { getCourseLanguages } = await import("../services/translation-service.js");
      return getCourseLanguages(getDb(), courseId);
    },
  );

  // 多语言:设置/获取课程当前显示语言（存 settings 表）
  ipcMain.handle(
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

  ipcMain.handle(
    "course:getLanguage",
    async (_e, courseId: string): Promise<string | null> => {
      const key = `course:${courseId}:locale`;
      const row = getDb().select().from(settingsTable).where(eq(settingsTable.key, key)).get();
      return row?.value ?? null;
    },
  );

  // M4：从 markdown 字符串生成课程（无网络依赖，给 UI 的"粘贴 markdown"入口）
  ipcMain.handle(
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

  // 导入本地文件夹 —— 走新 5 步管线(和 GitHub 对齐)
  // Step1 buildLocalInventory → Step2 classifyFileRoles → Step3 extractOutlines
  // → Step4 designCourseStructure → Step5 executeImport
  ipcMain.handle("import:localFolder", async (): Promise<Course | null> => {
    const send = (msg: string) => mainWindow?.webContents.send("import:progress", msg);
    // 1. Electron 文件选择对话框(选文件夹)
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "选择要导入的课程文件夹",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const folderPath = result.filePaths[0];
    const folderName = folderPath.split(/[\\/]/).pop() ?? "local-course";

    // Step 1: 扫描 → 文档 + 图片 + 翻译 + README + 目录树 + 独立图片
    send("正在扫描文件夹…");
    const { buildLocalInventory } = await import("../services/pure/local-folder-scanner.js");
    const inventory = await buildLocalInventory(folderPath, (n) => {
      if (n % 20 === 0) send(`已扫描 ${n} 个文件…`);
    });

    if (inventory.docs.length === 0) {
      throw new Error("文件夹里没有找到可识别的文本内容(.txt/.md/.html/.pdf)");
    }
    send(`✓ 扫描完成:${inventory.docs.length} 文档 · ${inventory.images.length} 图 · ${inventory.translations.length} 翻译文件`);

    // 构建 docsMap（原文 + 翻译）→ LocalContentSource
    const docsMap = new Map<string, string>();
    for (const doc of inventory.docs) docsMap.set(doc.path, doc.content);
    for (const tr of inventory.translations) docsMap.set(tr.path, tr.content);

    // Step 2: LLM 判文件角色 + sourceLang
    const { classifyFileRoles } = await import("../services/import-llm-service.js");
    const { pathsToDiscoveredFiles } = await import("../services/pure/repo-fetcher.js");
    const fileList = pathsToDiscoveredFiles(inventory.docs.map((d) => d.path));
    const roles = await classifyFileRoles(getDb(), inventory.readmeMd, fileList, inventory.fullTree, send);
    send(`✓ 文件分类:${roles.original.length} 原文 · ${roles.practice.length} 实操 · ${roles.skip.length} 跳过 · 原文语言 ${roles.sourceLang}`);

    // 语言决策（用本地 translations/ 检测到的语言，比 README 链接更可靠）
    const { getPrefLang, resolveImportLang } = await import("../services/lang-pref.js");
    const pref = getPrefLang(getDb()) ?? "en";
    const localLangs = inventory.translationLangs.map((code) => ({ code, name: code }));
    const { langCode: selectedLang, reason } = resolveImportLang(pref, roles.sourceLang, localLangs);
    send(`语言决策:${reason}`);

    // Step 3: 提取标题大纲（纯函数，不经网络，直接从 docsMap 读）
    const { extractOutlineWithCharCounts } = await import("../services/pure/repo-fetcher.js");
    const allFiles = [...roles.original, ...roles.practice];
    const outlines = new Map<string, ReturnType<typeof extractOutlineWithCharCounts>>();
    for (const path of allFiles) {
      const content = docsMap.get(path);
      if (content) outlines.set(path, extractOutlineWithCharCounts(content, path));
    }
    send(`✓ 提取 ${outlines.size} 个文件大纲`);

    // Step 4: LLM 设计课程结构（含独立图片关联）
    const { designCourseStructure } = await import("../services/import-llm-service.js");
    const standaloneImgList = inventory.standaloneImages.map((img) => ({ path: img.path, alt: img.altText }));
    const structure = await designCourseStructure(
      getDb(), inventory.readmeMd, outlines,
      roles.original, roles.practice, send, standaloneImgList,
    );
    const lessonCount = structure.sections.reduce((n, s) => n + s.lessons.length, 0);
    send(`✓ 课程结构:${structure.sections.length} 章 · ${lessonCount} 课`);

    // Step 5: 拉正文 + 图片内联 + 翻译 + 落库
    const { executeImport } = await import("../services/import-pipeline.js");
    const { LocalContentSource } = await import("../services/content-source.js");

    const translationFilesMap = selectedLang && roles.languages.some((l) => l.code === selectedLang)
      ? new Map([[selectedLang, []]])
      : null;

    const result2 = await executeImport(
      getDb(), structure,
      {
        source: new LocalContentSource(folderPath, docsMap),
        repoUrl: null, repoName: folderName,
        langCode: selectedLang,
        translationFiles: translationFilesMap,
        sourceLang: roles.sourceLang,
        translationLayout: roles.translationLayout,
        markDirty,
      },
      send,
    );

    markDirty();
    send(`✓ 导入完成`);

    const course = getDb().select().from(courses).where(eq(courses.id, result2.courseId)).get();
    return course as unknown as Course;
  });

  // 删除课程 + 其下全部节点/进度/练习/聊天（级联清理由 services 负责）
  ipcMain.handle("course:delete", async (_e, courseId: string) => {
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
  ipcMain.handle("course:getNodeContent", async (_e, nodeId: string, locale?: string) => {
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

  // 取节点摘要(懒生成:DB 没有则实时生成 lesson 摘要并缓存;section 用结构化时的摘要)
  ipcMain.handle("course:getNodeSummary", async (_e, nodeId: string) => {
    const db = getDb();
    const node = db
      .select()
      .from(contentNodes)
      .where(eq(contentNodes.id, nodeId))
      .get();
    if (!node) return null;
    // 已有摘要直接返回
    if (node.summary) return node.summary;
    // section 节点:结构化时已带 summary,没有就不生成(避免空 section 调 LLM)
    if (node.type !== "lesson") return null;
    // lesson 节点:懒生成(基于 content 正文,1-2 句中文摘要)
    try {
      const summary = await generateLessonSummary(db, nodeId);
      return summary;
    } catch {
      return null; // 生成失败不阻塞,中栏显示"暂无摘要"
    }
  });

  // LLM 课程结构化：把导入的碎片节点重组成教学结构
  ipcMain.handle("course:restructure", async (_e, courseId: string) => {
    const restructureSend = (msg: string) => mainWindow?.webContents.send("import:progress", msg);
    restructureSend("AI 正在分析课程结构…");
    const proposal = await analyzeCourseStructure(getDb(), courseId, restructureSend);
    mainWindow?.webContents.send(
      "import:progress",
      `分析完成：${proposal.sections.length} 章节，重新组织中…`,
    );
    const result = applyCourseStructure(getDb(), courseId, proposal);
    markDirty();
    mainWindow?.webContents.send(
      "import:progress",
      `结构化完成：${result.sectionCount} 章 / ${result.lessonCount} 课 / 跳过 ${result.skippedCount} 个练习节点`,
    );
    return result;
  });

  // 两个世界:查某学习课对应的实操节点(同 source_path 目录)
  ipcMain.handle("course:getPracticeForLesson", (_e, nodeId: string) => {
    return findPracticeForLesson(getDb(), nodeId);
  });
  // 两个世界:查某实操节点对应的学习课(反向跳转)
  ipcMain.handle("course:getLessonForPractice", (_e, nodeId: string) => {
    return findLessonForPractice(getDb(), nodeId);
  });

  // LLM 生成章节摘要 + 前置依赖标记
  ipcMain.handle("course:generateSummaries", async (_e, courseId: string) => {
    mainWindow?.webContents.send("import:progress", "AI 正在生成章节摘要…");
    const result = await generateLessonSummaries(getDb(), courseId);
    markDirty();
    mainWindow?.webContents.send("import:progress", `摘要生成完成: ${result.sectionsUpdated} 章节 / ${result.lessonsUpdated} 课时`);
    return result;
  });

  // Starter prompts: 给学习者提供开始引导按钮
  ipcMain.handle("course:getStarterPrompts", async (_e, nodeId: string) => {
    return getStarterPrompts(getDb(), nodeId);
  });

  /* ---------- 多模态资源(node_assets)---------- */

  ipcMain.handle("asset:listByNode", async (_e, nodeId: string) => {
    return listAssetsByNode(getDb(), nodeId);
  });

  ipcMain.handle("asset:listByCourse", async (_e, courseId: string) => {
    return listAssetsByCourse(getDb(), courseId);
  });

  ipcMain.handle("asset:getDataUrl", async (_e, assetId: string): Promise<string | null> => {
    return getAssetDataUrl(getDb(), assetId);
  });
}

export function registerProgressHandlers(): void {
  ipcMain.handle(
    "progress:get",
    async (_e, nodeId: string): Promise<Progress | null> => {
      return getProgressService(getDb(), nodeId);
    },
  );

  ipcMain.handle(
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

  ipcMain.handle("progress:markAttempted", async (_e, nodeId: string) => {
    markNodeAttemptedService(getDb(), nodeId, () => {
      markDirty();
      // 标记 attempted 即打卡（原行为保留）
      touchStreakToday();
    });
  });
}

/* ---------- SRS ---------- */

export function registerSrsHandlers(): void {
  ipcMain.handle("srs:getDue", async (): Promise<string[]> => {
    return getDueReviewNodeIds();
  });

  // v0.2: 详细 SRS 项(供四象限复习面板)
  ipcMain.handle("srs:getAll", async () => {
    return getAllSrsItems();
  });

  ipcMain.handle(
    "srs:record",
    async (_e, nodeId: string, quality: ReviewQuality) => {
      recordReview(nodeId, quality);
    },
  );
}

/* ---------- 打卡 ---------- */

export function registerStreakHandlers(): void {
  ipcMain.handle("streak:get", async (): Promise<Streak> => getStreak());

  ipcMain.handle("streak:touchToday", async (): Promise<Streak> =>
    touchStreakToday(),
  );
}

/* ---------- 设置 ---------- */

export function registerSettingsHandlers(): void {
  ipcMain.handle(
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

  ipcMain.handle(
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
  ipcMain.handle("xp:getStatus", async () => {
    return getXpStatus(getDb());
  });

  // 导出学习记录（JSON / Markdown）
  ipcMain.handle("course:export", async (_e, courseId: string, format: "json" | "markdown") => {
    const data = collectExportData(getDb(), courseId);
    if (!data) throw new Error(`课程不存在: ${courseId}`);
    return format === "json" ? exportJson(data) : exportMarkdown(data);
  });
}

/* ---------- Skill 系统（M1） ---------- */

export function registerSkillHandlers(): void {
  ipcMain.handle("skill:list", async () => listSkillsService(getDb()));

  ipcMain.handle("skill:get", async (_e, name: string) =>
    getSkillService(getDb(), name),
  );

  ipcMain.handle(
    "skill:create",
    async (
      _e,
      input: { name: string; description: string; type: string; body: string },
    ) => {
      const result = createSkillService(getDb(), {
        name: input.name,
        description: input.description,
        type: input.type as
          | "learning-mode"
          | "subject-pack"
          | "user-custom",
        body: input.body,
      });
      markDirty();
      return result;
    },
  );

  ipcMain.handle("skill:setActive", async (_e, name: string) => {
    setActiveSkillService(getDb(), name);
    markDirty();
  });

  ipcMain.handle("skill:getActive", async () => getActiveSkillService(getDb()));
}

/* ---------- Agent 引擎 + Proposal（M2） ---------- */

export function registerAgentHandlers(mainWindow: BrowserWindow): void {
  // agent 对话：流式 token 通过 chat:token 事件推（mainWindow 注入到 handleAgentChat）
  ipcMain.handle(
    "agent:chat",
    async (_e, nodeId: string, userMessage: string) => {
      return handleAgentChat(mainWindow, nodeId, userMessage);
    },
  );

  // 中断当前 agent 回复（Stop 按钮）
  ipcMain.handle("agent:abort", async (_e, nodeId: string) => {
    abortAgentChat(nodeId);
  });

  // v0.4: Thread 模式 agent 对话(传 threadId,从 thread 装配上下文)
  ipcMain.handle(
    "agent:chatThread",
    async (_e, threadId: string, userMessage: string) => {
      return handleAgentChatThread(mainWindow, threadId, userMessage);
    },
  );
  ipcMain.handle("agent:abortThread", async (_e, threadId: string) => {
    abortAgentChatThread(threadId);
  });

  // 取某节点聊天历史（持久化在 chat_sessions 表）
  ipcMain.handle("agent:getHistory", async (_e, nodeId: string) => {
    return getChatHistory(nodeId);
  });

  // 清空某节点聊天历史
  ipcMain.handle("agent:clearHistory", async (_e, nodeId: string) => {
    clearChatHistory(nodeId);
  });

  // provider 是否就绪（渲染层只见布尔）
  ipcMain.handle("agent:isReady", async () => isLlmReady(getDb()));

  // 返回所有 provider 预设元数据（给 Settings 页做 provider/model 选择器，不含 key）
  ipcMain.handle("agent:getProviderPresets", async () => {
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

  // 测试当前 provider 连接（Settings 页"测试连接"按钮）
  ipcMain.handle("agent:testConnection", async () => {
    return testLlmConnection(getDb());
  });

  // 测试自定义 provider 配置（不保存，临时验证）
  ipcMain.handle("agent:testCustomProvider", async (_e, input: CustomProviderInput) => {
    return testCustomProvider(input);
  });

  // OpenRouter 模型自动发现（公开 API，无需 key）
  ipcMain.handle("agent:discoverModels", async () => {
    return fetchOpenRouterModels();
  });

  // Provider 直连模型发现（用用户已配的 key 拉取 /v1/models）
  ipcMain.handle("agent:discoverProviderModels", async (_e, baseUrl: string, apiKey: string) => {
    return fetchProviderModels(baseUrl, apiKey);
  });

  // 自定义 provider CRUD
  ipcMain.handle("customProvider:list", async () => {
    return listCustomProvidersService(getDb());
  });
  ipcMain.handle("customProvider:create", async (_e, input: CustomProviderInput) => {
    const result = createCustomProviderService(getDb(), input);
    markDirty();
    return result;
  });
  ipcMain.handle("customProvider:update", async (_e, id: string, input: Partial<CustomProviderInput>) => {
    const result = updateCustomProviderService(getDb(), id, input);
    markDirty();
    return result;
  });
  ipcMain.handle("customProvider:delete", async (_e, id: string) => {
    deleteCustomProviderService(getDb(), id);
    markDirty();
  });

  // Proposal 流水线
  ipcMain.handle("proposal:listPending", async () =>
    listPendingProposalsService(getDb()),
  );
  ipcMain.handle("proposal:apply", async (_e, id: string) => {
    const result = applyProposalService(getDb(), id);
    // 如果包含 mark_mastered 操作，把节点加入 SRS 复习队列
    const hasMastered = result.operations?.some((op) => op.type === "mark_mastered");
    if (hasMastered && result.nodeId) {
      recordReview(result.nodeId, 5 as 5);
    }
    markDirty();
    return result;
  });
  ipcMain.handle("proposal:reject", async (_e, id: string) => {
    const result = rejectProposalService(getDb(), id);
    markDirty();
    return result;
  });
  // quiz 产物本地评分 → 自动建+应用 update_mastery 提案。
  // 答题观测是确定性的(无需 LLM 判断/人审),直接 apply。
  ipcMain.handle("quiz:recordAnswer", async (_e, nodeId: string, correct: boolean) => {
    if (!nodeId) return { applied: false };
    const proposal = createProposalService(getDb(), {
      nodeId,
      operations: [{ type: "update_mastery", nodeId, correct }],
      rationale: correct ? "quiz 产物答对" : "quiz 产物答错",
    });
    applyProposalService(getDb(), proposal.id);
    markDirty();
    // 读回新 mastery(UI 可选展示)
    const row = getDb().select().from(progressTable).where(eq(progressTable.nodeId, nodeId)).get();
    return { applied: true, newMastery: row?.mastery ?? undefined };
  });
}

/* ---------- 仪表盘 + 检索 + 记忆（M3） ---------- */

export function registerM3Handlers(): void {
  ipcMain.handle("dashboard:get", async (_e, courseId: string) => {
    return getDashboardService(getDb(), courseId);
  });

  ipcMain.handle("search:content", async (_e, query: string) => {
    // searchContent 需要原生 sqljs 句柄走 LIKE；从 drizzle $client 拿
    const sqljs = getDb() as unknown as {
      exec: (sql: string, params?: unknown[]) => Array<{ values: unknown[][] }>;
    };
    return searchContentService(sqljs, query);
  });

  ipcMain.handle(
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

  ipcMain.handle(
    "memory:get",
    async (
      _e,
      nodeId: string | null,
      category?: "global" | "node" | "friction_pattern",
    ) => getMemoryService(getDb(), nodeId, category),
  );
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
}

export function registerAllHandlers(mainWindow: BrowserWindow): void {
  registerCourseHandlers(mainWindow);
  registerProgressHandlers();
  registerSrsHandlers();
  registerStreakHandlers();
  registerSettingsHandlers();
  registerSkillHandlers();
  registerAgentHandlers(mainWindow);
  registerM3Handlers();
  registerExerciseHandlers();
  registerExamHandlers();
  registerCanvasHandlers();
  registerThreadHandlers();
}

/* ---------- v0.4: Thread 会话 ---------- */

export function registerThreadHandlers(): void {
  ipcMain.handle(
    "thread:list",
    async (_e, courseId: string, status?: "active" | "archived") => {
      return listThreads(courseId, status);
    },
  );
  ipcMain.handle("thread:create", async (_e, input) => {
    return createThread(input);
  });
  ipcMain.handle("thread:update", async (_e, id: string, patch) => {
    return updateThread(id, patch);
  });
  ipcMain.handle("thread:delete", async (_e, id: string) => {
    deleteThread(id);
  });
  ipcMain.handle("thread:getMessages", async (_e, threadId: string) => {
    return getThreadMessages(threadId);
  });
  ipcMain.handle(
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
  ipcMain.handle(
    "canvas:list",
    async (_e, courseId: string, nodeId?: string | null, zone?: string) => {
      return listCanvasItems(courseId, nodeId ?? undefined, zone as CanvasZoneOpt);
    },
  );
  ipcMain.handle(
    "canvas:save",
    async (_e, input) => {
      return saveCanvasItem(input);
    },
  );
  ipcMain.handle("canvas:delete", async (_e, id: string) => {
    deleteCanvasItem(id);
  });
  ipcMain.handle("canvas:togglePin", async (_e, id: string) => {
    return togglePinCanvasItem(id);
  });
  // 用户画线加笔记(user_note),带溯源
  ipcMain.handle("canvas:saveUserNote", async (_e, input) => {
    return saveUserNote(input);
  });
  // quiz 重做后更新 last_result(只保留最近一次)
  ipcMain.handle("canvas:recordQuizResult", async (_e, id: string, correct: boolean) => {
    return recordQuizResult(id, correct);
  });
  // 更新 user_note 的用户注释(canvas_items.notes 列)
  ipcMain.handle("canvas:updateUserNoteComment", async (_e, id: string, comment: string) => {
    return updateUserNoteComment(id, comment);
  });
}

/* ---------- 练习题 ---------- */

export function registerExerciseHandlers(): void {
  // AI 生题（缓存到 exercises 表）
  ipcMain.handle(
    "exercise:generate",
    async (_e, nodeId: string, type?: ExerciseType) => {
      const result = await generateExerciseService(getDb(), nodeId, type);
      markDirty();
      return result;
    },
  );

  // 列出某节点缓存的练习题
  ipcMain.handle("exercise:list", async (_e, nodeId: string) => {
    return listExercisesService(getDb(), nodeId);
  });

  // 提交答案 + 判分（触发掌握度更新 Proposal）
  ipcMain.handle(
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
  // 开始/继续考试:生成或读取题目
  ipcMain.handle("exam:start", async (_e, examNodeId: string) => {
    const result = await startExam(getDb(), examNodeId);
    markDirty();
    return result;
  });

  // 提交考试:判分 + 算星数 + 写 progress.crownLevel
  ipcMain.handle(
    "exam:submit",
    async (_e, examNodeId: string, answers: Record<string, string>) => {
      const result = submitExam(getDb(), examNodeId, answers);
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
