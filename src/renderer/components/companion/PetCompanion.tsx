/**
 * v0.11 桌宠窗生物:应用外的常驻伴学。
 *
 * 复用 Mascot 壳 + companionReducer 状态机(戳/抓/庆祝表情与主窗同款逻辑),
 * 栖息地换成整个桌面工作区:慢速巡游 + 原地张望交替。窗体默认点击穿透
 * (forward 仍送 pointermove),指针进生物热区 → companionPetSetClickThrough
 * (false) 换交互(戳/拖),离开热区恢复穿透。数据面轻量轮询:4s 跟随
 * companion_form/companion_enabled 换肤/隐身,30s xp:getStatus 喂能量核,
 * 今日达标一次 energy-full 庆祝(装饰层,失败静默)。
 */
import { useEffect, useRef, useState } from "react";
import { Mascot } from "./Mascot.js";
import {
  companionReducer,
  glideTo,
  initialCompanionState,
} from "../../lib/companion/companion-core.js";
import { formIdFromSetting } from "../../lib/companion/forms-index.ts";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion.js";

const SIZE = 110;
/** 巡游换点节奏(与主窗 ROAM_BUCKET_MS 同量级,桌宠更懒) */
const PET_BUCKET_MS = 5_200;

interface GrabState {
  /** 抓取点相对生物中心的偏移(拖拽保持不跳) */
  dx: number;
  dy: number;
  lastX: number;
  lastY: number;
  lastT: number;
  /** 估算水平速度(松手快慢决定晕眩/温柔) */
  vx: number;
}

export function PetCompanion() {
  const reduced = usePrefersReducedMotion();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(initialCompanionState(Date.now()));
  const posRef = useRef<{ x: number; y: number } | null>(null);
  const targetRef = useRef({ x: 0, y: 0 });
  const bucketRef = useRef(-1);
  const angleRef = useRef(0);
  const grabRef = useRef<GrabState | null>(null);
  const hoverRef = useRef(false);
  const energyRef = useRef(0);
  const goalMetRef = useRef(false);
  const [form, setForm] = useState(formIdFromSetting(null));
  const [crowned, setCrowned] = useState(false);
  const [halo, setHalo] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [, forceTick] = useState(0);

  const dispatch = (ev: Parameters<typeof companionReducer>[1]) => {
    const next = companionReducer(stateRef.current, ev);
    if (next !== stateRef.current) {
      stateRef.current = next;
      forceTick((n) => n + 1);
    }
  };

  // 设置跟随(4s):形象换肤 / 总开关(关 → 窗口留空,主进程会收窗)
  useEffect(() => {
    const pull = async () => {
      try {
        const f = await window.api?.getSetting("companion_form");
        const fid = formIdFromSetting(typeof f === "string" ? f : null);
        setForm((prev) => (prev === fid ? prev : fid));
        const en = await window.api?.getSetting("companion_enabled");
        setHidden(en === "false" || en === "0");
      } catch {
        /* 装饰层静默 */
      }
    };
    void pull();
    const id = setInterval(pull, 4_000);
    return () => clearInterval(id);
  }, []);

  // XP 轮询(30s):能量核 + 今日达标一次庆祝 + 等级徽标
  useEffect(() => {
    const pull = async () => {
      try {
        const x = await window.api?.getXpStatus();
        energyRef.current = x.dailyGoal > 0 ? Math.min(1, x.todayXp / x.dailyGoal) : 0;
        setCrowned(x.level >= 3);
        setHalo(x.level >= 7);
        if (energyRef.current >= 1 && !goalMetRef.current) {
          goalMetRef.current = true;
          dispatch({ type: "celebration", kind: "energy-full", now: Date.now() });
        } else {
          forceTick((n) => n + 1);
        }
      } catch {
        /* 装饰层静默 */
      }
    };
    void pull();
    const id = setInterval(pull, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 慢时钟:到期回落(晕眩→鼓脸→常态)驱动的重渲
  useEffect(() => {
    const id = setInterval(() => {
      dispatch({ type: "tick", now: Date.now() });
    }, 300);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 运动 + 热区检测(rAF 直写 transform,不逐帧过 React)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    if (!posRef.current) {
      posRef.current = { x: W() * 0.78, y: H() * 0.74 };
      targetRef.current = { ...posRef.current };
    }
    const apply = () => {
      const p = posRef.current!;
      wrap.style.transform = `translate3d(${(p.x - SIZE / 2).toFixed(1)}px, ${(p.y - SIZE / 2).toFixed(1)}px, 0) rotate(${(angleRef.current * 10).toFixed(2)}deg)`;
    };
    if (reduced) {
      posRef.current = { x: W() * 0.82, y: H() * 0.8 };
      angleRef.current = 0;
      apply();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(50, now - last);
      last = now;
      const g = grabRef.current;
      if (g) {
        posRef.current = { x: g.lastX - g.dx, y: g.lastY - g.dy };
        angleRef.current = Math.max(-0.6, Math.min(0.6, g.vx * 0.05));
      } else {
        const bucket = Math.floor(now / PET_BUCKET_MS);
        if (bucket !== bucketRef.current) {
          bucketRef.current = bucket;
          // 桌面巡游:1/3 概率原地张望,其余换点(确定性 sin-hash,同款手感)
          const r = Math.abs(Math.sin(bucket * 12.9898 + 78.233) * 43758.5453) % 1;
          const r2 = Math.abs(Math.sin(bucket * 3.717 + 1.31) * 43758.5453) % 1;
          if (r >= 0.34) targetRef.current = { ...posRef.current! };
          else targetRef.current = { x: W() * (0.08 + r * 0.84), y: H() * (0.12 + r2 * 0.74) };
        }
        const prev = posRef.current!;
        const next = glideTo(prev, targetRef.current, dt, 0.22);
        const vx = dt > 0 ? (next.x - prev.x) / dt : 0;
        angleRef.current += (Math.max(-0.5, Math.min(0.5, vx * 0.35)) - angleRef.current) * 0.08;
        posRef.current = next;
      }
      apply();
    };
    raf = requestAnimationFrame(frame);

    // 热区检测:穿透态(forward)也送 move;进生物关穿透可交互,离开恢复
    const onMove = (e: PointerEvent) => {
      const g = grabRef.current;
      if (g) {
        const t = performance.now();
        const dt = Math.max(1, t - g.lastT);
        g.vx = 0.6 * g.vx + 0.4 * ((e.clientX - g.lastX) / dt) * 16;
        g.lastX = e.clientX;
        g.lastY = e.clientY;
        g.lastT = t;
      }
      const p = posRef.current!;
      const inside = Math.hypot(e.clientX - p.x, e.clientY - p.y) < SIZE * 0.52;
      if (inside !== hoverRef.current) {
        hoverRef.current = inside;
        void window.api?.companionPetSetClickThrough(!inside);
      }
    };
    const onUp = () => {
      const g = grabRef.current;
      if (!g) return;
      grabRef.current = null;
      dispatch({ type: "grab", on: false, speed: Math.min(12, Math.abs(g.vx)), now: Date.now() });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [reduced]);

  const st = stateRef.current;
  return (
    <div
      ref={wrapRef}
      style={{ position: "fixed", left: 0, top: 0, width: SIZE, height: SIZE, willChange: "transform", opacity: hidden ? 0 : 1 }}
    >
      <Mascot
        form={form}
        expression={st.expression}
        pose={st.pose}
        size={SIZE}
        energyRatio={energyRef.current}
        interactive={!hidden}
        ariaLabel="LookatStudy 桌宠"
        onPoke={() => dispatch({ type: "poke", now: Date.now() })}
        onGrab={(px, py) => {
          const p = posRef.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          grabRef.current = { dx: px - p.x, dy: py - p.y, lastX: px, lastY: py, lastT: performance.now(), vx: 0 };
          dispatch({ type: "grab", on: true, now: Date.now() });
        }}
        crownBadge={crowned}
        haloBadge={halo}
      />
    </div>
  );
}
