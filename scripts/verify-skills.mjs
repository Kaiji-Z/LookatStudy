/**
 * M1 Skill 系统回归套件 —— VERIFICATION §8.5 的 7 条验收标准，每条对应一个测试组。
 *
 * 这是 §5 SOP step 1：先写回归，再写 feature。当前应该是 RED（实现还没写），
 * 实现（skill-service.ts / prompt-builder.ts / pure/skill-frontmatter.ts）写完后变 GREEN。
 *
 * 覆盖：
 *   §8.5 正向 1-4：激活持久化 / 默认 null / 真注入 / flag gating
 *   §8.5 反向 1-3：无静默切换 / flag=off 无泄漏 / 未解析 skill 不崩不空 prompt
 *   附带：frontmatter 解析器（plain/quoted/block 三形态）+ 4 个内置 skill 在表里
 *
 * 测试用真实 sql.js DB + 真实 drizzle 调真实服务函数 —— VERIFICATION §3.1，测源码非副本。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { parseSkillFrontmatter } from "../src/main/services/pure/skill-frontmatter.ts";
import {
  listSkills,
  getSkill,
  createSkill,
  setActiveSkill,
  getActiveSkill,
  seedBuiltinSkills,
} from "../src/main/services/skills/skill-service.ts";
import { buildSystemPrompt } from "../src/main/services/skills/prompt-builder.ts";
import { setFlagForTest } from "../src/main/services/skills/prompt-builder.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// 建真实 DB + schema
async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
  sqljs.run(schemaSql);
  return { db: drizzle(sqljs, { schema }), sqljs };
}

// ============================================================
// §0 frontmatter 解析器 —— 纯函数，直接测
// ============================================================

// T0a: plain 单行 description
const plain = parseSkillFrontmatter(
  "---\nname: socratic-mode\ndescription: 苏格拉底式引导\n---\n# 正文\n规则1",
);
assert.strictEqual(plain.name, "socratic-mode");
assert.strictEqual(plain.description, "苏格拉底式引导");
assert.ok(plain.body.includes("# 正文"), "T0a: body 应含正文");
console.log(`✓ T0a frontmatter(plain): name/description/body 解析正确`);

// T0b: 双引号 description
const quoted = parseSkillFrontmatter(
  `---
name: exam-prep-mode
description: "考试冲刺，计时无提示"
---
body`,
);
assert.strictEqual(quoted.name, "exam-prep-mode");
assert.strictEqual(quoted.description, "考试冲刺，计时无提示");
console.log(`✓ T0b frontmatter(quoted): 引号被剥离`);

// T0c: | block scalar description（多行）
const block = parseSkillFrontmatter(
  `---
name: project-mode
description: |
  项目实战模式。
  布置动手任务。
---
body`,
);
assert.strictEqual(block.name, "project-mode");
assert.ok(block.description.includes("项目实战模式"), "T0c: block 描述应含首行");
assert.ok(block.description.includes("动手任务"), "T0c: block 描述应含续行");
console.log(`✓ T0c frontmatter(|block): 多行描述折叠正确`);

// T0d: 无 frontmatter —— 整段当 body，name/description 为空
const noFm = parseSkillFrontmatter("just some markdown");
assert.strictEqual(noFm.name, "");
assert.strictEqual(noFm.description, "");
assert.strictEqual(noFm.body, "just some markdown");
console.log(`✓ T0d frontmatter(无): 退化为纯 body`);

// ============================================================
// §8.5 正向 —— 激活 / 默认 / 真注入 / flag gating
// ============================================================

let { db } = await makeDb();
seedBuiltinSkills(db);

// 预置：4 个内置 skill 都在表里
const all = listSkills(db);
assert.ok(all.length >= 4, `预置: 应有 ≥4 个内置 skill, 实际 ${all.length}`);
assert.ok(getSkill(db, "socratic-mode"), "预置: socratic-mode 存在");
console.log(`✓ 预置: ${all.length} 个内置 skill 已 seed（含 socratic/exam-prep/project/review）`);

// 正向 1: 激活可持久化
setActiveSkill(db, "socratic-mode");
assert.strictEqual(getActiveSkill(db), "socratic-mode", "正向1: 写后读回应一致");
console.log(`✓ §8.5 正向1 激活持久化: setActive → getActive 读回 "socratic-mode"`);

// 正向 2: 全新 DB 默认 null
const fresh = await makeDb();
assert.strictEqual(getActiveSkill(fresh.db), null, "正向2: 未激活时应为 null");
console.log(`✓ §8.5 正向2 默认 null: 全新 DB 无 active_skill`);

// 正向 3: 真注入 —— flag=on + 有 active skill 时，prompt 含 skill body 特征串
setFlagForTest(fresh.db, "skill_system", true);
seedBuiltinSkills(fresh.db);
setActiveSkill(fresh.db, "socratic-mode");
const promptWithSkill = buildSystemPrompt(fresh.db, "你是学习助手。");
const socraticSkill = getSkill(fresh.db, "socratic-mode");
// DB 存的是完整 raw（含 frontmatter）；prompt 注入的是解析后的纯 body。
// 锚点取 socratic-mode body 里的一句独有规则"不要直接给答案"
const anchor = "不要直接给答案";
assert.ok(
  socraticSkill.body.includes(anchor),
  "正向3 (setup): socratic-mode raw 应含特征串",
);
assert.ok(
  promptWithSkill.includes(anchor),
  `正向3: prompt 应含 skill body 特征串"${anchor}"。prompt 头部=${promptWithSkill.slice(0, 80)}`,
);
assert.ok(promptWithSkill.includes("你是学习助手。"), "正向3: base prompt 仍保留");
console.log(`✓ §8.5 正向3 真注入: flag=on 时 skill body 特征串出现在 system prompt 里`);

// 正向 4: flag gating —— flag=off 时，即使设了 skill，prompt 也只有 base
setFlagForTest(fresh.db, "skill_system", false);
const promptFlagOff = buildSystemPrompt(fresh.db, "你是学习助手。");
assert.strictEqual(
  promptFlagOff,
  "你是学习助手。",
  "正向4: flag=off 时 prompt 应等于 base（无任何 skill 内容）",
);
console.log(`✓ §8.5 正向4 flag gating: flag=off → prompt 严格等于 base`);

// ============================================================
// §8.5 反向 —— 无静默切换 / flag=off 无泄漏 / 未解析 skill 不崩
// ============================================================

// 反向 1: 无 setActiveSkill 时，连续两次 buildSystemPrompt 用同一个 skill（不漂移）
setFlagForTest(fresh.db, "skill_system", true);
const p1 = buildSystemPrompt(fresh.db, "base");
const p2 = buildSystemPrompt(fresh.db, "base");
assert.strictEqual(p1, p2, "反向1: 两次构造应完全一致（active skill 不许自己变）");
console.log(`✓ §8.5 反向1 无静默切换: 连续两次 buildSystemPrompt 结果相同`);

// 反向 2: flag=off 时 skill body 绝不泄漏进 prompt
setFlagForTest(fresh.db, "skill_system", false);
const leaked = buildSystemPrompt(fresh.db, "base prompt");
assert.ok(
  !leaked.includes("不要直接给答案"),
  "反向2: flag=off 时 skill body 特征串不许出现在 prompt 里",
);
console.log(`✓ §8.5 反向2 flag=off 无泄漏: skill body 特征串未出现在 prompt`);

// 反向 3: active_skill 指向不存在的 skill 名 → fallback 到 base prompt（不崩、不空）
setFlagForTest(fresh.db, "skill_system", true);
// 直接写一个不存在的 active_skill 名
fresh.sqljs.run(
  `INSERT INTO settings (key, value, is_secret) VALUES ('active_skill', 'ghost-mode-no-such-skill', 0)
   ON CONFLICT(key) DO UPDATE SET value='ghost-mode-no-such-skill'`,
);
const promptFallback = buildSystemPrompt(fresh.db, "base prompt fallback");
assert.strictEqual(
  promptFallback,
  "base prompt fallback",
  "反向3: 未解析 skill 时应 fallback 到 base prompt",
);
console.log(`✓ §8.5 反向3 未解析 skill fallback: 指向不存在 skill → 回退 base prompt（不崩不空）`);

// ============================================================
// 附加：用户自定义 skill 的 createSkill
// ============================================================
const custom = createSkill(fresh.db, {
  name: "my-mode",
  description: "用户自定义",
  type: "user-custom",
  body: "# 我的模式\n自定义规则",
});
assert.ok(custom.id, "附加: createSkill 返回带 id");
assert.strictEqual(getSkill(fresh.db, "my-mode")?.name, "my-mode");
console.log(`✓ 附加 createSkill: 用户自定义 skill 可创建并读回`);

console.log("\n=== ALL SKILL SYSTEM TESTS PASSED ✅ ===");
