/**
 * Electron preload —— 桥接主进程的 IPC 到渲染层。
 *
 * 通过 contextBridge 暴露受限的 api 对象到 window。
 * 渲染层通过 window.api.* 调用，无法直接访问 Node API。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ApiExpose, IpcEvents, ReviewQuality, SettingKey, ExerciseType, CustomProviderInput, CanvasZone, NoteSourceAnchor, HumanFrictionCategory } from "@shared/types";

const api = {
  /* 课程 */
  listCourses: (() => ipcRenderer.invoke("course:list")) as ApiExpose["listCourses"],
  getCourseTree: ((courseId: string, locale?: string) =>
    ipcRenderer.invoke("course:getTree", courseId, locale)) as ApiExpose["getCourseTree"],
  importCourseFromRepo: ((repoUrl: string, langCode?: string) =>
    ipcRenderer.invoke("course:importFromRepo", repoUrl, langCode)) as ApiExpose["importCourseFromRepo"],
  detectLanguages: ((repoUrl: string) =>
    ipcRenderer.invoke("course:detectLanguages", repoUrl)) as ApiExpose["detectLanguages"],
  getCourseLanguages: ((courseId: string) =>
    ipcRenderer.invoke("course:getLanguages", courseId)) as ApiExpose["getCourseLanguages"],
  setCourseLanguage: ((courseId: string, locale: string | null) =>
    ipcRenderer.invoke("course:setLanguage", courseId, locale)) as ApiExpose["setCourseLanguage"],
  getCourseLanguage: ((courseId: string) =>
    ipcRenderer.invoke("course:getLanguage", courseId)) as ApiExpose["getCourseLanguage"],
  analyzeRepo: ((repoUrl: string) =>
    ipcRenderer.invoke("course:analyzeRepo", repoUrl)) as ApiExpose["analyzeRepo"],
  importAnalyzed: ((repoUrl: string, analysis: import("@shared/types").RepoAnalysis) =>
    ipcRenderer.invoke("course:importAnalyzed", repoUrl, analysis)) as ApiExpose["importAnalyzed"],
  importLocalFolder: (() =>
    ipcRenderer.invoke("import:localFolder")) as ApiExpose["importLocalFolder"],
  importGithub: ((repoUrl: string) =>
    ipcRenderer.invoke("import:github", repoUrl)) as ApiExpose["importGithub"],
  importCancel: (() =>
    ipcRenderer.invoke("import:cancel")) as ApiExpose["importCancel"],
  generateCourseFromMarkdown: ((md: string, repoName: string, repoUrl?: string) =>
    ipcRenderer.invoke("course:generateFromMarkdown", md, repoName, repoUrl)) as ApiExpose["generateCourseFromMarkdown"],
  deleteCourse: ((courseId: string) =>
    ipcRenderer.invoke("course:delete", courseId)) as ApiExpose["deleteCourse"],
  restructureCourse: ((courseId: string) =>
    ipcRenderer.invoke("course:restructure", courseId)) as ApiExpose["restructureCourse"],
  generateSummaries: ((courseId: string) =>
    ipcRenderer.invoke("course:generateSummaries", courseId)) as ApiExpose["generateSummaries"],
  getStarterPrompts: ((nodeId: string) =>
    ipcRenderer.invoke("course:getStarterPrompts", nodeId)) as ApiExpose["getStarterPrompts"],
  getNodeContent: ((nodeId: string, locale?: string) =>
    ipcRenderer.invoke("course:getNodeContent", nodeId, locale)) as ApiExpose["getNodeContent"],
  getNodeSummary: ((nodeId: string, locale?: string | null) =>
    ipcRenderer.invoke("course:getNodeSummary", nodeId, locale ?? null)) as ApiExpose["getNodeSummary"],
  getPracticeForLesson: ((nodeId: string) =>
    ipcRenderer.invoke("course:getPracticeForLesson", nodeId)) as ApiExpose["getPracticeForLesson"],
  getLessonForPractice: ((nodeId: string) =>
    ipcRenderer.invoke("course:getLessonForPractice", nodeId)) as ApiExpose["getLessonForPractice"],

  /* 多模态资源(node_assets) */
  listAssetsByNode: ((nodeId: string) =>
    ipcRenderer.invoke("asset:listByNode", nodeId)) as ApiExpose["listAssetsByNode"],
  listAssetsByCourse: ((courseId: string) =>
    ipcRenderer.invoke("asset:listByCourse", courseId)) as ApiExpose["listAssetsByCourse"],
  getAssetDataUrl: ((assetId: string) =>
    ipcRenderer.invoke("asset:getDataUrl", assetId)) as ApiExpose["getAssetDataUrl"],

  /* 进度 */
  getProgress: ((nodeId: string) =>
    ipcRenderer.invoke("progress:get", nodeId)) as ApiExpose["getProgress"],
  updateProgress: ((nodeId: string, patch: any) =>
    ipcRenderer.invoke("progress:update", nodeId, patch)) as ApiExpose["updateProgress"],
  markNodeAttempted: ((nodeId: string) =>
    ipcRenderer.invoke("progress:markAttempted", nodeId)) as ApiExpose["markNodeAttempted"],

  /* 练习题 */
  generateExercise: ((nodeId: string, type?: ExerciseType, locale?: string | null) =>
    ipcRenderer.invoke("exercise:generate", nodeId, type, locale ?? null)) as ApiExpose["generateExercise"],
  listExercises: ((nodeId: string) =>
    ipcRenderer.invoke("exercise:list", nodeId)) as ApiExpose["listExercises"],
  submitExerciseAnswer: ((exerciseId: string, userAnswer: string) =>
    ipcRenderer.invoke("exercise:submit", exerciseId, userAnswer)) as ApiExpose["submitExerciseAnswer"],

  /* 章节考试 v2（后台生成 + KC 出题 + attempt 档案） */
  examPrepare: ((examNodeId: string, locale?: string | null) =>
    ipcRenderer.invoke("exam:prepare", examNodeId, locale ?? null)) as ApiExpose["examPrepare"],
  examGetStatus: ((examNodeId: string) =>
    ipcRenderer.invoke("exam:getStatus", examNodeId)) as ApiExpose["examGetStatus"],
  examStartAttempt: ((examNodeId: string) =>
    ipcRenderer.invoke("exam:startAttempt", examNodeId)) as ApiExpose["examStartAttempt"],
  examRecordAnswer: ((examNodeId: string, attemptId: string, exerciseId: string, answer: string) =>
    ipcRenderer.invoke("exam:recordAnswer", examNodeId, attemptId, exerciseId, answer)) as ApiExpose["examRecordAnswer"],
  examSubmitAttempt: ((
    examNodeId: string,
    attemptId: string,
    answers: Record<string, string>,
    opts?: { terminated?: boolean },
  ) =>
    ipcRenderer.invoke("exam:submitAttempt", examNodeId, attemptId, answers, opts)) as ApiExpose["examSubmitAttempt"],

  /* SRS */
  getDueReviews: (() => ipcRenderer.invoke("srs:getDue")) as ApiExpose["getDueReviews"],
  getAllSrsItems: (() => ipcRenderer.invoke("srs:getAll")) as ApiExpose["getAllSrsItems"],
  recordReview: ((nodeId: string, quality: ReviewQuality) =>
    ipcRenderer.invoke("srs:record", nodeId, quality)) as ApiExpose["recordReview"],

  /* 打卡 */
  getStreak: (() => ipcRenderer.invoke("streak:get")) as ApiExpose["getStreak"],
  touchStreakToday: (() =>
    ipcRenderer.invoke("streak:touchToday")) as ApiExpose["touchStreakToday"],

  /* Soul 系统（教学人设/persona） */
  listSouls: (() => ipcRenderer.invoke("soul:list")) as ApiExpose["listSouls"],
  getSoul: ((name: string) =>
    ipcRenderer.invoke("soul:get", name)) as ApiExpose["getSoul"],
  createSoul: ((input: any) =>
    ipcRenderer.invoke("soul:create", input)) as ApiExpose["createSoul"],
  setActiveSoul: ((name: string) =>
    ipcRenderer.invoke("soul:setActive", name)) as ApiExpose["setActiveSoul"],
  getActiveSoul: (() =>
    ipcRenderer.invoke("soul:getActive")) as ApiExpose["getActiveSoul"],

  /* Agent 引擎 + Proposal（M2） */
  agentChat: ((nodeId: string, msg: string, locale?: string | null) =>
    ipcRenderer.invoke("agent:chat", nodeId, msg, locale ?? null)) as ApiExpose["agentChat"],
  abortAgentChat: ((nodeId: string) =>
    ipcRenderer.invoke("agent:abort", nodeId)) as ApiExpose["abortAgentChat"],
  getChatHistory: ((nodeId: string) =>
    ipcRenderer.invoke("agent:getHistory", nodeId)) as ApiExpose["getChatHistory"],
  clearChatHistory: ((nodeId: string) =>
    ipcRenderer.invoke("agent:clearHistory", nodeId)) as ApiExpose["clearChatHistory"],
  agentChatThread: ((threadId: string, msg: string, displayText?: string | null, locale?: string | null) =>
    ipcRenderer.invoke("agent:chatThread", threadId, msg, displayText ?? null, locale ?? null)) as ApiExpose["agentChatThread"],
  abortAgentChatThread: ((threadId: string) =>
    ipcRenderer.invoke("agent:abortThread", threadId)) as ApiExpose["abortAgentChatThread"],
  isAgentReady: (() =>
    ipcRenderer.invoke("agent:isReady")) as ApiExpose["isAgentReady"],
  getProviderPresets: (() =>
    ipcRenderer.invoke("agent:getProviderPresets")) as ApiExpose["getProviderPresets"],
  testLlmConnection: (() =>
    ipcRenderer.invoke("agent:testConnection")) as ApiExpose["testLlmConnection"],
  testCustomProvider: ((input: CustomProviderInput) =>
    ipcRenderer.invoke("agent:testCustomProvider", input)) as ApiExpose["testCustomProvider"],
  discoverModels: (() =>
    ipcRenderer.invoke("agent:discoverModels")) as ApiExpose["discoverModels"],
  discoverProviderModels: ((baseUrl: string, apiKey: string) =>
    ipcRenderer.invoke("agent:discoverProviderModels", baseUrl, apiKey)) as ApiExpose["discoverProviderModels"],
  listCustomProviders: (() =>
    ipcRenderer.invoke("customProvider:list")) as ApiExpose["listCustomProviders"],
  createCustomProvider: ((input: CustomProviderInput) =>
    ipcRenderer.invoke("customProvider:create", input)) as ApiExpose["createCustomProvider"],
  updateCustomProvider: ((id: string, input: Partial<CustomProviderInput>) =>
    ipcRenderer.invoke("customProvider:update", id, input)) as ApiExpose["updateCustomProvider"],
  deleteCustomProvider: ((id: string) =>
    ipcRenderer.invoke("customProvider:delete", id)) as ApiExpose["deleteCustomProvider"],
  listPendingProposals: (() =>
    ipcRenderer.invoke("proposal:listPending")) as ApiExpose["listPendingProposals"],
  applyProposal: ((id: string) =>
    ipcRenderer.invoke("proposal:apply", id)) as ApiExpose["applyProposal"],
  rejectProposal: ((id: string) =>
    ipcRenderer.invoke("proposal:reject", id)) as ApiExpose["rejectProposal"],
  recordQuizAnswer: ((nodeId: string, correct: boolean, kc?: string) =>
    ipcRenderer.invoke("quiz:recordAnswer", nodeId, correct, kc)) as ApiExpose["recordQuizAnswer"],
  logFriction: ((nodeId: string | null, category: HumanFrictionCategory, summary: string | null) =>
    ipcRenderer.invoke("friction:log", nodeId, category, summary)) as ApiExpose["logFriction"],

  /* 仪表盘 + 检索 + 记忆（M3） */
  getDashboard: ((courseId: string) =>
    ipcRenderer.invoke("dashboard:get", courseId)) as ApiExpose["getDashboard"],
  searchContent: ((query: string) =>
    ipcRenderer.invoke("search:content", query)) as ApiExpose["searchContent"],
  updateMemory: ((input: any) =>
    ipcRenderer.invoke("memory:update", input)) as ApiExpose["updateMemory"],
  getMemory: ((nodeId: string | null, category?: any) =>
    ipcRenderer.invoke("memory:get", nodeId, category)) as ApiExpose["getMemory"],
  consolidateMemory: ((courseId: string) =>
    ipcRenderer.invoke("consolidate:run", courseId)) as ApiExpose["consolidateMemory"],

  /* 设置 */
  getSetting: ((key: SettingKey) =>
    ipcRenderer.invoke("settings:get", key)) as ApiExpose["getSetting"],
  setSetting: ((key: SettingKey, value: string) =>
    ipcRenderer.invoke("settings:set", key, value)) as ApiExpose["setSetting"],
  getXpStatus: (() =>
    ipcRenderer.invoke("xp:getStatus")) as ApiExpose["getXpStatus"],
  exportCourse: ((courseId: string, format: "json" | "markdown") =>
    ipcRenderer.invoke("course:export", courseId, format)) as ApiExpose["exportCourse"],

  /* v0.3: Canvas 画布(康奈尔式笔记本) */
  canvasList: ((courseId: string, nodeId?: string | null, zone?: CanvasZone) =>
    ipcRenderer.invoke("canvas:list", courseId, nodeId, zone)) as ApiExpose["canvasList"],
  canvasSave: ((input) =>
    ipcRenderer.invoke("canvas:save", input)) as ApiExpose["canvasSave"],
  canvasDelete: ((id: string) =>
    ipcRenderer.invoke("canvas:delete", id)) as ApiExpose["canvasDelete"],
  canvasTogglePin: ((id: string) =>
    ipcRenderer.invoke("canvas:togglePin", id)) as ApiExpose["canvasTogglePin"],
  /** 用户画线加笔记(user_note),带溯源(content/chat)。comment 为可选初始注释 */
  canvasSaveUserNote: ((input: {
    nodeId: string;
    courseId: string;
    text: string;
    sourceType: "content" | "chat";
    sourceAnchor: NoteSourceAnchor;
    comment?: string;
  }) =>
    ipcRenderer.invoke("canvas:saveUserNote", input)) as ApiExpose["canvasSaveUserNote"],
  /** quiz 重做后更新 last_result(只保留最近一次) */
  canvasRecordQuizResult: ((id: string, correct: boolean) =>
    ipcRenderer.invoke("canvas:recordQuizResult", id, correct)) as ApiExpose["canvasRecordQuizResult"],
  /** 更新 user_note 的用户注释(空串=删除) */
  canvasUpdateUserNoteComment: ((id: string, comment: string) =>
    ipcRenderer.invoke("canvas:updateUserNoteComment", id, comment)) as ApiExpose["canvasUpdateUserNoteComment"],

  /* v0.4: Thread 会话 */
  threadList: ((courseId: string, status?: "active" | "archived") =>
    ipcRenderer.invoke("thread:list", courseId, status)) as ApiExpose["threadList"],
  threadCreate: ((input) =>
    ipcRenderer.invoke("thread:create", input)) as ApiExpose["threadCreate"],
  threadUpdate: ((id: string, patch) =>
    ipcRenderer.invoke("thread:update", id, patch)) as ApiExpose["threadUpdate"],
  threadDelete: ((id: string) =>
    ipcRenderer.invoke("thread:delete", id)) as ApiExpose["threadDelete"],
  threadGetMessages: ((threadId: string) =>
    ipcRenderer.invoke("thread:getMessages", threadId)) as ApiExpose["threadGetMessages"],
  threadFindRecentByNode: ((courseId: string, nodeId: string) =>
    ipcRenderer.invoke("thread:findRecentByNode", courseId, nodeId)) as ApiExpose["threadFindRecentByNode"],

  /* 事件监听（main → renderer 推送） */
  on: ((channel: keyof IpcEvents, listener: (...args: any[]) => void) => {
    const wrapped = (_e: IpcRendererEvent, ...args: any[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }) as (channel: keyof IpcEvents, listener: (...args: any[]) => void) => () => void,
} satisfies ApiExpose & {
  on: (channel: keyof IpcEvents, listener: (...args: any[]) => void) => () => void;
};

export type LookatStudyApi = typeof api;

contextBridge.exposeInMainWorld("api", api);
