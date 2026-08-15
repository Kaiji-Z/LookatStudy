/**
 * SQLite Schema —— 7 张核心表。
 *
 * 设计原则：
 * - 一切学习数据纯本地（无云同步）
 * - adjacency list 表示课程树（parentId 自引用）
 * - SRS 用 SM-2 算法字段（easeFactor + intervalDays + repetitions）
 * - 所有金额/时间戳用 ISO string，避免 Date 序列化坑
 */
import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/* ---------- 课程 ---------- */

export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  /** 远程仓库 URL；本地导入或种子课程可为 null */
  repoUrl: text("repo_url"),
  repoName: text("repo_name").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  /** 内容版本，源仓库更新时递增，触发重新生成 */
  version: integer("version").notNull().default(1),
  /** Lab 类型：决定 AI 能否动手操作学习对象（M4 检测，M5 用） */
  labType: text("lab_type", { enum: ["doc", "code", "notebook"] })
    .notNull()
    .default("doc"),
  /** 仓库原文语言 (en / zh-CN / zh-TW / ...), LLM Step 2 判断; null=未知按 en 处理 */
  sourceLang: text("source_lang"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/* ---------- 课程树节点（章/节/知识点 三级，adjacency list） ---------- */

export const contentNodes = sqliteTable("content_nodes", {
  id: text("id").primaryKey(),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  parentId: text("parent_id"), // 自引用，根节点为 null
  type: text("type", { enum: ["section", "lesson", "concept", "exam"] }).notNull(),
  title: text("title").notNull(),
  /** 源仓库里的相对路径（如 README.md#phase-1） */
  sourcePath: text("source_path"),
  orderIdx: integer("order_idx").notNull().default(0),
  /** 按需生成的讲解内容（缓存） */
  content: text("content"),
  /** LLM 生成的课节摘要(1-2 句,空会话时中栏显示;导入时批量生成) */
  summary: text("summary"),
  /** 英文摘要(界面语言 en 时展示;中文摘要在 summary) */
  summaryEn: text("summary_en"),
  /** 两个世界: study(学习主线讲解) / practice(实操练习 notebook/lab/exercise) */
  world: text("world", { enum: ["study", "practice"] }).notNull().default("study"),
  /** JSON array of {title, description} — LLM 提取的知识组件(KC)定义，per-KC BKT 的基础 */
  knowledgePoints: text("knowledge_points"),
});

/* ---------- 练习题（按需生成后缓存） ---------- */

export const exercises = sqliteTable("exercises", {
  id: text("id").primaryKey(),
  nodeId: text("node_id")
    .notNull()
    .references(() => contentNodes.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["mcq", "fill_blank", "true_false", "predict_output", "order_lines", "debug"],
  }).notNull(),
  prompt: text("prompt").notNull(),
  /** 正确答案；MCQ 是选项字母，填空是字符串 */
  answer: text("answer").notNull(),
  /** 解释（答错/复盘时显示） */
  explanation: text("explanation"),
  /** MCQ 的选项 JSON 数组 */
  optionsJson: text("options_json"),
  aiGenerated: integer("ai_generated", { mode: "boolean" }).notNull().default(true),
  /** 章节考试题考察的知识点标题(考试出题时标注;课时练习题/老考试题为 NULL) */
  kcTitle: text("kc_title"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/* ---------- 学习进度 ---------- */

export const progress = sqliteTable("progress", {
  nodeId: text("node_id")
    .primaryKey()
    .references(() => contentNodes.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["locked", "available", "in_progress", "mastered"],
  }).notNull()
    .default("locked"),
  /** 1-5，参照多邻国 crown level */
  crownLevel: integer("crown_level").notNull().default(0),
  lastAttemptAt: text("last_attempt_at"),
  /** M2: BKT 掌握度概率 0-1（NULL=从未评估）。Per-KC: 有 KC 时 = min(各 KC)，聚合只读 */
  mastery: real("mastery"),
});

/* ---------- Per-Knowledge-Component BKT（第 19 张表） ---------- */

export const knowledgeComponentMastery = sqliteTable("knowledge_component_mastery", {
  id: text("id").primaryKey(),
  nodeId: text("node_id")
    .notNull()
    .references(() => contentNodes.id, { onDelete: "cascade" }),
  /** 对应 content_nodes.knowledge_points JSON 数组下标 */
  kcIndex: integer("kc_index").notNull(),
  /** per-KC BKT P(L)，初始 pInit(0.5) */
  mastery: real("mastery").notNull().default(0.5),
  testedCount: integer("tested_count").notNull().default(0),
}, (t) => [
  uniqueIndex("idx_kcm_node_kc").on(t.nodeId, t.kcIndex),
]);

/* ---------- 章节考试 attempt 档案（第 20 张表） ---------- */

export const examAttempts = sqliteTable("exam_attempts", {
  id: text("id").primaryKey(),
  examNodeId: text("exam_node_id")
    .notNull()
    .references(() => contentNodes.id, { onDelete: "cascade" }),
  startedAt: text("started_at").notNull(),
  /** NULL = 进行中(悬挂:app 崩溃/强关时遗留) */
  finishedAt: text("finished_at"),
  /** 1 = 中途离开被终止(未答题按答错计分) */
  terminated: integer("terminated", { mode: "boolean" }).notNull().default(false),
  correctCount: integer("correct_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  stars: integer("stars").notNull().default(0),
  /** {exerciseId: userAnswer} 逐题累计(崩溃安全的增量持久化) */
  answersJson: text("answers_json").notNull().default("{}"),
  /** 结算快照:逐题对错/正确答案/解析(判分后写) */
  perQuestionJson: text("per_question_json"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/* ---------- SRS 复习项（SM-2 字段） ---------- */

export const srsItems = sqliteTable("srs_items", {
  id: text("id").primaryKey(),
  nodeId: text("node_id")
    .notNull()
    .references(() => contentNodes.id, { onDelete: "cascade" }),
  /** SM-2 easiness factor，初始 2.5，范围 [1.3, 3.0] */
  easeFactor: integer("ease_factor").notNull().default(250), // 存整数 ×100，避免浮点
  /** 下次复习的间隔天数 */
  intervalDays: integer("interval_days").notNull().default(0),
  /** 连续答对次数 */
  repetitions: integer("repetitions").notNull().default(0),
  /** ISO date，下次到期日 */
  dueAt: text("due_at").notNull(),
  lastReviewedAt: text("last_reviewed_at"),
});

/* ---------- 打卡 ---------- */

export const streaks = sqliteTable("streaks", {
  id: text("id").primaryKey().default("singleton"), // 单用户本地，固定单行
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  /** ISO date YYYY-MM-DD */
  lastActiveDate: text("last_active_date"),
  /** 可用的 streak freeze 次数（参照多邻国） */
  freezeCount: integer("freeze_count").notNull().default(2),
});

/* ---------- AI 对话历史 ---------- */

export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").references(() => contentNodes.id, { onDelete: "cascade" }),
  /** messages 数组 JSON：[{role, content}] */
  messagesJson: text("messages_json").notNull().default("[]"),
  /** 记录这次对话用的 Provider，便于切换时不丢上下文 */
  provider: text("provider"),
  /** 记录激活的 soul（教学人设），便于复现教学风格 */
  activeSoul: text("active_soul"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/* ---------- Soul 系统（教学人设/persona） ---------- */

export const souls = sqliteTable("souls", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  type: text("type", {
    enum: ["builtin", "custom"],
  }).notNull(),
  body: text("body").notNull(),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/* ---------- Proposal 流水线（v2 新增） ---------- */

export const proposals = sqliteTable("proposals", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").references(() => contentNodes.id, { onDelete: "cascade" }),
  /** Operation[] 数组的 JSON */
  operationsJson: text("operations_json").notNull(),
  status: text("status", {
    enum: ["pending", "applied", "rejected", "stale"],
  }).notNull()
    .default("pending"),
  rationale: text("rationale"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  resolvedAt: text("resolved_at"),
});

/* ---------- Friction 日志（v2 新增） ---------- */

export const frictionLog = sqliteTable("friction_log", {
  id: text("id").primaryKey(),
  nodeId: text("node_id"),
  category: text("category", {
    enum: ["confused", "blocked", "frustrated", "agent_error"],
  }).notNull(),
  summary: text("summary"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/* ---------- 设置（API keys 等敏感配置） ---------- */

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  /** value；API key 类的加密后存（v0.1 用 electron safeStorage） */
  value: text("value").notNull(),
  isSecret: integer("is_secret", { mode: "boolean" }).notNull().default(false),
});

/* ---------- 记忆系统（M3） ---------- */

export const memory = sqliteTable("memory", {
  id: text("id").primaryKey(),
  /** 关联节点（可空，全局记忆） */
  nodeId: text("node_id"),
  /** 课程作用域：仅 friction_pattern 用（领域卡点不跨课程串）；NULL=跨课程（如 global 风格） */
  courseId: text("course_id"),
  summary: text("summary").notNull(),
  category: text("category", {
    enum: ["global", "node", "friction_pattern"],
  }).notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/* ---------- 自定义 Provider（用户自建 LLM 端点） ---------- */

export const customProviders = sqliteTable("custom_providers", {
  id: text("id").primaryKey(),
  /** 用户起的名字，如"智谱 CodingPlan CN" */
  label: text("label").notNull(),
  /** 协议：openai-compatible（默认，覆盖 90% 场景）/ anthropic / google */
  protocol: text("protocol", {
    enum: ["openai-compatible", "anthropic", "google"],
  })
    .notNull()
    .default("openai-compatible"),
  /** 端点 URL，如 https://api.z.ai/api/coding/paas/v4 */
  baseUrl: text("base_url").notNull(),
  /** API key（可空，本地模型如 Ollama 不需要） */
  apiKey: text("api_key"),
  /** 默认模型 id */
  defaultModel: text("default_model").notNull(),
  /** 可选模型列表 JSON（用户手填或测试连接回填） */
  modelsJson: text("models_json"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/* ---------- AI 产物画布(v0.3 黑板笔记本) ---------- */

/** AI 产物类型(对齐 agent-engine 的展示型 tool) + 用户画线笔记 */
export type ArtifactType =
  | "concept_map"
  | "quiz"
  | "compare_table"
  | "diagram"
  | "code_walkthrough"
  | "user_note"; // v0.3 康奈尔笔记区:用户从讲解/对话画线加的笔记

/** v0.3:所有 Generative UI 产物 + 用户笔记持久化到这张表,构成康奈尔式"学习笔记本"。 */
export const canvasItems = sqliteTable("canvas_items", {
  id: text("id").primaryKey(),
  /** 关联的课时(可空表示课程级产物) */
  nodeId: text("node_id"),
  /** 关联课程 */
  courseId: text("course_id").notNull(),
  /** 产物类型 */
  artifactType: text("artifact_type").notNull(),
  /** 产物标题 */
  title: text("title"),
  /** JSON 序列化的产物数据(与 tool execute 返回一致) */
  data: text("data").notNull(),
  /** 用户置顶(0/1) */
  pinned: integer("pinned").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  /** 用户备注(后续扩展) */
  notes: text("notes"),
  /** v0.3 溯源:'ai'(产物默认) / 'content'(讲解画线) / 'chat'(对话画线) */
  sourceType: text("source_type"),
  /** 溯源锚点 JSON:content={surroundingText} / chat={threadId,msgId} */
  sourceAnchor: text("source_anchor"),
  /** 仅 quiz:最近一次答题 'correct'/'wrong' */
  lastResult: text("last_result"),
  /** 仅 quiz:答题时间 */
  resultAt: text("result_at"),
});

/* ---------- v0.4: 会话 Thread 模型(类 Cursor 项目-会话) ---------- */

export type ThreadStatus = "active" | "archived";

/** v0.4: 会话线程。课程(项目)→ 多 thread(会话)→ 节点是素材。 */
export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull(),
  /** 用户起的名,如"注意力机制深挖" */
  title: text("title"),
  /** 主焦点节点(可空,影响 AI 注入的节点上下文) */
  focusNodeId: text("focus_node_id"),
  status: text("status", { enum: ["active", "archived"] as const })
    .notNull()
    .default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  messageCount: integer("message_count").notNull().default(0),
});

/** v0.4: 单条对话消息(替代旧 chat_sessions 的 messagesJson 一团)。 */
export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] as const }).notNull(),
  content: text("content").notNull(),
  /** v0.2 parts 产物/tool/reasoning(JSON,可空——纯文本消息没有) */
  partsJson: text("parts_json"),
  /** 气泡展示文本:按钮触发的消息存短动作标签;NULL(手打输入)= 原样展示 content */
  displayText: text("display_text"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/* ---------- 多模态资源:导入时收集的图片 / PDF 页面渲染图 ---------- */

/** 图片来源类型 */
export type AssetSourceKind = "image_file" | "markdown_ref" | "pdf_page";

/**
 * 导入课程时收集的图片元数据。
 * 图片二进制不入 DB(sql.js 内存型),只存元数据;文件在 userData/assets/{courseId}/。
 * agent-engine 在"用户问图相关问题时"按需读取喂给多模态 LLM。
 */
export const nodeAssets = sqliteTable("node_assets", {
  id: text("id").primaryKey(),
  nodeId: text("node_id")
    .notNull()
    .references(() => contentNodes.id, { onDelete: "cascade" }),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  /** assets 目录下的文件名(如 lesson1-fig01.png) */
  filename: text("filename").notNull(),
  /** image/png / image/jpeg / image/svg+xml 等 */
  mimeType: text("mime_type").notNull(),
  /** 源文件里的原始相对路径(如 lessons/1/img.png) */
  sourcePath: text("source_path"),
  sourceKind: text("source_kind", {
    enum: ["image_file", "markdown_ref", "pdf_page"] as const,
  }).notNull(),
  /** 像素宽(可空,svg/pdf 无) */
  width: integer("width"),
  /** 像素高(可空) */
  height: integer("height"),
  /** PDF 来源页码(可空,1-based) */
  pageNumber: integer("page_number"),
  /** ![](x) 的 alt 或文件名推断描述 */
  altText: text("alt_text"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/* ---------- 内容翻译（多语言课程） ---------- */

export const contentNodeTranslations = sqliteTable("content_node_translations", {
  id: text("id").primaryKey(),
  nodeId: text("node_id")
    .notNull()
    .references(() => contentNodes.id, { onDelete: "cascade" }),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  /** BCP-47 语言标签，如 "zh-CN", "ja", "fr" */
  locale: text("locale").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  summary: text("summary"),
});

