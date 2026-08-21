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
/** 接近毕业:mastery ≥ 此值但 < MASTERED 时,可提议提前毕业(mark_mastered)。 */
export const NEAR_MASTERED_THRESHOLD = 0.85;

/** 知识组件定义（per-KC BKT 的基础），LLM 从课程内容提取 */
export interface KnowledgePoint {
  title: string;
  description: string;
}

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
  /** JSON array of KnowledgePoint — LLM 提取的知识组件（per-KC BKT 基础）。null=未提取。 */
  knowledgePoints?: string | null;
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

/* ---------- 课程包导出结果 ---------- */
/** electron: path 为落盘路径;web: path=null + fileName/content 由浏览器端下载 */
export interface ExportPackResult {
  path: string | null;
  fileName?: string;
  content?: string;
}

/* ---------- 后台导入任务（import:localFolder / import:github 即返的句柄） ---------- */

/** 后台导入任务句柄：管线在 main 后台跑，进度走 import:progress，结束走 import:done */
export interface ImportJobHandle {
  jobId: string;
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
  /** 显式翻译配对: 原文路径 → 翻译文件路径（规则/LLM 判出的精确对；落库优先于布局猜路径） */
  translationPairs?: Record<string, string>;
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

/* ---------- Soul 系统（教学人设/persona） ---------- */

export type SoulType = "builtin" | "custom";

export interface Soul {
  id: string;
  name: string;
  description: string;
  type: SoulType;
  /** 完整 raw（含 frontmatter）。运行时用 parseFrontmatter 取 body 注入 system prompt */
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
  /** Per-KC BKT: 考察的知识组件下标（对应 knowledgePoints JSON 数组）。不传=无 KC 回退或更新全部。 */
  kcIndex?: number;
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

/** custom_providers 的用途分区(v0.15 三模型区):主模型/看图覆盖/朗读/听写 */
export type CustomProviderKind = "llm" | "vision" | "tts" | "asr";

export interface CustomProvider {
  id: string;
  label: string;
  kind: CustomProviderKind;
  protocol: "openai-compatible" | "anthropic" | "google";
  baseUrl: string;
  defaultModel: string;
  /** 可选模型列表（解析自 modelsJson） */
  models: ProviderModelInfo[];
  /** 是否需要 API key（本地模型如 Ollama 不需要） */
  hasApiKey: boolean;
  /** 支持看图（多模态）：kind=llm 行由用户手动勾选；kind=vision 天生支持 */
  vision: boolean;
  createdAt: string;
}

export interface CustomProviderInput {
  label: string;
  /** 缺省 llm(主模型区);vision/tts/asr 由对应设置区建 */
  kind?: CustomProviderKind;
  protocol: "openai-compatible" | "anthropic" | "google";
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  models?: ProviderModelInfo[];
  /** 支持看图（多模态），仅 kind=llm 有意义 */
  vision?: boolean;
}

/* ---------- v0.10 Composer:附件 / 上下文表 / 思考强度 ---------- */

/** 渲染层 → main:用户随消息上传的附件。image=纯 base64(无 data: 前缀);text=文件文本内容。 */
export interface ChatAttachmentInput {
  kind: "image" | "text";
  name: string;
  mime: string;
  size: number;
  /** image:纯 base64;text:UTF-8 文本正文 */
  data: string;
  /** 渲染层瞬态:乐观消息的本地预览 objectURL;main 侧忽略,不持久化。 */
  previewUrl?: string;
}

/** 附件在消息 parts 里的持久化载荷(不存 blob;image 落盘引用,text 正文已内联 content)。 */
export interface ChatAttachmentRef {
  kind: "image" | "text";
  name: string;
  mime: string;
  size: number;
  /** image:userData/attachments 下的文件名(经 attachment:getDataUrl 取回);text 无。 */
  file?: string;
  /** 渲染层瞬态:乐观消息的本地预览 objectURL,不持久化。 */
  previewUrl?: string;
}

/** agent:getContextUsage 的返回:渲染层算不清的"固定开销"(system/课文/学习者快照) + 模型窗口。
 * 渲染层再本地叠加对话历史与草稿的估算,合成完整上下文表。 */
export interface ContextUsageInfo {
  /** base prompt + soul + 语言提醒 */
  systemTokens: number;
  /** 课程结构 + 节点正文 + KC 清单 */
  nodeTokens: number;
  /** 学习者快照(掌握度+friction+memory) */
  learnerTokens: number;
  /** 活动模型的上下文窗口(未知 → null,只显示用量不显示占比) */
  contextWindow: number | null;
  provider: string;
  model: string;
  /** 当前模型是否支持看图(附件门控;未收录模型宽松为 true;配了 vision 覆盖也视为 true——走转译桥) */
  visionCapable: boolean;
  /** 主模型不支持看图但配了 vision 覆盖时的桥接模型名(输入框提示用);其余为 null */
  visionBridgeModel: string | null;
}

/** 思考强度(应用级偏好,存 settings.reasoning_effort)。"" = 自动(不干预,模型默认)。 */
export type ReasoningEffortSetting = "" | "fast" | "deep";

/* ---------- Starter Prompts（引导按钮） ---------- */

/** 巩固选择的稳定标识:渲染层据此查 i18n 字典覆盖 label/hint/message(界面语言)。 */
export type StarterPromptKey = "go-deeper" | "give-example" | "quiz-me" | "confused";

export interface StarterPrompt {
  /** 稳定标识(i18n 键);服务端返回的 label/message/hint 是中文默认值,渲染层按界面语言覆盖 */
  key: StarterPromptKey;
  /** 按钮显示文字(中文默认;渲染层用 starter.{key}.label 覆盖) */
  label: string;
  /** 点击后发送的完整消息(中文默认,已内插标题;渲染层用 starter.{key}.message + {title} 覆盖) */
  message: string;
  /** 图标 emoji */
  icon: string;
  /** 可见提示(说明这个按钮做什么;默认显示,不靠 hover;渲染层用 starter.{key}.hint 覆盖) */
  hint?: string;
  /** 标记:点这个按钮能涨掌握度(渲染层加视觉提示) */
  advancesMastery?: boolean;
  /** 标记:点这个按钮除了发消息,还额外记一条 friction(原 ? 卡点的归宿) */
  frictionCategory?: HumanFrictionCategory;
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

/* —— 章节考试 v2(后台生成 + KC 出题 + attempt 档案) —— */

/** 考试节点生成状态机:idle(未生成) → generating → ready / failed */
export type ExamGenStatus = "idle" | "generating" | "ready" | "failed";

/** 生成进度(main → renderer 的 exam:status 事件载荷,也是 prepare/getStatus 的返回) */
export interface ExamStatus {
  nodeId: string;
  status: ExamGenStatus;
  /** 已覆盖的知识点数(内部按 ≤3 KC/批 LLM 出题,每完成一批累加该批 KC 数;进度 = done/total) */
  done: number;
  /** 本章知识点总数 */
  total: number;
  /** failed 时的失败原因(供 UI 展示) */
  error: string | null;
}

/** 考试题目视图:Exercise + KC 标签 */
export interface ExamQuestionView extends Exercise {
  /** 考察的知识点标题(老考试题/兜底出题时为 null) */
  kcTitle: string | null;
}

/** 一场考试的结算快照(attempt 档案,切回节点可见) */
export interface ExamAttemptView {
  id: string;
  examNodeId: string;
  startedAt: string;
  finishedAt: string | null;
  /** true = 中途离开被终止(未答题按答错计分) */
  terminated: boolean;
  correctCount: number;
  totalCount: number;
  stars: number;
  /** 逐题结算(判分后才有;进行中为 null) */
  perQuestion: ExamPerQuestionResult[] | null;
}

export interface ExamPerQuestionResult {
  exerciseId: string;
  kcTitle: string | null;
  correct: boolean;
  /** 用户答案(MCQ 为原始选项下标字符串;空串 = 未答) */
  userAnswer: string;
  correctAnswer: string;
  explanation: string | null;
  /** false = 未答(超时/终止跳过),结算页区分"未答"与"答错" */
  answered: boolean;
  /** 题干快照(判分时定格):重新生成题库删旧题后,历史回顾仍自包含 */
  prompt?: string | null;
  /** 选项快照(判分时定格;老 attempt 无此字段) */
  options?: string[] | null;
}

/** getStatus 返回:生成状态 + 就绪元信息 + 最新 attempt */
export interface ExamStatusView extends ExamStatus {
  /** 就绪题目数(0 = 未就绪) */
  questionCount: number;
  /** 题库覆盖的知识点数(0 = 老考试题无标注,UI 隐藏 KC 分解) */
  kcCount: number;
  /** 就绪题目(未就绪为空数组;结算页逐题回顾 + 就绪页元信息用) */
  exercises: ExamQuestionView[];
  /** 历史最好星数(progress.crownLevel) */
  bestStars: number;
  /** 最新一次 attempt(含历史结果;悬挂的已被自动判死) */
  latestAttempt: ExamAttemptView | null;
  /** 历史考试次数 */
  attemptCount: number;
}

/** 提交考试返回(结算数据) */
export interface ExamSubmitResult {
  attemptId: string;
  correctCount: number;
  totalCount: number;
  accuracy: number;
  stars: number;
  /** 历史最高星数(含本次;写 progress.crownLevel) */
  bestStars: number;
  /** true = 中途离开被终止 */
  terminated: boolean;
  perQuestion: ExamPerQuestionResult[];
}

/** 多模态资源:导入课程时收集的图片/PDF 页面渲染图元数据 */
export type AssetSourceKind = "image_file" | "markdown_ref" | "pdf_page";

/** draw_diagram 产物渲染失败时的 mermaid 定点修复请求(渲染层 → 主进程 LLM) */
export interface DiagramRepairCall {
  /** 渲染失败的原始 mermaid(不含围栏) */
  mermaid: string;
  /** 渲染层捕获的解析错误信息 */
  errorMessage: string;
  diagramType: "flowchart" | "sequence" | "state";
}

/** 修复回执:失败绝不抛,ok:false + reason 让渲染层守自己的源码 fallback */
export interface DiagramRepairResult {
  ok: boolean;
  mermaid: string;
  reason?: string;
}

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

export type {
  SpeechModelId,
  SpeechModelStatus,
  SpeechDownloadProgress,
  SpeechTtsAudioEvent,
  SpeechTtsDoneEvent,
  SpeechTtsErrorEvent,
} from "./speech-types";
import type {
  SpeechModelId as SpeechModelIdT,
  SpeechModelStatus as SpeechModelStatusT,
  SpeechDownloadProgress as SpeechDownloadProgressT,
  SpeechTtsAudioEvent as SpeechTtsAudioEventT,
  SpeechTtsDoneEvent as SpeechTtsDoneEventT,
  SpeechTtsErrorEvent as SpeechTtsErrorEventT,
} from "./speech-types";

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
  /** 从本地文件夹导入（后台任务）:Electron 选目录 → 立即返回 jobId，管线后台跑。
   * push import:progress（进度）+ import:done（完成/失败/取消）。用户取消对话框返回 null */
  importLocalFolder(folderPath?: string): Promise<ImportJobHandle | null>;
  /** 从 GitHub 仓库导入（后台任务）:analyzeRepo + importAnalyzed 合一，立即返回 jobId。
   * push import:progress + import:done。URL 无效时立即抛错 */
  importGithub(repoUrl: string): Promise<ImportJobHandle>;
  /** 智能链接导入（后台任务）:github.com→仓库 / arxiv.org→论文 PDF / 其余→网页文章正文。
   * push import:progress + import:done。链接无法识别时立即抛错 */
  importUrl(url: string): Promise<ImportJobHandle>;
  /** 粘贴长文导入（后台任务）:无标题长文按句子边界自动分段成多课。文本为空立即抛错 */
  importText(payload: { name?: string; text: string }): Promise<ImportJobHandle>;
  /** EPUB 电子书导入（后台任务）:Electron 无参调用弹原生选择框(取消返回 null);
   * web 模式传 {fileName, contentBase64}(渲染层 <input type=file> 读内容) */
  importEpub(epub?: { fileName: string; contentBase64: string }): Promise<ImportJobHandle | null>;
  /** 本地音频导入(后台任务,多文件=多集):本地 Whisper 分段转写成课,缺模型自动下载。
   * Electron 无参调用弹原生多选框(取消返回 null);web 模式传 base64 数组 */
  importAudio(files?: { fileName: string; contentBase64: string }[]): Promise<ImportJobHandle | null>;
  /** 请求取消进行中的后台导入（拉取阶段生效，写库前零残留）。返回是否有任务在跑 */
  importCancel(): Promise<boolean>;
  /** 从断点重试:带上次落盘的导入方案快照续跑(已完成步骤零重烧)。快照不存在时抛错 */
  importResume(planId: string): Promise<ImportJobHandle>;
  /** 导入课程包:Electron 选 .lookatstudy-pack.json → 后台跑(命中则零 AI 调用)。取消对话框返回 null */
  importPack(pack?: { fileName: string; content: string }): Promise<ImportJobHandle | null>;
  /** 导出课程包(仅 GitHub 来源课程):Electron 另存对话框,返回写入路径;取消返回 null */
  exportPack(courseId: string): Promise<ExportPackResult | null>;
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
  /** locale = 界面语言(zh-CN/en);摘要随界面语言选版本,en 缺失时历史节点自动补齐 */
  getNodeSummary(nodeId: string, locale?: string | null): Promise<string | null>;
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

  /** 产物 */
  /** draw_diagram 渲染失败的 mermaid 定点修复(主进程 LLM,1 轮封顶;失败 ok:false 不抛) */
  repairMermaidDiagram(input: DiagramRepairCall): Promise<DiagramRepairResult>;

  /* 进度 */
  getProgress(nodeId: string): Promise<Progress | null>;
  updateProgress(nodeId: string, patch: Partial<Progress>): Promise<Progress>;
  markNodeAttempted(nodeId: string): Promise<void>;

  /* 练习题 */
  /** 让 AI 给某节点生成一道练习题（缓存到 exercises 表） */
  generateExercise(nodeId: string, type?: ExerciseType, locale?: string | null): Promise<Exercise>;
  /** 取某节点缓存的练习题（不生成新的；没有返回空数组） */
  listExercises(nodeId: string): Promise<Exercise[]>;
  /** 提交答案，返回是否正确 + 解释。同时触发 BKT 掌握度更新 Proposal */
  submitExerciseAnswer(
    exerciseId: string,
    userAnswer: string,
  ): Promise<{ correct: boolean; explanation: string | null; proposalId?: string }>;

  /* 章节考试 v2（后台生成 + KC 出题 + attempt 档案 + 限时考试） */
  /** 幂等启动题目生成(已就绪/生成中则无副作用),立即返回当前状态。生成在 main 后台继续。 */
  examPrepare(examNodeId: string, locale?: string | null): Promise<ExamStatus>;
  /** 重新生成题库:删旧题重启生成(在飞 no-op;悬挂 attempt 判死;历史星数保留) */
  examRegenerate(examNodeId: string, locale?: string | null): Promise<ExamStatus>;
  /** 查状态 + 就绪元信息 + 最新 attempt。悬挂 attempt(崩溃遗留)在此调用内自动按"未答=错"判死。 */
  examGetStatus(examNodeId: string): Promise<ExamStatusView>;
  /** 开始/重新考试:建 attempt 行,返回 attemptId + 就绪题目(含 KC 标签)。 */
  examStartAttempt(examNodeId: string): Promise<{
    attemptId: string;
    exercises: ExamQuestionView[];
  }>;
  /** 逐题增量持久化答案(崩溃安全:强关后悬挂 attempt 仍有已答记录)。 */
  examRecordAnswer(
    examNodeId: string,
    attemptId: string,
    exerciseId: string,
    answer: string,
  ): Promise<void>;
  /** 提交考试(terminated=中途离开被终止,未答题按答错计分,同样计星计分)。 */
  examSubmitAttempt(
    examNodeId: string,
    attemptId: string,
    answers: Record<string, string>,
    opts?: { terminated?: boolean },
  ): Promise<ExamSubmitResult>;

  /* SRS */
  getDueReviews(): Promise<string[]>;
  /** v0.2: 所有 SRS 项详情(供四象限复习面板)。返回 intervalDays/repetitions/dueAt/overdue。 */
  getAllSrsItems(): Promise<Array<{ nodeId: string; intervalDays: number; repetitions: number; dueAt: string; overdue: boolean }>>;
  recordReview(nodeId: string, quality: ReviewQuality): Promise<void>;

  /* 打卡 */
  getStreak(): Promise<Streak>;
  touchStreakToday(): Promise<Streak>;

  /* Agent 引擎（M2：取代原 v2 占位。agentChat 自带流式推送 via chat:token 事件） */
  agentChat(nodeId: string, userMessage: string, locale?: string | null): Promise<string>;
  /** 中断当前正在流的 agent 回复（Stop 按钮） */
  abortAgentChat(nodeId: string): Promise<void>;
  /** 取某节点的聊天历史（持久化在 chat_sessions 表） */
  getChatHistory(nodeId: string): Promise<ChatMessage[]>;
  /** 清空某节点的聊天历史 */
  clearChatHistory(nodeId: string): Promise<void>;
  /** v0.4: Thread 模式发消息(传 threadId,从 thread 装配上下文) */
  agentChatThread(
    threadId: string,
    userMessage: string,
    displayText?: string | null,
    /** 界面语言(i18n);null/缺省不传 = zh-CN */
    locale?: string | null,
    /** v0.10: 随消息上传的附件(image=vision 注入 + 落盘;text=正文内联进 content) */
    attachments?: ChatAttachmentInput[],
  ): Promise<string>;
  /** v0.4: 中断某 thread 的 agent 回复 */
  abortAgentChatThread(threadId: string): Promise<void>;
  /** v0.10: 当前节点+模型的一次性上下文开销(系统提示/课文/学习者快照的估算 token + 模型窗口)。
   * 给输入框上下文表;渲染层再本地叠加对话历史与草稿的估算。nodeId 不存在 → null。 */
  getContextUsage(nodeId: string, locale?: string | null): Promise<ContextUsageInfo | null>;
  /** v0.10: 取聊天图片附件的 data-url(渲染层恢复历史消息缩略图;file 须是 attachments 目录内的安全文件名) */
  getAttachmentDataUrl(file: string): Promise<string | null>;

  /* Soul 系统（教学人设/persona） */
  listSouls(): Promise<Soul[]>;
  getSoul(name: string): Promise<Soul | null>;
  createSoul(input: {
    name: string;
    description: string;
    type: SoulType;
    body: string;
  }): Promise<Soul>;
  setActiveSoul(name: string): Promise<void>;
  getActiveSoul(): Promise<string | null>;

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
  testLlmConnection(opts?: { vision?: boolean }): Promise<{ ok: boolean; detail: string; errorKind?: string }>;
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
  recordQuizAnswer(nodeId: string, correct: boolean, kc?: string): Promise<{ applied: boolean; newMastery?: number; mastered?: boolean }>;
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
  /** 记忆固化:从课程的对话+friction 采集 → LLM 提炼进全三类 memory。flag off 时 no-op。 */
  consolidateMemory(courseId: string): Promise<{
    ok: boolean;
    written?: string[];
    reason?: string;
  }>;

  /* 设置 */
  getSetting(key: SettingKey): Promise<string | null>;
  setSetting(key: SettingKey, value: string): Promise<void>;
  /** v0.11 桌宠:切换桌宠窗点击穿透(true=穿透还原桌面操作,false=可交互生物)。
   *  渲染层指针热区检测调用;web 运行时无桌宠窗,no-op。 */
  companionPetSetClickThrough(passThrough: boolean): Promise<void>;

  /** 语音模型状态(全部;absent/downloading/ready/error) */
  getSpeechModelStatus(): Promise<SpeechModelStatusT[]>;
  /** 下载/确保语音模型(进度经 speech:modelProgress 事件推送;全源失败抛错) */
  ensureSpeechModel(id: SpeechModelIdT): Promise<SpeechModelStatusT[]>;
  /** 删除语音模型释放磁盘(同时停朗读、失效引擎) */
  deleteSpeechModel(id: SpeechModelIdT): Promise<void>;
  /** 朗读一段消息文本(逐句 speech:ttsAudio → speech:ttsDone;模型未下载返回结构化 reason)。
   * v0.15:edge 默认 / local 离线 / custom-<id>(自定义 OpenAI 兼容端点);
   * azure 为旧库遗留取值仍生效;edge 抖动自动落 local(fellBackTo);
   * firstUse=首次用 edge 档(渲染层一次性披露"经微软在线服务") */
  ttsSpeak(text: string, messageId: string): Promise<
    | {
        ok: true;
        sentences: number;
        engine: "edge" | "azure" | "local" | "custom";
        fellBackTo?: "local";
        firstUse?: boolean;
      }
    | {
        ok: false;
        reason:
          | "engine-unavailable"
          | "model-missing"
          | "empty-text"
          | "azure-key-missing"
          | "azure-region-missing"
          | "edge-failed"
          | "custom-provider-missing";
      }
  >;
  /** 停止当前朗读(幂等) */
  ttsStop(): Promise<void>;
  /** 听写:渲染层录完整段 WAV(16kHz 单声道),一次调用换全文(v0.13 质量优先,
   *  v0.15:local=Whisper 离线(asr_local_model 指定)/ custom-<id>=OpenAI 兼容端点;
   *  groq/azure 为旧库遗留取值仍生效)。locale 用于语言提示 */
  asrTranscribe(
    wavBytes: ArrayBuffer,
    locale?: string,
  ): Promise<{ ok: true; text: string } | { ok: false; reason: string; detail?: string }>;

  /** v0.15 设置页:自定义朗读 provider 测试(真实合成一句验音频字节)。
   * providerId=已存的 provider(密钥在主进程解析);或直接传表单值(未保存先测) */
  testCustomTts(input: {
    providerId?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    voice?: string;
  }): Promise<{ ok: boolean; detail: string }>;
  /** v0.15 设置页:自定义听写 provider 探活(GET /models;端点不提供列表时如实说明) */
  testCustomAsr(input: {
    providerId?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }): Promise<{ ok: boolean; detail: string }>;

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
  /** 气泡展示文本(按钮触发的消息=短动作标签);null = 原样展示 content(手打输入) */
  displayText: string | null;
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
  | "flag_memory_system"
  // v0.20: PDF 公式密集页 vision 转写(默认 off,BYOK 视觉覆盖)
  | "flag_math_vision"
  // 多模态:可选的 vision 模型覆盖(不配则复用主模型)
  | "vision_provider_override"
  | "vision_model_override"
  // v0.10: 思考强度(空串=自动;"fast"=尽量关思考;"deep"=尽量开思考)
  | "reasoning_effort"
  // 语言偏好:导入时自动按此偏好选翻译 (en / zh-CN / zh-TW)
  | "pref_lang"
  // v0.13 语音三档:edge(默认)/azure/local 的引擎与音色语速
  // v0.15:tts_engine 取值扩为 edge/local/custom-<id>(azure 为旧库遗留,后端仍解析)
  | "tts_engine"
  | "tts_voice_edge"
  | "tts_sid_local"
  | "tts_speed"
  | "azure_tts_voice"
  | "azure_tts_api_key"
  | "azure_tts_region"
  // v0.15:自定义朗读的音色(OpenAI 兼容 /audio/speech 的 voice 参数,可空)
  | "tts_custom_voice"
  // v0.18:system 档音色名(浏览器 speechSynthesis voice.name;空=渲染层自动挑中文)
  | "tts_system_voice"
  // edge 档首次使用已披露(在线服务告知,一次性)
  | "tts_edge_disclosed"
  // v0.13 听写三档:local(Whisper 离线,默认)/groq(复用 LLM preset key)/azure STT
  // v0.15:asr_engine 取值改 local/custom-<id>(groq/azure 为旧库遗留,后端仍解析)
  | "asr_engine"
  | "azure_stt_api_key"
  | "azure_stt_region"
  // v0.15:本地听写选哪个 whisper(asr-whisper-turbo/asr-whisper-small;缺省 turbo 优先)
  | "asr_local_model"
  // 听写 UX:静音自动停(默认开);v0.14 飞书式复查浮层落地后 auto-send 已废
  | "asr_auto_stop"
  // 伴学伙伴可见性(用户设置,非引擎 flag;默认开,仅 "false"/"0" 关闭)
  | "companion_enabled" | "companion_form" | "companion_sfx"
  // v0.11 桌宠模式:伴学在应用外常驻(透明置顶窗;默认关)
  | "companion_pet_mode"
  // Groq LLM preset 早已使用(设置页经 as 断言写入);入 union 让听写档零断言读取
  | "groq_api_key";

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
  /** 后台导入任务结束（完成/失败/取消）。cancelled=true 表示用户主动取消。
   * 成功:planId=方案快照(课程包源),packable=可导出课程包(仅 github 来源);
   * 失败:planId=可从断点重试的快照(Step1 都没完成时无此字段)。 */
  "import:done": (result:
    | { ok: true; courseId: string; title: string; planId: string; reused: boolean; packable: boolean }
    | { ok: false; error: string; cancelled?: boolean; planId?: string }) => void;
  /**
   * v0.2 parts-based 流式协议：把 fullStream 的 part 透传给渲染层。
   * 与 chat:token 并存（兼容期），渲染层可二选一。M2 起优先用 chat:part。
   */
  "chat:part": (part: ChatStreamPart) => void;
  /** 考试题目生成进度推送(后台生成实时进度;完成/失败也走这里)。 */
  "exam:status": (status: ExamStatus) => void;
  /** main→renderer 状态变化推送(xp/streak/mastery 变化)。renderer 重拉 + 触发庆祝。 */
  "state:changed": (kind: "xp" | "streak" | "mastery") => void;
  /** v0.12 语音:逐句朗读音频(16-bit PCM WAV;serve 模式 wavBytes 为 base64 还原产物) */
  "speech:ttsAudio": (e: SpeechTtsAudioEventT) => void;
  /** 朗读结束(播完/被停/换场) */
  "speech:ttsDone": (e: SpeechTtsDoneEventT) => void;
  /** 朗读失败 */
  "speech:ttsError": (e: SpeechTtsErrorEventT) => void;
  /** 模型下载进度 */
  "speech:modelProgress": (e: SpeechDownloadProgressT) => void;
}
