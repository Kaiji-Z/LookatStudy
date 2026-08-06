/**
 * 共享类型契约 —— Electron 主进程与 React 渲染层之间的协议层。
 *
 * 修改这里的类型 = 修改 IPC 协议。两端必须同步。
 */

/* ---------- 课程模型 ---------- */

export type NodeType = "section" | "lesson" | "concept";

export type NodeStatus = "locked" | "available" | "in_progress" | "mastered";

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
}

export interface ProviderPresetInfo {
  id: string;
  label: string;
  protocol: "openai-compatible" | "anthropic" | "google";
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

/* ---------- IPC 通道协议 ---------- */

/**
 * 所有 IPC 调用都走 invoke/handle 模式。
 * 渲染层通过 preload 暴露的 window.api 调用。
 */
export interface ApiExpose {
  /* 课程 */
  listCourses(): Promise<Course[]>;
  getCourseTree(courseId: string): Promise<ContentNode[]>;
  importCourseFromRepo(repoUrl: string): Promise<Course>;
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
  /** 获取某节点的 starter prompts（引导按钮） */
  getStarterPrompts(nodeId: string): Promise<StarterPrompt[]>;
  /** 获取某节点的完整内容（课程导入 UI / 详情页用） */
  getNodeContent(nodeId: string): Promise<string | null>;

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

  /* SRS */
  getDueReviews(): Promise<string[]>;
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
  getXpStatus(): Promise<{ todayXp: number; dailyGoal: number; achieved: boolean; pct: number }>;
  /** 导出学习记录（JSON / Markdown 格式） */
  exportCourse(courseId: string, format: "json" | "markdown"): Promise<string>;
}

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

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
  | "user_level";

/* ---------- IPC 事件（main → renderer，单向推送） ---------- */

export interface IpcEvents {
  "chat:token": (chunk: string) => void;
  "chat:done": (fullText: string) => void;
  "chat:error": (error: string) => void;
  /** 工具调用事件（结构化，供聊天栏渲染工具条） */
  "chat:toolCall": (name: string, args: string) => void;
  /** 提议创建事件（结构化，供聊天栏渲染应用/拒绝卡） */
  "chat:proposal": (proposalId: string, summary: string, status: string) => void;
  "import:progress": (message: string) => void;
}
