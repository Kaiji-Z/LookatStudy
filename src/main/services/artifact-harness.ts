/**
 * artifact-harness —— Generative UI 产物的质量 harness(v0.2.1)。
 *
 * 现状问题(为什么需要 harness):
 *   5 个展示型 tool(concept_map / quiz / compare_table / diagram / code_walkthrough)
 *   的 zod schema 只校验"形状"(有 nodes 字段、是数组),不校验语义正确性:
 *     - concept_map 的 edge.from/to 可能指向不存在的 node.id → 渲染时边消失
 *     - compare_table 的 row.length 可能 ≠ headers.length → 表格错位
 *     - code_walkthrough 的 lineStart/lineEnd 可能超出 code 实际行数 → 高亮失效
 *     - quiz 的 answer 索引可能 ≥ options.length → 永远答不对
 *
 * 本模块三层防护:
 *   1. SCHEMAS:增强的 zod schema(带 .refine 语义校验)—— 给 agent-engine 的 tool inputSchema 用
 *   2. sanitize():graceful 修复(LLM 输出总会出错,丢弃/截断/clamp 而不是 throw)
 *      返回 { data, warnings } —— warnings 记录修复了什么,前端可选展示
 *   3. QUALITY_GUIDE:质量指南字符串 —— 拼进 tool description,告诉 LLM 产出高质量数据
 *
 * 设计参考:
 *   - Claude Artifacts:tool 产出 → schema 校验 → sandbox 渲染 → 失败有 fallback
 *   - IT-Explorers mermaid-render 教训:渲染成功 ≠ 语义正确(箭头指错渲染照样过)
 *   - 本项目 AGENTS.md §安全模型:模型只选 tool + 提供 input(zod 校验),execute 只返回数据
 */
import { z } from "zod";

// ============================================================
// §1  类型定义(与 agent-engine tool execute 返回值对齐)
// ============================================================

export type ArtifactType =
  | "concept_map"
  | "quiz"
  | "compare_table"
  | "diagram"
  | "code_walkthrough"
  | "guess";

export interface ConceptMapData {
  artifactType: "concept_map";
  title: string;
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label?: string }[];
}

export interface QuizData {
  artifactType: "quiz";
  questions: {
    prompt: string;
    options: string[];
    answer: number;
    explanation: string;
  }[];
}

export interface CompareTableData {
  artifactType: "compare_table";
  title: string;
  headers: string[];
  rows: string[][];
}

export interface DiagramData {
  artifactType: "diagram";
  title: string;
  diagramType: "flowchart" | "sequence" | "state";
  mermaid: string;
}

export interface CodeWalkthroughData {
  artifactType: "code_walkthrough";
  title: string;
  language: string;
  code: string;
  annotations: { lineStart: number; lineEnd: number; note: string }[];
}

/**
 * guess:hook 起手式的"二选一猜测"按钮卡(动机层)。和 quiz 的本质区别:
 *   - 不计分、无正确答案、不碰掌握度——"猜"是玩,不是考。
 *   - 揭晓由 AI 下一回合给出(不在卡上判定),卡只负责捕获学习者选了哪个。
 *   - 恰好 2 个选项(降低决策成本,正是 hook 起手的目的)。
 */
export interface GuessData {
  artifactType: "guess";
  /** 猜测的问题,如"你觉得:递归算阶乘会比循环——更慢,还是差不多?" */
  prompt: string;
  /** 恰好 2 个选项 */
  options: { id: string; label: string }[];
}

/** sanitize 的统一返回类型 */
export interface SanitizeResult<T = unknown> {
  /** 修复后的产物数据(可直接渲染) */
  data: T;
  /** 修复过程中产生的人类可读警告(每条一句话,前端可聚合提示) */
  warnings: string[];
}

// ============================================================
// §2  增强的 zod schema(语义校验)
// ============================================================

/** concept_map:edge 端点必须在 node id 集合内;节点 ≤ 10(防拥挤)。 */
export const conceptMapSchema = z
  .object({
    title: z.string().min(1),
    nodes: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
      .min(2)
      .max(10),
    edges: z
      .array(
        z.object({
          from: z.string().min(1),
          to: z.string().min(1),
          label: z.string().optional(),
        }),
      )
      .min(1),
  })
  .refine(
    (d) => {
      const ids = new Set(d.nodes.map((n) => n.id));
      return d.edges.every((e) => ids.has(e.from) && ids.has(e.to));
    },
    { message: "edge.from/to 必须指向存在的 node.id" },
  );

/** quiz:每题 answer 索引合法;options 2-6 个;questions 1-5 个。 */
export const quizSchema = z.object({
  questions: z
    .array(
      z
        .object({
          prompt: z.string().min(1),
          options: z.array(z.string().min(1)).min(2).max(6),
          answer: z.number().int(),
          explanation: z.string().min(1),
        })
        .refine((q) => q.answer >= 0 && q.answer < q.options.length, {
          message: "answer 必须满足 0 ≤ answer < options.length",
        }),
    )
    .min(1)
    .max(5),
});

/** compare_table:每行单元格数 = headers.length;headers 2-5 列;rows ≤ 8 行。 */
export const compareTableSchema = z
  .object({
    title: z.string().min(1),
    headers: z.array(z.string().min(1)).min(2).max(5),
    rows: z.array(z.array(z.string())).min(1).max(8),
  })
  .refine((d) => d.rows.every((r) => r.length === d.headers.length), {
    message: "每行单元格数必须等于 headers.length",
  });

/** diagram:mermaid 非空,长度 ≤ 2000 字符(防超长撑爆 UI)。 */
export const diagramSchema = z.object({
  title: z.string().min(1),
  diagramType: z.enum(["flowchart", "sequence", "state"]),
  mermaid: z.string().min(1).max(2000),
});

/** code_walkthrough:标注行号合法(1 ≤ lineStart ≤ lineEnd ≤ code 行数)。 */
export const codeWalkthroughSchema = z
  .object({
    title: z.string().min(1),
    language: z.string().min(1),
    code: z.string().min(1),
    annotations: z
      .array(
        z.object({
          lineStart: z.number().int(),
          lineEnd: z.number().int(),
          note: z.string().min(1),
        }),
      )
      .min(1),
  })
  .refine(
    (d) => {
      const codeLines = d.code.split("\n").length;
      return d.annotations.every(
        (a) => a.lineStart >= 1 && a.lineStart <= a.lineEnd && a.lineEnd <= codeLines,
      );
    },
    { message: "标注行号必须满足 1 ≤ lineStart ≤ lineEnd ≤ code 总行数" },
  );

/** guess:恰好 2 个选项,每个有 id + label。 */
export const guessSchema = z.object({
  prompt: z.string().min(1),
  options: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
    .length(2, "guess 必须恰好 2 个选项"),
});

// ============================================================
// §3  sanitize —— graceful 修复(LLM 输出总会出错,不 throw)
// ============================================================

/** 修复 concept_map:丢弃指向不存在 node 的 edge。 */
function sanitizeConceptMap(input: unknown): SanitizeResult<ConceptMapData> {
  const warnings: string[] = [];
  const d = (input ?? {}) as Partial<ConceptMapData>;
  const nodes = Array.isArray(d.nodes) ? d.nodes.filter((n) => n?.id && n?.label) : [];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(d.edges)
    ? d.edges.filter((e) => {
        const ok = e?.from && e?.to && ids.has(e.from) && ids.has(e.to);
        if (!ok) {
          warnings.push(`丢弃了无效的关系边(from=${e?.from ?? "?"}, to=${e?.to ?? "?"})`);
        }
        return ok;
      })
    : [];
  if (nodes.length < 2) {
    warnings.push("概念节点少于 2 个,渲染可能不完整");
  }
  return {
    data: {
      artifactType: "concept_map",
      title: typeof d.title === "string" && d.title ? d.title : "概念图",
      nodes,
      edges,
    },
    warnings,
  };
}

/** 修复 quiz:clamp answer 索引到合法范围;补齐缺字段。 */
function sanitizeQuiz(input: unknown): SanitizeResult<QuizData> {
  const warnings: string[] = [];
  const d = (input ?? {}) as Partial<QuizData>;
  const rawQuestions = Array.isArray(d.questions) ? d.questions : [];
  const questions = rawQuestions
    .filter((q) => q && Array.isArray(q.options) && q.options.length >= 2)
    .map((q, i) => {
      let answer = typeof q.answer === "number" ? q.answer : 0;
      if (answer < 0 || answer >= q.options.length) {
        warnings.push(`第 ${i + 1} 题 answer 索引越界,已 clamp 到 0`);
        answer = 0;
      }
      return {
        prompt: q.prompt || "(无题干)",
        options: q.options.slice(0, 6),
        answer,
        explanation: q.explanation || "(无解释)",
      };
    })
    .slice(0, 5);
  if (questions.length === 0) {
    warnings.push("没有有效的题目,渲染为空练习");
  }
  return { data: { artifactType: "quiz", questions }, warnings };
}

/** 修复 compare_table:每行截断/补齐到 headers.length。 */
function sanitizeCompareTable(input: unknown): SanitizeResult<CompareTableData> {
  const warnings: string[] = [];
  const d = (input ?? {}) as Partial<CompareTableData>;
  const headers = Array.isArray(d.headers) ? d.headers.filter((h) => h).slice(0, 5) : [];
  const colCount = headers.length;
  if (colCount < 2) {
    warnings.push("表头少于 2 列,渲染可能不完整");
  }
  const rows = Array.isArray(d.rows)
    ? d.rows
        .filter((r) => Array.isArray(r))
        .map((r, i) => {
          const cells = r.map((c) => String(c ?? ""));
          if (cells.length !== colCount) {
            warnings.push(`第 ${i + 1} 行单元格数(${cells.length})≠ 列数(${colCount}),已对齐`);
          }
          // 截断或补齐
          if (cells.length > colCount) return cells.slice(0, colCount);
          while (cells.length < colCount) cells.push("");
          return cells;
        })
        .slice(0, 8)
    : [];
  return {
    data: {
      artifactType: "compare_table",
      title: typeof d.title === "string" && d.title ? d.title : "对比表",
      headers,
      rows,
    },
    warnings,
  };
}

/** 修复 diagram:截断超长 mermaid。 */
function sanitizeDiagram(input: unknown): SanitizeResult<DiagramData> {
  const warnings: string[] = [];
  const d = (input ?? {}) as Partial<DiagramData>;
  let mermaid = typeof d.mermaid === "string" ? d.mermaid : "";

  // 1. 剥离 LLM 常见的 markdown 代码围栏(```mermaid / ``` 包裹)
  //    这是最常见的 syntax error 根因:LLM 把 mermaid 当 markdown 代码块返回
  const fenceMatch = mermaid.match(/```(?:mermaid)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    mermaid = fenceMatch[1] ?? "";
    warnings.push("剥离了 mermaid 代码外的 markdown 围栏");
  }

  // 2. trim + 去除首尾多余空白行
  mermaid = mermaid.trim();

  if (!mermaid) {
    mermaid = "flowchart TD\n  A[空图]";
    warnings.push("mermaid 代码为空,已用占位图替代");
  } else {
    // 3. 统一图类型关键字:LLM 常用 graph(旧)代替 flowchart(新),两者 mermaid 都支持
    //    但 sequenceDiagram / stateDiagram-v2 必须精确匹配大小写
    // 4. 去除行尾多余空格(mermaid 对某些图类型敏感)
    mermaid = mermaid
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n");

    // 5. 长度截断
    if (mermaid.length > 2000) {
      mermaid = mermaid.slice(0, 2000);
      warnings.push("mermaid 代码超过 2000 字符,已截断");
    }
  }

  const diagramType =
    d.diagramType === "flowchart" || d.diagramType === "sequence" || d.diagramType === "state"
      ? d.diagramType
      : "flowchart";
  if (diagramType !== d.diagramType) {
    warnings.push(`diagramType 不合法,已默认为 flowchart`);
  }
  return {
    data: {
      artifactType: "diagram",
      title: typeof d.title === "string" && d.title ? d.title : "图示",
      diagramType,
      mermaid,
    },
    warnings,
  };
}

/** 修复 code_walkthrough:clamp 行号到 [1, codeLines]。 */
function sanitizeCodeWalkthrough(input: unknown): SanitizeResult<CodeWalkthroughData> {
  const warnings: string[] = [];
  const d = (input ?? {}) as Partial<CodeWalkthroughData>;
  const code = typeof d.code === "string" ? d.code : "";
  const codeLines = code ? code.split("\n").length : 1;
  const annotations = Array.isArray(d.annotations)
    ? d.annotations
        .filter((a) => a && typeof a.note === "string")
        .map((a, i) => {
          let lineStart = Math.max(1, Math.floor(a.lineStart ?? 1));
          let lineEnd = Math.max(lineStart, Math.floor(a.lineEnd ?? lineStart));
          if (lineEnd > codeLines) {
            warnings.push(`第 ${i + 1} 段结束行(${lineEnd})超出代码总行数(${codeLines}),已 clamp`);
            lineEnd = codeLines;
          }
          if (lineStart > codeLines) {
            warnings.push(`第 ${i + 1} 段起始行(${lineStart})超出代码总行数(${codeLines}),已 clamp`);
            lineStart = codeLines;
          }
          return { lineStart, lineEnd, note: a.note };
        })
        .slice(0, 10)
    : [];
  return {
    data: {
      artifactType: "code_walkthrough",
      title: typeof d.title === "string" && d.title ? d.title : "代码讲解",
      language: typeof d.language === "string" && d.language ? d.language : "text",
      code,
      annotations,
    },
    warnings,
  };
}

/** 修复 guess:只保留有 id+label 的选项,不足 2 个补占位(保证按钮卡永远能渲染 2 个)。 */
function sanitizeGuess(input: unknown): SanitizeResult<GuessData> {
  const warnings: string[] = [];
  const d = (input ?? {}) as Partial<GuessData>;
  const opts = Array.isArray(d.options)
    ? d.options.filter((o) => o && o.id && o.label).slice(0, 2)
    : [];
  while (opts.length < 2) {
    warnings.push(`选项不足 2 个,补了占位选项 ${opts.length + 1}`);
    opts.push({ id: `opt${opts.length}`, label: opts.length === 0 ? "(选项 A)" : "(选项 B)" });
  }
  return {
    data: {
      artifactType: "guess",
      prompt: typeof d.prompt === "string" && d.prompt ? d.prompt : "你猜哪个?",
      options: opts as GuessData["options"],
    },
    warnings,
  };
}

const SANITIZERS: Record<ArtifactType, (input: unknown) => SanitizeResult> = {
  concept_map: sanitizeConceptMap,
  quiz: sanitizeQuiz,
  compare_table: sanitizeCompareTable,
  diagram: sanitizeDiagram,
  code_walkthrough: sanitizeCodeWalkthrough,
  guess: sanitizeGuess,
};

/**
 * 统一入口:按 type 派发到对应的 sanitizer。
 * 未知 type 返回空数据 + 警告(不 throw —— 渲染层有 UnknownArtifact fallback)。
 */
export function sanitizeArtifact(input: unknown, type: string): SanitizeResult {
  const sanitizer = SANITIZERS[type as ArtifactType];
  if (!sanitizer) {
    return { data: input, warnings: [`未知产物类型: ${type}`] };
  }
  return sanitizer(input);
}

// ============================================================
// §4  质量指南(拼进 tool description,引导 LLM 产出高质量数据)
// ============================================================

export const QUALITY_GUIDE = {
  concept_map:
    "质量要求:≤ 8 个概念节点(过多会拥挤),关系清晰避免网状交叉,每个节点 label 简短(≤ 8 字)。id 用英文小写下划线(如 attention / feed_forward)。",
  quiz:
    "质量要求:3-4 题最佳(最多 5 题),每题 4 个选项,distractor 要有迷惑性(不能明显荒谬),explanation 说清为什么对/错。",
  compare_table:
    "质量要求:维度列(第一列)清晰,对比项 2-4 个(列数 ≤ 5),单元格文字简洁(≤ 15 字),最多 8 行。",
  diagram:
    "质量要求:只返回合法 mermaid 语法(不含外层```),节点 id 用英文,标签可中文。优先 flowchart TD/LR;时序用 sequenceDiagram;状态用 stateDiagram-v2。代码 ≤ 30 行。",
  code_walkthrough:
    "质量要求:代码 ≤ 30 行(超长请节选关键片段),分段 3-6 段,每段讲解 1-2 句(说清 this does what),行号从 1 开始。",
  guess:
    "质量要求:恰好 2 个选项,每个 label 简短(≤ 15 字)。这是'猜'不是'考'——选项要有趣、能引发好奇(反直觉更好),不要明显有对错。id 用英文(如 a / b)。",
} as const;
