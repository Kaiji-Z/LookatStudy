/**
 * verify-agent-locale.mjs — AI 输出语言跟随(对话 + 出题)测试。
 *
 * 覆盖:
 * 1. shared/locales 纯函数:语言名映射 / zh 判定 / 语言指令(zh 逐字节=旧硬编码句,
 *    非 zh 显式点名工具参数) / 出题语言行
 * 2. base-prompt 组装:zh 默认提示词与旧版逐字节一致(默认行为零变化的回归锁),
 *    非 zh 注入英文指令且不含中文语言句;soul 语言提醒仅非 zh 存在
 * 3. resolveOutputLang(纯函数):界面语言即偏好——显式传入(i18n 界面语言)直接生效,
 *    null/缺省/空白 → zh-CN 兜底
 *
 * 纯函数测试,不依赖 Electron / 网络 / LLM / DB。
 * agent-engine 本体引 db/index(?raw),verify 进不去——语言组装已抽 base-prompt.ts,
 * 解析是 shared 纯函数,可直测。
 */
import { strict as assert } from "node:assert";
import {
  localeToLanguageName,
  isZhLocale,
  buildLanguageDirective,
  questionLanguageLine,
  resolveOutputLang,
} from "../shared/locales.ts";
import {
  buildBaseAgentPrompt,
  buildSoulLangReminder,
} from "../src/main/services/agent/base-prompt.ts";

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); failed++; }
}

/* ── 1) shared/locales 纯函数 ── */

await test("locales: 语言名映射(已知映射/未知原样)", () => {
  assert.strictEqual(localeToLanguageName("en"), "English");
  assert.strictEqual(localeToLanguageName("zh-CN"), "中文");
  assert.strictEqual(localeToLanguageName("ja"), "日本語");
  assert.strictEqual(localeToLanguageName("pt"), "pt"); // 未映射原样返回,不猜
});

await test("locales: isZhLocale 覆盖 zh 各变体", () => {
  for (const l of ["zh", "zh-CN", "zh-TW", "ZH-HK"]) assert.ok(isZhLocale(l), l);
  for (const l of ["en", "ja", "fr"]) assert.ok(!isZhLocale(l), l);
});

const ZH_SENTENCE = "用清晰、鼓励的中文回答。当学习者答错时，先肯定尝试再纠正。";

await test("locales: zh 语言指令 = 旧硬编码句(逐字节)", () => {
  assert.strictEqual(buildLanguageDirective("zh-CN"), ZH_SENTENCE);
  assert.strictEqual(buildLanguageDirective("zh-TW"), ZH_SENTENCE);
});

await test("locales: 非 zh 指令点名语言 + 工具参数约束", () => {
  const d = buildLanguageDirective("en");
  assert.ok(d.includes("Always respond in English"), d);
  assert.ok(d.includes("tool-call parameters"), "必须约束工具参数也跟随语言");
  assert.ok(!d.includes("中文"), d);
});

await test("locales: 出题语言行 zh/en 两态", () => {
  assert.ok(questionLanguageLine("zh-CN").includes("中文"));
  assert.ok(questionLanguageLine("en").includes("in English"));
});

/* ── 2) base-prompt 组装(zh 默认零变化的回归锁) ── */

await test("base-prompt: zh-CN 组装结果与旧硬编码 BASE_AGENT_PROMPT 逐字节一致", () => {
  // 旧版提示词 = HEAD + 语言句 + "\n\n" + TAIL。直接在测试里重建期望值,
  // 若有人改动 HEAD/TAIL 文案,这里会红——语言行为(默认 zh)不变的前提下文案微调需同步本测试。
  const expected =
    "你是 LookatStudy 的 AI 学习导师。学习者正在学一门由 GitHub 文档生成的课程。" +
    "你的职责是帮学习者真正理解知识，不是简单复述文档。" +
    ZH_SENTENCE + "\n\n" +
    "【防幻觉红线】你必须严格基于下面提供的「课程上下文」和「当前节点内容」回答。" +
    "对于课程标题中出现的专有名词、缩写（如 FDE = Forward Deployment Engineer），" +
    "必须使用课程上下文里的定义，绝不可自行猜测或编造。" +
    "如果学习者问的内容超出了你掌握的上下文，明确说'这部分内容不在当前课程材料中'，" +
    "而不是编造一个看似合理的回答。\n\n" +
    "【模糊提问处理】";
  const got = buildBaseAgentPrompt("zh-CN");
  assert.ok(got.startsWith(expected), "zh 组装开头与旧版不一致");
  assert.ok(got.includes(ZH_SENTENCE));
  assert.ok(!got.includes("Always respond"), "zh 提示词不应混入英文指令");
});

await test("base-prompt: en 组装注入英文指令,不含 zh 语言句", () => {
  const got = buildBaseAgentPrompt("en");
  assert.ok(got.includes("Always respond in English"));
  assert.ok(!got.includes(ZH_SENTENCE));
  assert.ok(got.includes("【防幻觉红线】"), "其余约束段保留");
});

await test("base-prompt: 工具清单含 mark_mastered/record_answer(手写标记事故锁)", () => {
  // 真实事故(2026-08-31,用户报告):默认思考档下模型没真正调用 mark_mastered,
  // 而是在正文里手写「[工具调用已执行] mark_mastered → …」假标记冒充已发起提议——
  // 界面只认 tool-call part,手写文本不产生确认卡片,学习者无按钮可点。
  // 修复 = 工具清单点名这两个工具 + 反伪造条款。本测试锁住这两段文案不被误删。
  const got = buildBaseAgentPrompt("zh-CN");
  assert.ok(got.includes("mark_mastered"), "工具清单应含 mark_mastered 指引");
  assert.ok(got.includes("record_answer"), "工具清单应含 record_answer 指引");
  assert.ok(got.includes("绝不可"), "反伪造条款应存在");
  assert.ok(got.includes("手写"), "反伪造条款应点名'手写'行为");
  assert.ok(got.includes("唯一途径"), "应声明发起提议的唯一途径是真正的工具调用");
});

await test("base-prompt: soul 语言提醒仅非 zh 存在", () => {
  assert.strictEqual(buildSoulLangReminder("zh-CN"), undefined);
  const r = buildSoulLangReminder("en");
  assert.ok(r && r.includes("English") && r.includes("tool parameters"));
});

/* ── 3) 输出语言解析(纯函数:界面语言即偏好) ── */

await test("resolve: 界面语言直接生效", () => {
  assert.strictEqual(resolveOutputLang("en"), "en");
  assert.strictEqual(resolveOutputLang("zh-CN"), "zh-CN");
  assert.strictEqual(resolveOutputLang("zh-TW"), "zh-TW");
  assert.strictEqual(resolveOutputLang("ja"), "ja");
});

await test("resolve: null/缺省/空白 → zh-CN 兜底", () => {
  assert.strictEqual(resolveOutputLang(null), "zh-CN");
  assert.strictEqual(resolveOutputLang(undefined), "zh-CN");
  assert.strictEqual(resolveOutputLang(""), "zh-CN");
  assert.strictEqual(resolveOutputLang("   "), "zh-CN");
});

/* ── 4. 「开始学习」开场提示词模板(App.handleStartLearning 现走 i18n)── */
await test("startLearningPrompt: zh 模板与旧硬编码逐字节一致(默认行为零变化)", async () => {
  const { translate } = await import("../src/renderer/lib/i18n.ts");
  const zhOld = `我想开始学「测试课」。但我现在没什么劲——别直接讲概念,也别出计分题考我。请这样开场:
1. 先用一两句散文抛个钩子(反直觉的、或跟我日常有关的,让我产生好奇);
2. 然后调用 pose_guess 工具,给我一个二选一的小猜测(就是玩,不是考试);
3. 我会点选项猜,你【下一回合】再揭晓,顺带把这课最核心的一点讲清楚。
铁律:起手不要讲座、不要用 generate_quiz 出计分题、不要计分。把我勾住是唯一目标。`;
  const zhGot = translate("chat.action.startLearningPrompt", "zh-CN", { title: "测试课" });
  assert.strictEqual(zhGot, zhOld);
});

await test("startLearningPrompt: en 模板完整、{title} 插值、无中文残留", async () => {
  const { translate } = await import("../src/renderer/lib/i18n.ts");
  const enGot = translate("chat.action.startLearningPrompt", "en", { title: "Demo Lesson" });
  assert.ok(enGot.includes("Demo Lesson"), "en 模板应完成 {title} 插值");
  assert.ok(enGot.includes("pose_guess"), "en 模板保留 pose_guess 工具名");
  assert.ok(!/[一-鿿]/.test(enGot), "en 模板不应含中文");
});

/* ── 汇总 ── */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
