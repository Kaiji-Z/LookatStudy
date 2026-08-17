/**
 * quiz-progress —— 答题卡进度的跨挂载持久化(localStorage)。
 *
 * #2 手机端"判分结果偶尔不同步进对话"根因:T3 切栏会卸载聊天面板,
 * QuizArtifact 的作答状态全在组件本地 state,切回来卡片回退成未作答。
 * 以题目内容哈希为键存 { current, score },重新挂载时恢复。
 *
 * 键语义:同一组题(题干+选项+答案序列)共享进度 —— "重练"生成新题即新键;
 * 副作用(recordQuizAnswer/庆祝)只挂在提交点击上,恢复不重放。
 */

export interface QuizProgress {
  /** 当前题下标(== questions.length 表示整卡已完成) */
  current: number;
  score: { correct: number; total: number };
}

interface QuizLike {
  questions: { prompt: string; options?: string[]; answer?: number }[];
}

const PREFIX = "ls-quiz-progress:";

/** 内容哈希键:FNV-1a(题干+选项+答案拼接)。不追求加密,只求稳定与区分度。 */
export function quizProgressKey(data: QuizLike): string {
  const src = data.questions
    .map((q) => `${q.prompt}|${(q.options ?? []).join("/")}#${q.answer ?? ""}`)
    .join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${PREFIX}${(h >>> 0).toString(36)}`;
}

export function loadQuizProgress(key: string): QuizProgress | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as QuizProgress;
    if (
      typeof p?.current === "number" && p.current >= 0 &&
      typeof p?.score?.correct === "number" && typeof p?.score?.total === "number"
    ) {
      return p;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveQuizProgress(key: string, p: QuizProgress): void {
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    /* 隐私模式不可写:退化为会话内行为(与修复前一致,不更糟) */
  }
}
