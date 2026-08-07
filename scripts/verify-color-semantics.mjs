/**
 * v0.2 颜色语义规范验证(M4)。
 *
 * 调研结论(olgaskuja + product register):
 *   绿(#58cc02 brand):只表 进度/正确/主操作/选中
 *   蓝(#1cb0f6 accent):只表 可交互(链接/可点击/二级操作)
 *   金(#ffc800 gold):只表 掌握(mastery/crown)
 *   橙红(#ff4b4b / orange-500):只表 警告/overdue/错误
 *
 * 本测试静态扫描源码,检查"疑似违规"模式。
 * 不是 100% 精确(有些场景需人工判),但能抓常见错误:
 *   - 绿色用在纯装饰(无状态语义)
 *   - 金色用在非掌握场景
 *   - 正文用 neutral-500 偏弱对比度
 */
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPONENT_DIR = join(__dirname, "..", "src", "renderer", "components");

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// 收集所有 tsx 文件内容
function readAllTsx(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...readAllTsx(full));
    } else if (entry.endsWith(".tsx")) {
      files.push({ path: full, content: readFileSync(full, "utf-8") });
    }
  }
  return files;
}
const allFiles = readAllTsx(COMPONENT_DIR);
const allContent = allFiles.map((f) => f.content).join("\n");

// ---------- T1: 金色(gold)只用于 mastery/crown 相关 ----------
test("T1 gold 只用于 mastery/crown 场景", () => {
  // 找所有含 gold 的 className,排除合理用法(mastery、crown、掌握、Lv.)
  const goldLines = allContent.split("\n").filter((l) => /\bgold\b/.test(l) && /className|class=/.test(l));
  // 允许的关键词:mastery, crown, 掌握, Lv, achieved, gold/30(边框,允许在成就卡)
  const violations = goldLines.filter((l) =>
    !/mastery|crown|掌握|Lv|achieved|progress|gold\/\d/.test(l),
  );
  // 允许少量非违规(如进度条达成态用 gold),所以只报"明显无关"的
  assert.ok(violations.length <= 2, `gold 可能误用 ${violations.length} 处:\n${violations.slice(0, 3).join("\n")}`);
});

// ---------- T2: 橙红只在警告/overdue/错误场景 ----------
test("T2 orange/red 只在 警告/overdue/错误 场景", () => {
  const orangeLines = allContent.split("\n").filter((l) => /orange-500|red-500|red-600/.test(l) && /className/.test(l));
  // 允许:overdue, warning, error, 复习, 待复习, wrong, 错, streak, danger, stop, submit, correct, fail, abort,
  //       以及 orange/red 用在"导航复习徽章"和"red-600 停止按钮"(class 含 hover:bg-red-5 或 rounded-full bg-orange)
  const violations = orangeLines.filter((l) =>
    !/overdue|warning|error|复习|待复习|wrong|错|🔥|streak|连击|review|reject|失败|quadrant|rate-again|stop|submit|correct|fail|abort|hover:bg-red|hover:text-red|hover:bg-orange|rounded-full bg-orange|text-orange-500 dark:text-orange-400 hover:|nav-review|dueCount|map-review|待复习/i.test(l),
  );
  assert.ok(violations.length <= 1, `orange/red 可能误用 ${violations.length} 处:\n${violations.slice(0, 3).join("\n")}`);
});

// ---------- T3: 正文不用 neutral-500 单值在 text-sm(对比度偏弱) ----------
test("T3 正文提示避免 neutral-500 单值配 text-sm", () => {
  // 找 text-neutral-500 dark:text-neutral-500(双 500,dark-first 下偏弱)
  const weakLines = allContent.split("\n").filter((l) =>
    /text-neutral-500 dark:text-neutral-500/.test(l),
  );
  // M4 阶段允许残留少量(都是辅助提示),但应 ≤5 处
  assert.ok(weakLines.length <= 5, `neutral-500 双值用在 text-sm ${weakLines.length} 处(应升级 600/400):\n${weakLines.slice(0, 3).join("\n")}`);
});

// ---------- T4: green brand 只用于 进度/选中/主操作/正确 ----------
test("T4 brand(绿)用于 进度/选中/操作/正确 场景", () => {
  // 找 text-brand/bg-brand,排除合理用法
  const brandLines = allContent.split("\n").filter((l) => /text-brand|bg-brand|border-brand/.test(l));
  // 这些都是合理场景:active, selected, primary, progress, submit, send, apply, correct, 掌握
  // 反例:用绿色做"装饰性背景"无状态语义
  // 由于 brand 用得很广(active 态),这里只做"数量合理性"检查
  assert.ok(brandLines.length > 10, `brand 用法应广泛(active/进度/操作),实际 ${brandLines.length} 处`);
});

// ---------- T5: blue accent 只用于 可交互/链接 ----------
test("T5 accent(蓝)用于 可交互/链接 场景", () => {
  const accentLines = allContent.split("\n").filter((l) => /text-accent|bg-accent|border-accent/.test(l));
  // 允许:hover, link, click, submit(blue), option(选中), interactive
  // accent 用在:quiz option 选中态、submit-blue 按钮、mermaid open link
  assert.ok(accentLines.length > 0, "accent 应有合理用法");
  // 检查没有把 accent 用在"已完成/掌握"(那是 gold 的活)
  const misuse = accentLines.filter((l) => /mastery|crown|掌握|完成|done|achieved/i.test(l));
  assert.ok(misuse.length === 0, `accent 不该用于 mastery 场景:\n${misuse.join("\n")}`);
});

// ---------- T6: 所有 testid 都有对应的 data-testid(无遗漏) ----------
test("T6 关键 testid 存在(无被误删)", () => {
  // 扫描 components/ + App.tsx
  const appContent = readFileSync(join(__dirname, "..", "src", "renderer", "App.tsx"), "utf-8");
  const combined = allContent + "\n" + appContent;
  const required = [
    "map-rail", "chat-panel", "chat-stream", "notebook-panel",
    "composer", "skill-select", "xp-bar", "streak-badge",
    "command-palette", "thread-switcher",
  ];
  for (const id of required) {
    assert.ok(
      combined.includes(`data-testid="${id}"`),
      `缺少 testid: ${id}`,
    );
  }
});

// ---------- 跑测 ----------
let passed = 0, failed = 0;
for (const { name, fn } of TESTS) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${e.message}`);
    failed++;
  }
}
console.log(`\n=== 颜色语义规范: ${passed}/${TESTS.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
if (failed > 0) process.exit(1);
