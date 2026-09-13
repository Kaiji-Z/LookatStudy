/**
 * verify-update-check —— 轻量更新检查通道(2026-09-13 审计后续 · IP2)。
 *
 *   T1  compareVersions 纯函数:升/平/降、v 前缀、预发布尾缀、非数字段、
 *       数值比较(0.10.0 > 0.9.0,禁字典序)
 *   T2  tagFromReleaseUrl:tag 页抽 tag / 非 tag 页 null / 带破折号 tag 保留
 *   T3  fetchLatestTag(fetch 注入):正常跳转 / 网络抛错 null / 非 tag 跳转 null
 *   T4  buildUpdateInfo:hasUpdate 判定 + releaseUrl 拼接
 *   T5  协议三件套同步:api-channels / preload / ipc handler + 每版本一次门
 *       (update_prompt_seen 已见即 null)+ 24h 缓存键
 *   T6  渲染层接线:App.tsx 空态不查(selectedCourseId 门)+ 会话一次
 *       (updateCheckedRef)+ 弹过即写 update_prompt_seen + 外链走
 *       window.open(releaseUrl)(经 setWindowOpenHandler 白名单)
 *   T7  本套件已注册 verify:core
 *
 * 运行:npx tsx scripts/verify-update-check.mjs(纯 Node,零网络零 Electron)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";
import {
  compareVersions,
  tagFromReleaseUrl,
  fetchLatestTag,
  buildUpdateInfo,
  UPDATE_CACHE_TTL_MS,
} from "../src/main/lib/update-check.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

/* T1 compareVersions */
t("T1a 升级方向", () => assert.equal(compareVersions("0.34.0", "v0.35.0"), -1));
t("T1b 相同版本(v 前缀容忍)", () => assert.equal(compareVersions("0.35.0", "v0.35.0"), 0));
t("T1c 降级方向", () => assert.equal(compareVersions("0.36.1", "0.35.9"), 1));
t("T1d 预发布尾缀取首三段", () => assert.equal(compareVersions("0.35.0", "v0.35.0-beta.1"), 0));
t("T1e 数值比较非字典序", () => assert.equal(compareVersions("0.10.0", "v0.9.0"), 1));
t("T1f 非数字段按 0", () => assert.equal(compareVersions("x.y.z", "v0.0.1"), -1));
t("T1g 两段简写", () => assert.equal(compareVersions("1.2", "v1.2.0"), 0));

/* T2 tagFromReleaseUrl */
t("T2a tag 页抽 tag", () =>
  assert.equal(tagFromReleaseUrl("https://github.com/Kaiji-Z/LookatStudy/releases/tag/v0.36.0"), "v0.36.0"));
t("T2b 非 tag 页 null", () =>
  assert.equal(tagFromReleaseUrl("https://github.com/Kaiji-Z/LookatStudy/releases"), null));
t("T2c latest 无跳转 null", () =>
  assert.equal(tagFromReleaseUrl("https://github.com/Kaiji-Z/LookatStudy/releases/latest"), null));
t("T2d 带破折号 tag 保留", () =>
  assert.equal(tagFromReleaseUrl("https://github.com/a/b/releases/tag/v1.0.0-hotfix.2"), "v1.0.0-hotfix.2"));

/* T3 fetchLatestTag(fetchFn 注入,零真实网络;先 await 再同步断言) */
const r3a = await fetchLatestTag(async () => ({ url: "https://github.com/Kaiji-Z/LookatStudy/releases/tag/v0.37.0" }));
t("T3a 正常跳转取 tag", () => assert.equal(r3a, "v0.37.0"));
const r3b = await fetchLatestTag(async () => {
  throw new Error("ENETDOWN");
});
t("T3b 网络抛错 → null(零打扰)", () => assert.equal(r3b, null));
const r3c = await fetchLatestTag(async () => ({ url: "https://github.com/Kaiji-Z/LookatStudy/releases" }));
t("T3c 非 tag 跳转 → null", () => assert.equal(r3c, null));

/* T4 buildUpdateInfo */
t("T4a 有更新", () => {
  const i = buildUpdateInfo("0.34.0", "v0.35.0");
  assert.equal(i.hasUpdate, true);
  assert.equal(i.latest, "v0.35.0");
  assert.ok(i.releaseUrl.endsWith("/tag/v0.35.0"), i.releaseUrl);
});
t("T4b 已最新", () => assert.equal(buildUpdateInfo("0.35.0", "v0.35.0").hasUpdate, false));
t("T4c tag 特殊字符编码进 URL", () => {
  const i = buildUpdateInfo("0.34.0", "v0.35.0-beta.1");
  assert.ok(i.releaseUrl.includes(encodeURIComponent("v0.35.0-beta.1")), i.releaseUrl);
});

/* T5 协议三件套 + 主进程门控(源级) */
const channels = read("shared/api-channels.ts");
const preload = read("src/preload/index.ts");
const ipcIdx = read("src/main/ipc/index.ts");
const types = read("shared/types.ts");
t("T5a channel 映射", () => assert.ok(channels.includes('getUpdateInfo: "app:getUpdateInfo"')));
t("T5b preload invoke", () => assert.ok(preload.includes('invoke("app:getUpdateInfo")')));
t("T5c handler 注册", () => assert.ok(ipcIdx.includes('handle("app:getUpdateInfo"')));
t("T5d 每版本一次:已见 tag → null", () =>
  assert.ok(ipcIdx.includes('"update_prompt_seen"') && ipcIdx.includes("seenRow?.value === tag")));
t("T5e 24h 缓存键 + TTL 常量", () => {
  assert.ok(ipcIdx.includes('"update_check_cache"'));
  assert.equal(UPDATE_CACHE_TTL_MS, 24 * 3600 * 1000);
});
t("T5f SettingKey 收录两键", () =>
  assert.ok(types.includes('"update_check_cache" | "update_prompt_seen"')));
t("T5g ApiExpose 声明", () => assert.ok(types.includes("getUpdateInfo(): Promise<UpdateInfo | null>")));

/* T6 渲染层接线(源级) */
const app = read("src/renderer/App.tsx");
t("T6a 空态不查(选课门)+ 会话一次", () => {
  assert.ok(app.includes("if (!selectedCourseId || updateCheckedRef.current) return;"));
  assert.ok(app.includes("updateCheckedRef.current = true"));
});
t("T6b 弹过即写 seen(提示了才算见过)", () =>
  assert.ok(app.includes('api.setSetting("update_prompt_seen", info.latest)')));
t("T6c 外链只走 releaseUrl(经 setWindowOpenHandler 白名单)", () =>
  assert.ok(app.includes("window.open(info.releaseUrl)")));

/* T7 注册进 verify:core */
const pkg = JSON.parse(read("package.json"));
t("T7 verify:core 链含本套件", () =>
  assert.ok(pkg.scripts["verify:core"].includes("verify-update-check")));

/* async T3 收尾 */
process.on("exit", () => console.log(`verify-update-check: ${passed} assertions ${process.exitCode ? "FAILED" : "passed"}`));
