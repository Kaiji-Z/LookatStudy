/**
 * 左栏容器 —— 包裹 ChatPanel，处理折叠态。
 *
 * 折叠时渲染成 46px 窄条（只有展开按钮）；
 * 展开时渲染完整 ChatPanel。
 */
import type { ContentNode } from "@shared/types";
import { ChatPanel } from "./ChatPanel.js";

export function Sidebar({
  collapsed,
  onToggleCollapse,
  selectedNode,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  selectedNode: ContentNode | null;
}) {
  if (collapsed) {
    return (
      <div
        className="w-12 shrink-0 bg-neutral-950 border-r border-neutral-800 flex flex-col items-center py-3"
        data-testid="sidebar-collapsed"
      >
        <button
          onClick={onToggleCollapse}
          className="text-neutral-400 hover:text-brand text-lg"
          title="展开聊天栏"
          data-testid="chat-expand-btn"
        >
          ▶
        </button>
        <div
          className="mt-3 text-[10px] text-neutral-600 writing-mode-vertical"
          style={{ writingMode: "vertical-rl" }}
        >
          AI 导师
        </div>
      </div>
    );
  }
  return <ChatPanel selectedNode={selectedNode} onToggleCollapse={onToggleCollapse} />;
}
