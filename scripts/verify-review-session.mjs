/**
 * verify-review-session —— 复习会话(对话式复习导师,v0.39)确定性测试。
 *
 * 设计(用户拍板 2026-09-23):点「复习」→ 开/续该课的 kind=review 会话线程,
 * AI 以【复习导师姿态】主持(先忆后问/错了才讲/嵌 quiz 计分检验),3~6 轮后调
 * end_review_session 收束:quality 1~5 喂 SM-2(算法权威在系统侧,AI 只评定),
 * 不写 BKT 掌握度(Phase D 同口径)。顺带修:复习也打卡 streak(纯复习日不断连胜)、
 * T3 复习选课切到对话栏(旧流程停在地图,讲解/自评藏在第三栏)。
 *
 * T1 轮次状态纯函数:reviewRoundState(json)/reviewRoundStateFromParts(parts)
 *    —— 末尾谁先出现谁算数(end 结果→ended / kickoff 标记→open / 都无→open)
 * T2 收束写入:reviewXpKindForQuality 映射 + recordReviewDb 返回 Sm2Result
 * T3 引擎接线(源级):姿态块注入(reviewMode 才有)+ 收束工具仅 reviewMode 注册 +
 *    双重防重复(回合内计数 + 轮次判定)+ XP/streak 同款写入 + 已收束续聊提示
 * T4 同源纪律(源级):assembleContextBlocks 与 getContextUsage 两个消费点都吃 reviewMode
 * T5 渲染层接线(源级):startReviewSession(kickoff+kind+T3 切栏)+ 抽屉入口 +
 *    兜底自评卡 + 收束卡 + 线程徽标 + ChatComposer reviewMode
 * T6 i18n:zh/en 双语键齐 + kickoff 提示词必须以 [[review-kickoff]] 开头(两侧轮次判定依赖)
 * T7 zh 姿态本体关键条款逐字锁(先忆后看纪律)
 * T8 schema/迁移/服务层 kind 透传 + verify:core 链注册自检
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/main/db/schema.ts";
import {
  REVIEW_END_TOOL_NAME,
  REVIEW_KICKOFF_MARKER,
  reviewXpKindForQuality,
  reviewRoundState,
  reviewRoundStateFromParts,
} from "../shared/review-session.ts";
import { recordReviewDb } from "../src/main/services/pure/srs-db.ts";
import { buildReviewTutorBlock } from "../src/main/services/agent/base-prompt.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
// 源文件在 Windows 工作区是 CRLF——统一归一为 LF,多行断言才稳
const read = (p) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const ipcSrc = read("src/main/ipc/index.ts");
const engineSrc = read("src/main/services/agent/agent-engine.ts");
const ctxSrc = read("src/main/services/agent/context-usage.ts");
const appSrc = read("src/renderer/App.tsx");
const threadsHookSrc = read("src/renderer/lib/useThreads.ts");
const switcherSrc = read("src/renderer/components/ThreadSwitcher.tsx");
const streamSrc = read("src/renderer/components/ChatStream.tsx");
const composerSrc = read("src/renderer/components/ChatComposer.tsx");
const i18nSrc = read("src/renderer/lib/i18n.ts");
const schemaSql = read("src/main/db/schema.sql");
const dbIndexSrc = read("src/main/db/index.ts");
const threadServiceSrc = read("src/main/services/thread-service.ts");
const pkg = JSON.parse(read("package.json"));

// ---------------------------------------------------------------- T1 轮次状态纯函数
{
  const endPart = JSON.stringify([
    { type: "tool-call", toolName: REVIEW_END_TOOL_NAME, state: "output-available", output: { status: "ended" } },
  ]);
  const endPartErr = JSON.stringify([
    { type: "tool-call", toolName: REVIEW_END_TOOL_NAME, state: "output-error", error: "x" },
  ]);
  const kickoff = (title) => ({ role: "user", content: `${REVIEW_KICKOFF_MARKER}\n我想复习「${title}」。`, partsJson: null });

  // 空线程 → open(宽容:没开场也允许收束)
  assert.equal(reviewRoundState([]), "open", "T1 空线程=open");
  // 只有 kickoff → open
  assert.equal(reviewRoundState([kickoff("X")]), "open", "T1 仅开场=open");
  // kickoff 后有 end → ended
  assert.equal(
    reviewRoundState([kickoff("X"), { role: "assistant", content: "收束", partsJson: endPart }]),
    "ended",
    "T1 开场后收束=ended",
  );
  // end 的工具失败不算收束(可重试)
  assert.equal(
    reviewRoundState([kickoff("X"), { role: "assistant", content: "失败", partsJson: endPartErr }]),
    "open",
    "T1 收束失败不算=可重试",
  );
  // 多轮:第一轮 end 之后新 kickoff → open(每轮一次收束)
  assert.equal(
    reviewRoundState([
      kickoff("X"),
      { role: "assistant", content: "r1", partsJson: endPart },
      kickoff("X"),
    ]),
    "open",
    "T1 第二轮开场重置为 open",
  );
  // 第二轮 end → ended
  assert.equal(
    reviewRoundState([
      kickoff("X"),
      { role: "assistant", content: "r1", partsJson: endPart },
      kickoff("X"),
      { role: "assistant", content: "r2", partsJson: endPart },
    ]),
    "ended",
    "T1 第二轮收束=ended",
  );
  // 损坏 JSON 静默跳过
  assert.equal(
    reviewRoundState([{ role: "assistant", content: "x", partsJson: "{broken" }]),
    "open",
    "T1 损坏 JSON 不炸",
  );
  // 普通聊天消息(无标记无 end)→ open
  assert.equal(
    reviewRoundState([{ role: "user", content: "普通问题", partsJson: null }]),
    "open",
    "T1 普通消息=open",
  );

  // parts 变体(渲染层 ChatMessageV2)
  const partsEnd = [{ type: "tool-call", toolName: REVIEW_END_TOOL_NAME, state: "output-available", output: { status: "ended" } }];
  assert.equal(
    reviewRoundStateFromParts([
      { role: "user", parts: [{ type: "text", text: `${REVIEW_KICKOFF_MARKER}\n复习` }] },
      { role: "assistant", parts: [{ type: "text", text: "好" }, ...partsEnd] },
    ]),
    "ended",
    "T1 parts 变体:收束=ended",
  );
  assert.equal(
    reviewRoundStateFromParts([
      { role: "user", parts: [{ type: "text", text: "旧开场" + REVIEW_KICKOFF_MARKER }] },
      { role: "assistant", parts: partsEnd },
      { role: "user", parts: [{ type: "text", text: `${REVIEW_KICKOFF_MARKER}\n新一轮` }] },
    ]),
    "open",
    "T1 parts 变体:新一轮=open",
  );
  console.log("T1 轮次状态纯函数(按轮次判定/失败可重试/损坏降级)✓");
}

// ---------------------------------------------------------------- T2 收束写入
{
  // XP 档映射:与 srs:record 自评同款(≥4 correct / ≤2 wrong / 3 不计)
  assert.equal(reviewXpKindForQuality(1), "wrong", "T2 q1=wrong");
  assert.equal(reviewXpKindForQuality(2), "wrong", "T2 q2=wrong");
  assert.equal(reviewXpKindForQuality(3), null, "T2 q3 不计");
  assert.equal(reviewXpKindForQuality(4), "correct", "T2 q4=correct");
  assert.equal(reviewXpKindForQuality(5), "correct", "T2 q5=correct");

  // recordReviewDb 返回 Sm2Result(收束卡要显示下次复习时间)
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(schemaSql);
  sqljs.run(`INSERT INTO courses (id, repo_name, title) VALUES ('c1','r','T')`);
  sqljs.run(`INSERT INTO content_nodes (id, course_id, type, title) VALUES ('n1','c1','lesson','L1')`);
  const db = drizzle(sqljs, { schema });

  const r1 = recordReviewDb(db, "n1", 1); // 忘了 → 明天
  assert.equal(r1.intervalDays, 1, "T2 quality1→interval 1(明天重练)");
  assert.ok(r1.dueAt && !Number.isNaN(Date.parse(r1.dueAt)), "T2 返回合法 dueAt");
  assert.equal(r1.repetitions, 0, "T2 quality1 重置 repetitions");

  const r2 = recordReviewDb(db, "n1", 4); // 记得 → 推进
  assert.equal(r2.repetitions, 1, "T2 quality4→reps 1");
  assert.equal(r2.intervalDays, 1, "T2 首次成功 interval 1");
  const r3 = recordReviewDb(db, "n1", 5); // 很熟 → 6 天
  assert.equal(r3.repetitions, 2, "T2 连续成功 reps 2");
  assert.equal(r3.intervalDays, 6, "T2 第二次成功 interval 6(SM-2 标准步进)");
  assert.ok(r3.easeFactor >= 1.3 && r3.easeFactor <= 3.0, "T2 EF 在钳制带内");

  const row = db.select().from(schema.srsItems).where(eq(schema.srsItems.nodeId, "n1")).get();
  assert.equal(row.dueAt, r3.dueAt, "T2 返回值与落库一致(单一真源)");
  console.log("T2 收束写入(XP 档映射/Sm2Result 回执/SM-2 步进)✓");
}

// ---------------------------------------------------------------- T3 引擎接线(源级)
{
  // 姿态块:reviewMode 才注入
  assert.ok(engineSrc.includes("(opts?.reviewMode ? \"\\n\\n\" + buildReviewTutorBlock(outLang) : \"\")"), "T3 assembleContextBlocks 按 reviewMode 注入姿态块");
  // 收束工具:仅 reviewMode 注册(条件展开)
  assert.ok(
    engineSrc.includes(`...(reviewMode`) && engineSrc.includes(`[REVIEW_END_TOOL_NAME]: tool({`),
    "T3 end_review_session 仅复习会话注册",
  );
  // 双重防重复:回合内计数 + 轮次判定
  assert.ok(engineSrc.includes("endReviewCalls > 1"), "T3 回合内重复收束硬闸");
  assert.ok(engineSrc.includes("reviewAlreadyEnded") && engineSrc.includes("reviewRoundState(rawMsgs)"), "T3 跨轮次收束状态判定");
  // 收束写入:recordReview + XP 档 + streak(与 srs:record 同款三件套)
  const toolBlock = engineSrc.slice(engineSrc.indexOf(`[REVIEW_END_TOOL_NAME]: tool({`), engineSrc.indexOf("update_learner_profile: tool({"));
  assert.ok(toolBlock.includes("recordReview(nodeId, quality)"), "T3 收束写 SRS");
  assert.ok(toolBlock.includes("reviewXpKindForQuality(quality)"), "T3 收束 XP 走统一映射");
  assert.ok(toolBlock.includes("touchStreakToday()"), "T3 收束打卡 streak");
  // 清红点闭环:quality=3 不写 XP,必须补发 state:changed——否则 refreshDue 不触发,
  // 收束后地图徽章的到期数挂着不清(2026-09-23 用户实测追问的漏网档)
  assert.ok(toolBlock.includes('else emitStateChange("xp")'), "T3 quality=3 补发 xp 事件(清红点)");
  // 不写 BKT:工具块内不得出现 createProposal/update_mastery
  assert.ok(!toolBlock.includes("createProposal") && !toolBlock.includes("update_mastery"), "T3 收束不写 BKT 掌握度(Phase D 同口径)");
  // 已收束续聊:提示层友好拦截
  assert.ok(engineSrc.includes("本复习会话已经收束过"), "T3 已收束续聊提示");
  // 线程 kind 读取
  assert.ok(engineSrc.includes("threadRow?.kind === \"review\""), "T3 引擎读 threads.kind");
  console.log("T3 引擎接线(姿态注入/工具注册/双重防重复/SRS+XP+streak/不写 BKT)✓");
}

// ---------------------------------------------------------------- T4 同源纪律(源级)
{
  // 实发:runAgentTurn 透传 reviewMode 给 assembleContextBlocks
  assert.ok(
    engineSrc.includes("assembleContextBlocks(\n    db,\n    nodeId,\n    locale,\n    { reviewMode },\n  )"),
    "T4 实发侧透传 reviewMode",
  );
  // 表显:context-usage 同源吃 reviewMode
  assert.ok(ctxSrc.includes("assembleContextBlocks(db, nodeId, locale, { reviewMode })"), "T4 context-usage 同源透传");
  assert.ok(ipcSrc.includes('"agent:getContextUsage", async (_e, nodeId: string, locale?: string | null, reviewMode?: boolean)'), "T4 IPC 第四参透传");
  assert.ok(composerSrc.includes("api.getContextUsage(nodeId, uiLang, reviewMode)"), "T4 ChatComposer 表显传 reviewMode");
  console.log("T4 同源纪律(实发/表显两消费点同吃 reviewMode)✓");
}

// ---------------------------------------------------------------- T5 渲染层接线(源级)
{
  // startReviewSession:kickoff + kind=review 线程 + T3 切栏
  const fnBlock = appSrc.slice(appSrc.indexOf("const startReviewSession"), appSrc.indexOf("// 答题完成自动 hook"));
  assert.ok(fnBlock.includes("openOrCreateReview"), "T5 会话线程解析/创建");
  assert.ok(fnBlock.includes('t("review.kickoff.prompt"'), "T5 开场提示词");
  assert.ok(fnBlock.includes('t("review.kickoff.label"'), "T5 开场短标签(display_text)");
  assert.ok(fnBlock.includes('if (tier === 3) setT3Pane("chat")'), "T5 手机端切到对话栏(修旧断点)");
  // 抽屉入口改走会话
  const drawerBlock = appSrc.slice(appSrc.indexOf("{showReviewDrawer && ("), appSrc.indexOf("{examLeave.open && ("));
  assert.ok(drawerBlock.includes("startReviewSession(id)"), "T5 复习抽屉选课=开会话");
  assert.ok(!drawerBlock.includes("setIsReviewing"), "T5 旧 isReviewing 流程退役");
  // 兜底自评卡:挂对话流下方 + 轮次 key
  assert.ok(
    appSrc.includes("reviewSessionActive && reviewRoundOpen && !chat.streaming") &&
    appSrc.includes("<SelfRatingCard key={reviewKickoffIdx}"),
    "T5 兜底自评卡(流结束未收束时显示,轮次 key 重挂)",
  );
  // 伴学:复习会话在场驱动
  assert.ok(appSrc.includes("companionReviewing(reviewSessionActive)"), "T5 伴学复习待命接线");
  // 收束卡:ChatStream 识别 end 工具结果
  assert.ok(
    streamSrc.includes('toolName === REVIEW_END_TOOL_NAME') &&
    streamSrc.includes('data-testid="review-outcome-card"'),
    "T5 收束卡渲染分支",
  );
  // 线程徽标
  assert.ok(
    switcherSrc.includes('th.kind === "review"') &&
    switcherSrc.includes("thread-review-"),
    "T5 复习会话 tab 徽标",
  );
  // useThreads:kind=review 线程解析/创建/bump
  assert.ok(
    threadsHookSrc.includes("openOrCreateReview") &&
    threadsHookSrc.includes('kind: "review"'),
    "T5 useThreads 会话线程管理",
  );
  console.log("T5 渲染层接线(会话入口/T3 切栏/兜底卡/收束卡/徽标/伴学)✓");
}

// ---------------------------------------------------------------- T6 i18n 双语 + kickoff 标记
{
  const zhBlock = i18nSrc.slice(0, i18nSrc.indexOf('"review.selfrated": "✓ Recorded'));
  const enBlock = i18nSrc.slice(i18nSrc.indexOf('"review.selfrated": "✓ Recorded'));
  for (const [name, block] of [["zh", zhBlock], ["en", enBlock]]) {
    assert.ok(block.includes('"review.kickoff.label"'), `T6 ${name} kickoff 标签`);
    assert.ok(block.includes('"review.outcome.title"'), `T6 ${name} 收束卡标题`);
    assert.ok(block.includes('"review.outcome.nextLesson"'), `T6 ${name} 下一课按钮`);
    assert.ok(block.includes('"review.outcome.tomorrow"'), `T6 ${name} 明天文案`);
    assert.ok(block.includes('"chat.tool.end_review_session"'), `T6 ${name} 工具标签`);
    assert.ok(block.includes('"thread.reviewBadge"'), `T6 ${name} 线程徽标文案`);
    // kickoff 提示词必须以标记开头(两侧轮次判定依赖;标记在 content,气泡被 display 覆盖)。
    // TS 源文件里标记后跟字面量反斜杠 n(字符串转义)——用 chr(92) 构造,避免转义在工具链里被剥。
    const bsN = String.fromCharCode(92) + "n";
    const line = block.split("\n").find((l) => l.includes('"review.kickoff.prompt"'));
    assert.ok(line && line.includes('"[[review-kickoff]]' + bsN), `T6 ${name} kickoff 提示词以标记+转义换行开头`);
  }
  console.log("T6 i18n 双语键 + kickoff 标记纪律✓");
}

// ---------------------------------------------------------------- T7 zh 姿态本体关键条款逐字锁
{
  const zh = buildReviewTutorBlock("zh-CN");
  assert.ok(zh.includes("【复习导师姿态】"), "T7 姿态块标题");
  assert.ok(zh.includes("先忆后看"), "T7 先忆后看纪律");
  assert.ok(zh.includes("错了才讲"), "T7 错了才讲纪律");
  assert.ok(zh.includes("适时收束"), "T7 收束纪律");
  assert.ok(zh.includes("不要调用 mark_mastered"), "T7 复习不发起毕业判定");
  assert.ok(zh.includes("1=几乎不记得/2=多数忘了/3=勉强想起/4=记得/5=很熟"), "T7 quality 评定标尺");
  // en 镜像关键条款
  const en = buildReviewTutorBlock("en-US");
  assert.ok(en.includes("[Review-tutor posture]"), "T7 en 姿态块标题");
  assert.ok(en.includes("Recall first, reveal later"), "T7 en 先忆后看");
  assert.ok(en.includes("1=remember almost nothing / 2=most of it gone / 3=barely recalled / 4=remembered / 5=solid"), "T7 en 标尺");
  console.log("T7 姿态本体双语关键条款锁✓");
}

// ---------------------------------------------------------------- T8 schema/迁移/服务层 + 链注册
{
  assert.ok(schemaSql.includes("kind TEXT NOT NULL DEFAULT 'chat'"), "T8 schema.sql kind 列");
  assert.ok(dbIndexSrc.includes('addColumnIfMissing("threads", "kind"'), "T8 老库幂等迁移");
  assert.ok(threadServiceSrc.includes("kind: input.kind ?? \"chat\""), "T8 createThread kind 透传");
  assert.ok(threadServiceSrc.includes("kind: ThreadKind"), "T8 Thread 接口带 kind");
  // srs:record 返回回执 + streak(旧自评路径同享)
  const srsBlock = ipcSrc.slice(ipcSrc.indexOf('"srs:record"'), ipcSrc.indexOf("/* ---------- 打卡"));
  assert.ok(srsBlock.includes("touchStreakToday()"), "T8 srs:record 打卡 streak(纯复习日不断连胜)");
  assert.ok(srsBlock.includes("intervalDays: result.intervalDays"), "T8 srs:record 返回回执");
  assert.ok(srsBlock.includes('else emitStateChange("xp")'), "T8 srs:record quality=3 同款补发(对称防御)");
  // verify:core 链注册
  assert.ok(
    pkg.scripts["verify:core"].includes("verify-review-session.mjs"),
    "T8 verify:core 链注册",
  );
  console.log("T8 schema/迁移/服务层/srs 回执/链注册✓");
}

console.log("\nverify-review-session 全部通过 ✓");
