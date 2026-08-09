/**
 * CompareTableArtifact —— 对比表产物(M2)。
 *
 * tool compare_table 返回 { headers, rows },渲染成对比表格。
 * 第一列通常是维度名,加粗;数据行斑马纹;暗色模式适配。
 */
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
        <span className="text-body">📊</span>
        <h3 className="text-body font-bold text-neutral-800 dark:text-neutral-200">{d.title}</h3>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-body">
          <thead>
            <tr className="bg-neutral-100 dark:bg-neutral-900/60">
              {d.headers.map((h, i) => (
                <th
                  key={i}
                  className={`px-3 py-2 text-left font-bold text-neutral-700 dark:text-neutral-300 border-b border-neutral-200 dark:border-neutral-800 ${
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
                className={ri % 2 === 0 ? "bg-white dark:bg-neutral-950" : "bg-neutral-50 dark:bg-neutral-900/30"}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`px-3 py-2 text-neutral-700 dark:text-neutral-300 border-b border-neutral-100 dark:border-neutral-800/60 align-top ${
                      ci === 0 ? "font-bold text-neutral-900 dark:text-neutral-100" : ""
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
        <div className="mt-2 text-caption text-amber-600 dark:text-amber-400" data-testid="artifact-warnings">
          ⚠️ {d.warnings.join("; ")}
        </div>
      )}
    </div>
  );
}
