/**
 * 聊天面板（左栏）—— AI 导师对话区。
 *
 * 功能：
 *   - 消息列表：user 右气泡 / assistant 左气泡 + Markdown 渲染 + 流式打字
 *   - 工具调用条：chat:toolCall 事件 → 插一行"🔧 工具名"
 *   - 提议卡：chat:proposal 事件 → 应用/拒绝按钮（走 proposal:apply/reject IPC）
 *   - 无 LLM key 时：显示就地配置引导（provider 选择 + key 输入 → setSetting）
 *   - 有 key 时：textarea + 发送，调 agentChat(nodeId, msg)
 *
 * 联动：父组件传入 selectedNode（当前学习的 lesson），顶部显示节点标题。
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "../lib/api.js";
import type { ContentNode, Skill, StarterPrompt } from "@shared/types";
import ReactMarkdown from "react-markdown";
import { ExercisePanel } from "./ExercisePanel.js";
import { SettingsView } from "./SettingsView.js";
import { translate } from "../lib/i18n.js";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "proposal";
  content: string;
  // proposal 消息专用
  proposalId?: string;
  proposalStatus?: "pending" | "applied" | "rejected";
}

interface AgentReadyState {
  ready: boolean;
  provider?: string;
  model?: string;
  missing?: string;
}

let msgIdCounter = 0;
const nextMsgId = () => `msg-${++msgIdCounter}`;

const SKILL_LABELS: Record<string, string> = {
  "socratic-mode": "苏格拉底",
  "exam-prep-mode": "考试冲刺",
  "project-mode": "项目实战",
  "review-mode": "复习",
};

export function ChatPanel({
  selectedNode,
  onToggleCollapse,
  skills,
  activeSkill,
  onPickSkill,
}: {
  selectedNode: ContentNode | null;
  onToggleCollapse: () => void;
  skills: Skill[];
  activeSkill: string | null;
  onPickSkill: (name: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [agentReady, setAgentReady] = useState<AgentReadyState | null>(null);
  const [panelMode, setPanelMode] = useState<"chat" | "exercise" | "settings">("chat");
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 拉就绪状态
  const checkReady = useCallback(async () => {
    try {
      const r = await api.isAgentReady();
      setAgentReady(r);
    } catch {
      setAgentReady({ ready: false, missing: "无法检查就绪状态" });
    }
  }, []);

  useEffect(() => {
    checkReady();
  }, [checkReady]);

  // 监听全局 "llm-config-changed" 事件：设置页保存后触发，重新检查就绪状态
  useEffect(() => {
    const handler = () => checkReady();
    window.addEventListener("llm-config-changed", handler);
    return () => window.removeEventListener("llm-config-changed", handler);
  }, [checkReady]);

  // 订阅流式事件（chat:token / done / error / toolCall / proposal）
  useEffect(() => {
    const offs: Array<() => void> = [];

    offs.push(
      api.on("chat:token", (chunk: string) => {
        setMessages((prev) => {
          // 找最后一条 assistant 消息，追加 token；没有就建一条
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant") {
            const copy = [...prev];
            copy[copy.length - 1] = {
              ...last,
              content: last.content + chunk,
            };
            return copy;
          }
          return [
            ...prev,
            { id: nextMsgId(), role: "assistant", content: chunk },
          ];
        });
      }),
    );

    offs.push(
      api.on("chat:done", () => {
        setStreaming(false);
      }),
    );

    offs.push(
      api.on("chat:error", (err: string) => {
        setStreaming(false);
        setMessages((prev) => [
          ...prev,
          { id: nextMsgId(), role: "assistant", content: `⚠️ ${err}` },
        ]);
      }),
    );

    offs.push(
      api.on("chat:toolCall", (name: string) => {
        setMessages((prev) => [
          ...prev,
          { id: nextMsgId(), role: "tool", content: name },
        ]);
      }),
    );

    offs.push(
      api.on("chat:proposal", (proposalId: string, summary: string) => {
        setMessages((prev) => [
          ...prev,
          {
            id: nextMsgId(),
            role: "proposal",
            content: summary,
            proposalId,
            proposalStatus: "pending",
          },
        ]);
      }),
    );

    return () => offs.forEach((off) => off());
  }, []);

  // 自动滚到底
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 节点切换时加载持久化的聊天历史
  useEffect(() => {
    if (!selectedNode) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const history = await api.getChatHistory(selectedNode.id);
        if (cancelled) return;
        setMessages(
          history.map((m) => ({
            id: nextMsgId(),
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
        );
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedNode?.id]);

  // 节点切换时加载 starter prompts
  useEffect(() => {
    if (!selectedNode) {
      setStarterPrompts([]);
      return;
    }
    api.getStarterPrompts(selectedNode.id).then(setStarterPrompts).catch(() => setStarterPrompts([]));
  }, [selectedNode?.id]);

  const handleSend = async () => {
    if (!input.trim() || streaming || !selectedNode || !agentReady?.ready)
      return;
    const text = input.trim();
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: nextMsgId(), role: "user", content: text },
    ]);
    setStreaming(true);
    try {
      await api.agentChat(selectedNode.id, text);
    } catch (e) {
      setStreaming(false);
      setMessages((prev) => [
        ...prev,
        {
          id: nextMsgId(),
          role: "assistant",
          content: `⚠️ ${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    }
  };

  // 停止正在流的回复（Stop 按钮）
  // 点击 starter prompt 按钮 → 直接发送该消息
  const handleStarterClick = async (msg: string) => {
    if (streaming || !selectedNode || !agentReady?.ready) return;
    setMessages((prev) => [...prev, { id: nextMsgId(), role: "user", content: msg }]);
    setStreaming(true);
    try {
      await api.agentChat(selectedNode.id, msg);
    } catch (e) {
      setStreaming(false);
      setMessages((prev) => [...prev, { id: nextMsgId(), role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : String(e)}` }]);
    }
  };

  const handleStop = async () => {
    if (!selectedNode || !streaming) return;
    try {
      await api.abortAgentChat(selectedNode.id);
    } catch {
      /* 忽略 */
    }
    setStreaming(false);
  };

  // 清空当前节点的聊天历史
  const handleClearHistory = async () => {
    if (!selectedNode) return;
    if (!confirm("确定清空当前节点的对话历史？")) return;
    try {
      await api.clearChatHistory(selectedNode.id);
      setMessages([]);
    } catch {
      /* 忽略 */
    }
  };

  const handleApplyProposal = async (proposalId: string, msgId: string) => {
    try {
      await api.applyProposal(proposalId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, proposalStatus: "applied" } : m,
        ),
      );
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextMsgId(),
          role: "assistant",
          content: `⚠️ 应用提议失败：${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    }
  };

  const handleRejectProposal = async (proposalId: string, msgId: string) => {
    try {
      await api.rejectProposal(proposalId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, proposalStatus: "rejected" } : m,
        ),
      );
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextMsgId(),
          role: "assistant",
          content: `⚠️ 拒绝提议失败：${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-neutral-50 dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800"
      data-testid="chat-panel"
    >
      {/* 顶栏：当前节点 + 折叠按钮 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 shrink-0">
        <div className="text-xs text-neutral-400 truncate flex-1">
          {selectedNode ? (
            <span data-testid="chat-current-node">
              📍 {selectedNode.title}
            </span>
          ) : (
            <span className="text-neutral-600">未选择节点</span>
          )}
        </div>
        <button
          onClick={onToggleCollapse}
          className="text-neutral-500 hover:text-neutral-200 ml-2 shrink-0"
          title="折叠聊天栏"
          data-testid="chat-collapse-btn"
        >
          ◀
        </button>
      </div>

      {/* 模式切换：💬对话 / 📝练习 / ⚙️设置（始终显示） */}
      <div className="flex border-b border-neutral-800 shrink-0">
        <button
          onClick={() => setPanelMode("chat")}
          data-testid="mode-chat"
          className={`flex-1 text-xs py-1.5 ${panelMode === "chat" ? "text-brand border-b-2 border-brand" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          {translate("mode.chat")}
        </button>
        <button
          onClick={() => setPanelMode("exercise")}
          data-testid="mode-exercise"
          className={`flex-1 text-xs py-1.5 ${panelMode === "exercise" ? "text-brand border-b-2 border-brand" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          {translate("mode.exercise")}
        </button>
        <button
          onClick={() => setPanelMode("settings")}
          data-testid="mode-settings"
          className={`flex-1 text-xs py-1.5 ${panelMode === "settings" ? "text-brand border-b-2 border-brand" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          {translate("mode.settings")}
        </button>
      </div>

      {/* 学习模式选择器（AI 怎么教）— 仅在非设置模式时显示 */}
      {panelMode !== "settings" && skills.length > 0 && (
        <div className="flex gap-1 px-3 py-1.5 border-b border-neutral-800 shrink-0 overflow-x-auto" data-testid="skill-picker-left">
          {skills.map((s) => {
            const isActive = s.name === activeSkill;
            const label = SKILL_LABELS[s.name] ?? s.name;
            return (
              <button
                key={s.id}
                onClick={() => onPickSkill(s.name)}
                title={s.description}
                data-testid={`skill-pill-${s.name}`}
                className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                  isActive
                    ? "border-brand bg-brand/20 text-brand font-semibold"
                    : "border-neutral-700 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* ⚙️ 设置模式：显示 SettingsView（滚动） */}
      {panelMode === "settings" ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
          <SettingsView />
        </div>
      ) : panelMode === "exercise" && agentReady?.ready ? (
        <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
          <ExercisePanel node={selectedNode} />
        </div>
      ) : (
        <>
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          selectedNode
            ? agentReady?.ready
              ? (
                <div className="text-center mt-12">
                  <div className="text-4xl mb-3 opacity-30">💬</div>
                  <div className="text-neutral-500 text-sm">{translate("chat.starter.hint")}</div>
                </div>
              )
              : (
                <div className="flex flex-col items-center justify-center mt-12 gap-4">
                  <div className="text-center">
                    <div className="text-4xl mb-3 opacity-40">🤖</div>
                    <div className="text-sm text-neutral-400 mb-1">{translate("chat.no_key.title")}</div>
                    <div className="text-xs text-neutral-600">{translate("chat.no_key.desc")}</div>
                  </div>
                  <button
                    onClick={() => setPanelMode("settings")}
                    data-testid="goto-settings-btn"
                    className="btn-3d-brand px-6 py-2.5 text-sm"
                  >
                    {translate("chat.no_key.btn")}
                  </button>
                </div>
              )
            : (
              <div className="text-neutral-600 text-sm text-center mt-8">
                → {translate("chat.input.no_node")}
              </div>
            )
        )}
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            msg={m}
            onApply={() => m.proposalId && handleApplyProposal(m.proposalId, m.id)}
            onReject={() => m.proposalId && handleRejectProposal(m.proposalId, m.id)}
          />
        ))}
        {streaming && (
          <div className="text-xs text-brand animate-pulse">● ● ●</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 / 未配key时的引导 */}
      <div className="border-t border-neutral-800 p-3 shrink-0">
        {!agentReady?.ready ? (
          <div className="flex items-center justify-center gap-3 py-2">
            <span className="text-xs text-neutral-500">{agentReady?.missing ?? "未配置 AI 模型"}</span>
            <button
              onClick={() => setPanelMode("settings")}
              className="text-xs text-brand hover:underline font-bold"
            >
              去配置 →
            </button>
          </div>
        ) : (
          <>
            {/* 常驻 starter 按钮（输入框上方，横向可滚动） */}
            {starterPrompts.length > 0 && selectedNode && (
              <div className="flex gap-1.5 overflow-x-auto pb-2 mb-1 scrollbar-thin" data-testid="starter-prompts">
                {starterPrompts.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handleStarterClick(p.message)}
                    disabled={streaming}
                    data-testid={`starter-prompt-${i}`}
                    className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-neutral-700 bg-neutral-900/50 hover:border-brand/50 hover:bg-brand/5 hover:text-brand transition-all text-neutral-400"
                  >
                    <span>{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              placeholder={
                selectedNode
                  ? translate("chat.input.placeholder")
                  : translate("chat.input.no_node")
              }
                disabled={streaming || !selectedNode}
                rows={2}
                data-testid="chat-input"
                className="flex-1 bg-neutral-900 text-neutral-100 text-sm rounded-lg px-3 py-2 resize-none border border-neutral-700 focus:border-brand focus:outline-none disabled:opacity-50"
              />
              {streaming ? (
                <button
                  onClick={handleStop}
                  data-testid="chat-stop"
                  className="bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-red-500 shrink-0"
                >
                  {translate("chat.stop")}
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={streaming || !input.trim() || !selectedNode}
                  data-testid="chat-send"
                  className="bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {translate("chat.send")}
                </button>
              )}
            </div>
            {messages.length > 0 && !streaming && (
              <button
                onClick={handleClearHistory}
                data-testid="chat-clear"
                className="mt-2 text-[11px] text-neutral-600 hover:text-neutral-400"
              >
                {translate("chat.clear")}
              </button>
            )}
          </>
        )}
      </div>
        </>
      )}
    </div>
  );
}

/* ---------- 单条消息 ---------- */

function MessageRow({
  msg,
  onApply,
  onReject,
}: {
  msg: ChatMessage;
  onApply: () => void;
  onReject: () => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end msg-enter">
        <div className="bg-brand text-white text-sm rounded-2xl rounded-tr-md px-4 py-2.5 max-w-[85%] font-medium shadow-md" style={{ boxShadow: "0 2px 8px rgba(88,204,2,0.2)" }}>
          {msg.content}
        </div>
      </div>
    );
  }
  if (msg.role === "tool") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 msg-enter py-1">
        <span className="bg-neutral-800 rounded px-1.5 py-0.5 font-mono">🔧 {msg.content}</span>
      </div>
    );
  }
  if (msg.role === "proposal") {
    return (
      <div className="proposal-card msg-enter" data-testid="proposal-card">
        <div className="text-neutral-200 text-xs mb-2 flex items-center gap-1.5">
          <span className="text-sm">📋</span>
          <span className="font-bold">AI 提议</span>
        </div>
        <div className="text-neutral-300 text-xs mb-3">{msg.content}</div>
        {msg.proposalStatus === "pending" ? (
          <div className="flex gap-2">
            <button
              onClick={onApply}
              data-testid="proposal-apply"
              className="btn-3d-brand px-4 py-1.5 text-xs"
            >
              ✓ 应用
            </button>
            <button
              onClick={onReject}
              data-testid="proposal-reject"
              className="btn-3d-neutral px-4 py-1.5 text-xs"
            >
              ✕ 拒绝
            </button>
          </div>
        ) : (
          <span className={`text-xs font-bold ${msg.proposalStatus === "applied" ? "text-brand" : "text-neutral-500"}`}>
            {msg.proposalStatus === "applied" ? "✅ 已应用" : "❌ 已拒绝"}
          </span>
        )}
      </div>
    );
  }
  // assistant — 带头像
  return (
    <div className="flex justify-start gap-2 msg-enter">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-dark flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5" style={{ boxShadow: "0 2px 6px rgba(28,176,246,0.2)" }}>
        AI
      </div>
      <div className="bg-neutral-900 text-neutral-100 text-sm rounded-2xl rounded-tl-md px-4 py-2.5 max-w-[85%] prose prose-invert prose-sm leading-relaxed">
        <ReactMarkdown>{msg.content}</ReactMarkdown>
      </div>
    </div>
  );
}

/* ConfigGuide 已废弃——未配 key 时走引导按钮跳转设置页（见上方 goto-settings-btn）*/
