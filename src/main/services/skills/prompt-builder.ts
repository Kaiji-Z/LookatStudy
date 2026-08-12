/**
 * System prompt 构造器 —— 把激活的 skill body 注入到 base prompt 前面。
 *
 * 这是 §8.5 正向 3/4 + 反向 1/2/3 的核心被测函数。
 *
 * Flag gating 规则（§4 不变量：flag=off = 改动前行为）：
 *   - skill_system flag=off → 直接返回 base prompt（skill body 绝不泄漏，反向 2）
 *   - flag=on 但无 active skill → 返回 base prompt
 *   - flag=on + active skill 存在 → base + "\n\n" + skill body（正向 3）
 *   - flag=on + active skill 指向不存在的 skill → fallback base + 记 friction（反向 3，不崩不空）
 *
 * 设计：本函数读 DB（settings + flag）。为可测性暴露 setFlagForTest，
 * 测试直接写 DB 行（不走 flags.ts 的 isFlagOn，避免循环依赖 + 让测试可见地控制 flag）。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import {
  settings as settingsTable,
  skills as skillsTable,
} from "../../db/schema.js";
import { getActiveSkill } from "./skill-service.js";
import { parseSkillFrontmatter } from "../pure/skill-frontmatter.js";
// P3: friction 写入抽到 pure/(db 注入),本文件不再直接 insert frictionLog
import { insertFrictionDb } from "../pure/friction-context.js";

type Db = SQLJsDatabase<typeof schema>;

const FLAG_KEY = "flag_skill_system";

/**
 * 构造 system prompt。basePrompt 是 agent 的基础人设/约束。
 */
export function buildSystemPrompt(db: Db, basePrompt: string): string {
  // 1. flag gating：off 时严格返回 base（反向 2 在此保证）
  if (!readFlag(db)) return basePrompt;

  // 2. 读 active skill 名（无则 base，正向 4 / 反向 1 都依赖此分支幂等）
  const activeName = getActiveSkill(db);
  if (!activeName) return basePrompt;

  // 3. 查 skill 行（不存在 → fallback base + 记 friction，反向 3）
  const row = db
    .select()
    .from(skillsTable)
    .where(eq(skillsTable.name, activeName))
    .get();
  if (!row) {
    logFriction(db, null, `active_skill "${activeName}" 不在 skills 表里，fallback 到 base prompt`);
    return basePrompt;
  }

  // 4. 从 skill 的 raw（含 frontmatter）解析出纯 body，注入 base 后面
  const parsed = parseSkillFrontmatter(row.body);
  const skillBody = parsed.body.trim();
  if (!skillBody) return basePrompt;

  return `${basePrompt}\n\n${skillBody}`;
}

/**
 * 测试辅助：直接写 settings 表的 flag 行（不走 flags.ts，避免引入 getDb 依赖）。
 * 生产代码用 src/main/services/flags.ts 的 setFlag，那是同一份 settings 行。
 */
export function setFlagForTest(
  db: Db,
  name: "skill_system",
  on: boolean,
): void {
  const key = `flag_${name}`;
  db.insert(settingsTable)
    .values({ key, value: String(on), isSecret: false })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: String(on), isSecret: false },
    })
    .run();
}

/* ---------- 内部 ---------- */

function readFlag(db: Db): boolean {
  const row = db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, FLAG_KEY))
    .get();
  return row?.value === "true";
}

function logFriction(db: Db, nodeId: string | null, summary: string): void {
  // P3: 不再把 skill 名塞进 nodeId 列(agent_error 是系统级,nodeId 应留 null;真实节点卡点走 friction:log)。
  insertFrictionDb(db, nodeId, "agent_error", summary);
}
