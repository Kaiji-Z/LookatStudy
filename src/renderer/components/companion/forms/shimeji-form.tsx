/**
 * ShimejiArt —— 第 7 形态:导入的 Shimeji 桌宠包(帧动画,SPEC-shimeji.md)。
 *
 * 与六款形态共用 Mascot 壳(拖拽/位置/尺寸/事件),但**运动学独立**:壳的
 * 姿势/口型/表情系统写 refs 的部分对本形态全部 no-op(空 g),生命感来自
 * 包自带帧动画——自主调度循环(动作池随机 + Pose.Duration 步进 + velocity
 * 位移 + 朝向镜像)在组件内 rAF-free 的 50ms interval 里跑。
 *
 * 表情→动作(替代三件套之"动作语义替换"):壳的 expression 不再画脸,而是
 * 偏向动作池(happy→Bouncing/Jumping,thinking→Stand,sleeping→Sit 系列)。
 * 一期运动学=本地水平步行(Move 类 velocity 驱动,容器内往返);跨栏飞行器/
 * 贴边/面板为二三期。
 * 无激活包 → 诚实占位(虚线剪影 + 包名),不白屏。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { ShimejiPackManifestT } from "@shared/types.ts";

import {
  getActiveShimeji,
  getFrameSrc,
  refreshActiveShimeji,
  subscribeActiveShimeji,
} from "../../../lib/companion/shimeji-pack-store.ts";
import type { FormArtProps } from "./shared.js";

/** 动作偏好:expression → 该情绪下优先选的动作名(包里没有就落回 idle 池)。 */
const EXPRESSION_PREF: Record<string, string[]> = {
  happy: ["Bouncing", "Jumping"],
  cheer: ["Bouncing", "Jumping"],
  proud: ["Bouncing"],
  stars: ["Jumping", "Bouncing"],
  flame: ["Dash", "Run"],
  thinking: ["Stand"],
  sleeping: ["Sit", "Sprawl"],
  listening: ["Stand"],
};

const TICK_MS = 50;
/** 本地步行活动半径(舞台 200 宽,角色 ~128,±36 可来回走) */
const WALK_RANGE = 36;

interface RuntimeState {
  actionName: string;
  poseIdx: number;
  ticksLeft: number;
  loopsLeft: number;
  /** 本地水平偏移(步行累积) */
  offsetX: number;
  /** 朝向:1=右 -1=左(velocity 符号或反弹) */
  facing: 1 | -1;
}

function pickIdleAction(manifest: ShimejiPackManifestT, expression: string): string {
  const have = new Set(manifest.actions.map((a) => a.name));
  const pref = EXPRESSION_PREF[expression] ?? [];
  const hit = pref.find((n) => have.has(n));
  if (hit) return hit;
  const pool = ["Stand", "Walk", "Sit", "Sprawl", "Stand"].filter((n) => have.has(n));
  return pool[Math.floor(Math.random() * pool.length)] ?? manifest.actions[0]?.name ?? "";
}

export function ShimejiArt({ uid, refs, expression, energyRatio }: FormArtProps) {
  const active = useSyncExternalStore(subscribeActiveShimeji, getActiveShimeji);
  const manifest = active?.manifest ?? null;
  const [rt, setRt] = useState<RuntimeState | null>(null);
  const exprRef = useRef(expression);
  exprRef.current = expression;
  const [, force] = useState(0);

  // 挂载即拉激活包(store 单例,inflight 去重)——设置页之外激活的包(重启后/协议直调)也能到位
  useEffect(() => {
    void refreshActiveShimeji();
  }, []);

  // 调度循环:50ms tick 推进帧序;Move 类驱动水平步行;循环耗尽换动作
  useEffect(() => {
    if (!manifest) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const startAction = (): RuntimeState => {
      const name = pickIdleAction(manifest, exprRef.current);
      const action = manifest.actions.find((a) => a.name === name);
      return {
        actionName: name,
        poseIdx: 0,
        ticksLeft: Math.max(1, action?.poses[0]?.duration ?? 1),
        loopsLeft: action?.kind === "Stay" ? 2 : action?.kind === "Move" ? 1 : 1,
        offsetX: 0,
        facing: Math.random() < 0.5 ? 1 : -1,
      };
    };
    setRt(startAction());
    timer = setInterval(() => {
      if (stopped) return;
      setRt((prev) => {
        if (!prev) return prev;
        const action = manifest.actions.find((a) => a.name === prev.actionName);
        if (!action || action.poses.length === 0) return startAction();
        let { poseIdx, ticksLeft, loopsLeft, offsetX, facing } = prev;
        ticksLeft -= 1;
        if (ticksLeft <= 0) {
          poseIdx += 1;
          if (poseIdx >= action.poses.length) {
            loopsLeft -= 1;
            poseIdx = 0;
            if (loopsLeft <= 0) return startAction();
          }
          ticksLeft = Math.max(1, action.poses[poseIdx]?.duration ?? 1);
        }
        if (action.kind === "Move" && action.poses[poseIdx]) {
          const [vx] = action.poses[poseIdx].velocity;
          if (vx !== 0) {
            facing = vx > 0 ? 1 : -1;
            offsetX += vx;
            if (Math.abs(offsetX) > WALK_RANGE) {
              offsetX = Math.sign(offsetX) * WALK_RANGE;
              facing = (facing * -1) as 1 | -1;
            }
          }
        }
        return { actionName: prev.actionName, poseIdx, ticksLeft, loopsLeft, offsetX, facing };
      });
      force((n) => n + 1);
    }, TICK_MS);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [manifest]);

  const current = useMemo(() => {
    if (!manifest || !rt) return null;
    return {
      action: manifest.actions.find((a) => a.name === rt.actionName) ?? null,
      pose: manifest.actions.find((a) => a.name === rt.actionName)?.poses[rt.poseIdx] ?? null,
      facing: rt.facing,
      offsetX: rt.offsetX,
    };
  }, [manifest, rt]);

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

  const pose = current?.pose ?? null;
  const src = pose ? getFrameSrc(active.id, pose.image) : null;
  // anchor=帧内脚底点 → 舞台底中(100,192)对齐;朝向镜像(velocity 已含朝向,镜像仅视觉翻转)
  const px = 100 - (pose?.anchor[0] ?? 64) + (current?.offsetX ?? 0);
  const py = 192 - (pose?.anchor[1] ?? 128);
  const facing = current?.facing ?? 1;

  return (
    <g className="cp-shimeji" data-testid="shimeji-art">
      {/* 壳的姿势/表情/口型 refs 全挂空 g(写入无害 no-op) */}
      <g ref={refs.bot} data-shimeji-body>
        <g transform={facing === -1 ? `translate(${200} 0) scale(-1 1)` : undefined}>
          {src ? (
            <image
              key={`${pose?.image}:${uid}`}
              href={src}
              x={facing === -1 ? 200 - (pose?.anchor[0] ?? 64) - 128 + (current?.offsetX ?? 0) * -1 : px}
              y={py}
              width={128}
              height={128}
              preserveAspectRatio="xMidYMax meet"
            />
          ) : (
            <rect x={px} y={py + 96} width={64} height={32} rx={6} opacity={0.25} fill="currentColor" />
          )}
        </g>
      </g>
      <g ref={refs.head} />
      <g ref={refs.armL} />
      <g ref={refs.armR} />
      <g ref={refs.eyes} />
      <g ref={refs.waves} />
      <g ref={refs.pupils} />
      {/* 能量低位可视化(与五形态同语义:低能量呼吸减速)——帧透明度微降 */}
      {energyRatio < 0.2 ? <rect width="0" height="0" data-shimeji-low-energy="1" /> : null}
    </g>
  );
}
