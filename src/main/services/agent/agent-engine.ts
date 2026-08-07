/**
 * Agent 引擎 —— AI 导师的核心 loop（ARCHITECTURE v2 原则 1: Agent 通用，Skill 决定怎么教）。
 *
 * 结构：streamText 包一层工具调度循环，执行工具，写操作走 Proposal。
 *   buildSystemPrompt(db, BASE) → streamText({model, system, messages, tools, maxSteps})
 *   工具里凡是要改学习者持久状态的，都走 Proposal（原则 2）：
 *     - record_answer : 学习者答了题 → 提议 update_mastery（人确认后才落库）
 *     - mark_mastered : AI 判断掌握了 → 提议 mark_mastered
 *     - get_node_info : 只读，直接返回（不走 proposal）
 *
 * 流式：emit 回调把 text-delta / tool-call / done 推给调用方（IPC 用 webContents.send）。
 *
 * 不在这里做 LLM 调用的单元测试（要真 key + 真网络）—— 那是 §8.4 supervisor/M4 dogfood 的事。
 * 本模块的可测部分（system prompt 装配 + 工具 schema + proposal 创建）由 verify-agent.mjs 覆盖。
 */
import { streamText, tool, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import {
  contentNodes,
  progress as progressTable,
  courses,
} from "../../db/schema.js";
import type { BrowserWindow } from "electron";
import { getDb, markDirty } from "../../db/index.js";
import { resolveLlm, classifyLlmError } from "./llm-client.js";
import { chatSessions } from "../../db/schema.js";
import type { ChatStreamPart } from "@shared/types";
import { buildSystemPrompt } from "../skills/prompt-builder.js";
import {
  createProposal,
  type LearningOperation,
} from "../proposal-service.js";

type Db = SQLJsDatabase<typeof schema>;

/** Agent 给学习者的基础人设（skill body 会追加在后面，由 buildSystemPrompt 负责） */
const BASE_AGENT_PROMPT =
  "你是 LookatStudy 的 AI 学习导师。学习者正在学一门由 GitHub 文档生成的课程。" +
  "你的职责是帮学习者真正理解知识，不是简单复述文档。" +
  "用清晰、鼓励的中文回答。当学习者答错时，先肯定尝试再纠正。\n\n" +
  "【防幻觉红线】你必须严格基于下面提供的「课程上下文」和「当前节点内容」回答。" +
  "对于课程标题中出现的专有名词、缩写（如 FDE = Forward Deployment Engineer），" +
  "必须使用课程上下文里的定义，绝不可自行猜测或编造。" +
  "如果学习者问的内容超出了你掌握的上下文，明确说'这部分内容不在当前课程材料中'，" +
  "而不是编造一个看似合理的回答。\n\n" +
  "【模糊提问处理】当学习者说'我不懂''不太理解'但没说具体不懂什么时，" +
  "不要假设你知道他哪里不懂然后长篇大论。" +
  "先反问'你具体是哪个概念不太清楚？'，或者列出这课涉及的 2-3 个核心概念让他选。" +
  "只讲解学习者明确问到的部分，不要主动扩展到课程内容之外的领域知识。\n\n" +
  "【Generative UI 教学工具】你有几个能生成可视化学习产物的工具，适时使用能大幅提升理解：" +
  "- show_concept_map:理清概念间关系(架构/依赖/分类),学习者说'理不清''有什么关系'时用;" +
  "- generate_quiz:出题检验,学习者说'考考我''出题'时,或讲完一节主动出 2-3 题巩固;" +
  "- compare_table:对比 A vs B,学习者问'区别''对比'时用;" +
  "- draw_diagram:画流程/时序/状态图,讲流程类内容时用;" +
  "- show_code_walkthrough:逐段讲解代码,学习者问'这段代码'时用。" +
  "工具是手段不是目的:能用工具让知识更清晰就用,否则正常文字讲解即可。一次回复最多用 1 个工具,避免过载。\n\n" +
  "【回答排版规范】你的回答支持完整 Markdown 渲染(标题/列表/表格/代码块/引用/粗斜体),请充分利用结构化排版让内容更易读:" +
  "- 用 ##/### 划分段落,不要一整块文字;" +
  "- 并列要点用无序列表(- ),有顺序的步骤用有序列表(1. );" +
  "- 对比、属性、规格用 GFM 表格(| 列1 | 列2 |),不要堆文字;" +
  "- 重要结论用 **粗体**,术语首次出现用 *斜体*;" +
  "- 命令/代码/文件名用 `行内代码`,多行代码用 ```language 代码块;" +
  "- 提示、警告、补充说明用 > 引用块;" +
  "- 避免长段落(超过 4 行就考虑拆分或转列表)。" +
  "好的排版 = 学习者更容易抓住重点,这是教学效果的一部分。";

/** 流式事件回调 */
export interface AgentEvents {
  onTextDelta?: (delta: string) => void;
  onToolCall?: (name: string, args: unknown) => void;
  onProposalCreated?: (proposalId: string, summary: string) => void;
  onError?: (message: string) => void;
  /**
   * v0.2 parts-based 流式协议：把 fullStream 里每种 part 类型透传给渲染层。
   * 渲染层按 part.type 累积到 message.parts[]，不再字符串拼接。
   * 这是 Generative UI + thinking trace 的基础。
   *
   * part.type 取值：
   *   "text"        { type, text }              ← 文本增量（与 onTextDelta 同源，二选一）
   *   "reasoning"   { type, text }              ← 思考过程（可折叠展示）
   *   "tool-start"  { type, toolName }          ← 工具开始执行（loading 态）
   *   "tool-result" { type, toolName, output }  ← 工具返回数据（Generative UI 产物）
   *   "tool-error"  { type, toolName, error }   ← 工具执行失败
   */
  onPart?: (part: ChatStreamPart) => void;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * 根据掌握度返回教学策略指引。
 * 让 AI 知道"现在该怎么教"——这是 harness 的核心。
 */
function getTeachingStrategy(mastery: number | null): string {
  if (mastery === null || mastery < 0.1) {
    return "学习者刚开始学这一课。先建立直觉再讲细节：用类比引入概念，确认理解后再深入。不要一次性倾倒所有信息，分步骤引导。";
  }
  if (mastery < 0.4) {
    return "学习者有初步了解但还不扎实。用提问检验理解（'你能用自己的话说说X是什么吗？'），发现误解时立即纠正。多给实际例子。";
  }
  if (mastery < 0.7) {
    return "学习者基本理解了核心内容。现在要深化：对比相似概念的区别，考察边界情况，引导思考'什么时候不该用这个'。可以出一些有迷惑性的问题。";
  }
  return "学习者接近掌握。进入综合应用阶段：让学习者尝试教别人（费曼技巧），考察知识在更大系统中的角色。如果学习者能清晰复述并举例，考虑提议标记掌握。";
}

/**
 * 运行一轮 agent loop。
 *
 * @param nodeId       当前在学的 content node id（提供上下文）
 * @param messages     对话历史
 * @param events       流式回调
 * @returns            assistant 的完整文本回复
 */
export async function runAgentTurn(
  db: Db,
  nodeId: string,
  messages: ChatTurn[],
  events: AgentEvents = {},
  abortSignal?: AbortSignal,
): Promise<string> {
  const llm = resolveLlm(db);
  const system = buildSystemPrompt(db, BASE_AGENT_PROMPT);

  // 当前节点上下文（只读，给 agent 看）
  const node = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.id, nodeId))
    .get();
  const nodeProgress = db
    .select()
    .from(progressTable)
    .where(eq(progressTable.nodeId, nodeId))
    .get();

  // 课程级上下文：标题、描述、章节结构概览（防 AI 以偏概全）
  const courseId = node?.courseId;
  const course = courseId
    ? db.select().from(courses).where(eq(courses.id, courseId)).get()
    : null;
  const courseSections = courseId
    ? db
        .select()
        .from(contentNodes)
        .where(eq(contentNodes.courseId, courseId))
        .all()
        .filter((n) => n.type === "section")
        .sort((a, b) => a.orderIdx - b.orderIdx)
    : [];
  const courseOutline = courseSections
    .map((s) => `  - ${s.title}`)
    .join("\n");

  const courseContext = course
    ? `课程标题：${course.title}\n` +
      `课程描述：${course.description ?? "(无)"}\n` +
      `课程章节结构：\n${courseOutline || "  (无)"}\n`
    : "(无课程级上下文)";

  // 根据掌握度生成教学策略指引
  const mastery = nodeProgress?.mastery ?? null;
  const teachingStrategy = getTeachingStrategy(mastery);

  const nodeContext = node
    ? `${courseContext}\n` +
      `当前学习节点：${node.title}（${node.type}）\n来源：${node.sourcePath ?? "(无)"}\n` +
      `内容：${node.content ?? "(尚未生成讲解，需要时基于标题引导)"}\n` +
      `学习者当前掌握度：${mastery != null ? mastery.toFixed(2) : "未知"}\n` +
      `进度状态：${nodeProgress?.status ?? "未开始"}\n\n` +
      `教学策略指引：${teachingStrategy}`
    : "(无当前节点上下文)";

  // 工具集：只读直接返回，写操作走 proposal
  const tools: ToolSet = {
    get_node_info: tool({
      description: "读取当前学习节点的详细信息（标题、内容、掌握度）。只读。",
      inputSchema: z.object({}),
      execute: async () => {
        events.onToolCall?.("get_node_info", {});
        return {
          title: node?.title,
          type: node?.type,
          content: node?.content,
          mastery: nodeProgress?.mastery ?? null,
          status: nodeProgress?.status ?? "未开始",
        };
      },
    }),
    record_answer: tool({
      description:
        "记录学习者的一次答题观测。会生成一个 Proposal（pending）等人确认——不会直接改掌握度。",
      inputSchema: z.object({
        correct: z.boolean().describe("这次观测学习者是否答对"),
        rationale: z.string().describe("为什么这么判定（一句）"),
      }),
      execute: async (input) => {
        const { correct, rationale } = input;
        events.onToolCall?.("record_answer", { correct, rationale });
        const ops: LearningOperation[] = [
          { type: "update_mastery", nodeId, correct },
        ];
        const proposal = createProposal(db, {
          nodeId,
          operations: ops,
          rationale: `答题观测：${rationale}`,
        });
        events.onProposalCreated?.(
          proposal.id,
          `提议更新掌握度（${correct ? "答对" : "答错"}）：${rationale}`,
        );
        return {
          proposalId: proposal.id,
          status: "pending",
          message: "已生成提议，等学习者确认后才会更新掌握度。",
        };
      },
    }),
    mark_mastered: tool({
      description:
        "提议把当前节点标记为已掌握。生成 Proposal 等人确认（人可以拒绝）。",
      inputSchema: z.object({
        rationale: z.string().describe("为什么判定已掌握"),
      }),
      execute: async (input) => {
        const { rationale } = input;
        events.onToolCall?.("mark_mastered", { rationale });
        const proposal = createProposal(db, {
          nodeId,
          operations: [{ type: "mark_mastered", nodeId }],
          rationale,
        });
        events.onProposalCreated?.(
          proposal.id,
          `提议标记为已掌握：${rationale}`,
        );
        return { proposalId: proposal.id, status: "pending" };
      },
    }),
    // ===== v0.2 展示型 tool(Generative UI)=====
    // 安全模型:模型只选 tool + 提供 input(zod 校验),execute 只返回数据,
    // 不改持久状态。前端按 toolName 渲染预注册的 Artifact 组件。
    show_concept_map: tool({
      description:
        "生成一个概念图,理清当前节点的核心概念之间的关系。" +
        "当你判断学习者需要可视化结构来理解时调用(如架构图、依赖关系、分类树)。" +
        "返回的 nodes/edges 会渲染成可交互的概念图产物。",
      inputSchema: z.object({
        title: z.string().describe("概念图标题(如'Transformer 架构')"),
        nodes: z
          .array(
            z.object({
              id: z.string().describe("节点唯一 id(如'attention')"),
              label: z.string().describe("节点显示文本"),
            }),
          )
          .min(2)
          .describe("概念节点列表"),
        edges: z
          .array(
            z.object({
              from: z.string().describe("起点节点 id"),
              to: z.string().describe("终点节点 id"),
              label: z.string().optional().describe("边标签(可选,如'输入'/'包含')"),
            }),
          )
          .min(1)
          .describe("节点间的关系边"),
      }),
      execute: async (input) => {
        events.onToolCall?.("show_concept_map", input);
        return {
          artifactType: "concept_map",
          title: input.title,
          nodes: input.nodes,
          edges: input.edges,
        };
      },
    }),
    generate_quiz: tool({
      description:
        "生成一组练习题(选择题/判断题),用于巩固当前节点的学习。" +
        "当学习者需要检验理解、或主动要求练习时调用。" +
        "返回的题目会渲染成可交互的练习卡产物(提交后自动判分 + 触发 ExplainCard)。",
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              prompt: z.string().describe("题干"),
              options: z.array(z.string()).min(2).describe("选项列表"),
              answer: z.number().describe("正确选项的索引(从 0 开始)"),
              explanation: z.string().describe("为什么这个答案对(答题反馈时展示)"),
            }),
          )
          .min(1)
          .max(5)
          .describe("题目列表(1-5 题)"),
      }),
      execute: async (input) => {
        events.onToolCall?.("generate_quiz", input);
        return {
          artifactType: "quiz",
          questions: input.questions,
        };
      },
    }),
    compare_table: tool({
      description:
        "生成一个对比表,对比两个或多个概念/方案/技术的异同。" +
        "当学习者问'A 和 B 有什么区别'、或需要横向对比时调用。" +
        "返回的表格会渲染成对比表产物。",
      inputSchema: z.object({
        title: z.string().describe("对比表标题(如'SQL vs NoSQL')"),
        headers: z.array(z.string()).min(2).describe("表头列名(第一列通常是维度名)"),
        rows: z
          .array(z.array(z.string()))
          .min(1)
          .describe("表格行,每行单元格数 = headers.length"),
      }),
      execute: async (input) => {
        events.onToolCall?.("compare_table", input);
        return {
          artifactType: "compare_table",
          title: input.title,
          headers: input.headers,
          rows: input.rows,
        };
      },
    }),
    draw_diagram: tool({
      description:
        "用 Mermaid 语法画一个流程图/时序图/状态图。" +
        "当需要展示流程、时序、状态转换等结构化图示时调用。" +
        "返回的 mermaid 代码会渲染成图(支持 flowchart/sequence/state)。注意只返回合法 mermaid 语法。",
      inputSchema: z.object({
        title: z.string().describe("图标题"),
        diagramType: z
          .enum(["flowchart", "sequence", "state"])
          .describe("图类型"),
        mermaid: z
          .string()
          .describe("Mermaid 语法代码(不含外层```),如 'flowchart TD\\n  A-->B'"),
      }),
      execute: async (input) => {
        events.onToolCall?.("draw_diagram", input);
        return {
          artifactType: "diagram",
          title: input.title,
          diagramType: input.diagramType,
          mermaid: input.mermaid,
        };
      },
    }),
    show_code_walkthrough: tool({
      description:
        "对一段代码做逐行/分段讲解。当学习者问'这段代码什么意思'、" +
        "或当前节点含代码需要拆解时调用。返回带行号标注的代码 + 每段讲解。",
      inputSchema: z.object({
        title: z.string().describe("讲解标题"),
        language: z.string().describe("代码语言(如'typescript'/'python')"),
        code: z.string().describe("要讲解的代码"),
        annotations: z
          .array(
            z.object({
              lineStart: z.number().describe("起始行号(从 1 开始)"),
              lineEnd: z.number().describe("结束行号"),
              note: z.string().describe("这段代码的讲解"),
            }),
          )
          .min(1)
          .describe("逐段讲解"),
      }),
      execute: async (input) => {
        events.onToolCall?.("show_code_walkthrough", input);
        return {
          artifactType: "code_walkthrough",
          title: input.title,
          language: input.language,
          code: input.code,
          annotations: input.annotations,
        };
      },
    }),
  };

  try {
    const result = streamText({
      model: llm.languageModel,
      system: `${system}\n\n${nodeContext}`,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools,
      stopWhen: stepCountIs(6),
      abortSignal,
    });

    let full = "";
    let sawError = false;
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        full += part.text;
        events.onTextDelta?.(part.text);
        // v0.2 parts 协议：文本增量同时走 onPart（兼容期内 onTextDelta 也保留）
        events.onPart?.({ type: "text", text: part.text });
      } else if (part.type === "reasoning-delta") {
        // 思考过程增量（extended thinking / reasoning models）
        events.onPart?.({ type: "reasoning", text: part.text });
      } else if (part.type === "tool-input-start") {
        // 工具开始：渲染层可显示 loading 态
        events.onPart?.({ type: "tool-start", toolName: part.toolName });
      } else if (part.type === "tool-result") {
        // 工具返回数据 → Generative UI 产物（M2 的 concept_map/quiz 等从这里来）
        events.onPart?.({
          type: "tool-result",
          toolName: part.toolName,
          output: part.output,
        });
      } else if (part.type === "tool-error") {
        events.onPart?.({
          type: "tool-error",
          toolName: part.toolName,
          error: String(part.error ?? "工具执行失败"),
        });
      } else if (part.type === "error") {
        sawError = true;
        const classified = classifyLlmError(part.error);
        events.onError?.(classified.detail);
      }
    }
    // 被中断：不报错，返回已收到的部分
    if (abortSignal?.aborted) {
      return full || "(已停止)";
    }
    // 空响应检测：既没文本也没报错 → 可能是 key 失效或被风控
    if (!full && !sawError) {
      events.onError?.(
        "AI 未返回任何内容（空响应）。可能 key 失效、额度用完，或被内容风控拦截。请到设置页测试连接。",
      );
    }
    return full;
  } catch (e) {
    // AbortError 是正常的停止，不报错
    if (e instanceof Error && (e.name === "AbortError" || abortSignal?.aborted)) {
      return "(已停止)";
    }
    const classified = classifyLlmError(e);
    events.onError?.(classified.detail);
    return `(Agent 出错：${classified.detail})`;
  }
}

/**
 * 主进程入口：把 IPC 调用桥到 runAgentTurn + 把事件推给渲染层窗口。
 *
 * 会话历史持久化到 chat_sessions 表（nodeId → messagesJson）。
 * 中断：每个 nodeId 一个 AbortController，agent:abort 时 abort。
 */
export async function handleAgentChat(
  win: BrowserWindow | null,
  nodeId: string,
  userMessage: string,
): Promise<string> {
  const db = getDb();

  const history = loadChatHistory(db, nodeId);
  history.push({ role: "user", content: userMessage });

  // 为本次回复建 AbortController，登记到 map（abortAgentChat 可调）
  const controller = new AbortController();
  abortControllers.set(nodeId, controller);

  const reply = await runAgentTurn(
    db,
    nodeId,
    history,
    {
      onTextDelta: (delta) => win?.webContents.send("chat:token", delta),
      onToolCall: (name, args) =>
        win?.webContents.send("chat:toolCall", name, JSON.stringify(args ?? {})),
      onProposalCreated: (id, summary) => {
        win?.webContents.send("chat:proposal", id, summary, "pending");
      },
      onError: (msg) => win?.webContents.send("chat:error", msg),
      // v0.2 parts 协议：把 reasoning/tool-start/tool-result/tool-error 透传给渲染层
      onPart: (part) => win?.webContents.send("chat:part", part),
    },
    controller.signal,
  );

  abortControllers.delete(nodeId);

  history.push({ role: "assistant", content: reply });
  saveChatHistory(db, nodeId, history);
  markDirty();
  win?.webContents.send("chat:done", reply);
  return reply;
}

/** 中断某节点正在跑的 agent 回复（Stop 按钮） */
export function abortAgentChat(nodeId: string): void {
  const controller = abortControllers.get(nodeId);
  if (controller) {
    controller.abort();
    abortControllers.delete(nodeId);
  }
}

/** 取某节点的聊天历史（从 chat_sessions 表读，给渲染层加载） */
export function getChatHistory(nodeId: string): ChatTurn[] {
  return loadChatHistory(getDb(), nodeId);
}

/** 清空某节点的聊天历史 */
export function clearChatHistory(nodeId: string): void {
  const db = getDb();
  db.delete(chatSessions).where(eq(chatSessions.nodeId, nodeId)).run();
  markDirty();
}

// nodeId → AbortController（运行中的回复才能中断）
const abortControllers = new Map<string, AbortController>();

/** 从 chat_sessions 表读历史，没有返回空数组 */
function loadChatHistory(db: Db, nodeId: string): ChatTurn[] {
  const row = db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.nodeId, nodeId))
    .get();
  if (!row?.messagesJson) return [];
  try {
    const parsed = JSON.parse(row.messagesJson) as ChatTurn[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 写历史到 chat_sessions 表（upsert） */
function saveChatHistory(db: Db, nodeId: string, history: ChatTurn[]): void {
  const messagesJson = JSON.stringify(history);
  const existing = db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(eq(chatSessions.nodeId, nodeId))
    .get();
  if (existing) {
    db.update(chatSessions)
      .set({ messagesJson })
      .where(eq(chatSessions.nodeId, nodeId))
      .run();
  } else {
    const { randomUUID } = require("node:crypto") as { randomUUID: () => string };
    db.insert(chatSessions)
      .values({ id: randomUUID(), nodeId, messagesJson })
      .run();
  }
}
