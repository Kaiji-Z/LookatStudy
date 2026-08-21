/**
 * diagram-repair —— draw_diagram 产物的 mermaid 语法自动修复(v0.20,archify 思想)。
 *
 * 背景:artifact-harness 校验的是"形状"(非空/长度),mermaid **语法**只有渲染层
 * 能验证(mermaid 需要 DOM,主进程跑不了)。LLM 偶发语法滑丝 → 渲染失败 → 学习者
 * 只看到源码 fallback。archify(tt-a1i/archify,MIT)的核心循环是"生成 → 验证器
 * 回执 → 带错误修复(限轮数) → 交付";本模块把同一循环适配到我们的运行时:
 * 渲染层 parse 失败 → IPC 带错误回主进程 → LLM 定点修复(1 轮封顶) → 回渲染层重渲。
 *
 * 修复调用与导入同源:buildImportModel + generateTextWithTimeout(看门狗/取消/
 * token 上限继承),fast 思考档(语法修复是窄任务,不值得深思)。
 * 修复失败绝不 throw —— 返回 {ok:false, reason},渲染层保持现有源码 fallback。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../../db/schema.js";
import { resolveLlm } from "./llm-client.js";
import { buildImportModel, generateTextWithTimeout } from "../import-llm-service.js";

type Db = SQLJsDatabase<typeof schema>;

export interface DiagramRepairInput {
  /** 渲染失败的原始 mermaid(不含围栏) */
  mermaid: string;
  /** 渲染层捕获的解析错误信息(喂回给 LLM 定点修) */
  errorMessage: string;
  diagramType: "flowchart" | "sequence" | "state";
}

export interface DiagramRepairResult {
  ok: boolean;
  /** 修复后的 mermaid(ok=true 时有效,保证非空且 ≤2000 字符) */
  mermaid: string;
  reason?: string;
}

/**
 * 修复提示词(纯函数,verify 直测)。要点:
 * - 给出原始代码 + 解析错误 + 图类型,让模型定点修而不是重画;
 * - 明确"只输出代码,不要围栏/解释"(省解析歧义);
 * - 要求语义不变(节点/边/顺序保留),防修复变重写。
 */
export function buildRepairPrompt(input: DiagramRepairInput): string {
  const safeCode = input.mermaid.slice(0, 4000);
  const safeErr = input.errorMessage.slice(0, 600);
  return [
    `下面的 Mermaid ${input.diagramType} 图代码渲染失败,请修复语法错误。`,
    "",
    "规则:",
    "1. 只修语法,不重画:保留原有节点、边和顺序,语义不变。",
    "2. 常见坑:节点 id 含中文或空格要用引号包裹(A[\"中文\"]);标签里的括号/引号要转义;",
    "   sequence 的 participant 声明与消息行 actors 要一致;state 转移箭头两侧要有状态 id。",
    "3. 只输出修复后的 Mermaid 代码本身:不要 markdown 围栏,不要任何解释文字。",
    "",
    "原始代码:",
    safeCode,
    "",
    "渲染错误:",
    safeErr,
  ].join("\n");
}

/** 从 LLM 回复里剥出纯 mermaid:模型偶尔不听话带围栏或前言,逐层剥。 */
export function extractMermaidFromReply(reply: string): string {
  let s = reply.trim();
  // 代码围栏剥离(只认 mermaid 或无语言标注的围栏)
  const fence = s.match(/```(?:mermaid)?\s*\n([\s\S]*?)\n?```/);
  if (fence?.[1]) s = fence[1].trim();
  // 前言剥离:代码通常从图类型声明行开始
  const decl = s.match(/^(flowchart|graph|sequenceDiagram|stateDiagram-v2)\b/m);
  if (decl?.index && decl.index > 0) s = s.slice(decl.index).trim();
  return s;
}

/** 修复结果的形态校验:非空、限长、至少含一个图结构信号。 */
export function isPlausibleMermaid(code: string, diagramType: DiagramRepairInput["diagramType"]): boolean {
  if (!code || code.length > 2000) return false;
  if (diagramType === "sequence") return /^(sequenceDiagram|\bparticipant\b)/m.test(code);
  if (diagramType === "state") return /^stateDiagram/m.test(code);
  return /^(flowchart|graph)\b/m.test(code);
}

/** 主入口:LLM 定点修复,1 轮。失败返回 {ok:false}(渲染层守自己的 fallback)。 */
export async function repairMermaidDiagram(db: Db, input: DiagramRepairInput): Promise<DiagramRepairResult> {
  try {
    const llm = resolveLlm(db);
    const bm = buildImportModel(llm);
    const reply = await generateTextWithTimeout(bm.model, buildRepairPrompt(input), {
      maxOutputTokens: bm.maxOutputTokens,
      ...(bm.providerOptions ? { providerOptions: bm.providerOptions } : {}),
    });
    const code = extractMermaidFromReply(reply);
    if (!isPlausibleMermaid(code, input.diagramType)) {
      return { ok: false, mermaid: "", reason: "修复输出不是可用的 mermaid 代码" };
    }
    return { ok: true, mermaid: code };
  } catch (e) {
    return { ok: false, mermaid: "", reason: e instanceof Error ? e.message : String(e) };
  }
}
