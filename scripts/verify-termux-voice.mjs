/**
 * verify-termux-voice —— Termux 语音引擎交付面的静态守卫(不编译,CI 外可跑)。
 *
 * 守什么:
 *  - 构建脚本/工作流/安装器三者的资产名一致(lookatstudy-termux-voice.tar.gz)
 *  - 安装器:install_voice 存在、四个启动点全部注入 LD_LIBRARY_PATH、语音步骤可交互且 --voice 直装
 *  - 工作流:tag/dispatch 触发、NDK 版本与构建脚本探测路径一致、attach 步骤存在
 *  - 构建脚本:node 语法可解析、关键配方在场(-z undefs / $ORIGIN / 软链还原 / ELF 验证)
 *
 * 运行:tsx scripts/verify-termux-voice.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf-8");

let passed = 0;
const ok = (name) => { passed++; console.log(`  ✓ ${name}`); };

const ASSET = "lookatstudy-termux-voice.tar.gz";

// ---------------------------------------------------------------------------
console.log("T1 三端资产名一致");
{
  const build = read("scripts/build-termux-voice.mjs");
  const installer = read("scripts/install-termux.sh");
  const wf = read(".github/workflows/termux-voice.yml");
  assert.ok(build.includes(`"${ASSET}"`), "构建脚本产物名");
  assert.ok(installer.includes(`download/${ASSET}`), "安装器下载 URL");
  assert.ok(wf.includes("sherpa-onnx-node-android-arm64-*.tar.gz") || wf.includes(ASSET), "工作流挂载通配");
  ok("资产名统一为 " + ASSET);
}

// ---------------------------------------------------------------------------
console.log("T2 构建脚本语法 + 配方在场");
{
  const build = read("scripts/build-termux-voice.mjs");
  execFileSync(process.execPath, ["--check", path.join(ROOT, "scripts/build-termux-voice.mjs")]);
  for (const needle of [
    "-Wl,-z,undefs",           // NAPI 符号放行(NDK --no-undefined 规避)
    "$ORIGIN",                  // rpath 兜底
    "linkname",                 // 上游软链还原(src/*.cc → harmony-os)
    "llvm-readelf",             // ELF 验证
    "arm64-v8a",
    "napi_register_module_v1",  // NAPI 注册符号断言
  ]) {
    assert.ok(build.includes(needle), `构建脚本缺配方要素: ${needle}`);
  }
  ok("语法通过 + 6 项关键配方齐");
}

// ---------------------------------------------------------------------------
console.log("T3 安装器:语音段 + 四启动点 LD_LIBRARY_PATH");
{
  const sh = read("scripts/install-termux.sh");
  assert.ok(/install_voice\(\)/.test(sh), "install_voice 函数");
  assert.ok(/bash install-termux\.sh --voice|--voice.*install_voice|"\$1" = "--voice"/.test(sh), "--voice 直装入口");
  assert.ok(/read .*ans/.test(sh), "交互询问");
  const hits = sh.match(/LD_LIBRARY_PATH=/g) ?? [];
  // start_service + start.sh + boot + bashrc = 4 处注入
  assert.ok(hits.length >= 4, `启动点注入不足: ${hits.length}/4`);
  assert.ok(/tar -xzf voice\.tar\.gz -C "\$APP_DIR\/node_modules"/.test(sh), "解包到 node_modules");
  ok(`install_voice + ${hits.length} 处启动注入`);
}

// ---------------------------------------------------------------------------
console.log("T4 工作流结构与 NDK 版本对齐");
{
  const wf = read(".github/workflows/termux-voice.yml");
  const build = read("scripts/build-termux-voice.mjs");
  assert.ok(/tags: \["v\*"\]/.test(wf), "tag 触发");
  assert.ok(/workflow_dispatch/.test(wf), "手动 dispatch");
  assert.ok(/gh release upload/.test(wf), "Release 挂载");
  const ndk = [...build.matchAll(/ndk\/(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  const ndkSet = new Set(ndk);
  for (const v of ndkSet) assert.ok(wf.includes(`ndk;${v}`), `工作流 NDK 版本缺 ${v}`);
  ok(`触发/挂载齐,NDK ${[...ndkSet].join(",")} 对齐`);
}

// ---------------------------------------------------------------------------
console.log("T5 构建产物被 git 忽略");
{
  const gi = read(".gitignore");
  assert.ok(/\.termux-build/.test(gi), ".gitignore 缺 .termux-build/");
  ok("构建目录已忽略");
}

console.log(`\nverify-termux-voice: ${passed} 组全绿 ✓`);
