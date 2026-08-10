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
 */
import { ConceptMapArtifact } from "./ConceptMapArtifact.js";
import { QuizArtifact } from "./QuizArtifact.js";
import { CompareTableArtifact } from "./CompareTableArtifact.js";
import { MermaidArtifact } from "./MermaidArtifact.js";
import { CodeWalkthroughArtifact } from "./CodeWalkthroughArtifact.js";

export interface ArtifactProps {
  data: unknown;
  /** quiz 产物答题回调(可选)。父组件接上后,答题会触发 mastery 更新。 */
  onQuizAnswered?: (question: { prompt: string }, selectedIndex: number, correct: boolean) => void;
}

/** 按 artifactType 路由到对应组件。未识别类型返回 fallback。 */
export function ArtifactRenderer({ data, onQuizAnswered }: ArtifactProps) {
  const d = data as { artifactType?: string } | null;
  if (!d || !d.artifactType) {
    return <UnknownArtifact data={data} />;
  }
  switch (d.artifactType) {
    case "concept_map":
      return <ConceptMapArtifact data={data} />;
    case "quiz":
      return <QuizArtifact data={data} onAnswered={onQuizAnswered} />;
    case "compare_table":
      return <CompareTableArtifact data={data} />;
    case "diagram":
      return <MermaidArtifact data={data} />;
    case "code_walkthrough":
      return <CodeWalkthroughArtifact data={data} />;
    default:
      return <UnknownArtifact data={data} />;
  }
}

function UnknownArtifact({ data }: ArtifactProps) {
  return (
    <div className="surface-card p-4 text-body text-neutral-500 dark:text-neutral-600 dark:text-neutral-400" data-testid="artifact-unknown">
      <div className="font-bold mb-1">🧩 产物(未识别类型)</div>
      <pre className="text-caption overflow-x-auto text-neutral-600 dark:text-neutral-400">
        {JSON.stringify(data, null, 2)?.slice(0, 200)}
      </pre>
    </div>
  );
}

export { ConceptMapArtifact, QuizArtifact, CompareTableArtifact, MermaidArtifact, CodeWalkthroughArtifact };
