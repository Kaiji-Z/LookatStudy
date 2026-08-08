/**
 * Exam Service —— 章节考试(关底 boss)。
 *
 * 每个考试节点(type=exam, parentId=sectionId)代表一章的综合测验。
 * 题目复用 exercises 表(node_id = 考试节点 id),题型固定 mcq(四选一)。
 *
 * 与 exercise-service 的区别:
 *   - exercise-service:单课单题,走 BKT mastery Proposal
 *   - exam-service:整章 N 题,正确率分档给 1-3 星(progress.crownLevel),
 *     不走 BKT、不解锁下一章(考试完全独立,可选支线)
 *
 * 设计决策(见 plan):
 *   - 自动生成:course-generator 给每个 section 末尾插 exam 节点
 *   - 不限时
 *   - 完全独立:不影响章节解锁
 *   - 星数:正确率 ≥60% → 1星, ≥80% → 2星, ≥95% → 3星
 *   - 可重考:星数取最高
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { contentNodes, exercises as exercisesTable, progress as progressTable } from "../db/schema.js";
import type { Exercise } from "@shared/types";
import { generateText } from "ai";
import { resolveLlm } from "./agent/llm-client.js";
import { gradeAnswer } from "./exercise-service.js";
import { randomUUID } from "node:crypto";

type Db = SQLJsDatabase<typeof schema>;

/** 每场考试的题目数 */
const EXAM_QUESTION_COUNT = 8;
/** 星数分档阈值(正确率) */
const ONE_STAR_THRESHOLD = 0.6;
const TWO_STAR_THRESHOLD = 0.8;
const THREE_STAR_THRESHOLD = 0.95;

/** 生成锁:写入 examNode.content 字段防 StrictMode 双调用双重生题。
 *  格式 `__exam_generating:<ISO>__`,2 分钟过期(防进程崩溃留死锁)。 */
const LOCK_PREFIX = "__exam_generating:";
const LOCK_TTL_MS = 2 * 60 * 1000;
const LOCK_POLL_MS = 400;
const LOCK_WAIT_MAX_MS = 40 * 1000;

/** 读 examNode.content 判断锁状态:返回 null(无锁/已生题) 或 锁的 ISO 时间。 */
function readLock(content: string | null): string | null {
  if (!content || !content.startsWith(LOCK_PREFIX)) return null;
  return content.slice(LOCK_PREFIX.length, -2); // 去掉结尾 __
}

/** 写锁(覆盖 content 字段)。sql.js 同步写,StrictMode 第二次调用立即可见。 */
function writeLock(db: Db, examNodeId: string): void {
  const lockValue = `${LOCK_PREFIX}${new Date().toISOString()}__`;
  db.update(contentNodes)
    .set({ content: lockValue })
    .where(eq(contentNodes.id, examNodeId))
    .run();
}

/** 清锁(还原 content 为 null)。题目已插入或生成失败都清,防死锁。 */
function clearLock(db: Db, examNodeId: string): void {
  db.update(contentNodes)
    .set({ content: null })
    .where(eq(contentNodes.id, examNodeId))
    .run();
}

/** 等待别人的锁释放(轮询)。锁 stale(>TTL)则抢锁返回 false(调用方继续生成)。
 *  返回 true = 等到了(题目应该已由对方生成,调用方应直接读);false = 抢到锁,该自己生成。 */
async function waitForLockOrTake(db: Db, examNodeId: string): Promise<boolean> {
  const deadline = Date.now() + LOCK_WAIT_MAX_MS;
  while (Date.now() < deadline) {
    const node = db.select().from(contentNodes).where(eq(contentNodes.id, examNodeId)).get();
    const lockIso = readLock(node?.content ?? null);
    if (!lockIso) return false; // 无锁,该自己生成
    const lockAge = Date.now() - new Date(lockIso).getTime();
    if (lockAge > LOCK_TTL_MS) {
      // 锁 stale,抢锁
      writeLock(db, examNodeId);
      return false;
    }
    // 别人在生成,等。期间题目可能已被对方插入 → 检查一下
    if (listExamExercises(db, examNodeId).length > 0) {
      return true; // 对方已完成,题目已就绪
    }
    await sleep(LOCK_POLL_MS);
  }
  throw new Error("考试题目生成等待超时(另一并发请求卡住)");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ExamStartResult {
  exercises: Exercise[];
}

export interface ExamSubmitResult {
  correctCount: number;
  totalCount: number;
  accuracy: number;
  stars: number; // 0-3(0=未达 60%,1/2/3 星)
  bestStars: number; // 历史最高星数(含本次)
  perQuestion: {
    exerciseId: string;
    correct: boolean;
    userAnswer: string;
    correctAnswer: string;
    explanation: string | null;
  }[];
}

/**
 * 开始/继续考试:已生成过题目则直接返回(支持刷新/重进),否则调 LLM 生成。
 * 上下文 = 同章节所有 lesson 的 title + content 摘要(整章范围,非单课)。
 */
export async function startExam(db: Db, examNodeId: string): Promise<ExamStartResult> {
  const examNode = db.select().from(contentNodes).where(eq(contentNodes.id, examNodeId)).get();
  if (!examNode) throw new Error(`考试节点不存在: ${examNodeId}`);

  // 幂等:已生成过题目则直接返回(刷新/重进不重新出题)
  const existing = listExamExercises(db, examNodeId);
  if (existing.length > 0) return { exercises: existing };

  // 生成锁:防 StrictMode 双调用并发双重生题(两次都在对方插入前读到 0 题)。
  // waitForLockOrTake:有锁等对方完成 → 返回 true(题目已就绪);无锁/锁 stale → 抢锁返回 false。
  const waitedForOther = await waitForLockOrTake(db, examNodeId);
  if (waitedForOther) {
    // 对方已生成,直接读
    const ready = listExamExercises(db, examNodeId);
    if (ready.length > 0) return { exercises: ready };
    // 罕见:对方清了锁但没插入(出错?)→ 自己重新走生成流程
  } else {
    // 抢到锁,再查一次(防 race:等待期间对方已完成)
    const ready = listExamExercises(db, examNodeId);
    if (ready.length > 0) {
      clearLock(db, examNodeId);
      return { exercises: ready };
    }
    writeLock(db, examNodeId);
  }

  // 拼合同章节所有 lesson 作为出题上下文
  const sectionId = examNode.parentId;
  const siblingLessons = sectionId
    ? db.select().from(contentNodes).all().filter(
        (n) => n.parentId === sectionId && n.type === "lesson",
      )
    : [];
  if (siblingLessons.length === 0) {
    clearLock(db, examNodeId); // 清锁防死锁
    throw new Error("本章没有课时,无法生成考试题");
  }

  const chapterContext = siblingLessons
    .map((l, i) => `### ${i + 1}. ${l.title}\n${(l.content ?? "").slice(0, 800)}`)
    .join("\n\n");

  const llm = resolveLlm(db);
  const prompt = buildExamPrompt(examNode.title, chapterContext, EXAM_QUESTION_COUNT);

  let created: Exercise[] = [];
  try {
    const result = await generateText({ model: llm.languageModel, prompt });
    const raw = result.text.trim();
    const parsed = parseExamJson(raw, EXAM_QUESTION_COUNT);
    if (!parsed.ok) throw new Error(`考试出题格式错误: ${parsed.error}`);

    // 存 exercises 表(node_id = 考试节点 id)
    for (const q of parsed.questions) {
      const id = randomUUID();
      db.insert(exercisesTable)
        .values({
          id,
          nodeId: examNodeId,
          type: "mcq",
          prompt: q.prompt,
          answer: q.answer,
          explanation: q.explanation ?? null,
          optionsJson: JSON.stringify(q.options),
          aiGenerated: true,
        })
        .run();
      created.push({
        id,
        nodeId: examNodeId,
        type: "mcq",
        prompt: q.prompt,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation ?? null,
        aiGenerated: true,
        createdAt: new Date().toISOString(),
      });
    }
  } catch (e) {
    clearLock(db, examNodeId); // 出错清锁,防下次卡死
    throw e;
  } finally {
    clearLock(db, examNodeId);
  }

  return { exercises: created };
}

/** 列出某考试节点的所有题目(按创建顺序)。 */
export function listExamExercises(db: Db, examNodeId: string): Exercise[] {
  const rows = db
    .select()
    .from(exercisesTable)
    .where(eq(exercisesTable.nodeId, examNodeId))
    .all();
  return rows.map((row) => ({
    id: row.id,
    nodeId: row.nodeId,
    type: row.type as Exercise["type"],
    prompt: row.prompt,
    options: row.optionsJson ? (JSON.parse(row.optionsJson) as string[]) : null,
    answer: row.answer,
    explanation: row.explanation,
    aiGenerated: row.aiGenerated,
    createdAt: row.createdAt,
  }));
}

/**
 * 提交考试:逐题判分,算正确率,给星数(取最高),写 progress.crownLevel。
 * 不走 BKT、不解锁下一章(考试完全独立)。
 */
export function submitExam(
  db: Db,
  examNodeId: string,
  answers: Record<string, string>,
): ExamSubmitResult {
  const examExercises = listExamExercises(db, examNodeId);
  if (examExercises.length === 0) {
    throw new Error("考试题目尚未生成");
  }

  let correctCount = 0;
  const perQuestion: ExamSubmitResult["perQuestion"] = [];

  for (const ex of examExercises) {
    const userAnswer = answers[ex.id] ?? "";
    const optionsJson = ex.options ? JSON.stringify(ex.options) : null;
    const correct = gradeAnswer(ex.type, ex.answer, userAnswer, optionsJson);
    if (correct) correctCount++;
    perQuestion.push({
      exerciseId: ex.id,
      correct,
      userAnswer,
      correctAnswer: ex.answer,
      explanation: ex.explanation,
    });
  }

  const totalCount = examExercises.length;
  const accuracy = correctCount / totalCount;
  const stars = accuracyToStars(accuracy);

  // 写 progress.crownLevel(星数取最高:重考不降星)
  const existing = db.select().from(progressTable).where(eq(progressTable.nodeId, examNodeId)).get();
  const prevStars = existing?.crownLevel ?? 0;
  const bestStars = Math.max(prevStars, stars);

  if (existing) {
    db.update(progressTable)
      .set({ crownLevel: bestStars, lastAttemptAt: new Date().toISOString() })
      .where(eq(progressTable.nodeId, examNodeId))
      .run();
  } else {
    db.insert(progressTable)
      .values({
        nodeId: examNodeId,
        status: "available",
        crownLevel: bestStars,
        lastAttemptAt: new Date().toISOString(),
      })
      .run();
  }

  return { correctCount, totalCount, accuracy, stars, bestStars, perQuestion };
}

/** 正确率 → 星数(1-3)。低于 60% 得 0 星(但会记录尝试)。 */
export function accuracyToStars(accuracy: number): number {
  if (accuracy >= THREE_STAR_THRESHOLD) return 3;
  if (accuracy >= TWO_STAR_THRESHOLD) return 2;
  if (accuracy >= ONE_STAR_THRESHOLD) return 1;
  return 0;
}

/* ---------- 出题 prompt + 解析(整章范围 N 题) ---------- */

function buildExamPrompt(examTitle: string, chapterContext: string, count: number): string {
  return [
    `你是 LookatStudy 的章节考试出题官。基于下面整章的学习内容,出 ${count} 道四选一选择题,作为本章的关底考试。`,
    ``,
    `考试标题:${examTitle}`,
    ``,
    `本章内容:`,
    chapterContext.slice(0, 6000),
    ``,
    `出题要求:`,
    `- 覆盖本章的多个知识点(不要集中在某一课),考察整章的理解`,
    `- 题干考"理解"和"应用",不要出死记硬背的定义题`,
    `- 干扰项 plausible 但 definitely wrong(基于学习者常犯的真实误解)`,
    `- 答案必须在提供的学习内容中有依据`,
    `- 题干和选项用中文,清晰无歧义`,
    ``,
    `严格按以下 JSON 格式返回,不要加 markdown 代码块标记、不要解释:`,
    `{`,
    `  "questions": [`,
    `    {`,
    `      "prompt": "题干(不含选项)",`,
    `      "options": ["选项A", "选项B", "选项C", "选项D"],`,
    `      "answer": "0",`,
    `      "explanation": "为什么是这个答案 + 其他选项为什么错(2-3句)"`,
    `    }`,
    `  ]`,
    `}`,
  ].join("\n");
}

interface ParsedExamQuestion {
  prompt: string;
  options: string[];
  answer: string;
  explanation?: string;
}

function parseExamJson(
  raw: string,
  expectedCount: number,
): { ok: true; questions: ParsedExamQuestion[] } | { ok: false; error: string } {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}` };
  }
  const arr = Array.isArray(obj.questions) ? (obj.questions as Record<string, unknown>[]) : null;
  if (!arr || arr.length === 0) {
    return { ok: false, error: "缺少 questions 数组" };
  }
  const questions: ParsedExamQuestion[] = [];
  for (let i = 0; i < arr.length && i < expectedCount; i++) {
    const q = arr[i]!;
    const prompt = typeof q.prompt === "string" ? q.prompt : "";
    const answer = typeof q.answer === "string" ? q.answer : "";
    const options = Array.isArray(q.options) ? (q.options as string[]) : null;
    const explanation = typeof q.explanation === "string" ? q.explanation : undefined;
    if (!prompt || !answer || !options || options.length < 2) {
      return { ok: false, error: `第 ${i + 1} 题格式不完整(需 prompt/options/answer)` };
    }
    questions.push({ prompt, options, answer, explanation });
  }
  if (questions.length < Math.min(3, expectedCount)) {
    return { ok: false, error: `题目数不足(解析出 ${questions.length} 题)` };
  }
  return { ok: true, questions };
}
