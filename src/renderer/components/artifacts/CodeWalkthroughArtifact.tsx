/**
 * CodeWalkthroughArtifact —— 代码逐段讲解产物(M2)。
 *
 * tool show_code_walkthrough 返回 { code, annotations }。
 * 渲染:带行号的代码 + 每段标注(点击高亮对应行)。
 * 仿 Cursor / GitHub 的代码块样式。
 */
import { useState } from "react";

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
}

export function CodeWalkthroughArtifact({ data }: { data: unknown }) {
  const d = data as CodeWalkthroughData;
  const [activeAnnotation, setActiveAnnotation] = useState<number | null>(null);
  const lines = d.code.split("\n");

  const isLineHighlighted = (lineNum: number) => {
    if (activeAnnotation === null) return false;
    const a = d.annotations[activeAnnotation];
    return a && lineNum >= a.lineStart && lineNum <= a.lineEnd;
  };

  return (
    <div className="surface-card p-4" data-testid="artifact-code-walkthrough">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🔍</span>
        <h3 className="text-sm font-bold text-neutral-800 dark:text-neutral-200">{d.title}</h3>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 font-mono">
          {d.language}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 代码块(带行号) */}
        <div className="bg-neutral-950 rounded-lg overflow-hidden border border-neutral-800">
          <pre className="text-[11px] font-mono leading-relaxed overflow-x-auto">
            <code>
              {lines.map((line, i) => {
                const lineNum = i + 1;
                return (
                  <div
                    key={i}
                    className={`flex ${isLineHighlighted(lineNum) ? "bg-brand/15" : ""}`}
                  >
                    <span className="select-none text-neutral-600 pr-3 pl-3 text-right w-10 shrink-0 border-r border-neutral-800">
                      {lineNum}
                    </span>
                    <span className="text-neutral-300 pl-3 whitespace-pre">{line || " "}</span>
                  </div>
                );
              })}
            </code>
          </pre>
        </div>

        {/* 讲解列表 */}
        <div className="space-y-2">
          <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
            逐段讲解
          </div>
          {d.annotations.map((a, i) => (
            <button
              key={i}
              onClick={() => setActiveAnnotation(activeAnnotation === i ? null : i)}
              data-testid={`annotation-${i}`}
              className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                activeAnnotation === i
                  ? "border-brand bg-brand/10"
                  : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
              }`}
            >
              <div className="text-[10px] font-bold text-brand mb-0.5">
                第 {a.lineStart}{a.lineEnd !== a.lineStart ? `-${a.lineEnd}` : ""} 行
              </div>
              <div className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
                {a.note}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
