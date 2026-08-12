/**
 * verify-motion-infra —— Phase 0 游戏感动效基础设施的静态回归断言。
 *
 * 防止回归:
 *   - getOrbs 每帧 querySelectorAll(布局重排主因) → 必须缓存节点引用
 *   - skyCanvas reduced-motion bug(frame 无条件 self-reschedule / attachOrbWeather 无视 reduced)
 *   - state:changed 推送通道(修 XP 能量条运行时不动 bug)
 *   - celebration 总线 + CelebrationLayer + usePrefersReducedMotion(a11y 双轨)
 *
 * 静态 grep 断言(读源文件检查关键模式),不跑运行时(动效/IPC 难单元测)。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.resolve(root, p), "utf8");

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    console.log(`✓ ${name}`);
    pass++;
  } else {
    console.log(`✗ ${name}`);
    fail++;
  }
}

const mapRail = read("src/renderer/components/MapRail.tsx");
const sky = read("src/renderer/lib/skyCanvas.ts");
const types = read("shared/types.ts");
const mainIdx = read("src/main/index.ts");

/* ---- getOrbs 性能(MapRail)---- */
check("T1 getOrbs 缓存节点引用(cachedBtns,不再每帧 querySelectorAll)", mapRail.includes("cachedBtns"));
check("T2 getOrbs MutationObserver 失效重建", mapRail.includes("MutationObserver(invalidate)"));
check("T3 getOrbs navRect 缓存", mapRail.includes("cachedNavRect"));

/* ---- skyCanvas reduced-motion 双轨 ---- */
check(
  "T4 attachSky frame reduced 不连续排程(if !reduced gate)",
  /if \(!reduced\) rafId = requestAnimationFrame\(frame\)/.test(sky),
);
check(
  "T5 attachOrbWeather reduced gate(reduced 时不画装饰)",
  sky.includes("if (reduced) return () => {}"),
);
check("T6 reduced 路径 scroll rAF coalesce(pending 标记)", sky.includes("pending") && sky.includes("onScrollHandler"));

/* ---- state:changed 推送通道(修 XP 能量条 bug)---- */
const stateEmit = read("src/main/lib/state-emitter.ts");
check("T7 state-emitter 模块(emitStateChange/setStateEmitter)", stateEmit.includes("emitStateChange") && stateEmit.includes("setStateEmitter"));

const xp = read("src/main/services/xp-service.ts");
check('T8 xp-service emit "xp" 变化', xp.includes('emitStateChange("xp")'));

const streak = read("src/main/services/streak.ts");
check('T9 streak emit "streak" 变化', streak.includes('emitStateChange("streak")'));

const proposal = read("src/main/services/proposal-service.ts");
check('T10 proposal emit "mastery" 变化', proposal.includes('emitStateChange("mastery")'));

check('T11 IpcEvents "state:changed" 通道类型', types.includes('"state:changed"'));
check("T12 main/index.ts 注入 setStateEmitter", mainIdx.includes("setStateEmitter") && mainIdx.includes('"state:changed"'));

/* ---- celebration 总线 + 渲染层 + a11y hook ---- */
const celebration = read("src/renderer/lib/celebration.ts");
check("T13 celebration 总线(celebrate/onCelebration)", celebration.includes("export function celebrate") && celebration.includes("onCelebration"));
check("T14 celebrationDefaults 粒子预设", celebration.includes("celebrationDefaults"));

const layer = read("src/renderer/components/CelebrationLayer.tsx");
check("T15 CelebrationLayer canvas 粒子层", layer.includes("canvasRef") && layer.includes("burst"));
check("T16 CelebrationLayer reduced 降级(静态图标)", layer.includes("usePrefersReducedMotion") && layer.includes("reducedFlash"));

const hook = read("src/renderer/lib/usePrefersReducedMotion.ts");
check("T17 usePrefersReducedMotion useSyncExternalStore", hook.includes("useSyncExternalStore") && hook.includes("matchMedia"));

const presets = read("src/renderer/lib/motion-presets.ts");
check("T18 motion-presets 弹簧/stagger 变体", presets.includes("springBrand") && presets.includes("staggerContainer"));

/* ---- App 挂载 + 订阅 ---- */
const app = read("src/renderer/App.tsx");
check("T19 App 挂载 <CelebrationLayer/>", app.includes("<CelebrationLayer />"));
check('T20 App 订阅 state:changed 重拉', app.includes('"state:changed"') && app.includes("getXpStatus"));

console.log(`\n=== Phase 0 动效基础设施: ${pass}/${pass + fail} 通过 ${fail ? "❌" : "✅"} ===`);
if (fail) {
  process.exit(1);
}
assert.ok(true);
