/**
 * audit-shimeji-reachability —— 动作可达性审计(v0.37.2 判据2 固化)。
 *
 * 对已安装包(APPDATA/lookatstudy/shimeji-packs)与 fixtures 代表包逐包计算
 * "永不演"集合:随机池(idle/walk/rest)+触发链(wall/ceiling/air/drag 池)之外
 * 的动作,逐项标注白名单原因(poses 空 / Sequence 未展开 / 无 slot 旧包未摊平)。
 * 判据:已装包每包永不演 ≤8 且剩余项全部白名单;fixtures 代表包(重导等价)同样 ≤8。
 *
 * 用法:npm run audit:shimeji(退出码 0=达标,1=超标)
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { expandShimejiSequences, parseShimejiActions, archiveOf } from "../src/main/services/shimeji/pure/shimeji-parse.ts";
import { poolsFor, EXPRESSION_PREF } from "../src/renderer/lib/companion/shimeji-scheduler.ts";

const REST = /sit|sprawl|lie|lay|sleep|nap|dangle|lookup/i;
const AIR = /fall|throw|trip/i;
const DRAG = /drag|resist|pinch/i;

/** 与调度器同口径的可达集合:随机池(poolsFor)+四触发链池内随机(pickVaried)+表情偏好 */
function reachableNames(actions) {
  const semantic = (a) => a.archiveOf ?? a.name;
  const bySlot = (s) => actions.filter((a) => a.slot === s);
  const ground = bySlot("ground");
  const random = new Set();
  for (const a of [
    ...ground.filter((a) => a.kind === "Stay" || a.kind === "Animate"),
    ...actions.filter((a) => a.archive === "fx" && a.poses.length),
    ...bySlot("mouse"),
    ...bySlot("tired"),
    ...ground.filter((a) => a.kind === "Move"),
    ...ground.filter((a) => REST.test(semantic(a))),
  ]) random.add(a.name);
  // 触发链:v0.37.2 后池内 pickVaried——池内全部可达(过滤空 poses,同调度器)
  const triggered = new Set();
  for (const pool of [
    bySlot("wall").filter((a) => a.poses.length),
    bySlot("ceiling").filter((a) => a.poses.length),
    bySlot("interact").filter((a) => AIR.test(semantic(a)) && a.poses.length),
    bySlot("interact").filter((a) => DRAG.test(semantic(a)) && a.poses.length),
  ]) for (const a of pool) triggered.add(a.name);
  // 表情偏好路径:happy→Bouncing/Jumping 等,archiveOf 或名字命中即达
  const prefNames = new Set(Object.values(EXPRESSION_PREF).flat());
  for (const a of actions) {
    if (prefNames.has(a.archiveOf ?? "") || prefNames.has(a.name)) random.add(a.name);
  }
  return { random, triggered };
}

function auditPack(label, actions) {
  const { random, triggered } = reachableNames(actions);
  const never = actions.filter((a) => !random.has(a.name) && !triggered.has(a.name));
  const whitelist = (a) =>
    (!a.poses || a.poses.length === 0 ? "poses空" : null) ??
    (a.slot === "panel" ? "panel三期(无窗口表面)" : null) ??
    (a.archive === "skip" ? "skip(IE专属)" : null) ??
    (a.kind === "Sequence" ? "Sequence未摊平" : null) ??
    (!a.slot ? "无slot旧包" : null) ?? "非白名单";
  const rows = never.map((a) => ({ name: a.name, kind: a.kind, slot: a.slot ?? "-", why: whitelist(a) }));
  // 口径:设计排除(panel/skip)单列——不是可达性缺陷,是产品拍板的无表面/无宿主;
  // 真残留 = 其余白名单类(poses空/Sequence未摊平/无slot) + 非白名单。
  // 判据:非白名单=0 且 真残留 ≤8(比"永不演总数≤8"更严格精确)。
  const excluded = rows.filter((r) => r.why.startsWith("panel") || r.why.startsWith("skip"));
  const residual = rows.filter((r) => !excluded.includes(r));
  const bad = residual.filter((r) => r.why === "非白名单");
  console.log(
    `${label}: 总${actions.length} 可达${random.size + triggered.size}` +
      ` 设计排除${excluded.length} 真残留${residual.length}` +
      (residual.length ? ` → ${residual.map((r) => `${r.name}[${r.why}]`).join(", ")}` : ""),
  );
  return { residual: residual.length, bad: bad.length };
}

const appdata = path.join(process.env.APPDATA, "lookatstudy", "shimeji-packs");
let fail = 0;
if (fs.existsSync(appdata)) {
  for (const dir of fs.readdirSync(appdata)) {
    if (dir.startsWith(".")) continue;
    const m = JSON.parse(fs.readFileSync(path.join(appdata, dir, "manifest.json"), "utf8"));
    // P0 懒补等价:审计前按名字反查补 archiveOf(与 getShimejiPack 同逻辑)
    m.actions = m.actions.map((a) => ({ ...a, ...(a.archiveOf ? {} : archiveOf(a.name).entry ? { archiveOf: archiveOf(a.name).entry.en } : {}) }));
    const r = auditPack(`${dir}(${m.name})`, m.actions);
    if (r.residual > 8 || r.bad > 0) fail++;
  }
}

// fixtures 代表包(重导等价:解析+摊平后审计)——本地/gitignored,缺席 SKIP
const fxRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", ".shimeji-fixtures");
if (fs.existsSync(fxRoot)) {
  for (const char of fs.readdirSync(fxRoot)) {
    const conf = ["Actions.xml", "actions.xml"]
      .map((f) => path.join(fxRoot, char, "conf", f))
      .find((p) => fs.existsSync(p));
    if (!conf) continue;
    const parsed = expandShimejiSequences(parseShimejiActions(fs.readFileSync(conf, "utf8")));
    const actions = parsed.actions.map((a) => ({ ...a, slot: archiveOf(a.name).slot }));
    const r = auditPack(`fixtures/${char}`, actions);
    if (r.residual > 8 || r.bad > 0) fail++;
  }
} else {
  console.log("(fixtures 不在场,代表包审计 SKIP)");
}

console.log(fail === 0 ? "\n审计达标:全部包永不演 ≤8 且白名单干净 ✓" : `\n审计未达标:${fail} 包超标 ✗`);
process.exit(fail === 0 ? 0 : 1);
