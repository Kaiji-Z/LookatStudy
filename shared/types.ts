/**
 * 共享类型契约 —— Electron 主进程与 React 渲染层之间的协议层。
 *
 * 修改这里的类型 = 修改 IPC 协议。两端必须同步。
 */

/* ---------- 课程模型 ---------- */

export type NodeType = "section" | "lesson" | "concept" | "exam";

export type NodeStatus = "locked" | "available" | "in_progress" | "mastered";

/** 两个世界: study(学习主线讲解) / practice(实操练习) */
export type World = "study" | "practice";

/* ---------- 掌握度阈值(主进程 + 渲染层共享,改这里两端联动) ----------
 * 单一真源:progress-service / proposal-service / MapRail 都从这里 import,
 * 避免 DB 认为该解锁了但 UI 还锁着(或反之)的漂移 bug。 */
/** 解锁硬门控:当前课 mastery ≥ 此值才解锁下一课(首次尝试 mastery=pInit=0.5 刚好达标)。 */
export const UNLOCK_MASTERY_THRESHOLD = 0.5;
/** 自动毕业:mastery ≥ 此值 → status 转 mastered。 */
export const MASTERED_MASTERY_THRESHOLD = 0.9;

export interface ContentNode {
  id: string;
  courseId: string;
  parentId: string | null;
  type: NodeType;
  title: string;
  /** 该节点内容来自源仓库的哪个文件 + 锚点（用于溯源） */
  sourcePath: string | null;
  /** 排序序号（同层兄弟节点之间） */
  orderIdx: number;
  /** LLM 生成的课节摘要(1-2 句,空会话时中栏显示;导入时批量生成) */
  summary?: string | null;
  /** 两个世界: study(学习主线) / practice(实操练习)。默认 study。 */
  world: World;
}

export interface Course {
  id: string;
  repoUrl: string | null;
  repoName: string;
  title: string;
  description: string | null;
  /** 课程树版本，用于内容更新时判断是否要重新生成 */
  version: number;
  createdAt: string;
}

/* ---------- 仓库分析（新智能导入管线 Step 1+2 结果） ---------- */

export interface RepoAnalysis {
  /** 仓库 URL */
  repoUrl: string;
  /** README 全文（供后续 Step 3+4 用） */
  readmeMd: string;
  /** 实际分支 */
  branch: string;
  /** 仓库原文语言 (en / zh-CN / zh-TW / ...), LLM Step 2 判断 */
  sourceLang: string;
  /** 检测到的翻译语言列表 */
  languages: { code: string; name: string }[];
  /** 导入时自动选定的语言 (null=用原文不拉翻译), 由 pref_lang + sourceLang 匹配得出 */
  selectedLang: string | null;
  /** 选定理由（供 UI 只读展示, 如"按偏好拉取简中翻译"） */
  importReason: string;
  /** 原文课程文件路径 */
  originalFiles: string[];
  /** 实操文件路径 */
  practiceFiles: string[];
  /** 噪声文件路径 */
  skipFiles: string[];
  /** 翻译文件: 语言代码 → 文件路径列表 */
  translationFiles: Record<string, string[]>;
  /** 检测到的翻译布局约定 (microsoft/parallel/suffix/none) */
  translationLayout: "microsoft" | "parallel" | "suffix" | "none";
}

/* ---------- 学习进度 ---------- */

export interface Progress {
  nodeId: string;
  status: NodeStatus;
  /** 1-5，参照多邻国 crown level：每多一层是更深的复习通关 */
  crownLevel: number;
  lastAttemptAt: string | null;
  /** M2: BKT 掌握度概率 0-1（NULL=从未评估） */
  mastery: number | null;
}

/* ---------- Skill 系统（v2 / M1） ---------- */

export type SkillType = "learning-mode" | "subject-pack" | "user-custom";

export interface Skill {
  id: string;
  name: string;
  description: string;
  type: SkillType;
  /** 完整 raw（含 frontmatter）。运行时用 parseSkillFrontmatter 取 body 注入 system prompt */
  body: string;
  isBuiltin: boolean;
}

/* ---------- Proposal 流水线（M2） ---------- */

export type OperationType =
  | "update_mastery"
  | "mark_mastered"
  | "set_node_status"
  | "add_to_srs";

export interface LearningOperation {
  type: OperationType;
  nodeId: string;
  correct?: boolean;
  status?: NodeStatus;
  quality?: number;
}

export type ProposalStatus = "pending" | "applied" | "rejected" | "stale";

export interface Proposal {
  id: string;
  nodeId: string | null;
  operations: LearningOperation[];
  status: ProposalStatus;
  rationale: string | null;
  createdAt: string;
  resolvedAt: string | null;
  applyError?: string;
}

/* ---------- 仪表盘 + 检索（M3） ---------- */

export interface SectionMastery {
  sectionId: string;
  sectionTitle: string;
  avgMastery: number;
  lessonCount: number;
  masteredCount: number;
}

export interface DashboardData {
  sections: SectionMastery[];
  /** P3.4 薄弱点:按 friction 次数排序的节点(排除 agent_error,上限 5) */
  frictionByNode: Array<{ nodeId: string; title: string; count: number }>;
  dueToday: number;
  currentStreak: number;
  freezeCount: number;
  overallMastery: number;
}

export interface SearchHit {
  nodeId: string;
  title: string;
  snippet: string;
  rank: number;
}

/* ---------- 聊天消息（持久化） ---------- */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** ISO timestamp */
  createdAt: string;
}

/* ---------- Provider 预设（给 Settings UI，不含 key） ---------- */

export interface ProviderModelInfo {
  id: string;
  label: string;
  contextWindow: number | null;
  /** 模型能力:chat / tools / reasoning / vision(用于 vision 覆盖选择器显示 ✅) */
  capabilities?: string[];
}

export interface ProviderPresetInfo {
  id: string;
  label: string;
  protocol: "openai-compatible" | "anthropic" | "google";
  baseUrl?: string;
  defaultModel: string;
  models: ProviderModelInfo[];
  apiKeySetting: string;
  keyUrl: string;
  note?: string;
}

/* ---------- 自定义 Provider（用户自建 LLM 端点） ---------- */

export interface CustomProvider {
  id: string;
  label: string;
  protocol: "openai-compatible" | "anthropic" | "google";
  baseUrl: string;
  defaultModel: string;
  /** 可选模型列表（解析自 modelsJson） */
  models: ProviderModelInfo[];
  /** 是否需要 API key（本地模型如 Ollama 不需要） */
  hasApiKey: boolean;
  createdAt: string;
}

export interface CustomProviderInput {
  label: string;
  protocol: "openai-compatible" | "anthropic" | "google";
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  models?: ProviderModelInfo[];
}

/* ---------- Starter Prompts（引导按钮） ---------- */

export interface StarterPrompt {
  /** 按钮显示文字 */
  label: string;
  /** 点击后发送的完整消息 */
  message: string;
  /** 图标 emoji */
  icon: string;
  /** hover 提示(说明这个按钮做什么) */
  hint?: string;
  /** 标记:点这个按钮能涨掌握度(渲染层加视觉提示) */
  advancesMastery?: boolean;
}

/* ---------- 练习题（M2 exercises 表的 UI 契约） ---------- */

export type ExerciseType = "mcq" | "fill_blank" | "true_false";

export interface Exercise {
  id: string;
  nodeId: string;
  type: ExerciseType;
  prompt: string;
  /** MCQ 选项（type=mcq 时用） */
  options: string[] | null;
  /** 正确答案（MCQ 是选项 index 的字符串；fill_blank 是答案文本；true_false 是 "true"/"false"） */
  answer: string;
  explanation: string | null;
  /** 本题是否由 AI 生成（true）还是人工（false）。当前全部 AI 生成 */
  aiGenerated: boolean;
  createdAt: string;
}

/** 多模态资源:导入课程时收集的图片/PDF 页面渲染图元数据 */
export type AssetSourceKind = "image_file" | "markdown_ref" | "pdf_page";

export interface NodeAsset {
  id: string;
  nodeId: string;
  courseId: string;
  /** assets 目录下的文件名(如 lesson1-fig01.png) */
  filename: string;
  /** image/png / image/jpeg / image/svg+xml 等 */
  mimeType: string;
  /** 源文件里的原始相对路径(如 lessons/1/img.png) */
  sourcePath: string | null;
  sourceKind: AssetSourceKind;
  /** 像素宽(可空) */
  width: number | null;
  /** 像素高(可空) */
  height: number | null;
  /** PDF 来源页码(可空,1-based) */
  pageNumber: number | null;
  /** ![](x) 的 alt 或文件名推断描述 */
  altText: string | null;
}

/* ---------- IPC 通道协议 ---------- */

/**
 * 所有 IPC 调用都走 invoke/handle 模式。
 * 渲染层通过 preload 暴露的 window.api 调用。
 */
/** 用户主动上报的卡点类型(写 friction_log,供 agent 上下文自适应)。 */
export type HumanFrictionCategory = "confused" | "blocked" | "frustrated";

export interface ApiExpose {
  /* 课程 */
  listCourses(): Promise<Course[]>;
  getCourseTree(courseId: string, locale?: string): Promise<ContentNode[]>;
  importCourseFromRepo(repoUrl: string, langCode?: string): Promise<Course>;
  /** 新智能管线 Step 1+2: 分析仓库 → 自动按 pref_lang + sourceLang 选定翻译 */
  analyzeRepo(repoUrl: string): Promise<RepoAnalysis>;
  /** 新智能管线 Step 3+4+5: 按分析结果导入（langCode 从 analysis.selectedLang 取） */
  importAnalyzed(repoUrl: string, analysis: RepoAnalysis): Promise<Course>;
  /** 检测仓库的可用翻译语言（从 README 的 translations/ 链接提取） */
  detectLanguages(repoUrl: string): Promise<{ code: string; name: string }[]>;
  /** 获取课程已导入的翻译语言列表 */
  getCourseLanguages(courseId: string): Promise<string[]>;
  /** 设置课程当前显示语言（null = 原文），存 settings 表 */
  setCourseLanguage(courseId: string, locale: string | null): Promise<void>;
  /** 获取课程当前显示语言（null = 原文） */
  getCourseLanguage(courseId: string): Promise<string | null>;
  /** 从本地文件夹导入:Electron 选目录 → 递归扫描 txt/md/html/pdf → 落库 → 自动结构化。push import:progress。用户取消返回 null */
  importLocalFolder(): Promise<Course | null>;
  /** M4: 从 markdown 字符串生成课程（无网络依赖） */
  generateCourseFromMarkdown(
    md: string,
    repoName: string,
    repoUrl?: string,
  ): Promise<Course>;
  /** 删除课程及其全部节点/进度（用户移除不需要的课程） */
  deleteCourse(courseId: string): Promise<void>;
  /** 用 LLM 把导入的碎片节点重组成教学结构（需要配 key） */
  restructureCourse(courseId: string): Promise<{
    sectionCount: number;
    lessonCount: number;
    skippedCount: number;
  }>;
  /** LLM 生成章节摘要 + 前置依赖标记（需要配 key） */
  generateSummaries(courseId: string): Promise<{ sectionsUpdated: number }>;
  /** 获取某节点的 starter prompts（引导按钮） */
  getStarterPrompts(nodeId: string): Promise<StarterPrompt[]>;
  /** 获取某节点的完整内容（课程导入 UI / 详情页用） */
  getNodeContent(nodeId: string, locale?: string): Promise<string | null>;
  /** 取节点摘要(导入时生成,空会话时中栏显示) */
  getNodeSummary(nodeId: string): Promise<string | null>;
  /** 两个世界:查某学习课对应的实操节点(同 source_path 目录) */
  getPracticeForLesson(nodeId: string): Promise<ContentNode[]>;
  /** 两个世界:查某实操节点对应的学习课(反向跳转) */
  getLessonForPractice(nodeId: string): Promise<ContentNode | null>;

  /* 多模态资源(node_assets) */
  /** 列某节点的全部图片资源(元数据,不含二进制) */
  listAssetsByNode(nodeId: string): Promise<NodeAsset[]>;
  /** 列某课程的全部图片资源(集中插图区展示用) */
  listAssetsByCourse(courseId: string): Promise<NodeAsset[]>;
  /** 读某资源的 data-url(base64,给 <img> src 用)。不存在返回 null */
  getAssetDataUrl(assetId: string): Promise<string | null>;

  /* 进度 */
  getProgress(nodeId: string): Promise<Progress | null>;
  updateProgress(nodeId: string, patch: Partial<Progress>): Promise<Progress>;
  markNodeAttempted(nodeId: string): Promise<void>;

  /* 练习题 */
  /** 让 AI 给某节点生成一道练习题（缓存到 exercises 表） */
  generateExercise(nodeId: string, type?: ExerciseType): Promise<Exercise>;
  /** 取某节点缓存的练习题（不生成新的；没有返回空数组） */
  listExercises(nodeId: string): Promise<Exercise[]>;
  /** 提交答案，返回是否正确 + 解释。同时触发 BKT 掌握度更新 Proposal */
  submitExerciseAnswer(
    exerciseId: string,
    userAnswer: string,
  ): Promise<{ correct: boolean; explanation: string | null; proposalId?: string }>;

  /* 章节考试（关底 boss，可选支线，正确率分档给 1-3 星） */
  /** 开始/继续考试：已生成过题目则直接返回，否则调 LLM 生成整章综合题 */
  examStart(examNodeId: string): Promise<{ exercises: Exercise[] }>;
  /** 提交考试：逐题判分，算正确率，给星数（取最高），写 progress.crownLevel */
  examSubmit(
    examNodeId: string,
    answers: Record<string, string>,
  ): Promise<{
    correctCount: number;
    totalCount: number;
    accuracy: number;
    stars: number;
    bestStars: number;
    perQuestion: Array<{
      exerciseId: string;
      correct: boolean;
      userAnswer: string;
      correctAnswer: string;
      explanation: string | null;
    }>;
  }>;

  /* SRS */
  getDueReviews(): Promise<string[]>;
  /** v0.2: 所有 SRS 项详情(供四象限复习面板)。返回 intervalDays/repetitions/dueAt/overdue。 */
  getAllSrsItems(): Promise<Array<{ nodeId: string; intervalDays: number; repetitions: number; dueAt: string; overdue: boolean }>>;
  recordReview(nodeId: string, quality: ReviewQuality): Promise<void>;

  /* 打卡 */
  getStreak(): Promise<Streak>;
  touchStreakToday(): Promise<Streak>;

  /* Agent 引擎（M2：取代原 v2 占位。agentChat 自带流式推送 via chat:token 事件） */
  agentChat(nodeId: string, userMessage: string): Promise<string>;
  /** 中断当前正在流的 agent 回复（Stop 按钮） */
  abortAgentChat(nodeId: string): Promise<void>;
  /** 取某节点的聊天历史（持久化在 chat_sessions 表） */
  getChatHistory(nodeId: string): Promise<ChatMessage[]>;
  /** 清空某节点的聊天历史 */
  clearChatHistory(nodeId: string): Promise<void>;
  /** v0.4: Thread 模式发消息(传 threadId,从 thread 装配上下文) */
  agentChatThread(threadId: string, userMessage: string): Promise<string>;
  /** v0.4: 中断某 thread 的 agent 回复 */
  abortAgentChatThread(threadId: string): Promise<void>;

  /* Skill 系统（M1） */
  listSkills(): Promise<Skill[]>;
  getSkill(name: string): Promise<Skill | null>;
  createSkill(input: {
    name: string;
    description: string;
    type: SkillType;
    body: string;
  }): Promise<Skill>;
  setActiveSkill(name: string): Promise<void>;
  getActiveSkill(): Promise<string | null>;

  /** LLM provider 是否就绪（渲染层只见布尔，不见 key） */
  isAgentReady(): Promise<{
    ready: boolean;
    provider?: string;
    model?: string;
    missing?: string;
  }>;
  /** 返回所有 provider 预设元数据（给 Settings 页做 provider/model 选择器，不含 key） */
  getProviderPresets(): Promise<ProviderPresetInfo[]>;
  /** 测试当前 provider 的 key + model + 网络是否通（Settings 页"测试连接"按钮） */
  testLlmConnection(): Promise<{
    ok: boolean;
    detail: string;
    errorKind?: "auth" | "rate-limit" | "network" | "not-configured" | "unknown";
  }>;
  /** 测试指定自定义 provider 配置（不保存，临时验证） */
  testCustomProvider(input: CustomProviderInput): Promise<{
    ok: boolean;
    detail: string;
    models?: ProviderModelInfo[];
    errorKind?: "auth" | "rate-limit" | "network" | "not-configured" | "unknown";
  }>;
  /** OpenRouter 模型自动发现（公开 API，无需 key） */
  discoverModels(): Promise<{
    ok: boolean;
    models?: Array<{
      id: string;
      label: string;
      contextWindow: number | null;
      pricing?: { input: number | null; output: number | null };
      capabilities?: string[];
      inputModalities?: string[];
    }>;
    error?: string;
  }>;
  /** Provider 直连模型发现（用已配 key 拉取 /v1/models） */
  discoverProviderModels(baseUrl: string, apiKey: string): Promise<{
    ok: boolean;
    models?: { id: string; label: string }[];
    error?: string;
  }>;
  /** 自定义 provider CRUD */
  listCustomProviders(): Promise<CustomProvider[]>;
  createCustomProvider(input: CustomProviderInput): Promise<CustomProvider>;
  updateCustomProvider(id: string, input: Partial<CustomProviderInput>): Promise<CustomProvider>;
  deleteCustomProvider(id: string): Promise<void>;

  /* Proposal 流水线（M2） */
  listPendingProposals(): Promise<Proposal[]>;
  applyProposal(id: string): Promise<Proposal>;
  rejectProposal(id: string): Promise<Proposal>;
  /** 本地评分的 quiz 产物答题观测 → 自动建+应用 update_mastery 提案(无需 LLM/人审)。 */
  recordQuizAnswer(nodeId: string, correct: boolean): Promise<{ applied: boolean; newMastery?: number; mastered?: boolean }>;
  /** 学习者主动报"卡点" → 写 friction_log(供 agent 上下文自适应)。nodeId 可空(课程级)。 */
  logFriction(nodeId: string | null, category: HumanFrictionCategory, summary: string | null): Promise<void>;

  /* 仪表盘 + 检索 + 记忆（M3） */
  getDashboard(courseId: string): Promise<DashboardData>;
  searchContent(query: string): Promise<SearchHit[]>;
  updateMemory(input: {
    nodeId?: string | null;
    summary: string;
    category: "global" | "node" | "friction_pattern";
  }): Promise<{ id: string; nodeId: string | null; summary: string; category: string }>;
  getMemory(
    nodeId: string | null,
    category?: "global" | "node" | "friction_pattern",
  ): Promise<
    Array<{
      id: string;
      nodeId: string | null;
      summary: string;
      category: string;
    }>
  >;

  /* 设置 */
  getSetting(key: SettingKey): Promise<string | null>;
  setSetting(key: SettingKey, value: string): Promise<void>;

  /** XP 状态（今日经验值 + 每日目标 + 达成百分比） */
  getXpStatus(): Promise<XpStatus>;
  /** 导出学习记录（JSON / Markdown 格式） */
  exportCourse(courseId: string, format: "json" | "markdown"): Promise<string>;

  /* v0.3: Canvas 画布(康奈尔式笔记本)—— AI 产物 + 用户画线 + 练习记录 */
  /** zone 可选:不传=全部 / 'understand'=理解区 / 'note'=笔记区 / 'practice'=练习区 */
  canvasList(courseId: string, nodeId?: string | null, zone?: CanvasZone): Promise<CanvasItem[]>;
  canvasSave(input: { nodeId?: string | null; courseId: string; artifactType: string; title?: string | null; data: unknown }): Promise<CanvasItem>;
  canvasDelete(id: string): Promise<void>;
  canvasTogglePin(id: string): Promise<CanvasItem | null>;
  /** 用户画线加笔记(user_note),带溯源(content/chat)。comment 为可选初始注释 */
  canvasSaveUserNote(input: {
    nodeId: string;
    courseId: string;
    text: string;
    sourceType: "content" | "chat";
    sourceAnchor: NoteSourceAnchor;
    comment?: string;
  }): Promise<CanvasItem>;
  /** quiz 重做后更新 last_result(只保留最近一次) */
  canvasRecordQuizResult(id: string, correct: boolean): Promise<CanvasItem | null>;
  /** 更新 user_note 的用户注释(空串=删除)。找不到返回 null */
  canvasUpdateUserNoteComment(id: string, comment: string): Promise<CanvasItem | null>;

  /* v0.4: Thread 会话(类 Cursor 项目-会话) */
  threadList(courseId: string, status?: "active" | "archived"): Promise<Thread[]>;
  threadCreate(input: { courseId: string; focusNodeId?: string | null; title?: string | null }): Promise<Thread>;
  threadUpdate(id: string, patch: { title?: string; status?: "active" | "archived"; focusNodeId?: string | null }): Promise<Thread | null>;
  threadDelete(id: string): Promise<void>;
  threadGetMessages(threadId: string): Promise<ChatMessageRow[]>;
  threadFindRecentByNode(courseId: string, nodeId: string): Promise<Thread | null>;
}

/** v0.4: 会话线程 */
export interface Thread {
  id: string;
  courseId: string;
  title: string | null;
  focusNodeId: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** v0.4: 单条对话消息 */
export interface ChatMessageRow {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  partsJson: string | null;
  createdAt: string;
}

/** v0.3: canvas_items 表的一行(对齐 DB schema)。 */
export interface CanvasItem {
  id: string;
  nodeId: string | null;
  courseId: string;
  artifactType: string;
  title: string | null;
  data: string;
  pinned: number;
  createdAt: string;
  notes: string | null;
  /** v0.3 溯源:'ai' / 'content'(讲解画线) / 'chat'(对话画线) */
  sourceType: string | null;
  /** 溯源锚点 JSON:content={surroundingText} / chat={threadId,msgId} */
  sourceAnchor: string | null;
  /** 仅 quiz:最近一次答题 'correct'/'wrong' */
  lastResult: string | null;
  /** 仅 quiz:答题时间 */
  resultAt: string | null;
}

/** 康奈尔笔记三区 */
export type CanvasZone = "understand" | "note" | "practice";

/** 用户画线笔记的溯源锚点 */
export type NoteSourceAnchor =
  | { type: "content"; surroundingText: string; startOffset?: number; endOffset?: number } // 讲解区:字符偏移(稳定通道)+ surroundingText(回退)
  | { type: "chat"; threadId: string; msgId: string; startOffset?: number; endOffset?: number }; // 对话流:thread + 消息 id + 消息内字符偏移

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

/** XP 状态(今日能量 + P4 累计/等级持久成长线)。 */
export interface XpStatus {
  todayXp: number;
  dailyGoal: number;
  achieved: boolean;
  pct: number;
  /** P4: 累计 XP(永不重置) */
  totalXp: number;
  /** P4: 由累计 XP 派生的等级 */
  level: number;
  /** P4: 当前等级进度 0-100 */
  levelPct: number;
}

export interface Streak {
  currentStreak: number;
  longestStreak: number;
  /** ISO date string YYYY-MM-DD */
  lastActiveDate: string | null;
  freezeCount: number;
}

export type SettingKey =
  | "openai_api_key"
  | "anthropic_api_key"
  | "google_api_key"
  | "glm_api_key"
  | "glm_codingplan_key"
  | "deepseek_api_key"
  | "kimi_api_key"
  | "qwen_api_key"
  | "siliconcloud_api_key"
  | "openrouter_api_key"
  | "active_provider"
  | "active_model"
  | "daily_goal_xp"
  | "user_level"
  // 多模态:feature flag(存 settings 表,key 形如 flag_xxx)
  | "flag_multimodal_import"
  | "flag_image_download"
  // 多模态:可选的 vision 模型覆盖(不配则复用主模型)
  | "vision_provider_override"
  | "vision_model_override"
  // 语言偏好:导入时自动按此偏好选翻译 (en / zh-CN / zh-TW)
  | "pref_lang";

/* ---------- IPC 事件（main → renderer，单向推送） ---------- */

/**
 * v0.2 流式 part 类型（parts-based 渲染协议）。
 * 对齐 AI SDK v5 fullStream，简化为渲染层友好形态。
 * ChatStream 渲染层按 part.type 累积到 message.parts[]，不再字符串拼接。
 */
export type ChatStreamPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-start"; toolName: string }
  | { type: "tool-result"; toolName: string; output: unknown }
  | { type: "tool-error"; toolName: string; error: string };

export interface IpcEvents {
  "chat:token": (chunk: string) => void;
  "chat:done": (fullText: string, ids?: { userMessageId?: string; assistantMessageId?: string }) => void;
  "chat:error": (error: string) => void;
  /** 工具调用事件（结构化，供聊天栏渲染工具条） */
  "chat:toolCall": (name: string, args: string) => void;
  /** 提议创建事件（结构化，供聊天栏渲染应用/拒绝卡） */
  "chat:proposal": (proposalId: string, summary: string, status: string) => void;
  "import:progress": (message: string) => void;
  /**
   * v0.2 parts-based 流式协议：把 fullStream 的 part 透传给渲染层。
   * 与 chat:token 并存（兼容期），渲染层可二选一。M2 起优先用 chat:part。
   */
  "chat:part": (part: ChatStreamPart) => void;
  /** main→renderer 状态变化推送(xp/streak/mastery 变化)。renderer 重拉 + 触发庆祝。 */
  "state:changed": (kind: "xp" | "streak" | "mastery") => void;
}
