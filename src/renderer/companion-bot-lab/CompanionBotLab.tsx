/**
 * companion-bot-lab/CompanionBotLab —— M0 spike 三档对照实验页(dev lab)。
 *
 * 入口:location.hash === "#companion-bot-lab"(App.tsx 根层懒挂载,主束零增量)。
 * 目的(判据 7):同一只程序化 Q 版角色跑 贴纸级 / PD-Lite / PD-Mesh 三档,
 * 同一套 bus 信号驱动,肉眼对照"僵 vs 活",产出 PD-Mesh 是否进 M1 的证据。
 * 详见 .goal/SPEC.md §5。
 */
import { useMemo, useState } from "react";
import { celebrate } from "../lib/celebration.js";
import type { BotState } from "@shared/companion-pack.ts";
import { buildSampleArt, SAMPLE_MANIFEST } from "./sample-pack.ts";
import { CompanionBot, MeshBot, PDLiteBot } from "./CompanionBot.tsx";

const POSE_BUTTONS: Array<{ pose: BotState | null; label: string }> = [
  { pose: null, label: "待机" },
  { pose: "happy", label: "开心" },
  { pose: "thinking", label: "思考" },
];

const TIER_NOTES = [
  { key: "sticker", title: "贴纸级 / Bongo 档", note: "整图帧替换 + 呼吸/squash/jump——M0 引擎,零切层" },
  { key: "pd-lite", title: "PD-Lite 纸偶", note: "四层切分 + 肩点旋转——刚体变换 + 次级运动,无网格" },
  { key: "pd-mesh", title: "PD-Mesh 网格", note: "同四层 + Canvas2D 网格变形——Live2D-lite,实验性" },
] as const;

export function CompanionBotLab(): React.ReactElement {
  const art = useMemo(() => buildSampleArt(), []);
  const [forced, setForced] = useState<BotState | null>(null);

  const close = () => {
    location.hash = "";
  };

  return (
    <div
      data-companion-bot-lab=""
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="bg-surface-0 text-ink max-h-[92vh] w-[min(920px,94vw)] overflow-auto rounded-2xl p-6 shadow-pop">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-title font-bold">CompanionBot Lab · M0 spike</h2>
            <p className="text-label text-ink/60">
              外部角色包三档对照——同一套伴学 bus 信号驱动。键击/庆祝事件对三栏同时生效。
            </p>
          </div>
          <button type="button" className="btn-3d-neutral text-label px-3 py-2" onClick={close}>
            关闭
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {POSE_BUTTONS.map(({ pose, label }) => (
            <button
              key={label}
              type="button"
              className={`text-label px-3 py-2 ${(pose ?? null) === forced ? "btn-3d-brand" : "btn-3d-neutral"}`}
              onClick={() => setForced(pose)}
            >
              {label}
            </button>
          ))}
          <button type="button" className="btn-3d-brand text-label px-3 py-2" data-testid="bot-lab-celebrate" onClick={() => celebrate("correct")}>
            庆祝总线(celebrate correct)
          </button>
          <textarea
            className="text-label h-10 w-44 resize-none rounded-xl border border-ink/15 bg-surface-2 px-3 py-2"
            placeholder="在此打字→拍臂"
            aria-label="typing test input"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-surface-2 p-4 text-center">
            <div className="flex h-[200px] items-center justify-center">
              <CompanionBot pack={{ manifest: SAMPLE_MANIFEST, srcs: art.srcs }} size={168} poseOverride={forced} />
            </div>
            <h3 className="text-label mt-2 font-bold">{TIER_NOTES[0].title}</h3>
            <p className="text-caption mt-1 text-ink/60">{TIER_NOTES[0].note}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-4 text-center">
            <div className="flex h-[200px] items-center justify-center">
              <PDLiteBot parts={art.parts} size={176} poseOverride={forced} />
            </div>
            <h3 className="text-label mt-2 font-bold">{TIER_NOTES[1].title}</h3>
            <p className="text-caption mt-1 text-ink/60">{TIER_NOTES[1].note}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-4 text-center">
            <div className="flex h-[200px] items-center justify-center">
              <MeshBot parts={art.parts} size={176} poseOverride={forced} />
            </div>
            <h3 className="text-label mt-2 font-bold">{TIER_NOTES[2].title}</h3>
            <p className="text-caption mt-1 text-ink/60">{TIER_NOTES[2].note}</p>
          </div>
        </div>

        <p className={`text-caption mt-4 ${art.selfSpec.ok ? "text-brand" : "text-warning"}`}>
          {art.selfSpec.ok
            ? "✓ 样例整图通过 PNG 三行规格检测(透明底/单主体/别贴边)——analyzePngSpec 活演示"
            : `✗ 样例未过规格:${art.selfSpec.issues.map((i) => i.code).join(", ")}`}
        </p>
      </div>
    </div>
  );
}
