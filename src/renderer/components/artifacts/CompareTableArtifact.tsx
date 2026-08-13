/**
 * CompareTableArtifact —— 对比表产物(M2)。
 *
 * tool compare_table 返回 { headers, rows },渲染成对比表格。
 * 第一列通常是维度名,加粗;数据行斑马纹;暗色模式适配。
 */
import { Table2, AlertTriangle } from "lucide-react";

interface CompareTableData {
  artifactType: "compare_table";
  title: string;
  headers: string[];
  rows: string[][];
  /** harness 可能注入的修复警告 */
  warnings?: string[];
}

export function CompareTableArtifact({ data }: { data: unknown }) {
  const d = data as CompareTableData;
  return (
    <div className="surface-card p-4" data-testid="artifact-compare-table">
      <div className="flex items-center gap-2 mb-3">
        <Table2 className="w-4 h-4 text-ink-muted shrink-0" />
        <h3 className="text-body font-bold text-ink">{d.title}</h3>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-faint)]">
        <table className="w-full text-body">
          <thead>
            <tr className="bg-surface-1/60">
              {d.headers.map((h, i) => (
                <th
                  key={i}
                  className={`px-3 py-2 text-left font-bold text-ink-muted border-b border-[var(--border-faint)] ${
                    i === 0 ? "w-32" : ""
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.rows.map((row, ri) => (
              <tr
                key={ri}
                className={ri % 2 === 0 ? "bg-surface-0" : "bg-surface-0/30"}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`px-3 py-2 text-ink-muted border-b border-[var(--border-faint)] align-top ${
                      ci === 0 ? "font-bold text-ink-strong" : ""
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
