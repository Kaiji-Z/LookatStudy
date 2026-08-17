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
import { useCallback, useState } from "react";
import { Table2, AlertTriangle, Maximize2 } from "lucide-react";
import { useLang } from "../../lib/i18n.js";
import { useTouchPanPinch } from "../../lib/useTouchPanPinch.js";
import { DiagramViewerModal } from "./DiagramViewerModal.js";

interface CompareTableData {
  artifactType: "compare_table";
  title: string;
  headers: string[];
  rows: string[][];
  /** harness 可能注入的修复警告 */
  warnings?: string[];
}

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;

export function CompareTableArtifact({ data }: { data: unknown }) {
  const d = data as CompareTableData;
  const t = useLang();
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const panPinch = useTouchPanPinch(
    useCallback((factor: number) => {
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z * factor).toFixed(3))));
    }, []),
  );

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

  return (
    <div className="surface-card p-4" data-testid="artifact-compare-table">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Table2 className="w-4 h-4 text-ink-muted shrink-0" />
          <h3 className="text-body font-bold text-ink truncate">{d.title}</h3>
        </div>
        <button
          onClick={() => { setZoom(1); setExpanded(true); }}
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
        onClick={() => { setZoom(1); setExpanded(true); }}
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

      {/* 全屏手势舞台:单指平移 + 双指捏合;zoom 属性重排,滚动区天然跟随 */}
      {expanded && (
        <DiagramViewerModal title={d.title} onClose={() => setExpanded(false)}>
          <div
            onPointerDown={panPinch.onPointerDown}
            onPointerMove={panPinch.onPointerMove}
            onPointerUp={panPinch.onPointerUp}
            onPointerCancel={panPinch.onPointerUp}
            className={`h-full w-full bg-surface-0/60 rounded-xl overflow-auto select-none ${panPinch.isPanning() ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ touchAction: "none" }}
            data-testid="comparetable-modal-stage"
          >
            <div style={{ zoom }} className="min-w-fit p-1">
              {tableEl}
            </div>
          </div>
        </DiagramViewerModal>
      )}
    </div>
  );
}
