/**
 * verify-note-highlight —— 持久画线 Highlight API 通道(v0.35.1,16:23 DOMException 根修)。
 *
 * 背景:applyPersistentMarksByText 会拆文本节点、插 <mark>,改写 ReactMarkdown
 * 管的 DOM;之后任何重渲染 reconcile 撞外来节点抛 DOMException(2026-09-14
 * 16:23 实测落在 markdown <a>)。修复 = 主通道迁 CSS Custom Highlight API
 * (Range 注册,零 DOM 改动),老 webview 保留 DOM 包裹兜底。
 *
 *   T1  highlightText 新通道面:supportsHighlightMarks / applyPersistentMarksHighlight /
 *       getNoteRange / hasNoteMark / flashNoteRange / getLastNoteRangeInContainer /
 *       setLastNoteMark(Range|Element) / getLastNoteMarkAnchor
 *   T2  调用方接线:NotebookPanel 与 ChatStream 均按 supportsHighlightMarks 分支
 *       (主通道优先,兜底保留);App 溯源轮询改 hasNoteMark(不再查 DOM mark)
 *   T3  CSS:cp-user-note 与 cp-user-note-flash 两条 ::highlight 规则在场
 *   T4  行为闭环注册:runHighlightTest 含 note-highlight 六断言(DOM 零改动/
 *       注册表/溯源/重放修剪/双容器共存/兜底共存)且 npm run test:highlight 在链上
 *   T5  伴学锚点:CompanionCreature 消费 getLastNoteMarkAnchor({range,host,block})
 *
 * 运行:npx tsx scripts/verify-note-highlight.mjs(纯源级,零 Electron)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

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

const hl = read("src/renderer/lib/highlightText.ts");
const nb = read("src/renderer/components/NotebookPanel.tsx");
const cs = read("src/renderer/components/ChatStream.tsx");
const app = read("src/renderer/App.tsx");
const cc = read("src/renderer/components/companion/CompanionCreature.tsx");
const css = read("src/renderer/index.css");
const mainIdx = read("src/main/index.ts");
const pkg = JSON.parse(read("package.json"));

/* T1 通道面 */
t("T1a 注册式画线入口在场", () => {
  assert.ok(hl.includes("export function supportsHighlightMarks()"));
  assert.ok(hl.includes("export function applyPersistentMarksHighlight("));
  assert.ok(hl.includes('USER_NOTE_HIGHLIGHT_NAME = "cp-user-note"'));
});
t("T1b 主通道零 DOM 改动的注释契约", () =>
  assert.ok(hl.includes("DOM 零改动") || hl.includes("零 DOM 改动")));
t("T1c 溯源/闪烁/末线 API", () => {
  assert.ok(hl.includes("export function getNoteRange("));
  assert.ok(hl.includes("export function hasNoteMark("));
  assert.ok(hl.includes("export function flashNoteRange("));
  assert.ok(hl.includes("export function getLastNoteRangeInContainer("));
});
t("T1d anchor 结构(range/host/block)", () => {
  assert.ok(hl.includes("export interface NoteMarkAnchor"));
  assert.ok(hl.includes("export function getLastNoteMarkAnchor()"));
});
t("T1e 全局注册表 + 死 Range 修剪", () => {
  assert.ok(hl.includes("liveNoteRanges"));
  assert.ok(hl.includes("isConnected"));
});

/* T2 调用方接线 */
t("T2a NotebookPanel 双通道分支", () => {
  assert.ok(nb.includes("if (supportsHighlightMarks()) applyPersistentMarksHighlight("));
  assert.ok(nb.includes("applyPersistentMarksByText(proseRef.current, notes)"));
});
t("T2b ChatStream 双通道分支", () => {
  assert.ok(cs.includes("if (supportsHighlightMarks()) applyPersistentMarksHighlight("));
  assert.ok(cs.includes("applyPersistentMarksByText(msgEl, notes)"));
});
t("T2c 跳转双通道(getNoteRange/flashNoteRange + 兜底 flashMark)", () => {
  assert.ok(nb.includes("flashNoteRange(range)") && nb.includes("flashMark(mark)"));
  assert.ok(cs.includes("flashNoteRange(range)") && cs.includes("flashMark(mark)"));
});
t("T2d App 溯源轮询不再查 DOM mark", () => {
  assert.ok(app.includes("if (hasNoteMark(noteId))"));
  assert.ok(!app.includes("mark[data-note-id="));
});
t("T2e 保存流伴学锚点走注册表", () => {
  assert.ok(nb.includes("getLastNoteRangeInContainer(proseRef.current)"));
});

/* T3 CSS */
t("T3 ::highlight 双规则在场", () => {
  assert.ok(css.includes("::highlight(cp-user-note)"));
  assert.ok(css.includes("::highlight(cp-user-note-flash)"));
});

/* T4 行为闭环 */
t("T4a runHighlightTest 含 note-highlight 断言组", () => {
  assert.ok(mainIdx.includes("note-highlight: 主通道画线后 DOM 零改动"));
  assert.ok(mainIdx.includes("applyPersistentMarksHighlight"));
});
t("T4b test:highlight 在 scripts 上", () =>
  assert.ok(pkg.scripts["test:highlight"]));

/* T5 伴学锚点 */
t("T5 CompanionCreature 消费 anchor 结构", () => {
  assert.ok(cc.includes("getLastNoteMarkAnchor()"));
  assert.ok(cc.includes("noteAnchor?.range.getBoundingClientRect()"));
  assert.ok(!cc.includes("getLastNoteMark()"));
});

/* 注册 check */
t("T6 verify:core 链含本套件", () =>
  assert.ok(pkg.scripts["verify:core"].includes("verify-note-highlight")));

console.log(`verify-note-highlight: ${passed} assertions ${process.exitCode ? "FAILED" : "passed"}`);
