/**
 * CelebrationLayer —— 根级庆祝渲染层。
 *
 * 监听 celebrate() 事件总线,统一渲染所有"高光时刻"的粒子爆发/闪光。
 * 解耦:任何组件 fire celebrate("correct"),本层负责画。新增反馈点 = 一行 celebrate()。
 *
 * 双轨(a11y 底线):
 *   - 默认:canvas 粒子爆发(物理:重力 + 衰减 + 旋转),空闲时停 rAF(绿色)。
 *   - prefers-reduced-motion:降级为居中静态图标淡入(仅 opacity,无位移/缩放/粒子)。
 *
 * 挂载:App 根 <CelebrationLayer/>(一个,全局)。z-[60] 高于 drawer(z-50)。
 */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, Crown, Flame, Zap, Award, XCircle, Sparkles, Trophy, type LucideIcon } from "lucide-react";
import {
  onCelebration,
  celebrationDefaults,
  type CelebrationEvent,
  type CelebrationKind,
} from "../lib/celebration.js";
import { usePrefersReducedMotion } from "../lib/usePrefersReducedMotion.js";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  rot: number;
  vr: number;
  shape: "rect" | "circle";
}

/** 按 kind 选降级图标 + 语义色(reduced-motion 时显示)。 */
function iconFor(kind: CelebrationKind): { Icon: LucideIcon; color: string } {
  switch (kind) {
    case "correct":
      return { Icon: CheckCircle2, color: "var(--brand)" };
    case "wrong":
      return { Icon: XCircle, color: "var(--warning)" };
    case "mastery":
    case "level-up":
      return { Icon: Crown, color: "var(--gold)" };
    case "unlock":
      return { Icon: Sparkles, color: "var(--brand)" };
    case "streak":
      return { Icon: Flame, color: "var(--review)" };
    case "energy-full":
      return { Icon: Zap, color: "var(--brand)" };
    case "exam-pass":
      return { Icon: Award, color: "var(--exam)" };
    case "lesson-complete":
      return { Icon: Trophy, color: "var(--gold)" };
    default:
      return { Icon: Sparkles, color: "var(--brand)" };
  }
}

export function CelebrationLayer() {
  const reduced = usePrefersReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const [reducedFlash, setReducedFlash] = useState<{ kind: CelebrationKind; id: number } | null>(null);

  // 默认路径:canvas 粒子爆发
  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const frame = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]!;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.25; // 重力
        p.vx *= 0.99;
        p.rot += p.vr;
        p.life--;
        if (p.life <= 0) {
          ps.splice(i, 1);
          continue;
        }
        const alpha = Math.min(1, p.life / p.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        }
        ctx.restore();
      }
      // 空闲停止(无粒子时不排程,绿色,不空跑 rAF)
      rafRef.current = ps.length > 0 ? requestAnimationFrame(frame) : 0;
    };

    const burst = (e: CelebrationEvent) => {
      const def = celebrationDefaults(e.kind);
      const n = Math.round(def.particles * (e.intensity ?? 1));
      const ox = e.origin?.x ?? window.innerWidth / 2;
      const oy = e.origin?.y ?? window.innerHeight / 2;
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n + Math.random() * 0.3;
        const speed = 3 + Math.random() * 6;
        const maxLife = (def.durationMs / 16) * (0.7 + Math.random() * 0.5);
        particlesRef.current.push({
          x: ox,
          y: oy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2, // 微向上初速(庆祝感)
          life: maxLife,
          maxLife,
          color: def.colors[i % def.colors.length]!,
          size: 4 + Math.random() * 5,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          shape: Math.random() < 0.5 ? "rect" : "circle",
        });
      }
      if (rafRef.current === 0) rafRef.current = requestAnimationFrame(frame);
    };

    const off = onCelebration(burst);
    return () => {
      off();
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      particlesRef.current = [];
    };
  }, [reduced]);

  // reduced 降级:静态图标淡入(仅 opacity,无位移/粒子)
  useEffect(() => {
    if (!reduced) return;
    let id = 0;
    const off = onCelebration((e) => {
      const cur = ++id;
      setReducedFlash({ kind: e.kind, id: cur });
      setTimeout(() => {
        if (cur === id) setReducedFlash(null);
      }, 600);
    });
    return off;
  }, [reduced]);

  if (reduced) {
    return (
      <AnimatePresence>
        {reducedFlash &&
          (() => {
            const { Icon, color } = iconFor(reducedFlash.kind);
            return (
              <motion.div
                key={reducedFlash.id}
                className="fixed inset-0 pointer-events-none z-[60] flex items-center justify-center"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.45 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Icon className="w-24 h-24" color={color} strokeWidth={1.5} />
              </motion.div>
            );
          })()}
      </AnimatePresence>
    );
  }

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-[60]" aria-hidden="true" />;
}
