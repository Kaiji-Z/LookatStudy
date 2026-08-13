/**
 * Soul 系统回归套件 —— VERIFICATION §8.5 验收标准。
 *
 * 由 verify-skills.mjs 重构而来：原 "skill"(教学模式)正名为 "soul"(教学人设/persona)。
 * 真 skill(过程性多步 playbook)是未来模块,本套件只覆盖 soul。
 *
 * §5 SOP step 1：先写回归,再写 feature。当前应为 RED（实现还没改名），
 * 实现（souls/soul-service.ts / souls/prompt-builder.ts / pure/frontmatter.ts）写完后变 GREEN。
 *
 * 覆盖（原 §8.5,去掉已删除的 flag gating）：
 *   正向 1-3：激活持久化 / 默认 null / 真注入（active soul 时 body 特征串进 prompt）
 *   反向 1-2：无静默切换 / active 指向不存在的 soul → fallback base（不崩不空）
 *   附带：frontmatter 解析器（plain/quoted/block/无）+ 3 个内置 soul 在表里 + 用户自定义 createSoul
 *
 * flag_skill_system 已删除（soul 注入常开；active_soul=null 时返回 base,等价于"关闭"）。
 * 测试用真实 sql.js DB + 真实 drizzle 调真实服务函数 —— VERIFICATION §3.1,测源码非副本。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { parseFrontmatter } from "../src/main/services/pure/frontmatter.ts";
import {
  listSouls,
  getSoul,
  createSoul,
  setActiveSoul,
  getActiveSoul,
  seedBuiltinSouls,
} from "../src/main/services/souls/soul-service.ts";
import { buildSystemPrompt } from "../src/main/services/souls/prompt-builder.ts";

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
// §0 frontmatter 解析器 —— 纯函数,直接测
// ============================================================

// T0a: plain 单行 description
const plain = parseFrontmatter(
  "---\nname: direct\ndescription: 精讲派,先讲清楚\n---\n# 正文\n规则1",
);
assert.strictEqual(plain.name, "direct");
assert.strictEqual(plain.description, "精讲派,先讲清楚");
assert.ok(plain.body.includes("# 正文"), "T0a: body 应含正文");
console.log(`✓ T0a frontmatter(plain): name/description/body 解析正确`);

// T0b: 双引号 description
const quoted = parseFrontmatter(
  `---
name: guide
description: "引导派,递台阶不递答案"
---
body`,
);
assert.strictEqual(quoted.name, "guide");
assert.strictEqual(quoted.description, "引导派,递台阶不递答案");
console.log(`✓ T0b frontmatter(quoted): 引号被剥离`);

// T0c: | block scalar description（多行）
const block = parseFrontmatter(
  `---
name: practice
description: |
  实战派。
  围绕真实世界乱问题。
---
body`,
);
assert.strictEqual(block.name, "practice");
assert.ok(block.description.includes("实战派"), "T0c: block 描述应含首行");
assert.ok(block.description.includes("真实世界"), "T0c: block 描述应含续行");
console.log(`✓ T0c frontmatter(|block): 多行描述折叠正确`);

// T0d: 无 frontmatter —— 整段当 body,name/description 为空
const noFm = parseFrontmatter("just some markdown");
assert.strictEqual(noFm.name, "");
assert.strictEqual(noFm.description, "");
assert.strictEqual(noFm.body, "just some markdown");
console.log(`✓ T0d frontmatter(无): 退化为纯 body`);

// ============================================================
// 正向 —— 激活 / 默认 / 真注入
// ============================================================

let { db } = await makeDb();
seedBuiltinSouls(db);

// 预置:3 个内置 soul 都在表里
const all = listSouls(db);
assert.ok(all.length >= 3, `预置: 应有 ≥3 个内置 soul, 实际 ${all.length}`);
assert.ok(getSoul(db, "direct"), "预置: direct 存在");
assert.ok(getSoul(db, "guide"), "预置: guide 存在");
assert.ok(getSoul(db, "practice"), "预置: practice 存在");
console.log(`✓ 预置: ${all.length} 个内置 soul 已 seed（direct/guide/practice）`);

// 正向 1: 激活可持久化
setActiveSoul(db, "direct");
assert.strictEqual(getActiveSoul(db), "direct", "正向1: 写后读回应一致");
console.log(`✓ 正向1 激活持久化: setActiveSoul → getActiveSoul 读回 "direct"`);

// 正向 2: 全新 DB 默认 null（无 active_soul = 用 base prompt,等价"关闭"）
const fresh = await makeDb();
assert.strictEqual(getActiveSoul(fresh.db), null, "正向2: 未激活时应为 null");
console.log(`✓ 正向2 默认 null: 全新 DB 无 active_soul`);

// 正向 3: 真注入 —— 有 active soul 时,prompt 含该 soul body 的特征串
seedBuiltinSouls(fresh.db);
setActiveSoul(fresh.db, "direct");
const promptWithSoul = buildSystemPrompt(fresh.db, "你是学习助手。");
const directSoul = getSoul(fresh.db, "direct");
// 锚点取 direct soul body 里一句独有规则
const anchor = "先讲清楚";
assert.ok(
  directSoul.body.includes(anchor),
  "正向3 (setup): direct soul raw 应含特征串",
);
assert.ok(
  promptWithSoul.includes(anchor),
  `正向3: prompt 应含 soul body 特征串"${anchor}"。prompt 头部=${promptWithSoul.slice(0, 80)}`,
);
assert.ok(promptWithSoul.includes("你是学习助手。"), "正向3: base prompt 仍保留");
console.log(`✓ 正向3 真注入: 有 active soul 时 body 特征串出现在 system prompt 里`);

// 三派特征串各异(反退化:确认 3 个 soul 内容真有分化,不是复制)
const dBody = getSoul(fresh.db, "direct").body;
const gBody = getSoul(fresh.db, "guide").body;
const pBody = getSoul(fresh.db, "practice").body;
assert.ok(dBody.includes("先讲清楚") && !dBody.includes("乱问题"), "分化: direct 含讲清楚、不含乱问题");
assert.ok(gBody.includes("递台阶") && !gBody.includes("worked example"), "分化: guide 含递台阶");
assert.ok(pBody.includes("真实世界") && pBody.includes("乱问题"), "分化: practice 含真实世界乱问题");
console.log(`✓ 三派分化: direct/guide/practice 特征串各异,非复制`);

// ============================================================
// 反向 —— 无静默切换 / 未解析 soul 不崩
// ============================================================

// 反向 1: 连续两次 buildSystemPrompt 用同一个 soul（不漂移）
const p1 = buildSystemPrompt(fresh.db, "base");
const p2 = buildSystemPrompt(fresh.db, "base");
assert.strictEqual(p1, p2, "反向1: 两次构造应完全一致（active soul 不许自己变）");
console.log(`✓ 反向1 无静默切换: 连续两次 buildSystemPrompt 结果相同`);

// 反向 2: active_soul 指向不存在的 soul 名 → fallback 到 base prompt（不崩、不空）
fresh.sqljs.run(
  `INSERT INTO settings (key, value, is_secret) VALUES ('active_soul', 'ghost-no-such-soul', 0)
   ON CONFLICT(key) DO UPDATE SET value='ghost-no-such-soul'`,
);
const promptFallback = buildSystemPrompt(fresh.db, "base prompt fallback");
assert.strictEqual(
  promptFallback,
  "base prompt fallback",
  "反向2: 未解析 soul 时应 fallback 到 base prompt",
);
console.log(`✓ 反向2 未解析 soul fallback: 指向不存在 soul → 回退 base prompt（不崩不空）`);

// ============================================================
// 附加:无 active soul 时 prompt 严格等于 base（等价"关闭"语义,取代原 flag gating）
// ============================================================
const fresh2 = await makeDb();
seedBuiltinSouls(fresh2.db);
// 不设 active_soul
assert.strictEqual(
  buildSystemPrompt(fresh2.db, "纯 base"),
  "纯 base",
  "附加: 无 active soul 时 prompt 严格等于 base",
);
console.log(`✓ 附加 无 active soul = base: 等价关闭,零行为变化`);

// ============================================================
// 附加:用户自定义 soul 的 createSoul
// ============================================================
const custom = createSoul(fresh2.db, {
  name: "my-soul",
  description: "用户自定义",
  type: "custom",
  body: "# 我的灵魂\n自定义规则",
});
assert.ok(custom.id, "附加: createSoul 返回带 id");
assert.strictEqual(getSoul(fresh2.db, "my-soul")?.name, "my-soul");
console.log(`✓ 附加 createSoul: 用户自定义 soul 可创建并读回`);

// ============================================================
// 迁移专项:老库(有 skills 表 + active_skill + flag_skill_system)升级到 soul
// 与 db/index.ts migrateSoulRename 同构 —— 改迁移 SQL 要同步改这里。
// verify-souls 主体用全新 DB(schema.sql 直接建 souls),不覆盖老库升级;本节补上。
// ============================================================
const old = await makeDb();
// 模拟升级前:先 DROP 掉 schema.sql 建的空 souls/chat_sessions/settings,重建老形态
old.sqljs.run(`DROP TABLE souls`);
old.sqljs.run(`DROP TABLE chat_sessions`);
old.sqljs.run(`DROP TABLE settings`);
// 老 skills 表(旧 type CHECK)
old.sqljs.run(`CREATE TABLE skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('learning-mode', 'subject-pack', 'user-custom')),
  body TEXT NOT NULL, is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`);
old.sqljs.run(`CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, active_skill TEXT, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`);
old.sqljs.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, is_secret INTEGER NOT NULL DEFAULT 0)`);
// 新 souls 表(schema.sql 升级后会建;模拟建好后的空表)
old.sqljs.run(`CREATE TABLE souls (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('builtin', 'custom')),
  body TEXT NOT NULL, is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP))`);
// active_soul 列(模拟 addColumnIfMissing 补上的新列)
old.sqljs.run(`ALTER TABLE chat_sessions ADD COLUMN active_soul TEXT`);
// 老数据:1 个 builtin(socratic-mode) + 1 个用户自建(my-mode)
old.sqljs.run(`INSERT INTO skills (id,name,description,type,body,is_builtin) VALUES ('b1','socratic-mode','old builtin','learning-mode','# old',1)`);
old.sqljs.run(`INSERT INTO skills (id,name,description,type,body,is_builtin) VALUES ('u1','my-mode','user custom','user-custom','# mine',0)`);
old.sqljs.run(`INSERT INTO chat_sessions (id, active_skill) VALUES ('s1','my-mode')`);
old.sqljs.run(`INSERT INTO settings (key,value,is_secret) VALUES ('active_skill','socratic-mode',0)`);
old.sqljs.run(`INSERT INTO settings (key,value,is_secret) VALUES ('flag_skill_system','true',0)`);

// 跑迁移(与 migrateSoulRename 同构)
old.sqljs.run(`INSERT OR IGNORE INTO souls (id,name,description,type,body,is_builtin,created_at) SELECT id,name,description,'custom',body,0,created_at FROM skills WHERE is_builtin=0`);
old.sqljs.run(`DROP TABLE skills`);
old.sqljs.run(`UPDATE chat_sessions SET active_soul=COALESCE(active_soul,active_skill) WHERE active_soul IS NULL`);
old.sqljs.run(`INSERT INTO settings(key,value,is_secret) SELECT 'active_soul',value,is_secret FROM settings WHERE key='active_skill'`);
old.sqljs.run(`DELETE FROM settings WHERE key='active_skill'`);
old.sqljs.run(`DELETE FROM settings WHERE key='flag_skill_system'`);

// 断言
const tablesLeft = old.sqljs.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='skills'`)[0]?.values.length ?? 0;
assert.strictEqual(tablesLeft, 0, "迁移: skills 表应已 DROP");
const migratedUser = getSoul(old.db, "my-mode");
assert.ok(migratedUser, "迁移: 用户自建 my-mode 应搬进 souls");
assert.strictEqual(migratedUser.type, "custom", "迁移: 搬过来的用户 soul type=custom");
assert.strictEqual(migratedUser.isBuiltin, false, "迁移: 用户 soul isBuiltin=false");
assert.ok(!getSoul(old.db, "socratic-mode"), "迁移: 老 builtin socratic-mode 应被丢弃(由新 seed 取代)");
const sessSoul = old.sqljs.exec(`SELECT active_soul FROM chat_sessions WHERE id='s1'`)[0].values[0][0];
assert.strictEqual(sessSoul, "my-mode", "迁移: chat_sessions.active_skill 数据搬到 active_soul");
const sRow = old.sqljs.exec(`SELECT value FROM settings WHERE key='active_soul'`)[0].values[0][0];
assert.strictEqual(sRow, "socratic-mode", "迁移: settings active_skill 值搬到 active_soul");
const staleKeys = old.sqljs.exec(`SELECT COUNT(*) FROM settings WHERE key IN ('active_skill','flag_skill_system')`)[0].values[0][0];
assert.strictEqual(staleKeys, 0, "迁移: active_skill / flag_skill_system 旧 key 应已删");
console.log(`✓ 迁移专项: skills→souls(留用户自建、弃老 builtin)+ active_skill→active_soul + 删旧 flag`);

console.log("\n=== ALL SOUL SYSTEM TESTS PASSED ✅ ===");
