/**
 * verify-ipc-input-guards —— IPC 入参形状校验纪律套件(2026-09-13 安全审计 · WP1)。
 *
 * 审计根因:渲染层展示不可信课程内容(GitHub/网页/EPUB/桌宠包/课程包),凡"渲染层
 * 字符串进文件路径/目录键"的 IPC 落盘点都必须过形状校验。本套件把该纪律机器化:
 *   T1  safeEntryDest 纯函数:穿越/绝对路径/盘符/NUL 拒,正常条目通过且落在 root 内
 *   T2  shimeji zip slip 行为断言:zipSync 合成恶意条目,staging 外零落盘
 *   T3  confirmShimejiImport:importId 形状拒绝 + characterRefs 穿越 ref 被跳过
 *   T4  parsePlan:恶意 planId(课程包投毒面)返回 null,合法 uuid 通过
 *   T5  deleteSpeechModel:清单外 id 抛错(路径成分不再进 rm)
 *   T6  源级守卫(T15 风格):五个修复点的守卫代码必须在场 + 本套件注册进 verify:core
 *
 * 运行:npx tsx scripts/verify-ipc-input-guards.mjs(纯 node + fflate,不依赖 Electron/DB)
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`✓ ${name}`);
    pass++;
  } else {
    console.error(`✗ ${name}${detail ? `: ${detail}` : ""}`);
    fail++;
  }
}

const { safeEntryDest } = await import("../src/main/services/pure/entry-guard.ts");
const { importShimejiZip, confirmShimejiImport } = await import(
  "../src/main/services/shimeji/shimeji-pack-service.ts"
);
const { parsePlan, IMPORT_PLAN_FORMAT_VERSION } = await import("../src/main/services/pure/import-plan.ts");
const { deleteSpeechModel } = await import("../src/main/services/speech/speech-model-service.ts");
const { SPEECH_MODELS_MANIFEST } = await import("../src/main/services/speech/speech-model-manifest.ts");

function tmpDataDir(tag) {
  const d = join(tmpdir(), `ls-ipc-guards-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

// ── T1 safeEntryDest 纯函数 ──
{
  const root = tmpDataDir("t1");
  check("T1 拒绝 ../ 穿越", safeEntryDest(root, "../evil.txt") === null);
  check("T1 拒绝内层 ../", safeEntryDest(root, "img/../../evil.png") === null);
  check("T1 拒绝 POSIX 绝对路径", safeEntryDest(root, "/etc/passwd") === null);
  check("T1 拒绝 Windows 盘符", safeEntryDest(root, "C:/evil.txt") === null && safeEntryDest(root, "C:\\evil.txt") === null);
  check("T1 拒绝 NUL 字节", safeEntryDest(root, "a\0b") === null);
  const ok = safeEntryDest(root, "char/img/shime1.png");
  check("T1 正常条目通过且落在 root 内", ok !== null && ok.startsWith(root));
  check("T1 ./ 前缀与冗余分隔可通过", safeEntryDest(root, "./a//b.png") !== null);
  rmSync(root, { recursive: true, force: true });
}

// ── T2 + T3 shimeji zip slip / confirmImport(共享一次真实导入;守卫缺失时管线会崩或穿越,都算红) ──
await (async () => {
  const dataDir = tmpDataDir("t2");
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // 魔数即可:导入不解码
  const zip = zipSync({
    "char/conf/Actions.xml": strToU8("<Mascot></Mascot>"),
    "char/img/shime1.png": PNG,
    "../evil-escape.txt": strToU8("pwn"),
    "../../evil-deeper.txt": strToU8("pwn"),
    "/abs-evil.txt": strToU8("pwn"),
    "C:\\drive-evil.txt": strToU8("pwn"),
  });
  const preview = await importShimejiZip(null, dataDir, Buffer.from(zip).toString("base64"));
  check("T2 恶意条目不影响角色发现", preview.characters.length === 1 && preview.characters[0].name === "char");

  const stagingRootDir = join(dataDir, "shimeji-packs", ".staging");
  check("T2 穿越 ../ 未落盘(staging 根)", !existsSync(join(stagingRootDir, "evil-escape.txt")));
  check("T2 穿越 ../../ 未落盘(packs 根)", !existsSync(join(dataDir, "shimeji-packs", "evil-deeper.txt")));
  check("T2 绝对路径/盘符条目未落盘", !existsSync(join(dataDir, "abs-evil.txt")) && !existsSync("C:\\drive-evil.txt"));
  check("T2 正常条目已落盘", existsSync(join(stagingRootDir, preview.importId, "char", "img", "shime1.png")));

  // T3:importId 形状闸(任意目录递归删的入口)
  await assert.rejects(() => confirmShimejiImport(null, dataDir, "../../evil", []), /非法导入会话 id/);
  check("T3 穿越 importId 被拒", true);
  await assert.rejects(() => confirmShimejiImport(null, dataDir, "not-hex-zz", []), /非法导入会话 id/);
  check("T3 非十六进制 importId 被拒", true);
  // T3:characterRefs 穿越 ref 跳过 + 合法角色正常落包
  const packs = await confirmShimejiImport(null, dataDir, preview.importId, ["../evil", preview.characters[0].ref]);
  check("T3 穿越 ref 被跳过、合法角色正常落包", Array.isArray(packs) && packs.length === 1);
  check("T3 穿越 ref 未把 staging 外内容拷进包", !existsSync(join(dataDir, "shimeji-packs", "evil")));
  rmSync(dataDir, { recursive: true, force: true });
})().catch((e) => {
  // 守卫缺失的旧实现会在盘符/穿越条目上崩溃(ENOENT)或直接写出 staging——都算红灯
  console.error(`✗ T2/T3 恶意 zip 行为断言异常(守卫疑似缺失): ${e.message}`);
  fail++;
});

// ── T4 parsePlan planId 形状 ──
{
  const good = JSON.stringify({
    formatVersion: IMPORT_PLAN_FORMAT_VERSION,
    planId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
    kind: "github",
    fullTree: [],
    treeHash: "x",
  });
  check("T4 合法 uuid planId 通过", parsePlan(good) !== null);
  const evil = JSON.stringify({ ...JSON.parse(good), planId: "../../../../Users/x/evil" });
  check("T4 穿越 planId 被拒", parsePlan(evil) === null);
  const evil2 = JSON.stringify({ ...JSON.parse(good), planId: "/abs/evil" });
  check("T4 绝对路径 planId 被拒", parsePlan(evil2) === null);
  const evil3 = JSON.stringify({ ...JSON.parse(good), planId: "zz!@#" });
  check("T4 非十六进制 planId 被拒", parsePlan(evil3) === null);
}

// ── T5 deleteSpeechModel 清单闸 ──
{
  const dataDir = tmpDataDir("t5");
  await assert.rejects(() => deleteSpeechModel(dataDir, "../../evil"), /未知语音模型/);
  check("T5 清单外 id 抛错(路径成分不进 rm)", true);
  const known = SPEECH_MODELS_MANIFEST.models[0].id;
  await deleteSpeechModel(dataDir, known); // 空目录上 force rm 为 no-op,不抛即通过
  check("T5 清单内 id 正常路径", true);
  rmSync(dataDir, { recursive: true, force: true });
}

// ── T6 源级守卫(防"修完又被顺手删") ──
{
  const shimeji = read("src/main/services/shimeji/shimeji-pack-service.ts");
  check("T6 shimeji 解包循环过 safeEntryDest", shimeji.includes("safeEntryDest(stagingDir, path)"));
  check("T6 confirmImport importId 形状闸", shimeji.includes("/^[0-9a-f]{8}$/.test(importId)"));
  check("T6 characterRefs 过 safeEntryDest", shimeji.includes("safeEntryDest(stagingDir, ref)"));

  const pack = read("src/main/services/companion-pack-service.ts");
  check("T6 applyPack 部件文件名白名单(写侧抛错)", pack.includes("if (!SAFE_PART_FILE.test(entry.file)) throw"));
  check("T6 读侧同样跳过非法文件名", pack.includes("if (!SAFE_PART_FILE.test(entry.file)) continue"));

  const speech = read("src/main/services/speech/speech-model-service.ts");
  check("T6 deleteSpeechModel 清单闸", speech.includes("未知语音模型 id") && speech.includes("SPEECH_MODELS_MANIFEST.models.some"));

  const plan = read("src/main/services/pure/import-plan.ts");
  check("T6 parsePlan planId 形状闸", plan.includes("/^[0-9a-f-]{8,64}$/"));

  const guard = read("src/main/services/pure/entry-guard.ts");
  check("T6 守卫含 resolve 后包含校验", guard.includes("startsWith(root + sep)"));

  const pkg = JSON.parse(read("package.json"));
  check("T6 本套件已注册 verify:core", pkg.scripts["verify:core"].includes("verify-ipc-input-guards"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
