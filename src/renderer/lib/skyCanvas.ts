/**
 * skyCanvas —— 滚动叙事天空(canvas 版,参照 A Day in One Scroll)。
 *
 * 核心思想:天空画在一个 sticky canvas 上(不随内容滚动,只随滚动进度重绘),
 * 每帧根据 scrollProgress(0..1)重画整张天:渐变 + 星 + 日/月弧线 + 云 + 地平线。
 * 纯函数 + 闭包,不依赖 React;调用方只需 attach 一个 scroll 容器 + 一个 canvas。
 *
 * 与 CSS 渐变版的区别:
 *   - CSS 渐变随内容滚动,只在第一章可见(用户反馈的 bug)
 *   - canvas sticky 在视口,全程铺满 → 滚到底也是天空
 *   - canvas 每帧重绘 → 云飘、星闪、日轨运动,丝滑
 */

/* ---- math helpers ---- */
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
type RGB = [number, number, number];
function mix3(c0: RGB, c1: RGB, t: number): RGB {
  return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
}
const rgbStr = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const rgbaStr = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/* ---- 天空色关键帧(3 段:天顶/中段/地平线)---- 调成偏暗色调,与深色 app 协调,
   但保留一日变化的暖→冷→暖→暗节奏。深色优先(AGENTS.md)。 */
interface SkyStop { t: number; top: RGB; mid: RGB; hor: RGB; }
const SKY: SkyStop[] = [
  { t: 0.0,  top: [8, 10, 26],      mid: [16, 20, 44],    hor: [34, 30, 58] },     // 深夜
  { t: 0.12, top: [30, 32, 72],     mid: [78, 56, 104],   hor: [158, 100, 116] },  // 拂晓 靛+紫
  { t: 0.22, top: [124, 156, 214],  mid: [232, 152, 120], hor: [250, 196, 128] },  // 日出 琥珀玫瑰
  { t: 0.36, top: [80, 142, 196],   mid: [132, 186, 226], hor: [188, 214, 232] },  // 清晨晴朗
  { t: 0.5,  top: [60, 120, 178],   mid: [108, 168, 212], hor: [168, 200, 226] },  // 正午
  { t: 0.62, top: [120, 132, 152],  mid: [150, 150, 160], hor: [180, 178, 182] },  // 云起
  { t: 0.74, top: [70, 60, 88],     mid: [108, 78, 110],  hor: [180, 110, 100] },  // 黄金时刻 玫瑰金
  { t: 0.86, top: [40, 30, 60],     mid: [88, 44, 76],    hor: [168, 72, 72] },    // 日落 深红
  { t: 1.0,  top: [8, 10, 26],      mid: [16, 20, 44],    hor: [34, 30, 58] },     // 回到深夜(无缝循环)
];
function skyAt(p: number): { top: RGB; mid: RGB; hor: RGB } {
  let i = 0;
  while (i < SKY.length - 1 && p > SKY[i + 1].t) i++;
  const a = SKY[i]!;
  const b = SKY[Math.min(i + 1, SKY.length - 1)]!;
  const t = smooth(clamp((p - a.t) / ((b.t - a.t) || 1), 0, 1));
  return { top: mix3(a.top, b.top, t), mid: mix3(a.mid, b.mid, t), hor: mix3(a.hor, b.hor, t) };
}

/* ---- 日/月弧线 ----
   p=0 与 p=1 是同一个深夜(循环)。陆地剪影已移除,底部边缘即地平线 →
   天体从底部边缘升起、在天顶附近达到最高、再落回底部边缘。
   太阳:单段日间弧 升 p≈0.16 → 落 p≈0.88。
   月亮:单段夜间弧 跨 p=0/1 边界(晚升 p≈0.92 → 凌晨过中天 → 黎明落 p≈0.08)。 */
interface Body { x: number; y: number; peakness: number; }
function dayArc(p: number, W: number, H: number, rise: number, set: number): Body | null {
  if (p < rise || p > set) return null;
  const u = (p - rise) / (set - rise);
  const x = lerp(0.1, 0.9, u);
  // 至高点留在 header 下方(顶部留 26%,约 header 高度 + 余量,防被遮);地平线贴底
  const zenith = H * 0.26;
  const horizon = H * 0.98;
  const y = horizon - Math.sin(u * Math.PI) * (horizon - zenith);
  return { x: x * W, y, peakness: Math.sin(u * Math.PI) };
}
function nightArc(p: number, W: number, H: number, rise: number, set: number): Body | null {
  let u: number;
  if (p >= rise) u = (p - rise) / (1 - rise + set);
  else if (p <= set) u = (1 - rise + p) / (1 - rise + set);
  else return null;
  const x = lerp(0.12, 0.88, u);
  const zenith = H * 0.26;
  const horizon = H * 0.98;
  const y = horizon - Math.sin(u * Math.PI) * (horizon - zenith);
  return { x: x * W, y, peakness: Math.sin(u * Math.PI) };
}

/* ---- 静态层(尺寸变化时重建)---- */
interface Star { x: number; y: number; r: number; tw: number; sp: number; big: boolean; }
interface Cloud { x: number; y: number; s: number; speed: number; seed: number; drift: number; }

/** 确定性伪随机(种子),让星/云每次同位置 */
function mulberry(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStars(W: number, H: number): Star[] {
  const rand = mulberry(20260809);
  const N = Math.max(28, Math.round((W * H) / 7000));
  const out: Star[] = [];
  for (let i = 0; i < N; i++) {
    out.push({
      x: rand(),
      y: rand() * 0.7,
      r: rand() * 1.2 + 0.3,
      tw: rand() * Math.PI * 2,
      sp: 0.6 + rand() * 1.4,
      big: rand() < 0.06,
    });
  }
  return out;
}
function buildClouds(): Cloud[] {
  const rand = mulberry(7);
  const out: Cloud[] = [];
  for (let i = 0; i < 6; i++) {
    out.push({
      x: rand(),
      y: 0.12 + rand() * 0.4,
      s: 0.55 + rand() * 1.2,
      speed: 0.000018 + rand() * 0.000035,
      seed: rand() * 1000,
      drift: rand() * 0.035 + 0.008,
    });
  }
  return out;
}

/* ---- 绘制函数 ---- */
function drawSky(ctx: CanvasRenderingContext2D, c: { top: RGB; mid: RGB; hor: RGB }, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgbStr(c.top));
  g.addColorStop(0.55, rgbStr(c.mid));
  g.addColorStop(1, rgbStr(c.hor));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawStars(ctx: CanvasRenderingContext2D, p: number, stars: Star[], W: number, H: number, t: number) {
  let vis = 0;
  if (p < 0.22) vis = smooth(1 - p / 0.22);
  else if (p > 0.8) vis = smooth((p - 0.8) / 0.2);
  if (vis <= 0.01) return;
  for (const s of stars) {
    const tw = 0.55 + 0.45 * Math.sin(t * s.sp + s.tw);
    const a = vis * tw;
    if (a < 0.02) continue;
    ctx.fillStyle = `rgba(255,248,228,${a})`;
    const r = s.big ? s.r * 1.8 : s.r;
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * H, r, 0, Math.PI * 2);
    ctx.fill();
    if (s.big) {
      ctx.fillStyle = `rgba(255,240,210,${a * 0.35})`;
      ctx.fillRect(s.x * W - r * 4, s.y * H - 0.4, r * 8, 0.8);
      ctx.fillRect(s.x * W - 0.4, s.y * H - r * 4, 0.8, r * 8);
    }
  }
}

function drawSun(ctx: CanvasRenderingContext2D, body: Body | null) {
  if (!body) return;
  const { x, y, peakness } = body;
  const R = 28 + peakness * 8;
  const halo = ctx.createRadialGradient(x, y, R * 0.4, x, y, R * 5);
  halo.addColorStop(0, "rgba(255,236,190,0.55)");
  halo.addColorStop(0.4, "rgba(255,210,150,0.16)");
  halo.addColorStop(1, "rgba(255,200,140,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - R * 5, y - R * 5, R * 10, R * 10);
  const disc = ctx.createRadialGradient(x, y, 0, x, y, R);
  disc.addColorStop(0, "rgba(255,252,238,1)");
  disc.addColorStop(0.7, "rgba(255,236,180,1)");
  disc.addColorStop(1, "rgba(255,214,150,0.9)");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
}

function drawMoon(ctx: CanvasRenderingContext2D, body: Body | null) {
  if (!body) return;
  const { x, y } = body;
  const R = 24;
  const halo = ctx.createRadialGradient(x, y, R * 0.8, x, y, R * 5);
  halo.addColorStop(0, "rgba(220,232,255,0.38)");
  halo.addColorStop(0.5, "rgba(220,232,255,0.1)");
  halo.addColorStop(1, "rgba(220,232,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(x - R * 5, y - R * 5, R * 10, R * 10);
  const disc = ctx.createRadialGradient(x - R * 0.25, y - R * 0.3, R * 0.2, x, y, R);
  disc.addColorStop(0, "rgba(255,254,247,1)");
  disc.addColorStop(0.7, "rgba(244,242,232,1)");
  disc.addColorStop(1, "rgba(214,222,236,1)");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(150,160,180,0.16)";
  const craters = [[-10, -6, 4], [5, 3, 5], [-3, 9, 3], [11, -8, 3]];
  for (const [dx, dy, r] of craters) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, tint: RGB, alpha: number) {
  const R = 18 * scale;
  const puffs = [[0, 0, 1], [-1.1, 0.1, 0.8], [1.1, 0.1, 0.8], [-0.5, -0.5, 0.7], [0.6, -0.45, 0.75], [-1.8, 0.3, 0.6], [1.8, 0.3, 0.6]];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = rgbaStr([tint[0] * 0.7, tint[1] * 0.7, tint[2] * 0.78], alpha * 0.9);
  for (const [dx, dy, s] of puffs) {
    ctx.beginPath();
    ctx.arc(dx * R, dy * R * 1.1 + R * 0.45, R * s * 1.05, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = rgbaStr(tint, alpha);
  for (const [dx, dy, s] of puffs) {
    ctx.beginPath();
    ctx.arc(dx * R, dy * R, R * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawClouds(ctx: CanvasRenderingContext2D, p: number, clouds: Cloud[], W: number, H: number, now: number) {
  let cover = 0;
  if (p < 0.3) cover = 0;
  else if (p < 0.5) cover = smooth((p - 0.3) / 0.2) * 0.35;
  else if (p < 0.66) cover = lerp(0.35, 0.85, smooth((p - 0.5) / 0.16));
  else if (p < 0.76) cover = 0.9;
  else if (p < 0.84) cover = lerp(0.9, 0.3, smooth((p - 0.76) / 0.08));
  else cover = lerp(0.3, 0.05, smooth((p - 0.84) / 0.16));
  if (cover < 0.02) return;
  const sky = skyAt(p);
  const lit = mix3(sky.hor, [255, 255, 255], 0.35);
  const dark = mix3(sky.mid, [20, 20, 30], 0.45);
  const stormy = p > 0.58 && p < 0.76;
  const tint = stormy ? dark : lit;
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    let x = (c.x + now * c.speed) % 1.2 - 0.1;
    const y = c.y + Math.sin(now * 0.0001 + c.seed) * c.drift;
    if (!(i / clouds.length < cover)) continue;
    drawCloud(ctx, x * W, y * H, c.s, tint, clamp(cover * 0.92, 0, 0.92));
  }
}

/* ---- 主入口:attach 返回 detach ----
   用法:const detach = attachSky(canvasEl, scrollEl, sizeEl); return detach;
   canvas 铺满 sizeEl(整个左栏,含 header),滚动进度读 scrollEl(map-path)。
   两者分离:天空延伸到 header,但滚动驱动仍来自内容容器。 */
export function attachSky(
  canvas: HTMLCanvasElement,
  scroll: HTMLElement,
  sizeEl?: HTMLElement,
): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const sizeTarget = sizeEl ?? scroll;

  let W = 0, H = 0, DPR = 1;
  let stars = buildStars(1, 1);
  const clouds = buildClouds();
  let scrollP = 0;
  let rafId = 0;
  let running = true;
  const T0 = performance.now();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    // canvas 尺寸跟整个左栏(sizeTarget = nav)走,这样天空铺满含 header 区域
    const rect = sizeTarget.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    stars = buildStars(W, H);
  }

  function readScroll() {
    const max = scroll.scrollHeight - scroll.clientHeight;
    scrollP = max > 0 ? clamp(scroll.scrollTop / max, 0, 1) : 0;
  }

  function frame(now: number) {
    if (!running) return;
    const p = scrollP;
    const t = reduced ? 0 : (now - T0) / 1000;
    const sky = skyAt(p);
    drawSky(ctx, sky, W, H);
    drawStars(ctx, p, stars, W, H, t);
    drawMoon(ctx, nightArc(p, W, H, 0.92, 0.08));
    drawSun(ctx, dayArc(p, W, H, 0.16, 0.88));
    drawClouds(ctx, p, clouds, W, H, now);
    // 不画地平线剪影:用户反馈陆地影响观感,天空占满整个左栏更干净
    rafId = requestAnimationFrame(frame);
  }

  const onScroll = () => readScroll();
  const ro = new ResizeObserver(() => { resize(); readScroll(); });
  ro.observe(sizeTarget);

  resize();
  readScroll();
  // reduced motion: 不跑连续 rAF,只在 scroll/resize 时画一帧
  if (reduced) {
    scroll.addEventListener("scroll", () => { readScroll(); frame(performance.now()); }, { passive: true });
    frame(performance.now());
  } else {
    scroll.addEventListener("scroll", onScroll, { passive: true });
    rafId = requestAnimationFrame(frame);
  }

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
    ro.disconnect();
    scroll.removeEventListener("scroll", onScroll);
  };
}
