/**
 * 考试生成状态存储 —— main 进程内存态 + promise 去重 + renderer 进度推送。
 *
 * 为什么内存态而不是 DB:单窗口单 main 进程,并发生成只可能来自同一进程的
 * 重复 IPC 调用(StrictMode 双调用/用户连点),模块级 Map + 共享 promise 即互斥。
 * 旧实现把锁写进 content_nodes.content 列(hack,还要备份还原),已删。
 *
 * ready 的真值在 DB(exercises 表有题 = 就绪):app 重启后 store 为空,
 * getStatus 由 exam-service 查 DB 兜底。store 只跟踪"活着的生成过程"。
 *
 * 测试友好:sender 默认 noop(setExamStatusSender 注入真实 IPC 发送)。
 */
import type { ExamGenStatus, ExamStatus } from "@shared/types";

type Sender = (payload: ExamStatus) => void;
let sender: Sender = () => {};

/** main 启动时注入真实 sender(webContents.send("exam:status", ...))。 */
export function setExamStatusSender(fn: Sender): void {
  sender = fn;
}

interface Entry {
  status: Exclude<ExamGenStatus, "idle" | "ready"> | "ready";
  done: number;
  total: number;
  error: string | null;
  /** 进行中的生成 promise(去重:并发 prepare 共享同一次生成) */
  promise: Promise<void> | null;
}

const entries = new Map<string, Entry>();

function emit(nodeId: string): void {
  const e = entries.get(nodeId);
  if (!e) return;
  sender({
    nodeId,
    status: e.status,
    done: e.done,
    total: e.total,
    error: e.error,
  });
}

export function setGenerating(nodeId: string, total: number): void {
  entries.set(nodeId, { status: "generating", done: 0, total, error: null, promise: null });
  emit(nodeId);
}

export function setProgress(nodeId: string, done: number): void {
  const e = entries.get(nodeId);
  if (!e) return;
  e.done = done;
  emit(nodeId);
}

export function setReady(nodeId: string): void {
  const e = entries.get(nodeId);
  if (e) {
    e.status = "ready";
    e.error = null;
    e.done = e.total;
    e.promise = null;
    emit(nodeId);
  }
}

export function setFailed(nodeId: string, error: string): void {
  const e = entries.get(nodeId);
  if (e) {
    e.status = "failed";
    e.error = error;
    e.promise = null;
    emit(nodeId);
  }
}

/** 当前内存态(无条目 = null:可能 idle,也可能 DB 里早已 ready——由调用方查 DB 判定)。 */
export function peek(
  nodeId: string,
): { status: ExamGenStatus; done: number; total: number; error: string | null } | null {
  const e = entries.get(nodeId);
  return e ? { status: e.status, done: e.done, total: e.total, error: e.error } : null;
}

/** 取进行中的生成 promise(去重用)。 */
export function getPromise(nodeId: string): Promise<void> | null {
  return entries.get(nodeId)?.promise ?? null;
}

export function setPromise(nodeId: string, p: Promise<void>): void {
  const e = entries.get(nodeId);
  if (e) e.promise = p;
}

/** 测试用:清空全部状态。 */
export function resetStoreForTest(): void {
  entries.clear();
}
