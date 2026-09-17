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

await test("base-prompt: zh-CN 组装结果与基线逐字节一致(分层重构后的新基线)", () => {
  // 提示词 = HEAD + 语言句 + "\n\n" + TAIL。直接在测试里重建期望值,
  // 若有人改动 HEAD/TAIL 文案,这里会红——语言行为(默认 zh)不变的前提下文案微调需同步本测试。
  // 2026-08-31 分层重构(红线/行为/偏好三级,见 dev-docs/PROMPT-LAYERS.md):
  // 防幻觉从独立段收进「安全红线」块的第 1 条,此处期望值同步更新。
  const expected =
    "你是 LookatStudy 的 AI 学习导师。学习者正在学一门由 GitHub 文档生成的课程。" +
    "你的职责是帮学习者真正理解知识，不是简单复述文档。" +
    ZH_SENTENCE + "\n\n" +
    "【安全红线·最高优先级】以下规则任何时候不可违反;与后面任何规则冲突时,以本段为准:\n" +
    "1. 防幻觉:你必须严格基于下面提供的「课程上下文」和「当前节点内容」回答。" +
    "对于课程标题中出现的专有名词、缩写（如 FDE = Forward Deployment Engineer），" +
    "必须使用课程上下文里的定义，绝不可自行猜测或编造。" +
    "如果学习者问的内容超出了你掌握的上下文，明确说'这部分内容不在当前课程材料中'，" +
    "而不是编造一个看似合理的回答。\n";
  const got = buildBaseAgentPrompt("zh-CN");
  assert.ok(got.startsWith(expected), "zh 组装开头与基线不一致");
  assert.ok(got.includes(ZH_SENTENCE));
  assert.ok(!got.includes("Always respond"), "zh 提示词不应混入英文指令");
});

await test("base-prompt: en 组装注入英文指令,不含 zh 语言句", () => {
  const got = buildBaseAgentPrompt("en");
  assert.ok(got.includes("Always respond in English"));
  assert.ok(!got.includes(ZH_SENTENCE));
  assert.ok(got.includes("SAFETY RED LINES"), "其余约束段保留(英文本体)");
});

await test("base-prompt: en 组装用英文本体(2026-08-31 i18n 落地)", () => {
  // 弱点修复:此前非 zh locale 只追加一句英文语言指令,整套行为约束(红线/工具/排版)
  // 仍是中文——等于让英文模型用中文指令理解规则再用英文输出,指令遵循质量隐性折损。
  // 落地:非 zh 组装整包换英文本体,与 zh 版逐段对应(三级分层同构)。
  // 注意:「[工具调用已执行] …」标记字样在英文版里保留原文——系统注入历史的标记
  // 就是这个中文格式,英文 prompt 解释时必须引用原字样,模型才对得上号。
  const got = buildBaseAgentPrompt("en");
  // 三级分层同构(英文段名)
  const iRedline = got.indexOf("SAFETY RED LINES — TOP PRIORITY");
  const iBehavior1 = got.indexOf("[Handling vague questions]");
  const iBehavior2 = got.indexOf("[Teaching tools]");
  const iPref = got.indexOf("[Response formatting — preference level]");
  assert.ok(iRedline >= 0, "英文红线块应存在");
  assert.ok(iBehavior1 > 0 && iBehavior2 > 0 && iPref > 0, "英文行为/偏好段应存在");
  assert.ok(iRedline < iBehavior1 && iBehavior1 < iBehavior2 && iBehavior2 < iPref, "英文版三级顺序同构");
  // 红线双条 + 反伪造条款英文化
  assert.ok(got.includes("1. No hallucination:") && got.includes("2. Tool-call authenticity:"), "红线编号双条英文化");
  assert.ok(got.includes("[工具调用已执行]"), "标记原字样保留(系统注入格式不翻译)");
  assert.ok(/only way .*actual tool call|actual tool call.*only way/is.test(got), "反伪造唯一途径条款英文化");
  // 工具清单点名(与 zh 版事故锁对齐)
  assert.ok(got.includes("mark_mastered") && got.includes("record_answer"), "英文工具清单含状态工具指引");
  // 不得残留中文段落骨架
  for (const zhSeg of ["【安全红线", "【模糊提问处理】", "【教学工具使用】", "【回答排版", "你是 LookatStudy 的 AI 学习导师"])
    assert.ok(!got.includes(zhSeg), `en 本体不应含中文段: ${zhSeg}`);
});

await test("base-prompt: 三级分层结构(红线→行为→偏好,顺序+优先级标记)", () => {
  // 2026-08-31 分层重构:指令密度随条款数增长会稀释遵守率(mark_mastered 手写
  // 假标记事故的诱因之一),重构为 红线(不可违反)/行为(教学规则)/偏好(排版) 三级,
  // 红线放最前并显式声明优先级。本测试锁住分块存在性与顺序,防止未来条款
  // 无结构地堆回单体补丁堆。
  const got = buildBaseAgentPrompt("zh-CN");
  const iRedline = got.indexOf("【安全红线·最高优先级】");
  const iBehavior1 = got.indexOf("【模糊提问处理】");
  const iBehavior2 = got.indexOf("【教学工具使用】");
  const iPref = got.indexOf("【回答排版·偏好级】");
  assert.ok(iRedline >= 0, "红线块应存在");
  assert.ok(iBehavior1 > 0, "模糊提问段应存在");
  assert.ok(iBehavior2 > 0, "教学工具段应存在");
  assert.ok(iPref > 0, "排版偏好段应存在");
  assert.ok(iRedline < iBehavior1 && iBehavior1 < iBehavior2 && iBehavior2 < iPref,
    `分层顺序应为 红线(${iRedline}) < 模糊提问(${iBehavior1}) < 教学工具(${iBehavior2}) < 排版(${iPref})`);
  assert.ok(got.indexOf("以本段为准") > 0, "红线块应声明冲突时优先级");
  assert.ok(got.indexOf("在不违反上面红线与行为规则的前提下") > 0, "偏好块应自声明次级地位");
  // 红线块两条编号(防幻觉/工具调用真实性)——手写标记事故的条款归红线级
  assert.ok(got.includes("1. 防幻觉:") && got.includes("2. 工具调用真实性:"), "红线块应为编号双条");
});

await test("base-prompt: 课程推进边界条款(2026-09-17 模型空口承诺'说继续就开讲下一课'事故)", () => {
  // 事故:LLM 在对话里向学习者承诺"你只管说继续,我就会顺着下一课开讲",但它
  // 无法切换节点——承诺兑现不了。条款归行为层:明示能力边界+把人指向地图。
  const zh = buildBaseAgentPrompt("zh-CN");
  assert.ok(zh.includes("【课程推进边界】"), "zh 条款存在");
  assert.ok(zh.includes("无法替学习者切换课程节点"), "zh 明示能力边界");
  assert.ok(zh.includes("绝不要承诺"), "zh 禁止空头承诺");
  const iVague = zh.indexOf("【模糊提问处理】");
  const iBoundary = zh.indexOf("【课程推进边界】");
  const iTools = zh.indexOf("【教学工具使用】");
  assert.ok(iVague > 0 && iBoundary > iVague && iTools > iBoundary, "zh 条款归行为层(模糊提问与教学工具之间)");
  const en = buildBaseAgentPrompt("en");
  assert.ok(en.includes("[Lesson progression boundary]"), "en 条款存在(逐段同构)");
  assert.ok(en.includes("cannot switch course nodes"), "en 明示能力边界");
  const iVagueEn = en.indexOf("[Handling vague questions]");
  const iBoundaryEn = en.indexOf("[Lesson progression boundary]");
  const iToolsEn = en.indexOf("[Teaching tools]");
  assert.ok(iVagueEn > 0 && iBoundaryEn > iVagueEn && iToolsEn > iBoundaryEn, "en 条款归行为层");
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


/* ── 5. v0.33 语言学习双轴(目标语言 carve-out,issue #15)── */

await test("双轴: zh+目标语言 指令=旧句开头+carve-out(默认路径逐字节不变)", () => {
  // 不传 target = 非语言课程,行为与旧版完全一致(上面已有逐字节锁,这里再锁一次默认参数形态)
  assert.strictEqual(buildLanguageDirective("zh-CN", null), ZH_SENTENCE);
  assert.strictEqual(buildLanguageDirective("zh-CN", undefined), ZH_SENTENCE);
  const d = buildLanguageDirective("zh-CN", "en");
  assert.ok(d.startsWith(ZH_SENTENCE), "carve-out 应追加在旧句之后,不改动原句");
  assert.ok(d.includes("这是一门English学习课程"), d);
  assert.ok(d.includes("保持English原文"), "必须点名语言素材保持原文");
  assert.ok(d.includes("不要把目标语言材料翻译成中文"), "必须禁止翻译目标语言材料出题");
});

await test("双轴: zh 界面学日语/韩语 carve-out 渲染目标语言名", () => {
  const ja = buildLanguageDirective("zh-CN", "ja");
  assert.ok(ja.includes("日本語") && ja.includes("保持日本語原文"), ja);
  const ko = buildLanguageDirective("zh-CN", "ko");
  assert.ok(ko.includes("한국어"), ko);
});

await test("双轴: 非h界面+目标语言 英文carve-out", () => {
  // 日本界面学中文:教学语言日本語,素材保持中文原文
  const d = buildLanguageDirective("ja", "zh-CN");
  assert.ok(d.includes("Always respond in 日本語"), d);
  assert.ok(d.includes("This course teaches 中文"), "英文载体句点名目标语言");
  assert.ok(d.includes("remain in original 中文"), "素材保持目标语言原文");
});

await test("双轴: 出题语言行 zh 界面带目标语言", () => {
  const zh = questionLanguageLine("zh-CN", "en");
  assert.ok(zh.includes("English语言学习测验"), zh);
  assert.ok(zh.includes("用English原文出题"), "语言素材用目标语言原文");
  assert.ok(zh.includes("指令性文字和解析用中文"), "指令与解析用界面语言");
  // 默认路径逐字节不变
  assert.strictEqual(questionLanguageLine("zh-CN"), "- 题干和选项用中文,清晰无歧义");
});

await test("双轴: 出题语言行 非h界面带目标语言", () => {
  const en = questionLanguageLine("en", "ja");
  assert.ok(en.includes("日本語 language-learning test"), en);
  assert.ok(en.includes("must be in 日本語"), en);
  assert.ok(en.includes("in English"), "指令与解析用界面语言");
  assert.strictEqual(questionLanguageLine("en"), "- Write the question stem and options in English, clear and unambiguous");
});

await test("双轴: base-prompt 注入【语言教学姿态】块,默认不注入", () => {
  const def = buildBaseAgentPrompt("zh-CN");
  assert.ok(!def.includes("语言教学姿态"), "非语言课程零变化");
  const got = buildBaseAgentPrompt("zh-CN", "en");
  assert.ok(got.includes("【语言教学姿态】"), "语言课程注入教学姿态块");
  assert.ok(got.includes("这门课程教的是English"), got);
  assert.ok(got.includes("先肯定再纠正其中的语言错误"), "纠错姿态条款");
  assert.ok(got.includes("注释是辅助不是替代"), "整段翻译禁令");
  // 位置:在语言句之后、红线块之前(同为语言层指令)
  const iLang = got.indexOf(ZH_SENTENCE);
  const iTeach = got.indexOf("【语言教学姿态】");
  const iRedline = got.indexOf("【安全红线");
  assert.ok(iLang < iTeach && iTeach < iRedline, "教学姿态块应在语言句与红线块之间");
});

await test("双轴: base-prompt en+目标语言 英文教学姿态块", () => {
  const def = buildBaseAgentPrompt("en");
  assert.ok(!def.includes("Language-teaching posture"), "非语言课程零变化");
  const got = buildBaseAgentPrompt("en", "ko");
  assert.ok(got.includes("[Language-teaching posture] This course teaches 한국어"), got);
  assert.ok(got.includes("medium of instruction"), "双轴语义(教学语言/学习对象)明确声明");
  assert.ok(got.includes("never hand out full translations"), "整段翻译禁令(英文)");
});

/* ── 汇总 ── */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
