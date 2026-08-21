/**
 * verify-system-tts —— v0.18 TTS 第四档「system」(浏览器/系统 speechSynthesis)。
 *
 * 档位定位:显式自选(音色是设备抽签:国产安卓厂商引擎常优于 kokoro,
 * Windows Chrome 本地 SAPI 可能更机械),不进 edge→local 自动降级链;
 * 播放管线在渲染层(逐句 utterance → playingSentence,karaoke/伴学共用)。
 *
 * 纯函数:音色挑选(偏好名→中文优先→default 标记→空表 null)与排序;
 * 编排:resolveTtsTier 新档解析、speakMessage 对 system 的防御性拒绝;
 * 接线:useSpeech 第二管线/设置页门控与音色选择/i18n 双语键(源级守卫)。
 *
 * 运行:tsx scripts/verify-system-tts.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { pickSystemVoice, sortVoicesZhFirst, systemVoiceLabel } from "../src/renderer/lib/system-tts";
import { resolveTtsTier } from "../src/main/services/speech/tts-tiers";
import { speakMessage } from "../src/main/services/speech/tts-service";

const read = (p) => readFileSync(new URL(`../src/renderer/${p}`, import.meta.url), "utf8");

let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

// ---------------------------------------------------------------------------
console.log("T1 音色挑选:偏好名 > 中文优先 > default 标记 > 空表 null");
{
  const zh = { name: "Huihui", lang: "zh-CN", default: true };
  const zhTw = { name: "MeiMei", lang: "zh-TW" };
  const en = { name: "David", lang: "en-US", default: true };
  // 偏好名精确匹配优先(哪怕不是中文)
  assert.equal(pickSystemVoice([zh, en], "David")?.name, "David", "偏好名命中");
  // 偏好名不存在 → 中文优先(且 zh-CN 先于 zh-TW)
  assert.equal(pickSystemVoice([en, zhTw, zh], "Nobody")?.name, "Huihui", "中文优先(zh-CN 胜)");
  // 无偏好:default 标记的中文胜过未标记的中文
  const zhPlain = { name: "Xunfei", lang: "zh-CN" };
  assert.equal(pickSystemVoice([zhPlain, zh], null)?.name, "Huihui", "default 标记的中文优先");
  // default 标记只有英文时不绑架选择:仍回到中文
  assert.equal(pickSystemVoice([zhPlain, en], null)?.name, "Xunfei", "default 仅英文时中文仍优先");
  // 全英文:default 标记优先
  const enPlain = { name: "Zira", lang: "en-US" };
  assert.equal(pickSystemVoice([enPlain, en], null)?.name, "David", "无中文时 default 英文优先");
  // 空表/空偏好串
  assert.equal(pickSystemVoice([], "x"), null, "空表 null(渲染层报 engine-unavailable)");
  assert.equal(pickSystemVoice([zh], "  ")?.name, "Huihui", "空白偏好按无偏好处理");
  ok("偏好/中文/default/空表 6 态全对");
}

// ---------------------------------------------------------------------------
console.log("T2 中文优先排序:zh-CN < zh-TW < 其他,lang+name 字典序稳定");
{
  const vs = [
    { name: "B", lang: "en-US" },
    { name: "A", lang: "zh-TW" },
    { name: "C", lang: "zh_CN" }, // 下划线变体(部分安卓引擎)
    { name: "D", lang: "zh" },
    { name: "E", lang: "en-GB" },
  ];
  const sorted = sortVoicesZhFirst(vs).map((v) => v.name);
  assert.deepEqual(sorted, ["D", "C", "A", "E", "B"], "zh/zh-CN(含下划线)先于 zh-TW 先于英文;同级按 lang 字典序");
  assert.equal(systemVoiceLabel({ name: "Huihui", lang: "zh-CN" }), "Huihui · zh-CN", "下拉显示名");
  ok("排序确定 + 显示名");
}

// ---------------------------------------------------------------------------
console.log("T3 档位解析:system 档 + tts_system_voice;非法值仍回 edge");
{
  const cfg = resolveTtsTier({ tts_engine: "system", tts_system_voice: "Huihui", tts_speed: "1.5" });
  assert.equal(cfg.engine, "system", "system 档解析");
  assert.equal(cfg.systemVoice, "Huihui", "音色名带出");
  assert.equal(cfg.speed, 1.5, "语速沿用统一多倍率");
  assert.equal(resolveTtsTier({ tts_engine: "system" }).systemVoice, null, "未选音色=null(自动挑)");
  assert.equal(resolveTtsTier({ tts_engine: "bogus" }).engine, "edge", "非法值不受影响");
  assert.equal(resolveTtsTier({ tts_engine: "edge", tts_system_voice: "x" }).systemVoice, "x", "其他档不影响字段解析");
  ok("解析 5 态");
}

// ---------------------------------------------------------------------------
console.log("T4 speakMessage 对 system 档防御性拒绝(正常路径渲染层不进 IPC)");
{
  const noop = () => {};
  const r = await speakMessage(noop, "/tmp/lsu-systts", { tts_engine: "system" }, "m1", "你好。", {});
  assert.equal(r.ok, false, "拒绝");
  assert.equal(r.reason, "engine-unavailable", "渲染层已有引导文案的原因码");
  ok("防御性拒绝");
}

// ---------------------------------------------------------------------------
console.log("T5 useSpeech 第二管线接线(源级守卫)");
{
  const s = read("lib/useSpeech.ts");
  // 句切分与 main 同一入口(零分叉)
  assert.ok(s.includes('from "@shared/speech-text"') && s.includes("speechSentencesOf("), "共用 speechSentencesOf");
  // 档位判定在 IPC 之前(点击手势内同步起播,Android 手势豁免不丢)
  const iBranch = s.indexOf('ttsCfgRef.current?.engine === "system"');
  const iIpc = s.indexOf("ttsSpeak(text, messageId)");
  assert.ok(iBranch > 0 && iIpc > iBranch, "system 分支先于 ttsSpeak IPC");
  // 档位缓存:挂载拉取 + 设置页广播
  assert.ok(s.includes("TTS_SETTINGS_CHANGED_EVENT") && s.includes('getSetting("tts_system_voice")'), "档位缓存来源");
  // 逐句 onstart 驱动 playingSentence(karaoke/伴学共用);顺序推进
  assert.ok(s.includes("u.onstart") && s.includes("setPlayingSentence({ index: idx"), "onstart 驱动播放句");
  assert.ok(s.includes("u.onend = advance") && s.includes("u.onerror = advance"), "顺序推进+单句失败跳过");
  // 停止:cancel 是 Android 唯一可靠停法
  assert.ok(s.includes('window.speechSynthesis.cancel()'), "stopLocal cancel");
  // 迟到音色表:voiceschanged 补后续句
  assert.ok(s.includes('"voiceschanged"'), "voiceschanged 迟到音色补偿");
  ok("第二管线 7 项接线");
}

// ---------------------------------------------------------------------------
console.log("T6 设置页接线:第四档按钮/门控/音色选择/设置变更广播");
{
  const s = read("components/SettingsView.tsx");
  assert.ok(s.includes('data-testid="tts-engine-system"'), "系统档按钮");
  assert.ok(s.includes("disabled={!systemTtsAvailable}"), "WebView 无 speechSynthesis 时置灰");
  assert.ok(s.includes('data-testid="tts-system-voice-select"') && s.includes('api.setSetting("tts_system_voice"'), "音色下拉 + 落库");
  assert.ok(s.includes('sortVoicesZhFirst(window.speechSynthesis.getVoices())'), "下拉中文优先排序");
  assert.ok(s.includes("notifyTtsSettingsChanged();") && s.includes("TTS_SETTINGS_CHANGED_EVENT"), "设置变更广播(档位缓存刷新)");
  const m = read("components/SettingsView.tsx");
  assert.ok(m.includes('getSetting("tts_system_voice")'), "启动读取已存音色");
  ok("设置页 6 项接线");
}

// ---------------------------------------------------------------------------
console.log("T7 纯度与 i18n:system-tts 不触 window;双语键齐");
{
  const pure = readFileSync(new URL("../src/renderer/lib/system-tts.ts", import.meta.url), "utf8");
  assert.ok(!pure.includes("window."), "system-tts.ts 纯函数(不触 window,verify 可直测)");
  const i18n = readFileSync(new URL("../src/renderer/lib/i18n.ts", import.meta.url), "utf8");
  for (const key of [
    "settings.speech.engine.system\"",
    "settings.speech.engine.system_note",
    "settings.speech.engine.system_unavailable",
    "settings.speech.voice_auto",
  ]) {
    const hits = i18n.split(key).length - 1;
    assert.ok(hits >= 2, `i18n 双语键缺: ${key}(zh+en 各一)`);
  }
  ok("纯度 + 双语 4 键");
}

console.log(`\nverify-system-tts: ${passed} 组全绿 ✓`);
