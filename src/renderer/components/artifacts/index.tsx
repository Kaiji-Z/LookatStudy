/**
 * Artifact 组件统一入口 —— v0.2 Generative UI 产物(M2)。
 *
 * tool execute 返回 { artifactType, ...data },前端按 artifactType 路由到对应组件。
 * 每个产物组件是纯展示 + 局部交互,不直接改持久状态(写操作仍走 Proposal)。
 *
 * 路由表(对齐 agent-engine.ts 的 tool execute 返回):
 *   concept_map    → ConceptMapArtifact
 *   quiz           → QuizArtifact
 *   compare_table  → CompareTableArtifact
 *   diagram        → MermaidArtifact
 *   code_walkthrough → CodeWalkthroughArtifact
 *   guess          → GuessArtifact(hook 起手式的二选一猜测,不计分)
 */
import { Puzzle } from "lucide-react";
import { useLang } from "../../lib/i18n.js";
import { ConceptMapArtifact } from "./ConceptMapArtifact.js";
import { QuizArtifact } from "./QuizArtifact.js";
import { CompareTableArtifact } from "./CompareTableArtifact.js";
import { MermaidArtifact } from "./MermaidArtifact.js";
import { CodeWalkthroughArtifact } from "./CodeWalkthroughArtifact.js";
import { GuessArtifact } from "./GuessArtifact.js";

export interface ArtifactProps {
  data: unknown;
  /** quiz 产物答题回调(可选)。父组件接上后,答题会触发 mastery 更新。 */
  onQuizAnswered?: (question: { prompt: string }, selectedIndex: number, correct: boolean) => void;
  /** 当前节点掌握度(决定 quiz 完成后是否给出"标记掌握"动作)。 */
  quizMastery?: number | null;
  /** 点某下一步动作 → 发消息进对话(仅 quiz 完成态用)。 */
  onPickAction?: (message: string) => void;
  /** quiz 答完最后一题提交时自动触发(成绩单 hook 给 AI,由 AI 决定下一步)。 */
  onQuizCompleted?: (result: { title: string; correct: number; total: number; detail: { prompt: string; chosen: string; answerText: string; correct: boolean }[] }) => void;
  /** card=内联卡片(默认);canvas=裸内容给 CanvasStage 画布(黑板/全屏查看器)。 */
  variant?: "card" | "canvas";
}

/** 按 artifactType 路由到对应组件。未识别类型返回 fallback。 */
export function ArtifactRenderer({ data, onQuizAnswered, quizMastery, onPickAction, onQuizCompleted, variant = "card" }: ArtifactProps) {
  const d = data as { artifactType?: string } | null;
  if (!d || !d.artifactType) {
    return <UnknownArtifact data={data} />;
  }
  switch (d.artifactType) {
    case "concept_map":
      return <ConceptMapArtifact data={data} variant={variant} />;
    case "quiz":
      return (
        <QuizArtifact
          data={data}
          onAnswered={onQuizAnswered}
          quizMastery={quizMastery}
          onPickAction={onPickAction}
          onQuizCompleted={onQuizCompleted}
        />
      );
    case "compare_table":
      return <CompareTableArtifact data={data} variant={variant} />;
    case "diagram":
      return <MermaidArtifact data={data} variant={variant} />;
    case "code_walkthrough":
      return <CodeWalkthroughArtifact data={data} variant={variant} />;
    case "guess":
      return <GuessArtifact data={data} onPickAction={onPickAction} />;
    default:
      return <UnknownArtifact data={data} />;
  }
}

function UnknownArtifact({ data }: ArtifactProps) {
  const t = useLang();
  return (
    <div className="surface-card p-4 text-body text-ink-muted" data-testid="artifact-unknown">
      <div className="font-bold mb-1 flex items-center gap-1.5">
        <Puzzle className="w-4 h-4" />
        {t("artifact.unknownHeader")}
      </div>
      <pre className="text-caption overflow-x-auto text-ink-muted">
        {JSON.stringify(data, null, 2)?.slice(0, 200)}
      </pre>
    </div>
  );
}

export { ConceptMapArtifact, QuizArtifact, CompareTableArtifact, MermaidArtifact, CodeWalkthroughArtifact, GuessArtifact };
