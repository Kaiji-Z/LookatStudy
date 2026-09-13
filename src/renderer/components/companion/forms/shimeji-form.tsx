/**
 * ShimejiArt —— 第 7 形态:导入的 Shimeji 桌宠包(帧动画,SPEC-shimeji.md)。
 *
 * 与六款形态共用 Mascot 壳(拖拽运输/位置/尺寸/事件),但**运动学独立**:壳的
 * 姿势/口型/表情系统写 refs 的部分对本形态全部 no-op(空 g),生命感来自
 * 包自带帧动画——动作语义与局部运动学在 shimeji-scheduler 纯状态机(地面
 * idle/步行/坐下/躺平 + 爬墙/爬顶 + 扔出坠落 + 被抓挣扎),组件只以 50ms
 * interval 步进并按脚底锚点渲染当前帧。
 *
 * 拖拽经 companion-grab 总线消费(Mascot pointer → bus):抓住=挣扎帧跟手
 * (跟手由壳负责),松手 speed≥2.5(与壳 throwDizzy 同阈)=扔出坠落动画;
 * 飞行器跨栏运输手感留用户拍板(SPEC 停止条件)。
 *
 * 表情→动作(替代三件套之"动作语义替换"):壳的 expression 不画脸,而是偏向
 * 动作池(happy→Bouncing/Jumping,sleeping→Sprawl/Sit,见 scheduler
 * EXPRESSION_PREF)。无激活包 → 诚实占位(虚线剪影),不白屏。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  getActiveShimeji,
  getFrameSrc,
  refreshActiveShimeji,
  subscribeActiveShimeji,
} from "../../../lib/companion/shimeji-pack-store.ts";
import {
  initMotion,
  tickShimeji,
  type ShimejiMotion,
  type ShimejiSandbox,
  type ShimejiSignal,
} from "../../../lib/companion/shimeji-scheduler.ts";
import type { FormArtProps } from "./shared.js";
import { VehArms, VehGroup } from "./vehicle.js";
import { VEH_THEMES, type VehTheme } from "../../../lib/companion/veh-themes.ts";
import type { FormRefs } from "./shared.js";

/** 前景机械臂(画在精灵之后,操作在身前可见)——与平台同受 .cp-veh-mount 门控。
    修:曾移出门控容器导致"平台收起而机械臂常显"(实测反馈 2026-09-12)。
    门控语义(2026-09-12 三次拍板):载具常驻(bot 本就悬浮,脚下没平台没道理),
    仅爬墙/爬顶时收起(贴边攀爬时平台碍事)。 */
function VehArmsGate({ refs, theme, hide }: { refs: Pick<FormRefs, "armL" | "armR">; theme: VehTheme; hide: boolean }) {
  return (
    <g className={`cp-veh-mount${hide ? " cp-veh-hide" : ""}`}>
      <VehArms refs={refs} theme={theme} />
    </g>
  );
}

const TICK_MS = 50;

export function ShimejiArt({ uid, refs, expression, energyRatio }: FormArtProps) {
  const active = useSyncExternalStore(subscribeActiveShimeji, getActiveShimeji);
  const manifest = active?.manifest ?? null;
  const [rt, setRt] = useState<ShimejiMotion>(initMotion);
  const exprRef = useRef(expression);
  exprRef.current = expression;
  const manifestRef = useRef(manifest);
  manifestRef.current = manifest;
  // 值勤钉扎:壳层值勤姿势(打字/写字/指向/飞行)时精灵收步归中、脚踩平台顶面——
  // 与载具机械臂对位;地面自主动作(调度器策略)不受影响
  const rootRef = useRef<SVGGElement | null>(null);
  const dutyRef = useRef(false);

  // 挂载即拉激活包(store 单例,inflight 去重)——设置页之外激活的包(重启后/协议直调)也能到位
  useEffect(() => {
    void refreshActiveShimeji();
  }, []);

  // 拖拽信号(壳派发,window CustomEvent 与 bus 同源):抓住=挣扎,松手=轻放/扔出
  useEffect(() => {
    const onGrab = (e: Event) => {
      const d = (e as CustomEvent<{ on: boolean; speed?: number }>).detail;
      const m = manifestRef.current;
      if (!m) return;
      const signal: ShimejiSignal = d.on ? { t: "grab" } : { t: "release", speed: d.speed ?? 0 };
      setRt((prev) => tickShimeji(prev, m, signal, exprRef.current));
    };
    window.addEventListener("companion-grab", onGrab);
    return () => window.removeEventListener("companion-grab", onGrab);
  }, []);

  // 调度循环:50ms tick 步进(纯函数替换状态,StrictMode 双调安全)
  useEffect(() => {
    if (!manifest) return;
    // 墙对齐可见容器边缘(2026-09-12 拍板):量 composer 卡/讲解面板的屏幕矩形,
    // 换算成舞台局部坐标当左右墙与顶棚;容器不可见/过小时回退舞台默认沙盒
    const measureSandbox = (): Partial<ShimejiSandbox> | null => {
      const svg = rootRef.current?.ownerSVGElement;
      if (!svg) return null;
      const stage = svg.getBoundingClientRect();
      if (stage.width < 40 || stage.height < 40) return null;
      const cont = document.querySelector('[data-testid="composer-card"], [data-testid="notebook-panel"]');
      if (!cont) return null;
      const r = cont.getBoundingClientRect();
      if (r.width < 120 || r.height < 80) return null;
      const toX = (sx: number) => ((sx - stage.left) / stage.width) * 200;
      const toY = (sy: number) => ((sy - stage.top) / stage.height) * 192;
      const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      const minX = clampN(toX(r.left), 40, 100);
      const maxX = clampN(toX(r.right), 100, 160);
      if (maxX - minX < 24) return null;
      return { minX, maxX, ceilY: clampN(toY(r.top), 24, 150) };
    };
    const timer = setInterval(() => {
      const cls = rootRef.current?.ownerSVGElement?.getAttribute("class") ?? "";
      const duty = /cp-pose-(typing|writing|flying)|cp-pose-point|cp-takeoff/.test(cls);
      dutyRef.current = duty;
      const box = measureSandbox();
      setRt((prev) => {
        const next = tickShimeji(prev, manifest, { t: "tick" }, exprRef.current, Math.random, box ?? undefined);
        if (!duty || next.mode !== "ground") return next;
        const action = manifest.actions.find((a) => a.name === next.actionName);
        const pinned = {
          ...next,
          x: next.x + (100 - next.x) * 0.25,
          y: 179,
          actionName: action?.kind === "Move" ? (manifest.actions.find((a) => a.kind === "Stay")?.name ?? next.actionName) : next.actionName,
        };
        return pinned;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [manifest]);

  // 无激活包:诚实占位
  if (!manifest || !active) {
    return (
      <g className="cp-shimeji-empty" aria-label="no shimeji pack">
        <rect x="64" y="120" width="72" height="72" rx="10" fill="none" stroke="currentColor" strokeDasharray="4 4" opacity="0.4" />
        <text x="100" y="162" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.5">
          Shimeji
        </text>
      </g>
    );
  }

  const action = manifest.actions.find((a) => a.name === rt.actionName) ?? null;
  const pose = action?.poses[rt.poseIdx] ?? null;
  const src = pose ? getFrameSrc(active.id, pose.image) : null;
  // anchor=帧内脚底点 → 平移到脚底位置;scale(-1 1) 绕锚点镜像(锚点局部原点)
  const ax = pose?.anchor[0] ?? 64;
  const ay = pose?.anchor[1] ?? 128;
  const hideVeh = rt.mode === "wall" || rt.mode === "ceiling";

  return (
    <g ref={rootRef} className="cp-shimeji" data-testid="shimeji-art" data-mode={rt.mode} data-action={rt.actionName ?? ""}>
      {/* 载具+机械臂常驻(2026-09-12 三次拍板):bot 本就悬浮,脚下没平台没道理;
          仅爬墙/爬顶(rt.mode wall/ceiling)时收起——贴边攀爬时平台碍事。
          refs.armL/armR 挂机械臂——壳的逐键拍打与指向姿势零接线落机械臂。 */}
      <g className={`cp-veh-mount${hideVeh ? " cp-veh-hide" : ""}`} data-testid="shimeji-veh">
        <VehGroup uid={`${uid}-shimeji-veh`} energyRatio={energyRatio} theme={VEH_THEMES.silver} />
      </g>
      <g ref={refs.bot} data-shimeji-body>
        <g transform={`translate(${rt.x} ${rt.y}) scale(${rt.facing} 1)`}>
          {src ? (
            <image
              key={`${pose?.image}:${uid}`}
              href={src}
              x={-ax}
              y={-ay}
              width={128}
              height={128}
              preserveAspectRatio="xMidYMax meet"
            />
          ) : (
            <rect x={-32} y={-32} width={64} height={32} rx={6} opacity={0.25} fill="currentColor" />
          )}
        </g>
      </g>
      <VehArmsGate refs={refs} theme={VEH_THEMES.silver} hide={hideVeh} />
      <g ref={refs.head} />
      <g ref={refs.eyes} />
      <g ref={refs.waves} />
      <g ref={refs.pupils} />
      {/* 能量低位可视化(与五形态同语义:低能量呼吸减速)——帧透明度微降 */}
      {energyRatio < 0.2 ? <rect width="0" height="0" data-shimeji-low-energy="1" /> : null}
    </g>
  );
}
