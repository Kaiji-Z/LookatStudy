/**
 * CodeWalkthroughArtifact —— 代码逐段讲解产物(M2, v0.2.1 交互优化, v0.11 弹窗查看)。
 *
 * tool show_code_walkthrough 返回 { code, annotations }。
 * 渲染:带行号的代码 + 每段标注(点击高亮 + 自动滚动到对应行)。
 *
 * v0.2.1 优化:
 *   - 点击标注 → 代码块自动滚动到对应行(scrollIntoView)
 *   - 移动端单列布局(代码在上,讲解在下);大屏双列
 *   - harness 警告展示
 *
 * v0.11:手机全屏读码 —— 点代码块/「放大查看」进弹窗,弹窗里单指拖动 + 双指捏合
 * (zoom 属性重排);标注点击联动在弹窗内同样生效(独立的 modal 行 ref,互不覆盖)。
 */
import { useRef, useState } from "react";
import { Code2, AlertTriangle, Maximize2 } from "lucide-react";
import { useLang } from "../../lib/i18n.js";
import { DiagramViewerModal } from "./DiagramViewerModal.js";
import { CanvasStage } from "../CanvasStage.js";

interface Annotation {
  lineStart: number;
  lineEnd: number;
  note: string;
}
interface CodeWalkthroughData {
  artifactType: "code_walkthrough";
  title: string;
  language: string;
  code: string;
  annotations: Annotation[];
  /** harness 可能注入的修复警告 */
  warnings?: string[];
}

export function CodeWalkthroughArtifact({ data, variant = "card" }: { data: unknown; variant?: "card" | "canvas" }) {
  const d = data as CodeWalkthroughData;
  const t = useLang();
  const [activeAnnotation, setActiveAnnotation] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  /** canvas 变体(黑板/全屏画布)专用 ref:与卡片内联互不覆盖 */
  const canvasLineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lines = d.code.split("\n");

  const isLineHighlighted = (lineNum: number) => {
    if (activeAnnotation === null) return false;
    const a = d.annotations[activeAnnotation];
    return a && lineNum >= a.lineStart && lineNum <= a.lineEnd;
  };

  const handleAnnotationClick = (i: number) => {
    const next = activeAnnotation === i ? null : i;
    setActiveAnnotation(next);
    if (next !== null) {
      // 滚动代码块到标注的起始行(弹窗开着滚弹窗内的行,否则滚内联的行)
      const a = d.annotations[next];
      const el = (expanded ? canvasLineRefs : lineRefs).current[a.lineStart - 1];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  /** 代码块(带行号)。refs 数组按调用方传入 —— 内联与弹窗两份副本互不覆盖 ref。
   *  代码块固定深底(neutral-950),文字必须用固定浅色 —— 不能用 ink token
   *  (亮色主题下 ink 变深字,黑底上不可读)。 */
  const renderCode = (refs: React.MutableRefObject<(HTMLDivElement | null)[]>) => (
    <div className="bg-neutral-950 rounded-lg overflow-hidden border border-neutral-800 max-h-[420px] overflow-y-auto">
      <pre className="text-label font-mono leading-relaxed overflow-x-auto">
        <code>
          {lines.map((line, i) => {
            const lineNum = i + 1;
            return (
              <div
                key={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className={`flex ${isLineHighlighted(lineNum) ? "bg-brand/15" : ""}`}
              >
                <span className="select-none text-neutral-600 pr-3 pl-3 text-right w-10 shrink-0 border-r border-neutral-800 tabular-nums">
                  {lineNum}
                </span>
                <span className="text-neutral-200 pl-3 whitespace-pre">{line || " "}</span>
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );

  const annotationsEl = (
    <div className="space-y-2">
      <div className="text-caption font-bold text-ink-muted">
        {t("artifact.codewalk.sectionLabel")}
      </div>
      {d.annotations.map((a, i) => (
        <button
          key={i}
          onClick={() => handleAnnotationClick(i)}
          data-testid={`annotation-${i}`}
          className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
            activeAnnotation === i
              ? "border-brand bg-brand/10"
              : "border-[var(--border-faint)] hover:border-[var(--border)]"
          }`}
        >
          <div className="text-caption font-bold text-brand mb-0.5">
            {a.lineEnd !== a.lineStart
              ? t("artifact.codewalk.lineRange", { a: a.lineStart, b: a.lineEnd })
              : t("artifact.codewalk.lineSingle", { n: a.lineStart })}
          </div>
          <div className="text-body text-ink-muted leading-relaxed">
            {a.note}
          </div>
        </button>
      ))}
    </div>
  );

  /* canvas 变体:裸代码块(标注留在卡片;画布上读码为主,CanvasStage 接管缩放平移) */
  if (variant === "canvas") {
    return (
      <div className="w-fit" data-testid="codewalk-canvas-content">
        {renderCode(canvasLineRefs)}
      </div>
    );
  }

  return (
    <div className="surface-card p-4" data-testid="artifact-code-walkthrough">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 className="w-4 h-4 text-ink-muted shrink-0" />
          <h3 className="text-body font-bold text-ink truncate">{d.title}</h3>
          <span className="text-caption font-bold px-1.5 py-0.5 rounded bg-surface-3 text-ink-muted font-mono shrink-0">
            {d.language}
          </span>
        </div>
        <button
          onClick={() => setExpanded(true)}
          data-testid="codewalk-expand"
          aria-label={t("artifact.viewer.open")}
          data-tooltip={t("artifact.viewer.open")}
          className="w-6 h-6 rounded border border-[var(--border)] text-ink-muted hover:bg-surface-3 flex items-center justify-center shrink-0"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 代码块(带行号)。内联:手机点代码进弹窗读 */}
        <div
          onClick={() => { if (!expanded) setExpanded(true); }}
          style={{ touchAction: "pan-x pan-y" }}
          data-noswipe="" /* 代码横向滚动与 T3 切栏滑动手势互斥 */
        >
          {renderCode(lineRefs)}
        </div>
        {annotationsEl}
      </div>

      {d.warnings && d.warnings.length > 0 && (
        <div className="mt-2 text-caption text-warning flex items-start gap-1" data-testid="artifact-warnings">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{d.warnings.join("; ")}</span>
        </div>
      )}

      {/* 全屏画布读码(CanvasStage):纯 transform,捏合看小字;标注留在卡片 */}
      {expanded && (
        <DiagramViewerModal title={d.title} onClose={() => setExpanded(false)}>
          <div className="h-full w-full rounded-xl overflow-hidden bg-surface-0/60">
            <CanvasStage testid="codewalk-modal-stage">
              <CodeWalkthroughArtifact data={data} variant="canvas" />
            </CanvasStage>
          </div>
        </DiagramViewerModal>
      )}
    </div>
  );
}
