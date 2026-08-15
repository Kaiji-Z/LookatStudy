/**
 * System prompt 构造器 —— 把激活的 soul body 注入到 base prompt 后面。
 *
 * Soul = 教学人设(persona),贯穿整轮对话的行为姿态。
 *
 * 注入规则(soul 注入常开,无 flag 门控):
 *   - 无 active soul → 返回 base prompt(等价"关闭",零行为变化)
 *   - 有 active soul 且存在于 souls 表 → base + "\n\n" + soul body
 *   - active soul 指向不存在的 soul → fallback base + 记 friction(不崩不空)
 *
 * 设计:本函数读 DB(settings + souls)。原 skill 版有 flag_skill_system 门控,
 * soul 重构后删除(soul 是 opt-in 叠加层,active_soul=null 即等价关闭,无需额外开关)。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { souls as soulsTable } from "../../db/schema.js";
import { getActiveSoul } from "./soul-service.js";
import { parseFrontmatter } from "../pure/frontmatter.js";
import { insertFrictionDb } from "../pure/friction-context.js";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 构造 system prompt。basePrompt 是 agent 的基础人设/约束。
 *
 * langReminder(可选,非 zh 时由调用方传):追加在 soul body 之后的语言提醒——
 * soul body 是中文写的,提醒 LLM 人设只管行为不管语言,输出语言跟随基座指令。
 * 无 active soul 时提醒也丢弃(语言指令已在 basePrompt 里,不依赖本参数)。
 */
export function buildSystemPrompt(db: Db, basePrompt: string, langReminder?: string): string {
  // 1. 读 active soul 名(无则 base)
  const activeName = getActiveSoul(db);
  if (!activeName) return basePrompt;

  // 2. 查 soul 行(不存在 → fallback base + 记 friction)
  const row = db
    .select()
    .from(soulsTable)
    .where(eq(soulsTable.name, activeName))
    .get();
  if (!row) {
    logFriction(db, null, `active_soul "${activeName}" 不在 souls 表里,fallback 到 base prompt`);
    return basePrompt;
  }

  // 3. 从 soul 的 raw(含 frontmatter)解析出纯 body,注入 base 后面
  const parsed = parseFrontmatter(row.body);
  const soulBody = parsed.body.trim();
  if (!soulBody) return basePrompt;

  return langReminder
    ? `${basePrompt}\n\n${soulBody}\n\n${langReminder}`
    : `${basePrompt}\n\n${soulBody}`;
}

/* ---------- 内部 ---------- */

function logFriction(db: Db, nodeId: string | null, summary: string): void {
  // 系统级错误,nodeId 留 null;真实节点卡点走 friction:log。
  insertFrictionDb(db, nodeId, "agent_error", summary);
}
