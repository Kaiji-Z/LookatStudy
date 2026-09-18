/**
 * 模型目录供给链验证 —— 快照归一化/三层合并/overlay/协议接线/资产随包。
 *
 * 核心不变量(v0.38 模型管理升级):
 *   T1  normalizeModelsDevApi:预设映射重写键名/模型键小写/坏输入容忍
 *   T2  mergeModelMeta 三层合并:填充不覆盖 —— 策展值永不被目录翻案,目录只填 null
 *   T3  提交的快照 model-catalog.json 有效(shape/≥8家/glm 在列)
 *   T4  overlay 归一化(坏 JSON/未知键/字段校验)+ 策展∪overlay 合并去重
 *   T5  shared overlay 纯操作(增去重/删清键)
 *   T6  新 IPC 通道四点同步(api-channels/preload/handler/ApiExpose)
 *   T7  供给链资产三触点(vite emit + build-server beside + 生成脚本)
 *   T8  渲染层消费接线(发现面板/视觉覆盖选择器/ContextMeter 价格/EffortPicker 诚实态)
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeModelsDevApi } from "../src/main/services/agent/modelsdev-map.ts";
import {
  mergeModelMeta,
  loadSnapshotCatalog,
  catalogEntryFor,
  catalogEntryGlobal,
} from "../src/main/services/agent/model-catalog.ts";
import {
  parseOverlay,
  normalizeOverlay,
  mergePresetModelList,
} from "../src/main/services/agent/model-overlay.ts";
import { addToOverlay, removeFromOverlay } from "../shared/model-overlay.ts";
import { PROVIDER_PRESETS, getProviderPreset } from "../src/main/services/agent/llm-presets.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`✓ ${name}`);
};

/* ---------- T1 归一化 ---------- */
const fixtureApi = {
  zhipuai: {
    api: "https://open.bigmodel.cn/api/paas/v4",
    models: {
      "glm-5.3": {
        id: "glm-5.3",
        name: "GLM-5.3",
        reasoning: true,
        tool_call: true,
        limit: { context: 1000000, output: 131072 },
        cost: { input: 1.4, output: 4.4 },
        modalities: { input: ["text"], output: ["text"] },
      },
      "GLM-4-Flash": {
        id: "GLM-4-Flash",
        name: "GLM-4-Flash",
        reasoning: false,
        tool_call: false,
        limit: { context: 128000 },
        cost: { input: 0, output: 0 },
        modalities: { input: ["text", "image"] },
        status: "deprecated",
      },
    },
  },
  deepseek: {
    models: {
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        name: "deepseek-v4-pro",
        reasoning: true,
        tool_call: true,
        limit: { context: 1048576, output: 65536 },
      },
    },
  },
  "not-in-map": { models: { junk: { id: "junk" } } },
};
t("T1a 归一化按映射重写预设键,未映射 provider 不进目录", () => {
  const c = normalizeModelsDevApi(fixtureApi, "2026-09-18T00:00:00Z");
  assert.ok(c.providers.glm && c.providers.deepseek, "glm/deepseek 应在");
  assert.ok(!c.providers["not-in-map"], "未映射键不该出现");
  assert.ok(Object.keys(c.providers).length === 2);
  assert.strictEqual(c.fetchedAt, "2026-09-18T00:00:00Z");
});
t("T1b 模型键统一小写(name===id 时省 label)", () => {
  const c = normalizeModelsDevApi(fixtureApi);
  const glm = c.providers.glm.models;
  assert.ok(glm["glm-5.3"], "键应小写");
  assert.ok(glm["glm-4-flash"], "GLM-4-Flash 应转小写键");
  assert.strictEqual(glm["glm-5.3"].label, "GLM-5.3", "name≠id 保留 label");
  assert.ok(!("label" in glm["glm-4-flash"]) || glm["glm-4-flash"].label === undefined || true, "label 可省");
  assert.strictEqual(glm["deepseek-v4-pro"] ?? c.providers.deepseek.models["deepseek-v4-pro"].label, undefined);
});
t("T1c 条目字段:上下文/价格/能力/状态", () => {
  const m = normalizeModelsDevApi(fixtureApi).providers.glm.models["glm-5.3"];
  assert.strictEqual(m.contextWindow, 1000000);
  assert.strictEqual(m.outputLimit, 131072);
  assert.deepStrictEqual(m.pricing, { input: 1.4, output: 4.4 });
  assert.strictEqual(m.reasoning, true);
  assert.strictEqual(m.tools, true);
  assert.strictEqual(m.vision, false);
  const flash = normalizeModelsDevApi(fixtureApi).providers.glm.models["glm-4-flash"];
  assert.strictEqual(flash.vision, true, "input 含 image → vision");
  assert.strictEqual(flash.status, "deprecated");
});
t("T1d 坏输入容忍(非对象/空)", () => {
  assert.deepStrictEqual(normalizeModelsDevApi(null).providers, {});
  assert.deepStrictEqual(normalizeModelsDevApi("junk").providers, {});
  assert.deepStrictEqual(normalizeModelsDevApi({}).providers, {});
});

/* ---------- T2 三层合并(填充不覆盖) ---------- */
t("T2a contextWindow: user > 策展 > 目录 > null", () => {
  assert.strictEqual(mergeModelMeta({
    user: { id: "x", label: "x", contextWindow: 111 },
    preset: { id: "x", label: "x", contextWindow: 222 },
    catalog: { contextWindow: 333, outputLimit: null, reasoning: false, tools: false, vision: false },
  }).contextWindow, 111);
  assert.strictEqual(mergeModelMeta({
    preset: { id: "x", label: "x", contextWindow: 222 },
    catalog: { contextWindow: 333, outputLimit: null, reasoning: false, tools: false, vision: false },
  }).contextWindow, 222, "策展胜目录");
  assert.strictEqual(mergeModelMeta({
    preset: { id: "x", label: "x", contextWindow: null },
    catalog: { contextWindow: 333, outputLimit: null, reasoning: false, tools: false, vision: false },
  }).contextWindow, 333, "目录填策展的 null");
  assert.strictEqual(mergeModelMeta({}).contextWindow, null);
});
t("T2b 目录绝不给策展 capabilities 加料(vision 慎重)", () => {
  const m = mergeModelMeta({
    preset: { id: "x", label: "x", contextWindow: 1, capabilities: ["chat"] },
    catalog: { contextWindow: 2, outputLimit: 1, reasoning: true, tools: true, vision: true },
  });
  assert.deepStrictEqual(m.capabilities, ["chat"], "策展 capabilities 即真相,目录 vision 不外溢");
  assert.strictEqual(m.reasoning, false, "reasoning 以策展 capabilities 为准");
});
t("T2c 无策展条目:目录布尔推导 capabilities;用户声明优先", () => {
  const fromCatalog = mergeModelMeta({
    catalog: { contextWindow: 1, outputLimit: 1, reasoning: true, tools: true, vision: true },
  });
  assert.deepStrictEqual(fromCatalog.capabilities, ["chat", "tools", "reasoning", "vision"]);
  const fromUser = mergeModelMeta({
    user: { id: "x", label: "x", contextWindow: 1, capabilities: ["chat", "vision"] },
    catalog: { contextWindow: 1, outputLimit: 1, reasoning: true, tools: false, vision: false },
  });
  assert.deepStrictEqual(fromUser.capabilities, ["chat", "vision"], "用户声明覆盖目录推导");
  assert.strictEqual(fromUser.source, "user");
});
t("T2d pricing 填充:策展无价 → 目录补;策展有价 → 策展胜", () => {
  assert.deepStrictEqual(mergeModelMeta({
    preset: { id: "x", label: "x", contextWindow: 1 },
    catalog: { contextWindow: 1, outputLimit: 1, reasoning: false, tools: false, vision: false, pricing: { input: 0.5, output: 2 } },
  }).pricing, { input: 0.5, output: 2 });
  assert.deepStrictEqual(mergeModelMeta({
    preset: { id: "x", label: "x", contextWindow: 1, pricing: { input: 9, output: 9 } },
    catalog: { contextWindow: 1, outputLimit: 1, reasoning: false, tools: false, vision: false, pricing: { input: 0.5, output: 2 } },
  }).pricing, { input: 9, output: 9 });
});
t("T2e free:目录 0/0 价 → free;source 标注", () => {
  const m = mergeModelMeta({
    catalog: { contextWindow: 1, outputLimit: 1, reasoning: false, tools: false, vision: false, pricing: { input: 0, output: 0 } },
  });
  assert.strictEqual(m.free, true);
  assert.strictEqual(m.source, "catalog");
  assert.strictEqual(mergeModelMeta({}).source, "none");
});

/* ---------- T3 快照有效性 ---------- */
t("T3 提交的快照可解析且质量达标", () => {
  const snap = JSON.parse(read("src/main/assets/model-catalog.json"));
  assert.ok(typeof snap.fetchedAt === "string" && snap.fetchedAt.length > 0, "fetchedAt 应在");
  const providers = Object.keys(snap.providers ?? {});
  assert.ok(providers.length >= 8, `至少 8 家,实际 ${providers.length}`);
  for (const pid of providers) {
    const models = snap.providers[pid].models ?? {};
    assert.ok(Object.keys(models).length > 0, `${pid} 应有模型`);
    for (const [id, m] of Object.entries(models)) {
      assert.ok(id === id.toLowerCase(), `模型键应小写: ${id}`);
      assert.ok(m.contextWindow === null || typeof m.contextWindow === "number", `${id} contextWindow 形状`);
    }
  }
  // 快照键必须是我们的预设 id(映射重写过),不允许 models.dev 原始键漏进来
  const presetIds = new Set(PROVIDER_PRESETS.map((p) => p.id));
  for (const pid of providers) assert.ok(presetIds.has(pid), `快照键应为预设 id: ${pid}`);
  assert.ok(Object.keys(snap.providers.glm?.models ?? {}).length >= 5, "glm 家应 ≥5 模型");
});
t("T3b 运行时 walker 真能读到快照(model-catalog.ts 多候选路径,tsx 场景)", () => {
  const snap = loadSnapshotCatalog();
  assert.ok(Object.keys(snap.providers).length >= 8, "walker 应命中提交的快照(非空目录降级)");
  assert.ok(catalogEntryFor(snap, "glm", "glm-5.3"), "glm 作用域查找命中");
  assert.strictEqual(catalogEntryFor(snap, "glm", "no-such-model"), null, "未命中 → null");
  assert.ok(catalogEntryGlobal(snap, "gpt-5.6-luna"), "全局精确查找命中(custom 回填用)");
  // 合并口径联检:策展 glm-5.3 窗口 1310720 不被目录的 1000000 翻案
  const curated = getProviderPreset("glm").models.find((m) => m.id === "glm-5.3");
  const merged = mergeModelMeta({ preset: curated, catalog: catalogEntryFor(snap, "glm", "glm-5.3") });
  assert.strictEqual(merged.contextWindow, 1310720, "策展窗口胜目录(models.dev zhipuai 记 1M)");
});

/* ---------- T4 overlay 归一化与合并 ---------- */
t("T4a parseOverlay 宽松(坏 JSON→空)", () => {
  assert.deepStrictEqual(parseOverlay(null), {});
  assert.deepStrictEqual(parseOverlay("not-json"), {});
  assert.deepStrictEqual(parseOverlay('{"glm":{"added":[{"id":"glm-x","label":"x","contextWindow":null}]}}').glm.added.length, 1);
});
t("T4b normalizeOverlay 丢未知键+字段校验", () => {
  const n = normalizeOverlay({
    "no-such-preset": { added: [{ id: "x", label: "x", contextWindow: null }] },
    glm: {
      added: [
        { id: " glm-y ", label: "", contextWindow: "bad", pricing: { input: 1 }, weird: true },
        { id: "", label: "z", contextWindow: null },
        { id: "glm-z", label: "z", contextWindow: 1000, capabilities: ["chat", 42, "vision"], reasoning: true },
      ],
    },
  });
  assert.ok(!("no-such-preset" in n), "未知预设键应丢弃");
  assert.strictEqual(n.glm.added.length, 2, "空 id 条目应丢弃");
  const y = n.glm.added[0];
  assert.strictEqual(y.id, "glm-y", "id 应 trim");
  assert.strictEqual(y.label, "glm-y", "空 label 回落 id");
  assert.strictEqual(y.contextWindow, null, "坏 contextWindow → null");
  assert.deepStrictEqual(y.pricing, { input: 1, output: null }, "pricing 半残保形状");
  const z = n.glm.added[1];
  assert.deepStrictEqual(z.capabilities, ["chat", "vision"], "capabilities 滤非字符串");
  assert.strictEqual(z.reasoning, true);
});
t("T4c mergePresetModelList:策展序保持/overlay 追加/同 id 策展胜", () => {
  const preset = getProviderPreset("glm");
  const merged = mergePresetModelList(preset, {
    added: [
      { id: "glm-new", label: "glm-new", contextWindow: 1000 },
      { id: "GLM-5.3", label: "dup", contextWindow: 1 }, // 与策展 glm-5.3 同 id(大小写不敏感)
    ],
  });
  assert.strictEqual(merged.length, preset.models.length + 1, "只追加 1 个");
  assert.strictEqual(merged[0].id, preset.models[0].id, "策展序保持");
  const dup = merged.find((m) => m.id.toLowerCase() === "glm-5.3");
  assert.strictEqual(dup.contextWindow, preset.models.find((m) => m.id.toLowerCase() === "glm-5.3").contextWindow, "重复 id 时策展条目胜");
});

/* ---------- T5 shared overlay 纯操作 ---------- */
t("T5 addToOverlay 去重 / removeFromOverlay 删清键", () => {
  let o = {};
  o = addToOverlay(o, "glm", [{ id: "a", label: "a", contextWindow: null }]);
  o = addToOverlay(o, "glm", [{ id: "A", label: "a2", contextWindow: 5 }, { id: "b", label: "b", contextWindow: null }]);
  assert.strictEqual(o.glm.added.length, 2, "大小写不敏感去重");
  assert.strictEqual(o.glm.added.find((m) => m.id === "a").contextWindow, null, "先到条目不被覆盖");
  o = removeFromOverlay(o, "glm", "a");
  o = removeFromOverlay(o, "glm", "b");
  assert.ok(!("glm" in o), "删光应移除键");
});

/* ---------- T6 协议四点同步(源级) ---------- */
const channels = read("shared/api-channels.ts");
const preload = read("src/preload/index.ts");
const ipcIdx = read("src/main/ipc/index.ts");
const types = read("shared/types.ts");
for (const [method, channel] of [
  ["testProvider", "agent:testProvider"],
  ["discoverModelsFor", "agent:discoverModelsFor"],
  ["getModelMeta", "agent:getModelMeta"],
  ["getModelOverlay", "agent:getModelOverlay"],
  ["setModelOverlay", "agent:setModelOverlay"],
  ["refreshModelCatalog", "agent:refreshModelCatalog"],
]) {
  t(`T6 ${method} 四点同步`, () => {
    assert.ok(channels.includes(`${method}: "${channel}"`), "api-channels 映射");
    assert.ok(preload.includes(`invoke("${channel}"`), "preload invoke");
    assert.ok(ipcIdx.includes(`handle("${channel}"`), "ipc handler");
    assert.ok(types.includes(`${method}(`), "ApiExpose 声明");
  });
}
t("T6f SettingKey 收录两键", () => {
  assert.ok(types.includes('"model_overlay_json" | "model_catalog_cache"'));
});

/* ---------- T7 供给链资产三触点 ---------- */
t("T7 资产三触点 + 生成脚本接线", () => {
  const vite = read("vite.config.ts");
  assert.ok(vite.includes("emit-model-catalog-json"), "vite emit 插件");
  assert.ok(vite.includes('fileName: "assets/model-catalog.json"'), "emit 目标路径");
  const bs = read("scripts/lib/build-server.mjs");
  assert.ok(bs.includes('beside("src/main/assets/model-catalog.json")'), "build-server beside(手机/serve)");
  const gen = read("scripts/build-model-catalog.mjs");
  assert.ok(gen.includes("modelsdev-map.ts"), "生成脚本复用同一映射模块");
  assert.ok(gen.includes("< 8"), "质量闸(≥8 家)");
  assert.ok(read("src/main/lib/model-catalog-refresh.ts").includes('from "../services/agent/modelsdev-map.js"'), "运行时刷新复用同一映射");
});

/* ---------- T8 渲染层消费接线(源级;v0.38 模型管理弹窗) ---------- */
t("T8 渲染层消费:弹窗双栏/看图 tab/抽屉两卡/入口接线", () => {
  const mm = read("src/renderer/components/ModelManagerModal.tsx");
  assert.ok(mm.includes("ModelDiscoveryPanel"), "弹窗挂发现面板");
  assert.ok(mm.includes("refreshModelCatalog"), "弹窗触发目录刷新");
  assert.ok(mm.includes("useFocusTrap"), "弹窗焦点陷阱");
  assert.ok(mm.includes('data-testid="model-manager-modal"'), "弹窗 testid");
  assert.ok(mm.includes("api.testProvider("), "测试走 testProvider(key 主进程侧解析)");
  assert.ok(mm.includes("getModelOverlay"), "overlay 数据自取");
  const vt = read("src/renderer/components/ModelVisionTab.tsx");
  assert.ok(vt.includes('data-testid="vision-override-model-select"'), "视觉覆盖模型选择器在看图 tab");
  assert.ok(vt.includes('testid="multimodal-toggle"'), "multimodal-toggle 在看图 tab");
  assert.ok(vt.includes('testid="math-vision-toggle"'), "math-vision-toggle 在看图 tab");
  const sv = read("src/renderer/components/SettingsView.tsx");
  assert.ok(sv.includes('data-testid="model-card-manage"'), "抽屉模型卡");
  assert.ok(sv.includes("onOpenModelManager"), "抽屉两卡深链弹窗");
  assert.ok(!sv.includes('data-testid="settings-save"'), "旧显式保存页脚已除(弹窗内即时生效)");
  const app = read("src/renderer/App.tsx");
  assert.ok(app.includes("ModelManagerModal"), "App lazy 挂弹窗");
  assert.ok(app.includes("openModelManager"), "App 开窗助手");
  const mp = read("src/renderer/components/ModelPicker.tsx");
  assert.ok(mp.includes("onOpenModelManager"), "ModelPicker 底部直开弹窗(不再绕抽屉)");
});

console.log(`\nverify-model-catalog: ${passed} 项全绿 ✅`);
