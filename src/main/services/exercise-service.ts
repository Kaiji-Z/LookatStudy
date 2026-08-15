/**
 * 练习题服务 —— AI 生题 + 缓存 + 判分。
 *
 * 流程:
 *   generateExercise(nodeId, type)
 *     → 读节点内容（content_nodes.content）做上下文
 *     → generateText 让 LLM 按 JSON schema 出一道题
 *     → 解析 + 校验 + 写 exercises 表（缓存，下次 listExercises 直接读）
 *   submitExerciseAnswer(exerciseId, userAnswer)
 *     → 比对答案（MCQ 按 index、fill_blank 归一化、true_false 布尔）
 *     → 创建 update_mastery Proposal（BKT 掌握度更新）
 *     → 返回 { correct, explanation, proposalId }
 *
 * 题型设计（从 exercises 表的 5 种收敛到 UI 用的 3 种；predict_output/order_lines/debug 暂不在 UI 暴露）:
 *   - mcq:        4 选 1，options 数组，answer 是正确选项的下标（"0"-"3"）
 *   - fill_blank: 文本题，answer 是标准答案字符串
 *   - true_false: 判断题，answer 是 "true"/"false"
 */
import { generateText } from "ai";
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { contentNodes, exercises } from "../db/schema.js";
import { resolveLlm } from "./agent/llm-client.js";
import { questionLanguageLine } from "@shared/locales";
import { resolveOutputLang } from "@shared/locales";
import { createProposal, applyProposal, type LearningOperation } from "./proposal-service.js";
import { recordReviewDb } from "./pure/srs-db.js";
import type { ReviewQuality } from "@shared/types";
import { addXpCorrect, addXpWrong } from "./xp-service.js";
import type { Exercise, ExerciseType } from "@shared/types";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 让 LLM 给某节点生成一道练习题。
 * @param type 题型；不传则随机（偏好 mcq）
 */
export async function generateExercise(
  db: Db,
  nodeId: string,
  type?: ExerciseType,
  /** 界面语言(i18n);null/缺省 = zh-CN */
  locale?: string | null,
): Promise<Exercise> {
  const node = db.select().from(contentNodes).where(eq(contentNodes.id, nodeId)).get();
  if (!node) throw new Error(`节点不存在: ${nodeId}`);

  // fill_blank 已废弃(归一化匹配无法处理同义词/改写,不够客观)→ 降级为 mcq。
  // 保留 ExerciseType 联合体 + gradeAnswer 分支仅为兼容 DB 中的历史 fill_blank 题。
  const exerciseType: ExerciseType = !type || type === "fill_blank" ? "mcq" : type;
  const llm = resolveLlm(db);

  const outLang = resolveOutputLang(locale);
  const prompt = buildGenerationPrompt(node.title, node.content ?? "(无内容，基于标题出题)", exerciseType, outLang);

  const result = await generateText({
    model: llm.languageModel,
    prompt,
  });

  const raw = result.text.trim();
  const parsed = parseExerciseJson(raw, exerciseType);
  if (!parsed.ok) {
    throw new Error(`AI 出题格式错误: ${parsed.error}`);
  }

  // 写 exercises 表
  const { randomUUID } = require("node:crypto") as { randomUUID: () => string };
  const id = randomUUID();
  db.insert(exercises)
    .values({
      id,
      nodeId,
      type: exerciseType,
      prompt: parsed.prompt,
      answer: parsed.answer,
      explanation: parsed.explanation ?? null,
      optionsJson: parsed.options ? JSON.stringify(parsed.options) : null,
      aiGenerated: true,
    })
    .run();

  return {
    id,
    nodeId,
    type: exerciseType,
    prompt: parsed.prompt,
    options: parsed.options ?? null,
    answer: parsed.answer,
    explanation: parsed.explanation ?? null,
    aiGenerated: true,
    createdAt: new Date().toISOString(),
  };
}

/** 列出某节点缓存的练习题 */
export function listExercises(db: Db, nodeId: string): Exercise[] {
  const rows = db.select().from(exercises).where(eq(exercises.nodeId, nodeId)).all();
  return rows.map(rowToExercise);
}

/**
 * 提交答案 + 判分。自动 apply mastery（与 quiz/record_answer 对齐：判分确定性，不需人确认）。
 * @returns correct / explanation
 */
export function submitExerciseAnswer(
  db: Db,
  exerciseId: string,
  userAnswer: string,
): { correct: boolean; explanation: string | null; xpGained?: number; totalXp?: number } {
  const ex = db.select().from(exercises).where(eq(exercises.id, exerciseId)).get();
  if (!ex) throw new Error(`题目不存在: ${exerciseId}`);

  const correct = gradeAnswer(ex.type as ExerciseType, ex.answer, userAnswer, ex.optionsJson);

  // 累加 XP（答对+10，答错+1）
  const xpGained = correct ? addXpCorrect(db) : addXpWrong(db);

  // 自动 create + apply update_mastery（不再留 pending 等人确认）
  const ops: LearningOperation[] = [
    { type: "update_mastery", nodeId: ex.nodeId, correct },
  ];
  const proposal = createProposal(db, {
    nodeId: ex.nodeId,
    operations: ops,
    rationale: `练习题作答（${ex.type}，${correct ? "答对" : "答错"}）`,
  });
  applyProposal(db, proposal.id);
  // BKT↔SRS 闭环：答题同时更新 SRS 复习计划（与 quiz:recordAnswer 对齐）
  // 用 pure/srs-db 避免 import srs.ts → db/index.ts → schema.sql?raw 链（tsx 无法解析 ?raw）
  recordReviewDb(db, ex.nodeId, (correct ? 5 : 2) as ReviewQuality);

  return {
    correct,
    explanation: ex.explanation,
    xpGained: correct ? 10 : 1,
    totalXp: xpGained,
  };
}

/* ---------- 内部工具 ---------- */

function rowToExercise(row: typeof exercises.$inferSelect): Exercise {
  return {
    id: row.id,
    nodeId: row.nodeId,
    type: row.type as ExerciseType,
    prompt: row.prompt,
    options: row.optionsJson ? (JSON.parse(row.optionsJson) as string[]) : null,
    answer: row.answer,
    explanation: row.explanation,
    aiGenerated: row.aiGenerated,
    createdAt: row.createdAt,
  };
}

function buildGenerationPrompt(title: string, content: string, type: ExerciseType, outLang: string): string {
  const typeSpec = {
    mcq: `出一道四选一选择题。options 是 4 个选项的数组，answer 是正确选项的下标（"0"/"1"/"2"/"3"）。
干扰项设计要求：基于学习者常犯的真实误解（不是明显错误的凑数选项），让认真学过的人能排除，没学懂的人会选错。
题干要考"理解"而非"记忆"：不要出"X 定义是什么"这种背诵题，要出"在 Y 场景下该用 X 还是 Z"这种应用题。`,
    fill_blank: `出一道填空题。answer 是标准答案字符串。
答案要明确唯一（避免开放性答案）。考概念关键词或逻辑推理结果，不要考死记的数字或拼写。`,
    true_false: `出一道判断题。answer 是 "true" 或 "false"。
出学习者容易判断错的陈述——看似正确但有微妙错误，或看似错误但实际正确的。不要出显而易见的题。`,
  }[type];

  return [
    `你是 LookatStudy 的出题官。基于下面的学习内容出一道考察理解（不是死记硬背）的${type}题。`,
    ``,
    `学习节点：${title}`,
    `内容：${content.slice(0, 3000)}`,
    ``,
    typeSpec,
    ``,
    `出题红线:`,
    `- 答案必须在提供的学习内容中有依据，不可编造内容里没有的知识`,
    questionLanguageLine(outLang),
    `- 干扰项 plausible 但 definitely wrong（不能有争议）`,
    ``,
    `严格按以下 JSON 格式返回，不要加任何 markdown 代码块标记、不要解释：`,
    `{`,
    `  "prompt": "题干（不含选项）",`,
    type === "mcq"
      ? `  "options": ["选项A", "选项B", "选项C", "选项D"],\n  "answer": "0",`
      : type === "true_false"
        ? `  "answer": "true",`
        : `  "answer": "标准答案",`,
    `  "explanation": "为什么是这个答案 + 其他选项为什么错（答错时给学习者看，2-3句）"`,
    `}`,
  ].join("\n");
}

function parseExerciseJson(
  raw: string,
  type: ExerciseType,
):
  | { ok: true; prompt: string; options?: string[]; answer: string; explanation?: string }
  | { ok: false; error: string } {
  // 剥 ```json ... ``` 包裹（即便我们要求了不加，LLM 有时还是会加）
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}` };
  }
  const prompt = typeof obj.prompt === "string" ? obj.prompt : "";
  const answer = typeof obj.answer === "string" ? obj.answer : "";
  const explanation = typeof obj.explanation === "string" ? obj.explanation : undefined;
  if (!prompt || !answer) {
    return { ok: false, error: "缺少 prompt 或 answer 字段" };
  }
  if (type === "mcq") {
    const options = Array.isArray(obj.options) ? (obj.options as string[]) : undefined;
    if (!options || options.length < 2) {
      return { ok: false, error: "mcq 题需要 options 数组（至少 2 项）" };
    }
    return { ok: true, prompt, options, answer, explanation };
  }
  return { ok: true, prompt, answer, explanation };
}

/** 判分：按题型归一化比较。导出供 exam-service 复用(考试逐题判分)。 */
export function gradeAnswer(
  type: ExerciseType,
  correctAnswer: string,
  userAnswer: string,
  optionsJson: string | null,
): boolean {
  const u = userAnswer.trim();
  if (type === "mcq") {
    // 正确答案存的是下标 "0"-"3"；用户可能传下标也可能传选项文本
    if (u === correctAnswer) return true;
    // 尝试把用户输入当选项文本比对
    if (optionsJson) {
      try {
        const options = JSON.parse(optionsJson) as string[];
        const idx = options.findIndex((o) => normalize(o) === normalize(u));
        return String(idx) === correctAnswer;
      } catch {
        /* ignore */
      }
    }
    return false;
  }
  if (type === "true_false") {
    return u.toLowerCase() === correctAnswer.toLowerCase();
  }
  // fill_blank: 归一化比较（去空格/标点/大小写）
  return normalize(u) === normalize(correctAnswer);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/[。，,!！?？；;:：]/g, "");
}
