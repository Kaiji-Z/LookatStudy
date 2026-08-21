/**
 * Exam Service v2 —— 章节考试(关底 boss):后台生成 + KC 出题 + attempt 档案。
 *
 * 每个考试节点(type=exam, parentId=sectionId)代表一章的综合测验。
 * 题目复用 exercises 表(node_id = 考试节点 id),题型固定 mcq(四选一),带 kc_title 标签。
 *
 * 生命周期:
 *   idle → generating(main 后台,分批出题真实进度) → ready ⇄ answering → result
 *                └→ failed(保留原因,可重试)
 *
 * 与 exercise-service 的区别:
 *   - exercise-service:单课单题,走 BKT mastery Proposal
 *   - exam-service:整章按知识点出题,正确率分档给 1-3 星(progress.crownLevel),
 *     不走 BKT、不解锁下一章(考试完全独立,可选支线;KC 分解纯展示不回写)
 *
 * attempt 档案(exam_attempts 表,第 20 张表):
 *   - 点"开始考试"建行;每答一题增量持久化 answers_json(崩溃安全)
 *   - 提交(正常/超时/中途离开 terminated)判分落库,切回节点可见历史结果
 *   - 悬挂 attempt(finished_at IS NULL,app 崩溃/强关遗留)在 getStatus 时
 *     自动按"未答=错"判死——与"离开即终止"规则一致
 *
 * 生成互斥:单窗口单 main 进程,exam-generation-store 的内存 Map + 共享 promise
 * 即互斥(旧版把锁写进 content_nodes.content 列的 hack 已删)。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import {
  contentNodes,
  exercises as exercisesTable,
  progress as progressTable,
  examAttempts,
} from "../db/schema.js";
import type {
  ExamGenStatus,
  ExamStatus,
  ExamStatusView,
  ExamQuestionView,
  ExamAttemptView,
  ExamPerQuestionResult,
  ExamSubmitResult,
} from "@shared/types";
import { planExamQuota } from "@shared/exam-logic";
import { generateText } from "ai";
import { resolveLlm } from "./agent/llm-client.js";
import { questionLanguageLine } from "@shared/locales";
import { resolveOutputLang } from "@shared/locales";
import { gradeAnswer } from "./exercise-service.js";
import { addXp } from "./xp-service.js";
import { emitStateChange } from "../lib/state-emitter.js";
import { getKnowledgePoints } from "./kc-service.js";
import {
  setGenerating,
  setProgress,
  setReady,
  setFailed,
  peek,
  getPromise,
  setPromise,
} from "./exam-generation-store.js";
import { randomUUID } from "node:crypto";

type Db = SQLJsDatabase<typeof schema>;

/** 星数分档阈值(正确率) */
const ONE_STAR_THRESHOLD = 0.6;
const TWO_STAR_THRESHOLD = 0.8;
const THREE_STAR_THRESHOLD = 0.95;
/** KC 分批出题:每批最多 KC 数(一批一次 LLM 调用,进度 = 完成批数/总批数) */
const KCS_PER_BATCH = 3;
/** 批失败重试次数 */
const BATCH_RETRY = 1;

/* ============================================================
 * 生成状态查询/启动
 * ============================================================ */

/**
 * 幂等启动题目生成:已就绪(DB 有题)→ ready;生成中 → 返回进行中状态;
 * 否则后台启动(不阻塞,进度走 exam:status 事件),立即返回 generating。
 */
/** locale: 界面语言(i18n)——用户偏好什么界面就偏好什么输出;null/缺省 = zh-CN。题库一次性生成,语言在生成时定格。 */
export function prepareExam(db: Db, examNodeId: string, locale?: string | null): ExamStatus {
  const node = db.select().from(contentNodes).where(eq(contentNodes.id, examNodeId)).get();
  if (!node) throw new Error(`考试节点不存在: ${examNodeId}`);

  // 幂等:题库已生成(含旧版 8 题考试)→ ready
  if (listExamQuestions(db, examNodeId).length > 0) {
    return { nodeId: examNodeId, status: "ready", done: 1, total: 1, error: null };
  }

  // 去重:生成中,共享同一次后台生成
  const inFlight = getPromise(examNodeId);
  if (inFlight) {
    const p = peek(examNodeId);
    return p
      ? { nodeId: examNodeId, ...p }
      : { nodeId: examNodeId, status: "generating", done: 0, total: 0, error: null };
  }

  // 启动后台生成。generateExamBank 的同步前缀(节点检查+KC 收集+setGenerating)
  // 在本函数返回前执行完,因此这里 peek 一定拿到 generating 态。
  const p = generateExamBank(db, examNodeId, locale);
  setPromise(examNodeId, p);
  const state = peek(examNodeId);
  return state
    ? { nodeId: examNodeId, ...state }
    : { nodeId: examNodeId, status: "generating", done: 0, total: 0, error: null };
}

/**
 * 重新生成题库:删旧题 + 重启后台生成。
 * - 在飞生成中 → no-op(共享同一次生成,不删题)
 * - 悬挂 attempt 先按"未答=错"判死(与"离开即终止"规则一致)
 * - attempt 档案与 progress.crownLevel(历史星数)保留——重新出题不否定历史成绩
 * - 旧题删除后,历史 attempt 的逐题回顾靠判分时快照的 prompt/options 自包含
 */
export function regenerateExam(db: Db, examNodeId: string, locale?: string | null): ExamStatus {
  const node = db.select().from(contentNodes).where(eq(contentNodes.id, examNodeId)).get();
  if (!node) throw new Error(`考试节点不存在: ${examNodeId}`);

  // 在飞生成 → 共享同一次生成,不做任何变更
  const inFlight = getPromise(examNodeId);
  if (inFlight) {
    const p = peek(examNodeId);
    return p
      ? { nodeId: examNodeId, ...p }
      : { nodeId: examNodeId, status: "generating", done: 0, total: 0, error: null };
  }

  // 悬挂 attempt 判死(未答=错,terminated)——旧题即将删除,不能留未结账的场次
  const dangling = latestUnfinishedAttempt(db, examNodeId);
  if (dangling) {
    gradeAndFinalize(db, examNodeId, dangling, safeParseRecord(dangling.answersJson), true);
  }

  db.delete(exercisesTable).where(eq(exercisesTable.nodeId, examNodeId)).run();

  // generateExamBank 的同步前缀里 setGenerating 会覆盖 store 旧条目(ready/failed 复位)
  const p = generateExamBank(db, examNodeId, locale);
  setPromise(examNodeId, p);
  const state = peek(examNodeId);
  return state
    ? { nodeId: examNodeId, ...state }
    : { nodeId: examNodeId, status: "generating", done: 0, total: 0, error: null };
}

/**
 * 查状态 + 就绪元信息 + 最新 attempt。
 * 悬挂 attempt(崩溃遗留)在此自动按"未答=错"判死。
 */
export function getExamStatusView(db: Db, examNodeId: string): ExamStatusView {
  const node = db.select().from(contentNodes).where(eq(contentNodes.id, examNodeId)).get();
  if (!node) throw new Error(`考试节点不存在: ${examNodeId}`);

  // 悬挂 attempt 解析:自动判死(未答=错,terminated)
  const dangling = latestUnfinishedAttempt(db, examNodeId);
  if (dangling) {
    gradeAndFinalize(db, examNodeId, dangling, safeParseRecord(dangling.answersJson), true);
  }

  const questions = listExamQuestions(db, examNodeId);
  const storeState = peek(examNodeId);

  // 状态裁决:进行中的生成 > DB 就绪 > 内存失败态 > idle
  let status: ExamGenStatus;
  if (storeState?.status === "generating") status = "generating";
  else if (questions.length > 0) status = "ready";
  else if (storeState?.status === "failed") status = "failed";
  else status = "idle";

  const kcCount = new Set(
    questions.map((q) => q.kcTitle).filter((t): t is string => !!t),
  ).size;

  const latestRow = latestAttemptRow(db, examNodeId);
  const attemptRows = db
    .select({ id: examAttempts.id })
    .from(examAttempts)
    .where(eq(examAttempts.examNodeId, examNodeId))
    .all();
  const progressRow = db
    .select()
    .from(progressTable)
    .where(eq(progressTable.nodeId, examNodeId))
    .get();

  return {
    nodeId: examNodeId,
    status,
    done: status === "generating" ? (storeState?.done ?? 0) : status === "ready" ? 1 : 0,
    total: status === "generating" ? (storeState?.total ?? 0) : 1,
    error: status === "failed" ? (storeState?.error ?? "生成失败") : null,
    questionCount: questions.length,
    kcCount,
    exercises: questions,
    bestStars: progressRow?.crownLevel ?? 0,
    latestAttempt: latestRow ? toAttemptView(latestRow) : null,
    attemptCount: attemptRows.length,
  };
}

/* ============================================================
 * 后台生成:KC 收集 → 分批配额 → LLM 出题 → 落库
 * ============================================================ */

/** 章节 KC(带来源课时,出题上下文用) */
interface ChapterKc {
  title: string;
  description: string;
  lessonId: string;
  lessonTitle: string;
}

/**
 * 收集章节 KC:同 section 所有 lesson 的 knowledge_points 按课时序去重合并。
 * 无 KC 的课时(老课程/提取失败)用课时标题做伪 KC 兜底——考试照常能出。
 */
function collectChapterKcs(db: Db, examNodeId: string): ChapterKc[] {
  const node = db.select().from(contentNodes).where(eq(contentNodes.id, examNodeId)).get();
  const sectionId = node?.parentId;
  const lessons = sectionId
    ? db
        .select()
        .from(contentNodes)
        .all()
        .filter((n) => n.parentId === sectionId && n.type === "lesson")
        .sort((a, b) => a.orderIdx - b.orderIdx)
    : [];
  if (lessons.length === 0) return [];

  const seen = new Set<string>();
  const kcs: ChapterKc[] = [];
  for (const l of lessons) {
    const kps = getKnowledgePoints(db, l.id);
    if (kps.length > 0) {
      for (const kp of kps) {
        if (seen.has(kp.title)) continue;
        seen.add(kp.title);
        kcs.push({
          title: kp.title,
          description: kp.description ?? "",
          lessonId: l.id,
          lessonTitle: l.title,
        });
      }
    } else if (!seen.has(l.title)) {
      // 伪 KC:课时本身
      seen.add(l.title);
      kcs.push({ title: l.title, description: "", lessonId: l.id, lessonTitle: l.title });
    }
  }
  return kcs;
}

/** KC 按 ≤3 个/批分组,批配额 = 成员配额和。 */
function batchKcs(kcs: ChapterKc[], quotas: number[]): Array<{ kcs: ChapterKc[]; quota: number }> {
  const batches: Array<{ kcs: ChapterKc[]; quota: number }> = [];
  for (let i = 0; i < kcs.length; i += KCS_PER_BATCH) {
    const group = kcs.slice(i, i + KCS_PER_BATCH);
    const quota = quotas.slice(i, i + KCS_PER_BATCH).reduce((a, b) => a + b, 0);
    batches.push({ kcs: group, quota: Math.max(1, quota) });
  }
  return batches;
}

/**
 * 后台生成题库。永不 reject(失败写进 store 的 failed 态 + 原因)。
 * 全批完成后一次性落库:要么完整题库要么没有(崩溃恢复语义干净,不会半截题库)。
 * 批失败重试一次仍失败 → 跳过该批继续(累计 <3 题才算整体失败)。
 */
async function generateExamBank(db: Db, examNodeId: string, locale?: string | null): Promise<void> {
  try {
    const node = db.select().from(contentNodes).where(eq(contentNodes.id, examNodeId)).get();
    if (!node) throw new Error(`考试节点不存在: ${examNodeId}`);

    const kcs = collectChapterKcs(db, examNodeId);
    if (kcs.length === 0) throw new Error("本章没有课时,无法生成考试题");

    const quotas = planExamQuota(kcs.map((k) => k.title));
    const batches = batchKcs(kcs, quotas);
    // 进度以"知识点覆盖"计(用户可懂),不以 LLM 批次计:total = 本章 KC 总数,
    // 每完成一批(含跳过的失败批)累加该批覆盖的 KC 数。
    setGenerating(examNodeId, kcs.length);

    const llm = resolveLlm(db);
    // 题库语言在生成时定格:界面语言(未传 → zh-CN)
    const outLang = resolveOutputLang(locale);
    const collected: Array<ParsedExamQuestion & { kcTitle: string }> = [];
    let lastError: string | null = null;
    let done = 0;

    for (const batch of batches) {
      const allowedKcs = batch.kcs.map((k) => k.title);
      // 批内 KC 涉及的课时内容(去重,每课截 800 字)
      const lessonIds = [...new Set(batch.kcs.map((k) => k.lessonId))];
      const lessonContents = lessonIds
        .map((id) => db.select().from(contentNodes).where(eq(contentNodes.id, id)).get())
        .filter((l): l is NonNullable<typeof l> => !!l)
        .map((l) => ({ title: l.title, content: (l.content ?? "").slice(0, 800) }));
      for (let attempt = 0; attempt <= BATCH_RETRY; attempt++) {
        try {
          const prompt = buildKcBatchPrompt(node.title, batch, lessonContents, outLang);
          const result = await generateText({ model: llm.languageModel, prompt });
          const parsed = parseExamJson(result.text.trim(), batch.quota, allowedKcs);
          if (!parsed.ok) throw new Error(`出题格式错误: ${parsed.error}`);
          collected.push(...parsed.questions);
          break; // 本批成功
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      done += batch.kcs.length;
      setProgress(examNodeId, done);
    }

    if (collected.length < 3) {
      throw new Error(lastError ?? `题目数不足(仅生成 ${collected.length} 题)`);
    }

    // 全部批完成后一次性落库
    for (const q of collected) {
      db.insert(exercisesTable)
        .values({
          id: randomUUID(),
          nodeId: examNodeId,
          type: "mcq",
          prompt: q.prompt,
          answer: q.answer,
          explanation: q.explanation ?? null,
          optionsJson: JSON.stringify(q.options),
          aiGenerated: true,
          kcTitle: q.kcTitle,
        })
        .run();
    }
    setReady(examNodeId);
  } catch (e) {
    setFailed(examNodeId, e instanceof Error ? e.message : String(e));
  }
}

/* ============================================================
 * attempt 档案:开始 / 逐题记录 / 提交判分
 * ============================================================ */

/** 开始/重新考试:建 attempt 行,返回 attemptId + 就绪题目。 */
export function startExamAttempt(
  db: Db,
  examNodeId: string,
): { attemptId: string; exercises: ExamQuestionView[] } {
  const node = db.select().from(contentNodes).where(eq(contentNodes.id, examNodeId)).get();
  if (!node) throw new Error(`考试节点不存在: ${examNodeId}`);
  const questions = listExamQuestions(db, examNodeId);
  if (questions.length === 0) throw new Error("考试题目尚未生成");

  // 防御:上一场悬挂(正常流程 getStatus 已判死,这里兜底)
  const dangling = latestUnfinishedAttempt(db, examNodeId);
  if (dangling) {
    gradeAndFinalize(db, examNodeId, dangling, safeParseRecord(dangling.answersJson), true);
  }

  const id = randomUUID();
  db.insert(examAttempts)
    .values({
      id,
      examNodeId,
      startedAt: new Date().toISOString(),
      answersJson: "{}",
    })
    .run();
  return { attemptId: id, exercises: questions };
}

/** 逐题增量持久化(崩溃安全:强关后悬挂 attempt 仍有已答记录)。已结束的 attempt 忽略。 */
export function recordExamAnswer(
  db: Db,
  examNodeId: string,
  attemptId: string,
  exerciseId: string,
  answer: string,
): void {
  const row = db.select().from(examAttempts).where(eq(examAttempts.id, attemptId)).get();
  if (!row || row.examNodeId !== examNodeId || row.finishedAt) return;
  const stored = safeParseRecord(row.answersJson);
  stored[exerciseId] = answer;
  db.update(examAttempts)
    .set({ answersJson: JSON.stringify(stored) })
    .where(eq(examAttempts.id, attemptId))
    .run();
}

/**
 * 提交考试:逐题判分(未答 = 错),写 attempt 结算 + progress.crownLevel(取最高)+ XP。
 * terminated = 中途离开被终止,同样计星计分(按"未答=错算总分"规则)。
 */
export function submitExamAttempt(
  db: Db,
  examNodeId: string,
  attemptId: string,
  answers: Record<string, string>,
  opts?: { terminated?: boolean },
): ExamSubmitResult {
  const row = db.select().from(examAttempts).where(eq(examAttempts.id, attemptId)).get();
  if (!row) throw new Error(`考试 attempt 不存在: ${attemptId}`);
  if (row.examNodeId !== examNodeId) throw new Error("attempt 与考试节点不匹配");
  if (row.finishedAt) throw new Error("该场考试已提交,不能重复提交");

  // 渲染端提交的 answers 覆盖增量持久化的存量(崩溃恢复场景只有存量)
  const merged = { ...safeParseRecord(row.answersJson), ...answers };
  return gradeAndFinalize(db, examNodeId, row, merged, opts?.terminated ?? false);
}

/* ============================================================
 * 内部:判分落库(正常提交与悬挂判死共用)
 * ============================================================ */

type AttemptRow = typeof examAttempts.$inferSelect;

function gradeAndFinalize(
  db: Db,
  examNodeId: string,
  attemptRow: AttemptRow,
  answers: Record<string, string>,
  terminated: boolean,
): ExamSubmitResult {
  const questions = listExamQuestions(db, examNodeId);
  if (questions.length === 0) throw new Error("考试题目尚未生成");

  let correctCount = 0;
  const perQuestion: ExamPerQuestionResult[] = [];
  for (const q of questions) {
    const userAnswer = answers[q.id] ?? "";
    const optionsJson = q.options ? JSON.stringify(q.options) : null;
    const correct = gradeAnswer(q.type, q.answer, userAnswer, optionsJson);
    if (correct) correctCount++;
    perQuestion.push({
      exerciseId: q.id,
      kcTitle: q.kcTitle,
      correct,
      userAnswer,
      correctAnswer: q.answer,
      explanation: q.explanation,
      answered: userAnswer !== "",
      // 题干/选项快照:重新生成题库会删 exercises 行,历史回顾必须自包含
      prompt: q.prompt,
      options: q.options ?? null,
    });
  }

  const totalCount = questions.length;
  const accuracy = correctCount / totalCount;
  const stars = accuracyToStars(accuracy);

  db.update(examAttempts)
    .set({
      finishedAt: new Date().toISOString(),
      terminated,
      correctCount,
      totalCount,
      stars,
      answersJson: JSON.stringify(answers),
      perQuestionJson: JSON.stringify(perQuestion),
    })
    .where(eq(examAttempts.id, attemptRow.id))
    .run();

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

  // XP(每答对一题 +10;terminated 也计——按"算总分"规则)。addXp 内部 emitStateChange("xp")。
  if (correctCount > 0) addXp(db, correctCount * 10);
  // 刷新地图(考试节点星数变化需要重渲染)
  emitStateChange("mastery");

  return {
    attemptId: attemptRow.id,
    correctCount,
    totalCount,
    accuracy,
    stars,
    bestStars,
    terminated,
    perQuestion,
  };
}

function latestUnfinishedAttempt(db: Db, examNodeId: string): AttemptRow | null {
  const rows = db
    .select()
    .from(examAttempts)
    .where(eq(examAttempts.examNodeId, examNodeId))
    .all()
    .filter((r) => !r.finishedAt);
  return rows.length > 0 ? rows[rows.length - 1]! : null;
}

function latestAttemptRow(db: Db, examNodeId: string): AttemptRow | null {
  const rows = db
    .select()
    .from(examAttempts)
    .where(eq(examAttempts.examNodeId, examNodeId))
    .all();
  return rows.length > 0 ? rows[rows.length - 1]! : null;
}

function toAttemptView(row: AttemptRow): ExamAttemptView {
  let perQuestion: ExamPerQuestionResult[] | null = null;
  if (row.perQuestionJson) {
    try {
      const parsed = JSON.parse(row.perQuestionJson);
      if (Array.isArray(parsed)) perQuestion = parsed as ExamPerQuestionResult[];
    } catch {
      perQuestion = null;
    }
  }
  return {
    id: row.id,
    examNodeId: row.examNodeId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    terminated: !!row.terminated,
    correctCount: row.correctCount,
    totalCount: row.totalCount,
    stars: row.stars,
    perQuestion,
  };
}

function safeParseRecord(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/* ============================================================
 * 查询与纯工具
 * ============================================================ */

/** 列出某考试节点的所有题目(自然插入序),带 KC 标签。 */
export function listExamQuestions(db: Db, examNodeId: string): ExamQuestionView[] {
  const rows = db
    .select()
    .from(exercisesTable)
    .where(eq(exercisesTable.nodeId, examNodeId))
    .all();
  return rows.map((row) => ({
    id: row.id,
    nodeId: row.nodeId,
    type: row.type as ExamQuestionView["type"],
    prompt: row.prompt,
    options: row.optionsJson ? (JSON.parse(row.optionsJson) as string[]) : null,
    answer: row.answer,
    explanation: row.explanation,
    aiGenerated: row.aiGenerated,
    createdAt: row.createdAt,
    kcTitle: row.kcTitle ?? null,
  }));
}

/** 正确率 → 星数(1-3)。低于 60% 得 0 星(但会记录尝试)。 */
export function accuracyToStars(accuracy: number): number {
  if (accuracy >= THREE_STAR_THRESHOLD) return 3;
  if (accuracy >= TWO_STAR_THRESHOLD) return 2;
  if (accuracy >= ONE_STAR_THRESHOLD) return 1;
  return 0;
}

/* ============================================================
 * 出题 prompt + 解析(按 KC 批次)
 * ============================================================ */

function buildKcBatchPrompt(
  examTitle: string,
  batch: { kcs: ChapterKc[]; quota: number },
  lessonContents: Array<{ title: string; content: string }>,
  outLang: string,
): string {
  const kcList = batch.kcs
    .map((k) => `- ${k.title}:${k.description || "(见下方课时内容)"}(来自课时《${k.lessonTitle}》)`)
    .join("\n");

  const contentParts = lessonContents.map(
    (l, i) => `### ${i + 1}. ${l.title}\n${l.content || "(课时无正文)"}`,
  );

  return [
    `你是 LookatStudy 的章节考试出题官。基于下面的知识点与课程内容,出 ${batch.quota} 道四选一选择题。`,
    ``,
    `考试标题:${examTitle}`,
    ``,
    `本批要覆盖的知识点(每题必须考察其中之一):`,
    kcList,
    ``,
    `课程内容:`,
    contentParts.join("\n\n"),
    ``,
    `出题要求:`,
    `- 每题明确考察上面列出的某一个知识点,kc 字段填写该知识点标题(必须与列表完全一致)`,
    `- 题干考"理解"和"应用",不要出死记硬背的定义题`,
    `- 干扰项 plausible 但 definitely wrong(基于学习者常犯的真实误解)`,
    `- 答案必须在提供的课程内容中有依据`,
    `- 数学表达式用行内 $..$ 或行间 $$..$$ 的 LaTeX 记法书写,不要用纯文本近似(界面会渲染成公式)`,
    questionLanguageLine(outLang),
    ``,
    `严格按以下 JSON 格式返回,不要加 markdown 代码块标记、不要解释:`,
    `{`,
    `  "questions": [`,
    `    {`,
    `      "prompt": "题干(不含选项)",`,
    `      "options": ["选项A", "选项B", "选项C", "选项D"],`,
    `      "answer": "0",`,
    `      "explanation": "为什么是这个答案 + 其他选项为什么错(2-3句)",`,
    `      "kc": "考察的知识点标题"`,
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
  kcTitle: string;
}

/**
 * 解析一批 LLM 出题结果。
 * - 每题必须有 prompt/options(≥2)/answer;kc 缺失或不在此批 KC 列表 → 轮转兜底映射
 * - 有效题数 ≥1 即可(整体 <3 题的失败在 generateExamBank 末尾裁决)
 */
function parseExamJson(
  raw: string,
  expectedCount: number,
  allowedKcs: string[],
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
    const kcRaw = typeof q.kc === "string" ? q.kc : "";
    if (!prompt || !answer || !options || options.length < 2) {
      return { ok: false, error: `第 ${i + 1} 题格式不完整(需 prompt/options/answer)` };
    }
    // kc 兜底:缺失/不在批内列表 → 轮转映射到本批 KC(保证 quota 大致对齐)
    const kcTitle = allowedKcs.includes(kcRaw) ? kcRaw : allowedKcs[i % allowedKcs.length]!;
    questions.push({ prompt, options, answer, explanation, kcTitle });
  }
  if (questions.length < 1) {
    return { ok: false, error: `题目数不足(解析出 ${questions.length} 题)` };
  }
  return { ok: true, questions };
}
