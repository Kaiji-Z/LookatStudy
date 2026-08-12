/**
 * CodeWalkthroughArtifact —— 代码逐段讲解产物(M2, v0.2.1 交互优化)。
 *
 * tool show_code_walkthrough 返回 { code, annotations }。
 * 渲染:带行号的代码 + 每段标注(点击高亮 + 自动滚动到对应行)。
 *
 * v0.2.1 优化:
 *   - 点击标注 → 代码块自动滚动到对应行(scrollIntoView)
 *   - 移动端单列布局(代码在上,讲解在下);大屏双列
 *   - harness 警告展示
 */
import { useRef, useState } from "react";
import { Code2, AlertTriangle } from "lucide-react";
import { useLang } from "../../lib/i18n.js";

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

export function CodeWalkthroughArtifact({ data }: { data: unknown }) {
  const d = data as CodeWalkthroughData;
  const t = useLang();
  const [activeAnnotation, setActiveAnnotation] = useState<number | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
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
      // 滚动代码块到标注的起始行
      const a = d.annotations[next];
      const el = lineRefs.current[a.lineStart - 1];
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <div className="surface-card p-4" data-testid="artifact-code-walkthrough">
      <div className="flex items-center gap-2 mb-3">
        <Code2 className="w-4 h-4 text-ink-muted shrink-0" />
        <h3 className="text-body font-bold text-neutral-800 dark:text-neutral-200">{d.title}</h3>
        <span className="text-caption font-bold px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-ink-muted font-mono">
          {d.language}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 代码块(带行号) */}
        <div className="bg-neutral-950 rounded-lg overflow-hidden border border-neutral-800 max-h-[420px] overflow-y-auto">
          <pre className="text-label font-mono leading-relaxed overflow-x-auto">
            <code>
              {lines.map((line, i) => {
                const lineNum = i + 1;
                return (
                  <div
                    key={i}
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    className={`flex ${isLineHighlighted(lineNum) ? "bg-brand/15" : ""}`}
                  >
                    <span className="select-none text-neutral-600 pr-3 pl-3 text-right w-10 shrink-0 border-r border-neutral-800">
                      {lineNum}
                    </span>
                    <span className="text-neutral-700 dark:text-neutral-300 pl-3 whitespace-pre">{line || " "}</span>
                  </div>
                );
              })}
            </code>
          </pre>
        </div>

        {/* 讲解列表 */}
        <div className="space-y-2">
          <div className="text-caption font-bold text-ink-muted uppercase tracking-wider">
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
                  : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-500"
              }`}
            >
              <div className="text-caption font-bold text-brand mb-0.5">
                {a.lineEnd !== a.lineStart
                  ? t("artifact.codewalk.lineRange", { a: a.lineStart, b: a.lineEnd })
                  : t("artifact.codewalk.lineSingle", { n: a.lineStart })}
              </div>
              <div className="text-body text-neutral-700 dark:text-neutral-300 leading-relaxed">
                {a.note}
              </div>
            </button>
          ))}
        </div>
      </div>

      {d.warnings && d.warnings.length > 0 && (
        <div className="mt-2 text-caption text-amber-600 dark:text-amber-400 flex items-start gap-1" data-testid="artifact-warnings">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{d.warnings.join("; ")}</span>
        </div>
      )}
    </div>
  );
}
