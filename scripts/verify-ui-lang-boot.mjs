/**
 * verify-ui-lang-boot —— 界面语言首启跟随系统 locale(AppImage 目录收录前提)。
 *
 * 背景(2026-09-30,AppImage/appimage.github.io PR #9039):目录收录要求非中文
 * 环境默认英文界面(跟随系统 LANG/LC_*,中文环境仍默认中文)。旧实现是
 * i18n.ts 里 localStorage 为空时硬编码 zh-CN——en-US 机器首启也是中文界面。
 *
 * 分层:
 * T1 纯函数 localeToUiLang(shared/locales):zh 各变体→zh-CN,非 zh→en,
 *    无信息(null/undefined/空白)→zh-CN(Node 侧无 DOM import 的旧路径零变化)
 * T2 真实模块初始化(子进程预置 localStorage/navigator 桩后 import 真 i18n.ts,
 *    每场景独立子进程=模块初始化状态隔离):en-US→en / zh-CN→zh-CN /
 *    zh-TW→zh-CN(UI 只有简体变体)/ ja-JP→en / 无 localStorage→zh-CN /
 *    navigator 无 language 字段→zh-CN
 * T3 显式选择优先:store 存合法值(en/zh-CN)时 locale 不改写;垃圾值回落推导
 * T4 setLang 持久化:setLang 写 localStorage(显式选择跨重启)+ getLang 即时反映
 * T5 源级守卫:i18n.ts 初始化器接线(localeToUiLang 调用 + 存储值校验先于推导)+
 *    main/index.ts 测试模式(--ui-test/shots)强制 --lang zh-CN——否则 en 机器上
 *    72 条中文 DOM 断言与中文截图遍全假红
 * T6 verify:core 链注册自检
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { trackTempDir } from "./lib/temp-clean.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
// 源文件在 Windows 工作区是 CRLF——统一归一为 LF,多行断言才稳
const read = (p) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const i18nSrc = read("src/renderer/lib/i18n.ts");
const mainIndexSrc = read("src/main/index.ts");
const pkg = JSON.parse(read("package.json"));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}: ${e.message}`); failed++; }
}

/* ── T1 纯函数 ── */

const { localeToUiLang } = await import("../shared/locales.ts");

await test("T1 纯函数: zh 变体→zh-CN, 非 zh→en, 大小写不敏感", () => {
  for (const l of ["zh", "zh-CN", "zh-TW", "zh-Hans", "zh-Hant", "zh-HK", "zh-SG", "zh-MO", "ZH", "Zh-TW"])
    assert.strictEqual(localeToUiLang(l), "zh-CN", l);
  for (const l of ["en", "en-US", "ja-JP", "fr", "de-DE", "pt-BR", "EN-us"])
    assert.strictEqual(localeToUiLang(l), "en", l);
});

await test("T1 纯函数: 无信息(null/undefined/空白)→zh-CN(Node 侧旧默认零变化)", () => {
  for (const l of [null, undefined, "", "   "])
    assert.strictEqual(localeToUiLang(l), "zh-CN", JSON.stringify(l));
});

/* ── T2/T3/T4 真实模块初始化(子进程桩全局)── */

// 探针脚本:按环境变量预置 DOM 全局后 import 真 i18n.ts,输出初始化语言 +
// setLang 后的语言/持久化值。每场景一个子进程(模块级 currentLang 只初始化一次)。
const PROBE_SRC = `
import { pathToFileURL } from "node:url";
const store = JSON.parse(process.env.PROBE_STORE ?? "{}");
if (process.env.PROBE_NO_LS !== "1") {
  globalThis.localStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
  };
}
// PROBE_LANG="__none__" = navigator 在但无 language 字段(信息缺失形态)
Object.defineProperty(globalThis, "navigator", {
  value: process.env.PROBE_LANG === "__none__" ? {} : { language: process.env.PROBE_LANG },
  configurable: true,
});
const mod = await import(pathToFileURL(process.env.PROBE_TARGET).href);
const out = ["init:" + mod.getLang()];
if (globalThis.localStorage) {
  const next = mod.getLang() === "en" ? "zh-CN" : "en";
  mod.setLang(next);
  out.push("after:" + mod.getLang() + ";stored:" + globalThis.localStorage.getItem("lookatstudy-lang"));
}
console.log(out.join("\\n"));
`;

const probeDir = trackTempDir(mkdtempSync(join(tmpdir(), "ls-ui-lang-")));
const probePath = join(probeDir, "probe-ui-lang.mjs");
writeFileSync(probePath, PROBE_SRC, "utf8");

/** 跑一次探针子进程,返回 stdout 行数组 */
function runProbe({ lang, store = {}, noLs = false }) {
  const r = spawnSync(process.execPath, ["--import", "tsx", probePath], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PROBE_TARGET: join(ROOT, "src/renderer/lib/i18n.ts"),
      PROBE_LANG: lang,
      PROBE_STORE: JSON.stringify(store),
      PROBE_NO_LS: noLs ? "1" : "0",
    },
  });
  assert.strictEqual(r.status, 0, `探针子进程退出码 ${r.status}: ${r.stderr}`);
  return r.stdout.trim().split("\n");
}

await test("T2 真实初始化: en-US locale 首启 → en(目录收录前提)", () => {
  assert.strictEqual(runProbe({ lang: "en-US" })[0], "init:en");
});

await test("T2 真实初始化: zh-CN / zh-TW 首启 → zh-CN(UI 唯一中文变体)", () => {
  assert.strictEqual(runProbe({ lang: "zh-CN" })[0], "init:zh-CN");
  assert.strictEqual(runProbe({ lang: "zh-TW" })[0], "init:zh-CN");
});

await test("T2 真实初始化: ja-JP 等非中文 → en", () => {
  assert.strictEqual(runProbe({ lang: "ja-JP" })[0], "init:en");
});

await test("T2 真实初始化: 无 localStorage(Node import 路径)→ zh-CN 零变化", () => {
  // verify-agent-locale 等套件在纯 Node 里 import i18n 用 translate()——此路径行为不变
  assert.strictEqual(runProbe({ lang: "en-US", noLs: true })[0], "init:zh-CN");
});

await test("T2 真实初始化: navigator 无 language 字段 → zh-CN(无信息=旧默认)", () => {
  assert.strictEqual(runProbe({ lang: "__none__" })[0], "init:zh-CN");
});

await test("T3 显式选择优先: 合法存储值不被 locale 改写", () => {
  assert.strictEqual(runProbe({ lang: "en-US", store: { "lookatstudy-lang": "zh-CN" } })[0], "init:zh-CN");
  assert.strictEqual(runProbe({ lang: "zh-CN", store: { "lookatstudy-lang": "en" } })[0], "init:en");
});

await test("T3 垃圾存储值回落首启推导(不落旧硬编码)", () => {
  assert.strictEqual(
    runProbe({ lang: "en-US", store: { "lookatstudy-lang": "garbage" } })[0],
    "init:en",
    "垃圾值应视为未选择,走 locale 推导而非 zh-CN",
  );
});

await test("T4 setLang: 切换即时生效 + 持久化进 localStorage", () => {
  const lines = runProbe({ lang: "zh-CN" });
  // 探针在 zh 起始态下切 en:after=en 且 stored=en
  assert.strictEqual(lines[1], "after:en;stored:en", lines.join(" | "));
});

/* ── T5 源级守卫(接线防拆)── */

await test("T5 源级: i18n.ts 初始化器真调 localeToUiLang(navigator.language)", () => {
  const m = i18nSrc.match(/let currentLang: Lang = \(\(\) => \{([\s\S]*?)\}\)\(\);/);
  assert.ok(m, "currentLang 初始化器应存在");
  const init = m[1];
  assert.ok(init.includes("localeToUiLang("), "初始化器应调用 localeToUiLang(纯函数)");
  assert.ok(init.includes("navigator.language"), "推导应读 navigator.language");
  // 旧硬编码兜底不允许回来(标题注释里的历史描述除外,只看初始化器体内)
  assert.ok(!/'zh-CN'\s*\|\|\s*"zh-CN"|\/\*\s*zh-CN\s*\*\//.test(init), "不应残留硬编码 zh-CN 兜底");
});

await test("T5 源级: 存储值合法性校验先于 locale 推导(显式选择优先的次序锁)", () => {
  const m = i18nSrc.match(/let currentLang: Lang = \(\(\) => \{([\s\S]*?)\}\)\(\);/);
  const init = m?.[1] ?? "";
  const iValid = init.indexOf('stored === "zh-CN"');
  const iDerive = init.indexOf("localeToUiLang(");
  assert.ok(iValid >= 0, "应有存储值两态合法性校验");
  assert.ok(iDerive > iValid, `校验(${iValid})应在推导(${iDerive})之前`);
});

await test("T5 源级: main/index.ts 测试模式强制 --lang zh-CN(en 机器上中文断言防假红)", () => {
  // ui-test 72 条中文 DOM 断言 + shots 中文遍都默认"首启即中文";首启改跟随
  // locale 后,en-US 机器不强制就会全红。守卫:--ui-test 与 shots 分支都挂 lang 开关。
  const iSwitch = mainIndexSrc.indexOf('appendSwitch("lang", "zh-CN")');
  assert.ok(iSwitch > 0, "应存在 appendSwitch(\"lang\", \"zh-CN\")");
  const region = mainIndexSrc.slice(Math.max(0, iSwitch - 600), iSwitch + 200);
  assert.ok(region.includes("--ui-test") || region.includes('includes("--ui-test")'), "开关应挂在 ui-test/shots 测试模式分支内");
  assert.ok(region.includes("isShotsRun") || region.includes("--shots"), "shots 模式也应被覆盖");
});

await test("T6 verify:core 链已注册本套件", () => {
  assert.ok(
    pkg.scripts["verify:core"].includes("verify-ui-lang-boot.mjs"),
    "package.json verify:core 应包含 verify-ui-lang-boot.mjs",
  );
});

/* ── 汇总 ── */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
