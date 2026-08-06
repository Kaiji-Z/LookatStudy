/**
 * Electron preload —— 桥接主进程的 IPC 到渲染层。
 *
 * 通过 contextBridge 暴露受限的 api 对象到 window。
 * 渲染层通过 window.api.* 调用，无法直接访问 Node API。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ApiExpose, IpcEvents, ReviewQuality, SettingKey } from "@shared/types";

const api = {
  /* 课程 */
  listCourses: (() => ipcRenderer.invoke("course:list")) as ApiExpose["listCourses"],
  getCourseTree: ((courseId: string) =>
    ipcRenderer.invoke("course:getTree", courseId)) as ApiExpose["getCourseTree"],
  importCourseFromRepo: ((repoUrl: string) =>
    ipcRenderer.invoke("course:importFromRepo", repoUrl)) as ApiExpose["importCourseFromRepo"],
  generateCourseFromMarkdown: ((md: string, repoName: string, repoUrl?: string) =>
    ipcRenderer.invoke("course:generateFromMarkdown", md, repoName, repoUrl)) as ApiExpose["generateCourseFromMarkdown"],

  /* 进度 */
  getProgress: ((nodeId: string) =>
    ipcRenderer.invoke("progress:get", nodeId)) as ApiExpose["getProgress"],
  updateProgress: ((nodeId: string, patch: any) =>
    ipcRenderer.invoke("progress:update", nodeId, patch)) as ApiExpose["updateProgress"],
  markNodeAttempted: ((nodeId: string) =>
    ipcRenderer.invoke("progress:markAttempted", nodeId)) as ApiExpose["markNodeAttempted"],

  /* SRS */
  getDueReviews: (() => ipcRenderer.invoke("srs:getDue")) as ApiExpose["getDueReviews"],
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
  isAgentReady: (() =>
    ipcRenderer.invoke("agent:isReady")) as ApiExpose["isAgentReady"],
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
