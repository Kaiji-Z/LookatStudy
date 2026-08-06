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
import { createProposal, type LearningOperation } from "./proposal-service.js";
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
): Promise<Exercise> {
  const node = db.select().from(contentNodes).where(eq(contentNodes.id, nodeId)).get();
  if (!node) throw new Error(`节点不存在: ${nodeId}`);

  const exerciseType: ExerciseType = type ?? "mcq";
  const llm = resolveLlm(db);

  const prompt = buildGenerationPrompt(node.title, node.content ?? "(无内容，基于标题出题)", exerciseType);

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
 * 提交答案 + 判分。
 * @returns correct / explanation / proposalId（更新掌握度的提议，等人确认）
 */
export function submitExerciseAnswer(
  db: Db,
  exerciseId: string,
  userAnswer: string,
): { correct: boolean; explanation: string | null; proposalId?: string } {
  const ex = db.select().from(exercises).where(eq(exercises.id, exerciseId)).get();
  if (!ex) throw new Error(`题目不存在: ${exerciseId}`);

  const correct = gradeAnswer(ex.type as ExerciseType, ex.answer, userAnswer, ex.optionsJson);

  // 生成 update_mastery Proposal（correct 传给 BKT）
  const ops: LearningOperation[] = [
    { type: "update_mastery", nodeId: ex.nodeId, correct },
  ];
  const proposal = createProposal(db, {
    nodeId: ex.nodeId,
    operations: ops,
    rationale: `练习题作答（${ex.type}，${correct ? "答对" : "答错"}）`,
  });

  return {
    correct,
    explanation: ex.explanation,
    proposalId: proposal.id,
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

function buildGenerationPrompt(title: string, content: string, type: ExerciseType): string {
  const typeSpec = {
    mcq: `出一道四选一选择题。options 是 4 个选项的数组，answer 是正确选项的下标（"0"/"1"/"2"/"3"）。干扰项要合理（基于常见误解）。`,
    fill_blank: `出一道填空题。answer 是标准答案字符串。答案要明确唯一（避免开放性答案）。`,
    true_false: `出一道判断题。answer 是 "true" 或 "false"。`,
  }[type];

  return [
    `你是 LookatStudy 的出题官。基于下面的学习内容出一道考察理解（不是死记）的${type}题。`,
    ``,
    `学习节点：${title}`,
    `内容：${content.slice(0, 3000)}`,
    ``,
    typeSpec,
    ``,
    `严格按以下 JSON 格式返回，不要加任何 markdown 代码块标记、不要解释：`,
    `{`,
    `  "prompt": "题干（不含选项）",`,
    type === "mcq"
      ? `  "options": ["选项A", "选项B", "选项C", "选项D"],\n  "answer": "0",`
      : type === "true_false"
        ? `  "answer": "true",`
        : `  "answer": "标准答案",`,
    `  "explanation": "为什么是这个答案（一句话，答错时给学习者看）"`,
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

/** 判分：按题型归一化比较 */
function gradeAnswer(
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
