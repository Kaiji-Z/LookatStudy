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
import type { ContentNode, Skill } from "@shared/types";
import ReactMarkdown from "react-markdown";
import { ExercisePanel } from "./ExercisePanel.js";
import { SettingsView } from "./SettingsView.js";

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
  const [configMode, setConfigMode] = useState(false);
  const [panelMode, setPanelMode] = useState<"chat" | "exercise" | "settings">("chat");
  // 配置引导的本地态
  const [cfgProvider, setCfgProvider] = useState("glm");
  const [cfgKey, setCfgKey] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 拉就绪状态
  const checkReady = useCallback(async () => {
    try {
      const r = await api.isAgentReady();
      setAgentReady(r);
      setConfigMode(!r.ready);
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

  const handleSaveConfig = async () => {
    const keyMap: Record<string, string> = {
      glm: "glm_api_key",
      openai: "openai_api_key",
      deepseek: "deepseek_api_key",
      anthropic: "anthropic_api_key",
      google: "google_api_key",
    };
    const keyField = keyMap[cfgProvider];
    if (!keyField || !cfgKey.trim()) return;
    try {
      await api.setSetting(keyField as Parameters<typeof api.setSetting>[0], cfgKey.trim());
      await api.setSetting("active_provider", cfgProvider);
      setCfgKey("");
      await checkReady(); // 重新检查就绪
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextMsgId(),
          role: "assistant",
          content: `⚠️ 保存配置失败：${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-neutral-950 border-r border-neutral-800"
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
          💬 对话
        </button>
        <button
          onClick={() => setPanelMode("exercise")}
          data-testid="mode-exercise"
          className={`flex-1 text-xs py-1.5 ${panelMode === "exercise" ? "text-brand border-b-2 border-brand" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          📝 练习
        </button>
        <button
          onClick={() => setPanelMode("settings")}
          data-testid="mode-settings"
          className={`flex-1 text-xs py-1.5 ${panelMode === "settings" ? "text-brand border-b-2 border-brand" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          ⚙️ 设置
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
          <div className="text-neutral-600 text-sm text-center mt-8">
            {selectedNode
              ? agentReady?.ready
                ? `开始学「${selectedNode.title}」——问 AI 导师任何问题`
                : "配置 API key 后即可开始 AI 教学"
              : "→ 点击右侧的 lesson 气泡，开始学习"}
          </div>
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

      {/* 输入区 / 配置引导 */}
      <div className="border-t border-neutral-800 p-3 shrink-0">
        {configMode || !agentReady?.ready ? (
          <ConfigGuide
            provider={cfgProvider}
            setProvider={setCfgProvider}
            apiKey={cfgKey}
            setApiKey={setCfgKey}
            missing={agentReady?.missing}
            onSave={handleSaveConfig}
          />
        ) : (
          <>
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
                    ? "问 AI 导师…（Enter 发送）"
                    : "先在右侧选一个 lesson…"
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
                  停止
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={streaming || !input.trim() || !selectedNode}
                  data-testid="chat-send"
                  className="bg-brand text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  发送
                </button>
              )}
            </div>
            {messages.length > 0 && !streaming && (
              <button
                onClick={handleClearHistory}
                data-testid="chat-clear"
                className="mt-2 text-[11px] text-neutral-600 hover:text-neutral-400"
              >
                清空对话历史
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
      <div className="flex justify-end">
        <div className="bg-brand/20 text-neutral-100 text-sm rounded-lg px-3 py-2 max-w-[85%]">
          {msg.content}
        </div>
      </div>
    );
  }
  if (msg.role === "tool") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        <span>🔧</span>
        <span className="font-mono">{msg.content}</span>
      </div>
    );
  }
  if (msg.role === "proposal") {
    return (
      <div
        className="border border-accent/40 bg-accent/5 rounded-lg p-2.5 text-xs"
        data-testid="proposal-card"
      >
        <div className="text-neutral-300 mb-2">
          📋 <span className="font-medium">AI 提议：</span>
          {msg.content}
        </div>
        {msg.proposalStatus === "pending" ? (
          <div className="flex gap-2">
            <button
              onClick={onApply}
              data-testid="proposal-apply"
              className="bg-brand text-white px-3 py-1 rounded hover:bg-brand/80"
            >
              应用
            </button>
            <button
              onClick={onReject}
              data-testid="proposal-reject"
              className="border border-neutral-600 text-neutral-300 px-3 py-1 rounded hover:bg-neutral-800"
            >
              拒绝
            </button>
          </div>
        ) : (
          <span
            className={
              msg.proposalStatus === "applied"
                ? "text-brand font-medium"
                : "text-neutral-500"
            }
          >
            {msg.proposalStatus === "applied" ? "✅ 已应用" : "❌ 已拒绝"}
          </span>
        )}
      </div>
    );
  }
  // assistant
  return (
    <div className="flex justify-start">
      <div className="bg-neutral-900 text-neutral-100 text-sm rounded-lg px-3 py-2 max-w-[85%] prose prose-invert prose-sm">
        <ReactMarkdown>{msg.content}</ReactMarkdown>
      </div>
    </div>
  );
}

/* ---------- 配置引导（无 key 时） ---------- */

function ConfigGuide({
  provider,
  setProvider,
  apiKey,
  setApiKey,
  missing,
  onSave,
}: {
  provider: string;
  setProvider: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  missing?: string;
  onSave: () => void;
}) {
  return (
    <div className="space-y-2" data-testid="config-guide">
      <div className="text-xs text-neutral-400">
        🔑 {missing ?? "未配置 LLM API key"}
      </div>
      <select
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
        data-testid="config-provider"
        className="w-full bg-neutral-900 text-neutral-100 text-sm rounded px-2 py-1.5 border border-neutral-700"
      >
        <option value="glm">智谱 GLM（国内推荐）</option>
        <option value="deepseek">DeepSeek</option>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic Claude</option>
        <option value="google">Google Gemini</option>
      </select>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="粘贴 API key（sk-…）"
        data-testid="config-key-input"
        className="w-full bg-neutral-900 text-neutral-100 text-sm rounded px-2 py-1.5 border border-neutral-700 focus:border-brand focus:outline-none"
      />
      <button
        onClick={onSave}
        disabled={!apiKey.trim()}
        data-testid="config-save"
        className="w-full bg-brand text-white text-sm font-medium px-3 py-1.5 rounded hover:bg-brand/80 disabled:opacity-40"
      >
        保存并连接
      </button>
      <p className="text-[10px] text-neutral-600">
        key 只存本地主进程，不离开你的电脑。
      </p>
    </div>
  );
}
