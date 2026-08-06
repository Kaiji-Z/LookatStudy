/**
 * IPC handlers 注册 —— 主进程对渲染层暴露的所有方法。
 *
 * 组织方式：按领域分 register* 函数，由 main/index.ts 统一调用。
 * 通道名规范：domain:action（如 course:list, streak:touch）
 */
import { ipcMain, type BrowserWindow } from "electron";
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
} from "@shared/types";
import {
  getDueReviewNodeIds,
  recordReview,
} from "../services/srs.js";
import { getStreak, touchStreakToday } from "../services/streak.js";
// 业务逻辑抽出到 services，让无头测试能直接覆盖（不再只能在 UI 点）
import {
  getProgress as getProgressService,
  updateProgress as updateProgressService,
  markNodeAttempted as markNodeAttemptedService,
} from "../services/progress-service.js";
// Skill 系统（M1）—— 业务逻辑在 skill-service，IPC 是薄壳
import {
  listSkills as listSkillsService,
  getSkill as getSkillService,
  createSkill as createSkillService,
  setActiveSkill as setActiveSkillService,
  getActiveSkill as getActiveSkillService,
} from "../services/skills/skill-service.js";
// Agent 引擎 + Proposal（M2）
import { handleAgentChat, abortAgentChat, getChatHistory, clearChatHistory } from "../services/agent/agent-engine.js";
import { isLlmReady, testLlmConnection, testCustomProvider } from "../services/agent/llm-client.js";
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
} from "../services/proposal-service.js";
// M3：仪表盘 + 检索 + 记忆
import { getDashboard as getDashboardService } from "../services/dashboard-service.js";
import { searchContent as searchContentService } from "../services/search-service.js";
import {
  updateMemory as updateMemoryService,
  getMemory as getMemoryService,
} from "../services/search-service.js";
// M4：Course Generator
import { generateCourseFromMarkdown as generateCourseFromMarkdownService, generateCourseFromRepoFiles as generateCourseFromRepoFilesService } from "../services/course-generator.js";
import {
  filterLessonFiles,
  detectRepoPattern,
  fetchMarkdownContents,
  buildCourseFromFiles,
  cdnUrl,
} from "../services/pure/repo-fetcher.js";
// 练习题服务
import {
  generateExercise as generateExerciseService,
  listExercises as listExercisesService,
  submitExerciseAnswer as submitExerciseAnswerService,
} from "../services/exercise-service.js";

/* ---------- 课程 ---------- */

export function registerCourseHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle("course:list", async (): Promise<Course[]> => {
    const db = getDb();
    return db.select().from(courses).all() as Course[];
  });

  ipcMain.handle(
    "course:getTree",
    async (_e, courseId: string): Promise<ContentNode[]> => {
      const db = getDb();
      return db
        .select()
        .from(contentNodes)
        .where(eq(contentNodes.courseId, courseId))
        .all() as ContentNode[];
    },
  );

  // 全仓库导入：从 GitHub repo 拉 README → 检测形态 → 拉所有课时 .md → 落库。
  // 支持:形态 A（课程型，README 链接发现子文件）+ 形态 B（单文件型，README 自身够长）。
  // 进度通过 import:progress 事件推给渲染层。
  ipcMain.handle(
    "course:importFromRepo",
    async (_e, repoUrl: string): Promise<Course> => {
      const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!m) throw new Error(`无效 GitHub URL：${repoUrl}`);
      const [, owner, repoRaw] = m;
      const cleanRepo = repoRaw.replace(/\.git$/, "");

      const send = (msg: string) =>
        mainWindow?.webContents.send("import:progress", msg);

      // Step 1: 拉 README（试 main + master 分支，走 CDN）
      send("正在拉取 README…");
      const branches = ["main", "master"];
      let readmeMd = "";
      let readmeBranch = "main";
      for (const br of branches) {
        try {
          const url = cdnUrl(owner, cleanRepo, br, "README.md");
          const res = await fetch(url);
          if (res.ok) {
            readmeMd = await res.text();
            readmeBranch = br;
            break;
          }
        } catch {
          /* 试下一个 */
        }
      }
      if (!readmeMd) {
        throw new Error(
          "拉取 README 失败。可能是网络受限或仓库私有。" +
            "请改用「粘贴 Markdown」方式手动提供内容。",
        );
      }
      send(`README 拉取成功（${readmeMd.length} 字符）`);

      // Step 2: 检测仓库形态
      const detection = detectRepoPattern(readmeMd);

      if (detection.pattern === "unsupported") {
        throw new Error(
          `这个仓库不像学习仓库：${detection.reason}。` +
            "LookatStudy 专为学习型仓库设计（如微软 AI-For-Beginners）。" +
            "如果确实有学习内容，请用「粘贴 Markdown」方式手动导入。",
        );
      }

      // Step 3a: 课程型 → 拉所有课时文件
      if (detection.pattern === "course" && detection.lessonFiles) {
        const lessonFiles = filterLessonFiles(detection.lessonFiles);
        send(`检测到课程型仓库（${lessonFiles.length} 个课时文件），开始拉取…`);

        const fetchResult = await fetchMarkdownContents(
          lessonFiles,
          owner,
          cleanRepo,
          readmeBranch,
          fetch,
          (done, total, path) => {
            send(`拉取文件 ${done}/${total}: ${path}`);
          },
        );

        if (fetchResult.ok.length === 0) {
          // 所有子文件都拉失败 → 降级用 README 本身
          send("子文件拉取全部失败，降级用 README 正文");
          const result = generateCourseFromMarkdownService(getDb(), readmeMd, {
            repoUrl,
            repoName: cleanRepo,
          });
          markDirty();
          const course = getDb().select().from(courses).where(eq(courses.id, result.courseId)).get();
          return course as unknown as Course;
        }

        // 从 README 取课程标题
        const titleMatch = readmeMd.match(/^#\s+(.+)$/m);
        const courseTitle = titleMatch ? titleMatch[1].trim() : cleanRepo;

        // 合并所有课时文件成 ParsedCourse
        const parsed = buildCourseFromFiles(courseTitle, fetchResult.ok);
        send(`解析完成：${parsed.sections.length} 章节，构建课程…`);

        const result = generateCourseFromRepoFilesService(getDb(), parsed, {
          repoUrl,
          repoName: cleanRepo,
        });
        markDirty();

        if (fetchResult.failed.length > 0) {
          send(`完成（${fetchResult.failed.length} 个文件拉取失败已跳过）`);
        } else {
          send(`导入完成：${result.sectionCount} 章 / ${result.lessonCount} 课`);
        }

        const course = getDb().select().from(courses).where(eq(courses.id, result.courseId)).get();
        return course as unknown as Course;
      }

      // Step 3b: 单文件型 → 走现有 generateCourseFromMarkdown
      send("检测到单文件型仓库，用 README 正文构建课程…");
      const result = generateCourseFromMarkdownService(getDb(), readmeMd, {
        repoUrl,
        repoName: cleanRepo,
      });
      markDirty();
      send(`导入完成：${result.sectionCount} 章 / ${result.lessonCount} 课`);
      const course = getDb().select().from(courses).where(eq(courses.id, result.courseId)).get();
      return course as unknown as Course;
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

  // 取某节点完整内容（课程详情 / 练习生成上下文用）
  ipcMain.handle("course:getNodeContent", async (_e, nodeId: string) => {
    const db = getDb();
    const node = db
      .select({ content: contentNodes.content })
      .from(contentNodes)
      .where(eq(contentNodes.id, nodeId))
      .get();
    return node?.content ?? null;
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
    markDirty();
    return result;
  });
  ipcMain.handle("proposal:reject", async (_e, id: string) => {
    const result = rejectProposalService(getDb(), id);
    markDirty();
    return result;
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

/**
 * 类型断言：确保我们的 IPC 通道实现覆盖 ApiExpose 全部方法。
 * 后续 M2/M4 实现 chat/import 时，这里会变成实际函数。
 */
export type { ApiExpose };
