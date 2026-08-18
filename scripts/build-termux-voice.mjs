/**
 * build-termux-voice —— Termux(bionic arm64)语音引擎包构建器(路 3)。
 *
 * 产物:sherpa-onnx-node-android-arm64-{version}.tar.gz(~8MB)
 *   sherpa-onnx.node           上游 C-API NAPI 绑定,NDK 交叉编译(无核心编译)
 *   libsherpa-onnx-c-api.so    k2-fsa 官方 android 预编译
 *   libonnxruntime.so          同上(21.7MB)
 *   + npm 包原装 JS 包装层(package.json 标注 termux 版本)
 *
 * 关键事实(全部实测,2026-08-19):
 *  - 上游 npm 包 sherpa-onnx-node 的 src/*.cc 是指向 harmony-os 目录的软链
 *    (单一真源),tar 解包要按 linkname 解析还原。
 *  - addon 绑定的是 C-API:链接官方预编译 .so 即可,无需编译 sherpa 核心。
 *  - NDK 工具链默认 -Wl,--no-undefined 会拦 NAPI 符号(它们本该留空由宿主
 *    node 在 dlopen 时解析),要 -Wl,-z,undefs 放行。
 *  - RUNPATH 打 $ORIGIN(构建机绝对路径在部署机必失效);启动脚本另有
 *    LD_LIBRARY_PATH 双保险。
 *
 * 环境:ANDROID_NDK / CMAKE_BIN / NINJA_BIN(默认探 Android SDK 常见位置);
 *      GITHUB_ACTIONS=1 时源 URL 直连(CI 网络),否则走 gh-proxy 镜像链。
 * 运行:node scripts/build-termux-voice.mjs(产物出 .termux-build/,下载缓存幂等)。
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// 复用主进程依赖(纯 JS 流式解压;本脚本不被打包,直接吃仓库 node_modules)
const tar = require("tar-stream");
const unbzip2 = require("unbzip2-stream");

const SHERPA_VERSION = "1.13.6";
const PKG_VERSION = `${SHERPA_VERSION}-termux.1`;
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, ".termux-build");
const PROXIES = ["", "https://gh-proxy.com/", "https://ghproxy.net/"];
const ANDROID_PLATFORM = "24";
const NEED_SO = ["libsherpa-onnx-c-api.so", "libonnxruntime.so"];

const log = (m) => console.log(`[termux-voice] ${m}`);
const die = (m) => { console.error(`[termux-voice] FAIL ${m}`); process.exit(1); };

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function findTool(label, envVar, candidates) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const c of candidates) if (fs.existsSync(c)) return c;
  die(`找不到 ${label}:设 ${envVar} 指定(试过 ${candidates.join(" | ")})`);
}

const NDK = findTool("Android NDK", "ANDROID_NDK", [
  path.join(os.homedir(), "AppData/Local/Android/Sdk/ndk/28.2.13676358"),
  "/usr/local/lib/android/sdk/ndk/28.2.13676358",
]).replaceAll("\\", "/");
const CMAKE = findTool("cmake", "CMAKE_BIN", [
  path.join(os.homedir(), "AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe"),
  "cmake",
]);
const NINJA = findTool("ninja", "NINJA_BIN", [
  path.join(os.homedir(), "AppData/Local/Android/Sdk/cmake/3.22.1/bin/ninja.exe"),
  "ninja",
]);
const READELF = path.join(
  NDK, "toolchains/llvm/prebuilt", process.platform === "win32" ? "windows-x86_64" : "linux-x86_64",
  "bin", process.platform === "win32" ? "llvm-readelf.exe" : "llvm-readelf",
);

async function fetchToFile(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    log(`缓存命中 ${path.basename(dest)}`);
    return;
  }
  const chain = process.env.GITHUB_ACTIONS ? [""] : PROXIES;
  let lastErr;
  for (const p of chain) {
    try {
      const res = await fetch(p + url, { redirect: "follow", signal: AbortSignal.timeout(600_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest + ".part"));
      fs.renameSync(dest + ".part", dest);
      log(`下载 ${path.basename(dest)} ${(fs.statSync(dest).size / 1048576).toFixed(1)}MB(${p || "直连"})`);
      return;
    } catch (e) {
      lastErr = e;
      try { fs.rmSync(dest + ".part", { force: true }); } catch {}
    }
  }
  die(`下载失败 ${url}: ${lastErr}`);
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    // Node 18.20+ 禁止 spawnSync .cmd(bat)无 shell 直启
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd),
  });
}

/** 解 tar(.gz/.bz2)到内存条目表:{name, isSym, linkname, isfile, data()} */
function readTarEntries(archive) {
  const decompress = archive.endsWith(".bz2") ? unbzip2() : zlib.createGunzip();
  return new Promise((resolve, reject) => {
    const entries = [];
    const extract = tar.extract();
    extract.on("entry", (header, stream, next) => {
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        entries.push({
          name: header.name,
          type: header.type,
          linkname: header.linkname,
          data: Buffer.concat(chunks),
        });
        next();
      });
      stream.resume();
    });
    extract.on("finish", () => resolve(entries));
    extract.on("error", reject);
    fs.createReadStream(archive).on("error", reject).pipe(decompress).on("error", reject).pipe(extract);
  });
}

// ---------------------------------------------------------------------------
// 1. 材料
// ---------------------------------------------------------------------------

async function prepareSources() {
  await fetchToFile(
    `https://github.com/k2-fsa/sherpa-onnx/archive/refs/tags/v${SHERPA_VERSION}.tar.gz`,
    path.join(OUT_DIR, "sherpa-src.tar.gz"),
  );
  await fetchToFile(
    `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/sherpa-onnx-v${SHERPA_VERSION}-android.tar.bz2`,
    path.join(OUT_DIR, "android-libs.tar.bz2"),
  );

  log("解析源 tar(含软链还原)…");
  const srcEntries = await readTarEntries(path.join(OUT_DIR, "sherpa-src.tar.gz"));
  const prefix = `sherpa-onnx-${SHERPA_VERSION}/`;
  const realFiles = new Map(srcEntries.filter((e) => e.type === "file").map((e) => [e.name, e]));

  // addon 目录:普通文件直出;软链按 linkname 还原真身(上游 src/*.cc → harmony-os)
  const addonDir = path.join(OUT_DIR, "addon");
  fs.rmSync(path.join(addonDir, "src"), { recursive: true, force: true });
  let files = 0, links = 0;
  for (const e of srcEntries) {
    if (!e.name.startsWith(prefix + "scripts/node-addon-api/")) continue;
    const rel = e.name.slice((prefix + "scripts/node-addon-api/").length);
    if (!rel || rel.endsWith("/")) continue;
    const dest = path.join(addonDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (e.type === "file") {
      fs.writeFileSync(dest, e.data); files++;
    } else if (e.type === "symlink") {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(e.name), e.linkname));
      const tm = realFiles.get(target);
      if (!tm) continue; // 仓库外绝对路径软链(如 /Users/...)不属于构建面
      fs.writeFileSync(dest, tm.data); links++;
    }
  }
  const ccCount = fs.readdirSync(path.join(addonDir, "src")).filter((f) => f.endsWith(".cc")).length;
  if (ccCount < 15) die(`addon src 异常:仅 ${ccCount} 个 .cc(软链还原失败?)`);
  log(`addon 源就绪:${files} 文件 + ${links} 软链还原(${ccCount} 个 .cc)`);

  // install 布局:include/c-api.h + lib/两个 .so
  const installDir = path.join(OUT_DIR, "install");
  fs.rmSync(installDir, { recursive: true, force: true });
  const headerRel = "sherpa-onnx/c-api/c-api.h";
  const header = realFiles.get(prefix + headerRel);
  if (!header) die("c-api.h 缺失");
  fs.mkdirSync(path.join(installDir, "include/sherpa-onnx/c-api"), { recursive: true });
  fs.writeFileSync(path.join(installDir, "include/sherpa-onnx/c-api/c-api.h"), header.data);
  fs.mkdirSync(path.join(installDir, "lib"), { recursive: true });

  log("解析 android 预编译 tar…");
  const libEntries = await readTarEntries(path.join(OUT_DIR, "android-libs.tar.bz2"));
  for (const name of NEED_SO) {
    const e = libEntries.find((x) => x.name.endsWith(`arm64-v8a/${name}`) && x.type === "file");
    if (!e) die(`android 预编译缺 ${name}`);
    fs.writeFileSync(path.join(installDir, "lib", name), e.data);
  }
  log("install 布局就绪:c-api.h + " + NEED_SO.join(" + "));
  return { addonDir, installDir };
}

// ---------------------------------------------------------------------------
// 2. addon 依赖 + 交叉编译
// ---------------------------------------------------------------------------

async function buildAddon(addonDir, installDir) {
  // npm 装绑定层头文件(napi 包装 + node 头)
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npmCmd, ["install", "--no-audit", "--no-fund", "--no-save",
    "node-addon-api@^8", "node-api-headers@^1"], { cwd: addonDir });
  const napiInclude = path.join(addonDir, "node_modules/node-api-headers/include").replaceAll("\\", "/");
  if (!fs.existsSync(napiInclude)) die("node-api-headers include 目录缺失");

  const buildDir = path.join(addonDir, "build");
  fs.rmSync(buildDir, { recursive: true, force: true });
  const installDirFwd = installDir.replaceAll("\\", "/");
  run(CMAKE, [
    "-S", addonDir,
    "-B", buildDir, "-G", "Ninja",
    `-DCMAKE_MAKE_PROGRAM=${NINJA}`,
    `-DCMAKE_TOOLCHAIN_FILE=${NDK}/build/cmake/android.toolchain.cmake`,
    "-DANDROID_ABI=arm64-v8a",
    `-DANDROID_PLATFORM=android-${ANDROID_PLATFORM}`,
    "-DCMAKE_BUILD_TYPE=Release",
    // -z undefs 放行 NAPI 未定义符号(宿主 node dlopen 时解析);$ORIGIN 兜 rpath
    "-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,undefs -Wl,-rpath,$ORIGIN",
    `-DCMAKE_JS_INC=${napiInclude}`,
  ], { cwd: addonDir, env: { SHERPA_ONNX_INSTALL_DIR: installDirFwd } });
  run(CMAKE, ["--build", buildDir, "--", "-j" + Math.max(2, os.cpus().length - 1)], { cwd: addonDir });

  const node = path.join(buildDir, "sherpa-onnx.node");
  if (!fs.existsSync(node)) die("sherpa-onnx.node 未产出");
  return node;
}

// ---------------------------------------------------------------------------
// 3. ELF 验证:依赖 .so 齐、RUNPATH 带 $ORIGIN、NAPI 注册符号、AArch64
// ---------------------------------------------------------------------------

function verifyElf(nodePath) {
  const out = execFileSync(READELF, ["-d", nodePath], { encoding: "utf-8" });
  for (const so of NEED_SO) {
    if (!out.includes(`Shared library: [${so}]`)) die(`ELF 缺 NEEDED ${so}`);
  }
  if (!/\$ORIGIN/.test(out)) die("ELF RUNPATH 缺 $ORIGIN");
  const syms = execFileSync(READELF, ["--dyn-symbols", nodePath], { encoding: "utf-8" });
  if (!syms.includes("napi_register_module_v1")) die("缺 napi_register_module_v1(NAPI 注册符号)");
  const hdr = execFileSync(READELF, ["-h", nodePath], { encoding: "utf-8" });
  if (!hdr.includes("AArch64")) die("非 AArch64 产物");
  log("ELF 验证通过:NEEDED 双 .so + RUNPATH $ORIGIN + NAPI 符号 + AArch64");
}

// ---------------------------------------------------------------------------
// 4. 组包:JS 包装层(npm 包原装)+ 产物三件套 → tar.gz
// ---------------------------------------------------------------------------

async function assemble(nodePath) {
  const stage = path.join(OUT_DIR, "stage/sherpa-onnx-node");
  fs.rmSync(path.join(OUT_DIR, "stage"), { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  const npmPkgDir = path.join(ROOT, "node_modules/sherpa-onnx-node");
  if (!fs.existsSync(path.join(npmPkgDir, "sherpa-onnx.js"))) {
    die(`npm 包装层缺失(${npmPkgDir})——先在本仓库 npm install`);
  }
  for (const f of fs.readdirSync(npmPkgDir)) {
    if (f.endsWith(".js") || f.endsWith(".json") || f.endsWith(".md")) {
      fs.copyFileSync(path.join(npmPkgDir, f), path.join(stage, f));
    }
  }
  fs.copyFileSync(nodePath, path.join(stage, "sherpa-onnx.node"));
  for (const so of NEED_SO) {
    fs.copyFileSync(path.join(OUT_DIR, "install/lib", so), path.join(stage, so));
  }
  const pkgJson = JSON.parse(fs.readFileSync(path.join(stage, "package.json"), "utf-8"));
  pkgJson.version = PKG_VERSION;
  pkgJson.description = `${pkgJson.description ?? ""} [termux android-arm64 build with bundled .so]`;
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(pkgJson, null, 2));

  // tar.gz(node zlib 原生,免外部 xz)
  // 资产名不带版本:install-termux.sh 走 releases/latest/download 固定 URL
  const outName = "lookatstudy-termux-voice.tar.gz";
  const outPath = path.join(OUT_DIR, outName);
  await new Promise((resolve, reject) => {
    const pack = tar.pack();
    const gz = zlib.createGzip({ level: 9 });
    const ws = fs.createWriteStream(outPath);
    const add = (rel, abs) => {
      pack.entry({ name: `sherpa-onnx-node/${rel}`, size: fs.statSync(abs).size }, fs.readFileSync(abs));
    };
    for (const f of fs.readdirSync(stage)) add(f, path.join(stage, f));
    pack.finalize();
    pack.pipe(gz).pipe(ws);
    ws.on("finish", resolve);
    ws.on("error", reject);
  });
  const mb = (fs.statSync(outPath).size / 1048576).toFixed(1);
  log(`产物就绪:${outPath}(${mb}MB)`);
  return outPath;
}

// ---------------------------------------------------------------------------
async function main() {
  log(`NDK=${NDK}`);
  const { addonDir, installDir } = await prepareSources();
  const node = await buildAddon(addonDir, installDir);
  verifyElf(node);
  const out = await assemble(node);
  console.log(`\nTERMUX_VOICE_PACKAGE=${out}`);
}

main().catch((e) => die(e?.stack ?? String(e)));
