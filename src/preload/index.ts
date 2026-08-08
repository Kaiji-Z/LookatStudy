/**
 * Electron preload —— 桥接主进程的 IPC 到渲染层。
 *
 * 通过 contextBridge 暴露受限的 api 对象到 window。
 * 渲染层通过 window.api.* 调用，无法直接访问 Node API。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ApiExpose, IpcEvents, ReviewQuality, SettingKey, ExerciseType, CustomProviderInput } from "@shared/types";

const api = {
  /* 课程 */
  listCourses: (() => ipcRenderer.invoke("course:list")) as ApiExpose["listCourses"],
  getCourseTree: ((courseId: string) =>
    ipcRenderer.invoke("course:getTree", courseId)) as ApiExpose["getCourseTree"],
  importCourseFromRepo: ((repoUrl: string) =>
    ipcRenderer.invoke("course:importFromRepo", repoUrl)) as ApiExpose["importCourseFromRepo"],
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
  getNodeContent: ((nodeId: string) =>
    ipcRenderer.invoke("course:getNodeContent", nodeId)) as ApiExpose["getNodeContent"],

  /* 进度 */
  getProgress: ((nodeId: string) =>
    ipcRenderer.invoke("progress:get", nodeId)) as ApiExpose["getProgress"],
  updateProgress: ((nodeId: string, patch: any) =>
    ipcRenderer.invoke("progress:update", nodeId, patch)) as ApiExpose["updateProgress"],
  markNodeAttempted: ((nodeId: string) =>
    ipcRenderer.invoke("progress:markAttempted", nodeId)) as ApiExpose["markNodeAttempted"],

  /* 练习题 */
  generateExercise: ((nodeId: string, type?: ExerciseType) =>
    ipcRenderer.invoke("exercise:generate", nodeId, type)) as ApiExpose["generateExercise"],
  listExercises: ((nodeId: string) =>
    ipcRenderer.invoke("exercise:list", nodeId)) as ApiExpose["listExercises"],
  submitExerciseAnswer: ((exerciseId: string, userAnswer: string) =>
    ipcRenderer.invoke("exercise:submit", exerciseId, userAnswer)) as ApiExpose["submitExerciseAnswer"],

  /* 章节考试（关底 boss） */
  examStart: ((examNodeId: string) =>
    ipcRenderer.invoke("exam:start", examNodeId)) as ApiExpose["examStart"],
  examSubmit: ((examNodeId: string, answers: Record<string, string>) =>
    ipcRenderer.invoke("exam:submit", examNodeId, answers)) as ApiExpose["examSubmit"],

  /* SRS */
  getDueReviews: (() => ipcRenderer.invoke("srs:getDue")) as ApiExpose["getDueReviews"],
  getAllSrsItems: (() => ipcRenderer.invoke("srs:getAll")) as ApiExpose["getAllSrsItems"],
  recordReview: ((nodeId: string, quality: ReviewQuality) =>
    ipcRenderer.invoke("srs:record", nodeId, quality)) as ApiExpose["recordReview"],

  /* 打卡 */
  getStreak: (() => ipcRenderer.invoke("streak:get")) as ApiExpose["getStreak"],
  touchStreakToday: (() =>
    ipcRenderer.invoke("streak:touchToday")) as ApiExpose["touchStreakToday"],

  /* Skill 系统（M1） */
  listSkills: (() => ipcRenderer.invoke("skill:list")) as ApiExpose["listSkills"],
  getSkill: ((name: string) =>
    ipcRenderer.invoke("skill:get", name)) as ApiExpose["getSkill"],
  createSkill: ((input: any) =>
    ipcRenderer.invoke("skill:create", input)) as ApiExpose["createSkill"],
  setActiveSkill: ((name: string) =>
    ipcRenderer.invoke("skill:setActive", name)) as ApiExpose["setActiveSkill"],
  getActiveSkill: (() =>
    ipcRenderer.invoke("skill:getActive")) as ApiExpose["getActiveSkill"],

  /* Agent 引擎 + Proposal（M2） */
  agentChat: ((nodeId: string, msg: string) =>
    ipcRenderer.invoke("agent:chat", nodeId, msg)) as ApiExpose["agentChat"],
  abortAgentChat: ((nodeId: string) =>
    ipcRenderer.invoke("agent:abort", nodeId)) as ApiExpose["abortAgentChat"],
  getChatHistory: ((nodeId: string) =>
    ipcRenderer.invoke("agent:getHistory", nodeId)) as ApiExpose["getChatHistory"],
  clearChatHistory: ((nodeId: string) =>
    ipcRenderer.invoke("agent:clearHistory", nodeId)) as ApiExpose["clearChatHistory"],
  agentChatThread: ((threadId: string, msg: string) =>
    ipcRenderer.invoke("agent:chatThread", threadId, msg)) as ApiExpose["agentChatThread"],
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

  /* 仪表盘 + 检索 + 记忆（M3） */
  getDashboard: ((courseId: string) =>
    ipcRenderer.invoke("dashboard:get", courseId)) as ApiExpose["getDashboard"],
  searchContent: ((query: string) =>
    ipcRenderer.invoke("search:content", query)) as ApiExpose["searchContent"],
  updateMemory: ((input: any) =>
    ipcRenderer.invoke("memory:update", input)) as ApiExpose["updateMemory"],
  getMemory: ((nodeId: string | null, category?: any) =>
    ipcRenderer.invoke("memory:get", nodeId, category)) as ApiExpose["getMemory"],

  /* 设置 */
  getSetting: ((key: SettingKey) =>
    ipcRenderer.invoke("settings:get", key)) as ApiExpose["getSetting"],
  setSetting: ((key: SettingKey, value: string) =>
    ipcRenderer.invoke("settings:set", key, value)) as ApiExpose["setSetting"],
  getXpStatus: (() =>
    ipcRenderer.invoke("xp:getStatus")) as ApiExpose["getXpStatus"],
  exportCourse: ((courseId: string, format: "json" | "markdown") =>
    ipcRenderer.invoke("course:export", courseId, format)) as ApiExpose["exportCourse"],

  /* v0.3: Canvas 画布 */
  canvasList: ((courseId: string, nodeId?: string | null) =>
    ipcRenderer.invoke("canvas:list", courseId, nodeId)) as ApiExpose["canvasList"],
  canvasSave: ((input) =>
    ipcRenderer.invoke("canvas:save", input)) as ApiExpose["canvasSave"],
  canvasDelete: ((id: string) =>
    ipcRenderer.invoke("canvas:delete", id)) as ApiExpose["canvasDelete"],
  canvasTogglePin: ((id: string) =>
    ipcRenderer.invoke("canvas:togglePin", id)) as ApiExpose["canvasTogglePin"],

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
