/**
 * verify-math-render —— v0.19 数学公式全链(P1 渲染 / P2 朗读口语化 / P3 出题)。
 * 纯函数直测(记法归一/口语化规则)+ 源级接线守卫(三出口插件序/getTextModel
 * katex 规则/合成侧转换/提示词放开)。run: tsx scripts/verify-math-render.mjs
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { normalizeMathNotation } from "../src/renderer/lib/math-normalize.js";
import { mathToSpokenZH, speakMathInSentence } from "../shared/math-speech.js";
import { normalizeSpeechText } from "../shared/speech-text.js";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

console.log("T1 记法归一(\\(..\\)/\\[..\\] → $..$/$$..$$,幂等,围栏不动)");
{
  assert.equal(normalizeMathNotation(`\\(x^2\\) 是平方`), "$x^2$ 是平方", "行内记法归一");
  assert.equal(normalizeMathNotation(`\\[E=mc^2\\]`), "$$E=mc^2$$", "行间记法归一");
  const once = normalizeMathNotation(`\\(a\\) 与 \\[b\\]`);
  assert.equal(normalizeMathNotation(once), once, "幂等");
  assert.ok(normalizeMathNotation("```\n\\(x\\) 代码内不动\n```").includes("\\(x\\)"), "围栏内不动");
  assert.equal(normalizeMathNotation("plain $x$ 照旧"), "plain $x$ 照旧", "$ 记法零变化");
  assert.equal(normalizeMathNotation("```\ncode\n```\n\\(y\\)"), "```\ncode\n```\n$y$", "围栏内外混合");
}
console.log("✓ T1 记法归一");

console.log("T2 口语化规则表(分式/根号/上下标/希腊/算符/未知宏降级)");
{
  assert.equal(mathToSpokenZH("x^2"), "x 的 2 次方");
  assert.equal(mathToSpokenZH("\\frac{a}{b}"), "a 分之 b");
  assert.equal(mathToSpokenZH("\\frac{\\alpha}{\\beta}"), "阿尔法 分之 贝塔", "分式参数递归口语化");
  assert.equal(mathToSpokenZH("\\sqrt{x+1}"), "根号 x+1");
  assert.equal(mathToSpokenZH("\\sqrt[3]{8}"), "3 次根号 8");
  assert.equal(mathToSpokenZH("x_1"), "x 下标 1");
  assert.ok(mathToSpokenZH("\\alpha + \\beta").includes("阿尔法") && mathToSpokenZH("\\alpha + \\beta").includes("贝塔"), "希腊字母");
  assert.ok(mathToSpokenZH("a \\leq b").includes("小于等于"), "关系算符");
  assert.ok(mathToSpokenZH("\\int").includes("积分"), "积分");
  assert.ok(!mathToSpokenZH("\\unknowncmd").includes("\\"), "未知宏去掉反斜杠(逐字母降级)");
  // 句级:段外逐字节不变
  const s = "先看 $x^2$ 再看 $$\\frac{a}{b}$$ 结束。";
  const spoken = speakMathInSentence(s);
  assert.ok(spoken.includes("先看") && spoken.includes("结束。"), "段外文本保留");
  assert.ok(spoken.includes("x 的 2 次方") && spoken.includes("a 分之 b"), "段内口语化");
  assert.ok(!spoken.includes("$"), "美元定界符不进语音");
  assert.equal(speakMathInSentence("无公式句。"), "无公式句。", "无公式句零变化");
  // P1 纪律:normalizeSpeechText 本层不做口语化(原文透传,合成侧才转换)
  assert.ok(normalizeSpeechText("$x^2$ 与 $$\\frac{a}{b}$$").includes("$x^2$"), "净化层公式原文透传");
}
console.log("✓ T2 口语化规则表");

console.log("T3 渲染接线(两出口插件序=sanitize 先于 katex;字体全局引入)");
{
  for (const [name, f] of [["讲解区", "src/renderer/components/NotebookPanel.tsx"], ["对话流", "src/renderer/components/ChatStream.tsx"]]) {
    const src = read(f);
    assert.ok(src.includes("remarkPlugins={[remarkGfm, remarkMath]}"), `T3: ${name} 挂 remark-math`);
    const m = src.match(/rehypePlugins=\{\[rehypeRaw, \[rehypeSanitize, markdownSanitizeSchema\], rehypeKatex\]\}/);
    assert.ok(m, `T3: ${name} 插件序=raw→sanitize→katex(katex 产物不经 sanitize)`);
    assert.ok(src.includes("normalizeMathNotation("), `T3: ${name} 内容过记法归一`);
  }
  assert.ok(read("src/renderer/main.tsx").includes("katex/dist/katex.min.css"), "T3: katex 样式全局引入(一次打包)");
}
console.log("✓ T3 渲染接线");

console.log("T4 文本模型与公式(KaTeX 双层不撕裂匹配;合成侧转换/原文层不动)");
{
  const hl = read("src/renderer/lib/highlightText.ts");
  assert.ok(hl.includes('parent.closest(".katex-html")') && hl.includes("FILTER_REJECT"), "T4: 视觉字形层整段跳过");
  assert.ok(/\.katex-mathml.*?!parent\.closest\("annotation"\)/s.test(hl), "T4: MathML 只收 annotation 的 TeX 源");
  const tts = read("src/main/services/speech/tts-service.ts");
  assert.ok(tts.includes("synth(dataDir, cfg, engine, speakMathInSentence(sentence)"), "T4: 主进程合成吃口语化文本");
  assert.ok(tts.includes("sentence: sentences[i]!,"), "T4: 句事件仍发原文(karaoke 对齐 DOM)");
  const speech = read("src/renderer/lib/useSpeech.ts");
  assert.ok(speech.includes("speakMathInSentence(q.sentences[idx]!"), "T4: 系统档 utterance 口语化");
}
console.log("✓ T4 文本模型与公式");

console.log("T5 网页公式回收 + 出题放开 LaTeX");
{
  const art = read("src/main/services/pure/html-article.ts");
  const recover = art.indexOf("script[type='math/tex']");
  const strip = art.indexOf('for (const tag of ["script", "style", "head"])');
  assert.ok(recover >= 0 && strip >= 0 && recover < strip, "T5: MathJax script 回收先于 script 清理");
  assert.ok(art.includes('.katex")') && art.includes("annotation"), "T5: KaTeX annotation 回收");
  for (const [name, f] of [["练习", "src/main/services/exercise-service.ts"], ["考试", "src/main/services/exam-service.ts"]]) {
    assert.ok(read(f).includes("$$..$$ 的 LaTeX 记法"), `T5: ${name}提示词放开 LaTeX`);
  }
}
console.log("✓ T5 网页公式回收 + 出题放开");

console.log("\nverify-math-render: ALL PASS");
