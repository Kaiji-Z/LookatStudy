/**
 * verify-termux-voice —— Termux 语音引擎交付面的静态守卫(不编译,CI 外可跑)。
 *
 * 守什么:
 *  - 构建脚本/工作流/安装器三者的资产名一致(lookatstudy-termux-voice.tar.gz)
 *  - 安装器:install_voice 存在且默认安装(全程零交互,失败不阻断)、四个启动点全部注入 LD_LIBRARY_PATH
 *  - 安装/升级(update.sh)同源下载链:npmmirror+滞后守卫 → npm 官方 → GitHub → gh 代理;
 *    双脚本 bash -n 语法门;解析函数恒 exit 0 契约(miss 返回 1 会杀 set -e 脚本)
 *  - 工作流:tag/dispatch 触发、NDK 版本与构建脚本探测路径一致、attach 步骤存在
 *  - 构建脚本:node 语法可解析、关键配方在场(-z undefs / $ORIGIN / 软链还原 / ELF 验证)
 *
 * 运行:tsx scripts/verify-termux-voice.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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
  assert.ok(build.includes('"lookatstudy-termux-voice"'), "npm 包名(lookatstudy-termux-voice)");
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
  assert.ok(/install_voice \|\| true/.test(sh), "语音引擎默认安装(失败不阻断)");
  assert.ok(!/read -r/.test(sh), "安装全程零交互(无 read 提问)");
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
  // 工作流经 CDN zip 装 NDK(不再走 sdkmanager 的 ndk;X 语法),只断版本串在场且目录名一致
  for (const v of ndkSet) assert.ok(wf.includes(v), `工作流 NDK 版本缺 ${v}`);
  ok(`触发/挂载齐,NDK ${[...ndkSet].join(",")} 对齐`);
}

// ---------------------------------------------------------------------------
console.log("T5 构建产物被 git 忽略");
{
  const gi = read(".gitignore");
  assert.ok(/\.termux-build/.test(gi), ".gitignore 缺 .termux-build/");
  ok("构建目录已忽略");
}

// ---------------------------------------------------------------------------
console.log("T6 npm 分发(npmmirror 主源 + trusted publishing)");
{
  const installer = read("scripts/install-termux.sh");
  const wfVoice = read(".github/workflows/termux-voice.yml");
  const wfAndroid = read(".github/workflows/android-build.yml");
  // 安装器:两个产物都走 npm_tarball 主源 + --strip-components=1 解包
  assert.ok(/npm_tarball lookatstudy-mobile/.test(installer), "便携包走 npm 镜像主源");
  assert.ok(/npm_tarball lookatstudy-termux-voice/.test(installer), "语音包走 npm 镜像主源");
  assert.ok(installer.includes("registry.npmmirror.com/$1/latest"), "latest 元数据端点");
  const strips = installer.match(/--strip-components=1/g) ?? [];
  assert.ok(strips.length >= 2, "两个 tgz 解包剥 package/ 前缀");
  // CI:trusted publishing(OIDC)——id-token 权限 + npm≥11.5.1 升级 + 无 token 残留
  for (const [name, wf] of [["termux-voice", wfVoice], ["android-build", wfAndroid]]) {
    assert.ok(wf.includes("id-token: write"), `${name}: id-token 权限`);
    assert.ok(wf.includes("npm install -g npm@latest"), `${name}: npm 升级到 OIDC 版`);
    assert.ok(/npm publish .*--access public/.test(wf), `${name}: publish 步`);
    assert.ok(!wf.includes("NODE_AUTH_TOKEN"), `${name}: 无 token 残留`);
  }
  const build = read("scripts/build-termux-voice.mjs");
  assert.ok(build.includes("Kaiji-Z/LookatStudy.git"), "repository.url 指向本仓库");
  assert.ok(wfVoice.includes("RELEASE_TAG:"), "引擎包版本随 Release tag");
  ok("双源安装 + 双工作流 OIDC 发布");
}

// ---------------------------------------------------------------------------
console.log("T7 安装/升级同源下载链(npmmirror+守卫 → npm 官方 → GitHub → gh 代理)");
{
  const installer = read("scripts/install-termux.sh");
  // 安装器本体静态语法门(此前从未有过;heredoc/引号错误在此拦截)
  execFileSync("bash", ["-n", path.join(ROOT, "scripts/install-termux.sh")]);

  // 抽出 update.sh 生成体(引号 heredoc,零转义),拼头部桩后 bash -n —— 生成体结构错误在此拦截
  // (\r 归一:本机工作树 CRLF、CI 与手机端 LF,两态都要过)
  const m = installer.match(/cat <<'UPDATE_EOF'\r?\n([\s\S]*?)\r?\nUPDATE_EOF/);
  assert.ok(m, "update.sh 生成体(UPDATE_EOF 引号 heredoc)在场");
  const body = m[1].replace(/\r/g, "");
  const tmp = path.join(os.tmpdir(), `ls-update-${process.pid}.sh`);
  fs.writeFileSync(
    tmp,
    `#!/usr/bin/env bash\nset -euo pipefail\nAPP_DIR=/tmp/lsu PORT=17890 GH_ASSET=https://example/zip\n${body}\n`,
  );
  try {
    execFileSync("bash", ["-n", tmp]);
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  // 链序按【调用点】位置断言(不是函数定义位置):镜像 → 官方 → GitHub zip 链
  const iMirror = body.indexOf("tb=$(npm_tarball lookatstudy-mobile)");
  const iOfficial = body.indexOf("tb=$(npm_tarball_official lookatstudy-mobile)");
  const iZip = body.indexOf('for p in "" "https://gh-proxy.com/"');
  assert.ok(iMirror >= 0 && iOfficial > iMirror && iZip > iOfficial, `update.sh 链序错: ${iMirror}/${iOfficial}/${iZip}`);
  for (const needle of [
    "registry.npmmirror.com",          // 镜像主源
    "registry.npmjs.org",              // 官方源兜底
    "gh_latest_version",               // 滞后守卫探测
    "ver_ge",
    "ghproxy.net", "ghfast.top",       // gh 代理链后两跳
    "--strip-components=1",            // tgz 剥 package/ 前缀
    "保持原版本",                       // 全链失败保底不破坏现场
  ]) {
    assert.ok(body.includes(needle), `update.sh 生成体缺: ${needle}`);
  }
  assert.ok(/\[ -n "\$gh" \] && ! ver_ge/.test(body), "滞后守卫(落后让位;探测失败信任镜像)");

  // 安装器两段(便携包/语音)同样有官方源这一跳,且必须落在同函数段内
  // (裸 indexOf 会被 heredoc 生成体里的同款调用顶替 —— 破坏验证实测踩过)
  for (const [name, pkg] of [["便携包", "lookatstudy-mobile"], ["语音", "lookatstudy-termux-voice"]]) {
    const a = installer.indexOf(`tb=$(npm_tarball ${pkg})`);
    const sectionEnd = installer.indexOf('info "npm 源未命中', a);
    const b = installer.indexOf(`tb=$(npm_tarball_official ${pkg})`);
    assert.ok(a >= 0 && sectionEnd > a && b > a && b < sectionEnd, `安装器${name}段缺官方源跳或次序错`);
  }
  // set -e 契约:解析函数恒 exit 0(空=未命中)——miss 返回 1 会静默杀脚本(eeeada1 潜伏 bug 的根因)
  const fnBlock = installer.slice(installer.indexOf("npm_tarball() {"), installer.indexOf("npm_tarball_official() {"));
  assert.ok(!/return 1/.test(fnBlock), "npm_tarball 恒 exit 0(miss 不得 return 1)");
  ok("同源链序 + 双脚本 bash -n + 滞后守卫 + set -e 契约");
}

console.log(`\nverify-termux-voice: ${passed} 组全绿 ✓`);
