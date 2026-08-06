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
import { handleAgentChat } from "../services/agent/agent-engine.js";
import { isLlmReady } from "../services/agent/llm-client.js";
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
import { generateCourseFromMarkdown as generateCourseFromMarkdownService } from "../services/course-generator.js";

/* ---------- 课程 ---------- */

export function registerCourseHandlers(): void {
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

  // M4：Course Generator —— 从 GitHub repo 拉 README.md，解析落库。
  // 网络受限时会失败，提示用户手动提供 markdown（走 course:generateFromMarkdown）。
  ipcMain.handle(
    "course:importFromRepo",
    async (_e, repoUrl: string): Promise<Course> => {
      // 从 repoUrl 提取 owner/repo，拼 raw README url
      const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
      if (!m) throw new Error(`无效 GitHub URL：${repoUrl}`);
      const [, owner, repo] = m;
      const cleanRepo = repo.replace(/\.git$/, "");
      // 试 main 分支的 README.md（README 大小写都试）
      const candidates = [
        `https://raw.githubusercontent.com/${owner}/${cleanRepo}/main/README.md`,
        `https://raw.githubusercontent.com/${owner}/${cleanRepo}/master/README.md`,
        `https://raw.githubusercontent.com/${owner}/${cleanRepo}/main/readme.md`,
      ];
      let md = "";
      let lastErr = "";
      for (const url of candidates) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            md = await res.text();
            break;
          }
          lastErr = `${res.status} ${res.statusText}`;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }
      if (!md) {
        throw new Error(
          `拉取 README 失败（${lastErr}）。可能是网络受限或仓库私有。` +
            `请用 course:generateFromMarkdown 手动提供 markdown 内容。`,
        );
      }
      const result = generateCourseFromMarkdownService(getDb(), md, {
        repoUrl,
        repoName: cleanRepo,
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
}

/* ---------- 进度 ---------- */

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

  // provider 是否就绪（渲染层只见布尔）
  ipcMain.handle("agent:isReady", async () => isLlmReady(getDb()));

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
  registerCourseHandlers();
  registerProgressHandlers();
  registerSrsHandlers();
  registerStreakHandlers();
  registerSettingsHandlers();
  registerSkillHandlers();
  registerAgentHandlers(mainWindow);
  registerM3Handlers();
}

/**
 * 类型断言：确保我们的 IPC 通道实现覆盖 ApiExpose 全部方法。
 * 后续 M2/M4 实现 chat/import 时，这里会变成实际函数。
 */
export type { ApiExpose };
