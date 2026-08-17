/**
 * CompareTableArtifact —— 对比表产物(M2, v0.11 弹窗查看)。
 *
 * tool compare_table 返回 { headers, rows },渲染成对比表格。
 * 第一列通常是维度名,加粗;数据行斑马纹;暗色模式适配。
 *
 * v0.11:宽表格是手机捏合刚需 —— 内联区只留横向滚动(不抢手势),
 * 点表格/「放大查看」进全屏弹窗,弹窗里单指拖动 + 双指捏合(Chromium `zoom`
 * 属性重排,滚动区天然跟随,无需手工撑开)。
 */
import { useState } from "react";
import { Table2, AlertTriangle, Maximize2 } from "lucide-react";
import { useLang } from "../../lib/i18n.js";
import { DiagramViewerModal } from "./DiagramViewerModal.js";
import { CanvasStage } from "../CanvasStage.js";

interface CompareTableData {
  artifactType: "compare_table";
  title: string;
  headers: string[];
  rows: string[][];
  /** harness 可能注入的修复警告 */
  warnings?: string[];
}

export function CompareTableArtifact({ data, variant = "card" }: { data: unknown; variant?: "card" | "canvas" }) {
  const d = data as CompareTableData;
  const t = useLang();
  const [expanded, setExpanded] = useState(false);

  const tableEl = (
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
  );

  /* canvas 变体:裸表格自然尺寸(CanvasStage 接管缩放平移;黑板/全屏查看器) */
  if (variant === "canvas") {
    return <div className="w-fit" data-testid="comparetable-canvas-content">{tableEl}</div>;
  }

  return (
    <div className="surface-card p-4" data-testid="artifact-compare-table">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Table2 className="w-4 h-4 text-ink-muted shrink-0" />
          <h3 className="text-body font-bold text-ink truncate">{d.title}</h3>
        </div>
        <button
          onClick={() => setExpanded(true)}
          data-testid="comparetable-expand"
          aria-label={t("artifact.viewer.open")}
          data-tooltip={t("artifact.viewer.open")}
          className="w-6 h-6 rounded border border-[var(--border)] text-ink-muted hover:bg-surface-3 flex items-center justify-center shrink-0"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* 内联:原生横向滚动(手机不抢手势);点表格进弹窗 */}
      <div
        className="overflow-x-auto rounded-lg border border-[var(--border-faint)]"
        onClick={() => setExpanded(true)}
        style={{ touchAction: "pan-x pan-y" }}
        data-noswipe="" /* 表格横向滚动与 T3 切栏滑动手势互斥 */
      >
        {tableEl}
      </div>
      {d.warnings && d.warnings.length > 0 && (
        <div className="mt-2 text-caption text-warning flex items-start gap-1" data-testid="artifact-warnings">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{d.warnings.join("; ")}</span>
        </div>
      )}

      {/* 全屏画布舞台(CanvasStage):纯 transform,表格小字捏合放大读 */}
      {expanded && (
        <DiagramViewerModal title={d.title} onClose={() => setExpanded(false)}>
          <div className="h-full w-full rounded-xl overflow-hidden bg-surface-0/60">
            <CanvasStage testid="comparetable-modal-stage">
              <div className="p-2 surface-card">
                <CompareTableArtifact data={data} variant="canvas" />
              </div>
            </CanvasStage>
          </div>
        </DiagramViewerModal>
      )}
    </div>
  );
}
