/**
 * verify-db-migration —— 数据层安全/健壮性套件(2026-09-13 安全审计 · WP3)。
 *
 *   T1  老库迁移行为测试(真 sql.js):构造 pre-exam 时代 8 列 content_nodes +
 *       子表行 → ensureExamTypeAllowed → 不抛错(旧实现"12 values for 8 columns"
 *       必炸=启动失败死循环)、行数保留、exercises 不被级联清空、CHECK 含 exam、
 *       幂等二跑、迁移后 FK 级联仍生效
 *   T2  flushDb 原子写源级守卫:tmp+renameSync + 失败重试不裸抛(审计 P0/P1)
 *   T3  exam 题库链 markDirty:handler 透传 + 删旧题/落库完成两个写点标脏(审计 F6)
 *   T4  autoStructureCourse 的 KC/摘要批量生成后 markDirty(两条路径,审计 F7)
 *   T5  本套件已注册 verify:core
 *
 * 运行:npx tsx scripts/verify-db-migration.mjs(真 sql.js,不依赖 Electron)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`✓ ${name}`);
    pass++;
  } else {
    console.error(`✗ ${name}${detail ? `: ${detail}` : ""}`);
    fail++;
  }
}

const initSqlJs = (await import("sql.js")).default;
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const { ensureExamTypeAllowed } = await import("../src/main/db/migrate-content-nodes.ts");
const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");

/** 构造"pre-exam 时代老库":全套表建好后,把 content_nodes 降级回 8 列旧形状,
 *  再模拟 addColumnIfMissing 补齐 v2 四列(真实时序:迁移先加列后重建表)。 */
function buildLegacyDb() {
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON;");
  db.run(schemaSql);
  db.run("DROP TABLE content_nodes");
  db.run(`CREATE TABLE content_nodes (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    parent_id TEXT,
    type TEXT NOT NULL CHECK (type IN ('section', 'lesson', 'concept')),
    title TEXT NOT NULL,
    source_path TEXT,
    order_idx INTEGER NOT NULL DEFAULT 0,
    content TEXT
  )`);
  db.run("ALTER TABLE content_nodes ADD COLUMN summary TEXT");
  db.run("ALTER TABLE content_nodes ADD COLUMN summary_en TEXT");
  db.run("ALTER TABLE content_nodes ADD COLUMN world TEXT NOT NULL DEFAULT 'study'");
  db.run("ALTER TABLE content_nodes ADD COLUMN knowledge_points TEXT");
  db.run("INSERT INTO courses (id, repo_url, repo_name, title, description, version) VALUES ('c1','u','n','T','d',1)");
  db.run("INSERT INTO content_nodes (id, course_id, parent_id, type, title, source_path, order_idx, content, world) VALUES ('n1','c1',NULL,'section','S',NULL,0,NULL,'study')");
  db.run("INSERT INTO content_nodes (id, course_id, parent_id, type, title, source_path, order_idx, content, world) VALUES ('n2','c1','n1','lesson','L',NULL,1,'body','study')");
  db.run("INSERT INTO exercises (id, node_id, type, prompt, answer, options_json, ai_generated) VALUES ('e1','n2','mcq','p','a','[]',1)");
  // v2 列的真实数据:迁移必须逐列保真(具名拷贝截断=静默丢数据,不报错——必须锁)
  db.run("UPDATE content_nodes SET summary='sm', summary_en='se', knowledge_points='[]' WHERE id='n2'");
  return db;
}

// ── T1 老库迁移行为 ──
{
  const db = buildLegacyDb();
  let threw = null;
  try {
    ensureExamTypeAllowed(db);
  } catch (e) {
    threw = e;
  }
  check("T1 老库迁移不抛错(旧实现 12 values for 8 columns 必炸)", threw === null, threw?.message ?? "");

  const cnt = db.exec("SELECT COUNT(*) FROM content_nodes")[0].values[0][0];
  check("T1 节点行数保留", cnt === 2, `实际 ${cnt}`);

  const ex = db.exec("SELECT COUNT(*) FROM exercises WHERE node_id='n2'")[0].values[0][0];
  check("T1 exercises 子表未被级联清空(旧实现在 FK=ON 下 DROP 会清 8 张子表)", ex === 1, `实际 ${ex}`);

  const ddl = String(db.exec("SELECT sql FROM sqlite_master WHERE name='content_nodes'")[0].values[0][0]);
  check("T1 新 CHECK 含 exam", ddl.includes("'exam'"));

  const v2 = db.exec("SELECT summary, summary_en, world, knowledge_points FROM content_nodes WHERE id='n2'")[0].values[0];
  check("T1 v2 列数据逐列保真(summary/summary_en/world/knowledge_points)", v2.join("|") === "sm|se|study|[]", `实际 ${v2.join("|")}`);

  let threw2 = null;
  try {
    ensureExamTypeAllowed(db);
  } catch (e) {
    threw2 = e;
  }
  check("T1 幂等二跑不抛", threw2 === null, threw2?.message ?? "");

  db.run("DELETE FROM courses WHERE id='c1'");
  const after = db.exec("SELECT COUNT(*) FROM content_nodes")[0].values[0][0];
  check("T1 迁移后 FK 级联仍生效(删课程连带删节点)", after === 0, `实际 ${after}`);
}

// ── T2 flushDb 原子写源级守卫 ──
{
  const src = read("src/main/db/index.ts");
  check("T2 flushDb 走 tmp+renameSync", src.includes("writeFileSync(tmp") && src.includes("renameSync(tmp, _dbPath)"));
  check("T2 flushDb 失败不裸抛(重试而非 uncaughtException)", src.includes("flushDb 落盘失败") && /setTimeout\(flushDb, 2000\)/.test(src));
}

// ── T3 exam 题库链 markDirty ──
{
  const svc = read("src/main/services/exam-service.ts");
  const ipc = read("src/main/ipc/index.ts");
  check("T3 prepare/regenerate 签名收 markDirty", svc.includes("prepareExam(db: Db, examNodeId: string, locale?: string | null, markDirty?") && svc.includes("regenerateExam(db: Db, examNodeId: string, locale?: string | null, markDirty?"));
  check("T3 后台落库完成标脏", svc.includes("markDirty?.(); // 题库落库完成立即标脏"));
  check("T3 删旧题标脏", svc.includes("markDirty?.(); // 删旧题立即标脏"));
  check("T3 handler 透传 markDirty", ipc.includes("prepareExam(getDb(), examNodeId, locale, markDirty)") && ipc.includes("regenerateExam(getDb(), examNodeId, locale, markDirty)"));
}

// ── T4 autoStructureCourse KC/摘要批量生成后标脏 ──
{
  const ipc = read("src/main/ipc/index.ts");
  const hits = ipc.split("markDirty(); // KC/摘要批量落库即标脏").length - 1;
  check("T4 两条结构化路径均补 markDirty(路径 A well-organized + 路径 B 重组)", hits === 2, `实际 ${hits} 处`);
}

// ── T5 注册 ──
{
  const pkg = JSON.parse(read("package.json"));
  check("T5 本套件已注册 verify:core", pkg.scripts["verify:core"].includes("verify-db-migration"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
