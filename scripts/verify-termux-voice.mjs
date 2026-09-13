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
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";

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
  // IP4 后常量改为 GH_RELEASE 基址 + 资产名拼接(安装器/生成头部双处)
  assert.ok(installer.includes(`GH_ASSET="\${GH_RELEASE}/lookatstudy-mobile.zip"`) && installer.includes(`GH_VOICE="\${GH_RELEASE}/${ASSET}"`), "安装器下载 URL");
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
  // (IP4 后调用形状=meta 两行:tarball URL + dist.integrity)
  const iMirror = body.indexOf("meta=$(npm_tarball lookatstudy-mobile)");
  const iOfficial = body.indexOf("meta=$(npm_tarball_official lookatstudy-mobile)");
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
    'verify_npm_tgz mobile.tgz "$itg"', // IP4:npm 跳下载后强校验
    'verify_gh_download ls.zip lookatstudy-mobile.zip', // IP4:GH 跳 sidecar 校验
  ]) {
    assert.ok(body.includes(needle), `update.sh 生成体缺: ${needle}`);
  }
  assert.ok(/\[ -n "\$gh" \] && ! ver_ge/.test(body), "滞后守卫(落后让位;探测失败信任镜像)");

  // 安装器两段(便携包/语音)同样有官方源这一跳,且必须落在同函数段内
  // (裸 indexOf 会被 heredoc 生成体里的同款调用顶替 —— 破坏验证实测踩过)
  for (const [name, pkg] of [["便携包", "lookatstudy-mobile"], ["语音", "lookatstudy-termux-voice"]]) {
    const a = installer.indexOf(`meta=$(npm_tarball ${pkg})`);
    const sectionEnd = installer.indexOf('info "npm 源未命中', a);
    const b = installer.indexOf(`meta=$(npm_tarball_official ${pkg})`);
    assert.ok(a >= 0 && sectionEnd > a && b > a && b < sectionEnd, `安装器${name}段缺官方源跳或次序错`);
  }
  // set -e 契约:解析函数恒 exit 0(空=未命中)——miss 返回 1 会静默杀脚本(eeeada1 潜伏 bug 的根因)
  const fnBlock = installer.slice(installer.indexOf("npm_tarball() {"), installer.indexOf("npm_tarball_official() {"));
  assert.ok(!/return 1/.test(fnBlock), "npm_tarball 恒 exit 0(miss 不得 return 1)");
  // npm 元数据第二行(integrity)与两段 GH 校验接线在场
  assert.ok(installer.includes('sed -n 2p') && installer.includes('verify_npm_tgz mobile.tgz "$itg"') && installer.includes('verify_npm_tgz voice.tgz "$itg"'), "IP4:npm 跳 integrity 校验接线");
  assert.ok(installer.includes('verify_gh_download ls.zip lookatstudy-mobile.zip') && installer.includes('verify_gh_download voice.tar.gz lookatstudy-termux-voice.tar.gz'), "IP4:GH 跳 sidecar 校验接线");
  // gh_asset_sha256 自身也守恒 exit 0 契约(空=校验源不可达,不得 return 1)
  const shaBlock = installer.slice(installer.indexOf("gh_asset_sha256() {"), installer.indexOf("verify_gh_download() {"));
  assert.ok(!/return 1/.test(shaBlock), "gh_asset_sha256 恒 exit 0");
  ok("同源链序 + 双脚本 bash -n + 滞后守卫 + set -e 契约");
}

// ---------------------------------------------------------------------------
console.log("T8 下载完整性(npm integrity + GH sidecar):工作流资产 + 行为 fixture");
{
  // 工作流:sidecar 生成 + 挂载(android 三件 + voice 引擎)
  const androidYml = read(".github/workflows/android-build.yml");
  const voiceYml = read(".github/workflows/termux-voice.yml");
  assert.ok(androidYml.includes("Generate sha256 sidecars") && androidYml.includes("lookatstudy-mobile.zip.sha256") && androidYml.includes("install-termux.sh.sha256") && androidYml.includes("LookatStudy-launcher.apk.sha256"), "android-build.yml sidecar 生成+挂载");
  assert.ok(voiceYml.includes("lookatstudy-termux-voice.tar.gz.sha256"), "termux-voice.yml sidecar 生成+挂载");

  // 行为 fixture:从安装器抽函数体,桩掉 curl/info/warn/ok,真跑校验逻辑
  const installer = read("scripts/install-termux.sh").replace(/\r/g, "");
  const grab = (name) => {
    const i = installer.indexOf(`${name}() {`);
    assert.ok(i >= 0, `${name} 在场`);
    const j = installer.indexOf("\n}\n", i);
    return installer.slice(i, j + 3);
  };
  const sandbox = path.join(os.tmpdir(), `ls-verify-${process.pid}`);
  const binDir = path.join(sandbox, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  // curl 桩:sidecar 内容写死(对 lookatstudy-termux-voice.tar.gz.sha256 返回期望值)
  const expected = "a".repeat(64);
  fs.writeFileSync(path.join(binDir, "curl"), `#!/usr/bin/env bash\nif printf '%s' "$*" | grep -q 'voice.tar.gz.sha256'; then printf '%s' '${expected}'; exit 0; fi\nexit 1\n`);
  fs.chmodSync(path.join(binDir, "curl"), 0o755);
  fs.writeFileSync(path.join(sandbox, "voice.tar.gz"), Buffer.from("tampered-payload"));
  fs.writeFileSync(path.join(sandbox, "voice.tar.gz.good"), Buffer.from("x"));
  const goodSum = crypto.createHash("sha256").update("x").digest("hex");
  fs.writeFileSync(path.join(sandbox, "voice.tar.gz.good.sha256.sum"), goodSum);
  fs.writeFileSync(path.join(binDir, "curl.good"), `#!/usr/bin/env bash\nif printf '%s' "$*" | grep -q 'voice.tar.gz.sha256'; then printf '%s' '${goodSum}'; exit 0; fi\nexit 1\n`);
  fs.chmodSync(path.join(binDir, "curl.good"), 0o755);
  const stubs = {
    curl: `#!/usr/bin/env bash\nif printf '%s' "$*" | grep -q 'voice.tar.gz.sha256'; then printf '%s' '${expected}'; exit 0; fi\nexit 1\n`,
    "curl.good": `#!/usr/bin/env bash\nif printf '%s' "$*" | grep -q 'voice.tar.gz.sha256'; then printf '%s' '${goodSum}'; exit 0; fi\nexit 1\n`,
  };
  // MSYS bash 的 PATH 需 POSIX 盘符风格(/c/...),Windows 盘符路径要换算
  const posix = (p) => p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d) => "/" + d.toLowerCase());
  const harness = (file) => `#!/usr/bin/env bash
set -uo pipefail
PATH="${posix(binDir)}:$PATH"
DL_PREFIXES=("" )
GH_RELEASE="https://gh.example/download"
info() { :; }
warn() { :; }
ok() { :; }
${grab("sha256_of")}
${grab("gh_asset_sha256")}
${grab("verify_gh_download")}
cd "${posix(sandbox)}"
verify_gh_download "${file}" lookatstudy-termux-voice.tar.gz "语音引擎包"
exit $?
`;
  const runCase = (curlName, file, extraEnv = {}) => {
    // 当前例的桩占住 binDir/curl(harness 内 PATH 前置 binDir,避开 Windows 分号 PATH)
    fs.writeFileSync(path.join(binDir, "curl"), stubs[curlName]);
    fs.chmodSync(path.join(binDir, "curl"), 0o755);
    const p = path.join(sandbox, `case-${curlName}-${file}.sh`);
    fs.writeFileSync(p, harness(file));
    fs.chmodSync(p, 0o755);
    const r = spawnSync("bash", [p], { env: { ...process.env, ...extraEnv } });
    return r.status;
  };
  // 1) sha 匹配 → 0
  assert.equal(runCase("curl.good", "voice.tar.gz.good"), 0, "sidecar 匹配应放行");
  // 2) 篡改/损坏 → 拒(非 0)
  assert.notEqual(runCase("curl", "voice.tar.gz"), 0, "sha 不匹配应拒装");
  // 3) sidecar 不可达(curl 恒 404)→ 拒(非 0)
  stubs["curl.dead"] = `#!/usr/bin/env bash\nexit 1\n`;
  assert.notEqual(runCase("curl.dead", "voice.tar.gz.good"), 0, "校验源不可达应拒装");
  // 4) 逃逸口 → 放行
  assert.equal(runCase("curl", "voice.tar.gz", { LOOKATSTUDY_SKIP_VERIFY: "1" }), 0, "显式逃逸口应放行");

  // npm integrity 行为:verify_npm_tgz 用真 node 算 sha512-base64
  const tgz = path.join(sandbox, "m.tgz");
  fs.writeFileSync(tgz, Buffer.from("npm-payload"));
  const b64 = crypto.createHash("sha512").update("npm-payload").digest("base64");
  const npmCase = (integrity, env = {}) => {
    const p = path.join(sandbox, "npm-case.sh");
    fs.writeFileSync(p, `#!/usr/bin/env bash
set -uo pipefail
info() { :; }
warn() { :; }
${grab("verify_npm_tgz")}
verify_npm_tgz "${posix(tgz)}" '${integrity}'
exit $?
`);
    fs.chmodSync(p, 0o755);
    return spawnSync("bash", [p], { env: { ...process.env, ...env } }).status;
  };
  assert.equal(npmCase(`sha512-${b64}`), 0, "integrity 匹配应放行");
  assert.notEqual(npmCase("sha512-AAAA"), 0, "integrity 不匹配应拒");
  assert.notEqual(npmCase(""), 0, "缺 integrity 应拒(fail-closed)");
  assert.equal(npmCase("sha512-AAAA", { LOOKATSTUDY_SKIP_VERIFY: "1" }), 0, "逃逸口放行");

  fs.rmSync(sandbox, { recursive: true, force: true });
  ok("工作流 sidecar + 校验行为(匹配放行/篡改拒/不可达拒/逃逸口) + npm integrity 四态");
}

console.log(`\nverify-termux-voice: ${passed} 组全绿 ✓`);
