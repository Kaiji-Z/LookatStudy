/**
 * Agent 引擎 —— AI 导师的核心 loop（ARCHITECTURE v2 原则 1: Agent 通用，Skill 决定怎么教）。
 *
 * 结构（借鉴 OpenChatCut runtime.ts）：
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
} from "../../db/schema.js";
import type { BrowserWindow } from "electron";
import { getDb, markDirty } from "../../db/index.js";
import { resolveLlm } from "./llm-client.js";
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
  "用清晰、鼓励的中文回答。当学习者答错时，先肯定尝试再纠正。";

/** 流式事件回调 */
export interface AgentEvents {
  onTextDelta?: (delta: string) => void;
  onToolCall?: (name: string, args: unknown) => void;
  onProposalCreated?: (proposalId: string, summary: string) => void;
  onError?: (message: string) => void;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
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

  const nodeContext = node
    ? `当前学习节点：${node.title}（${node.type}）\n来源：${node.sourcePath ?? "(无)"}\n` +
      `内容：${node.content ?? "(尚未生成讲解，需要时基于标题引导)"}\n` +
      `学习者当前掌握度：${nodeProgress?.mastery != null ? nodeProgress.mastery.toFixed(2) : "未知"}\n` +
      `进度状态：${nodeProgress?.status ?? "未开始"}`
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
    });

    let full = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        full += part.text;
        events.onTextDelta?.(part.text);
      } else if (part.type === "error") {
        const msg =
          part.error instanceof Error ? part.error.message : String(part.error);
        events.onError?.(msg);
      }
    }
    return full;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    events.onError?.(msg);
    return `(Agent 出错：${msg})`;
  }
}

/**
 * 主进程入口：把 IPC 调用桥到 runAgentTurn + 把事件推给渲染层窗口。
 */
export async function handleAgentChat(
  win: BrowserWindow | null,
  nodeId: string,
  userMessage: string,
): Promise<string> {
  const db = getDb();

  // 简单的会话历史：内存里按 nodeId 存（M3 再持久化到 chat_sessions）
  const history = chatHistoryByNode.get(nodeId) ?? [];
  history.push({ role: "user", content: userMessage });

  const reply = await runAgentTurn(db, nodeId, history, {
    onTextDelta: (delta) => win?.webContents.send("chat:token", delta),
    onToolCall: (name) =>
      win?.webContents.send("import:progress", `工具调用：${name}`),
    onProposalCreated: (id, summary) => {
      win?.webContents.send("import:progress", `新提议：${summary}（#${id.slice(0, 8)}）`);
    },
    onError: (msg) => win?.webContents.send("chat:error", msg),
  });

  history.push({ role: "assistant", content: reply });
  chatHistoryByNode.set(nodeId, history);
  markDirty();
  win?.webContents.send("chat:done", reply);
  return reply;
}

// 内存会话历史（nodeId → turns）。M3 持久化到 chat_sessions 表。
const chatHistoryByNode = new Map<string, ChatTurn[]>();
