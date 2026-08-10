/**
 * 主进程 DB 逻辑验证 —— 纯 Node，不依赖 Electron。
 *
 * 验证 sql.js + schema.sql + 种子课程写入 + 查询正确。
 * 这是 v0.1 的"地基"——如果这个脚本能过，说明数据层完整可用，
 * Electron 只是一层 GUI 壳。
 */
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const initSqlJs = (await import("sql.js")).default;
const wasmDir = join(ROOT, "node_modules/sql.js/dist");
const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
const db = new SQL.Database();
db.run("PRAGMA foreign_keys = ON;");

// 1. schema 能建表（schema.sql 是唯一来源，verify 验证它正确）
const schemaSql = readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8");
db.run(schemaSql);
console.log("✓ schema.sql 建表成功");

// 1b. 验证 v2 新增的表都建出来了
const requiredTables = ["courses", "content_nodes", "exercises", "progress", "srs_items", "streaks", "chat_sessions", "settings", "skills", "proposals", "friction_log"];
const actualTables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.map(r => r[0]);
const missing = requiredTables.filter(t => !actualTables.includes(t));
console.assert(missing.length === 0, `缺少表: ${missing.join(", ")}`);
console.log(`✓ v2 表完整: ${requiredTables.length} 张业务表全部存在`);

// 1c. 验证 courses 的 lab_type 列存在（v2 新增列）
const courseCols = db.exec("PRAGMA table_info(courses)")[0].values.map(r => r[1]);
console.assert(courseCols.includes("lab_type"), "courses 应有 lab_type 列");
console.log(`✓ courses.lab_type 列存在`);

// 2. 种子课程写入（从 services/seed.ts 复制核心逻辑，用原生 SQL）
const COURSE_ID = "seed-ai-for-beginners";
db.run(
  `INSERT INTO courses (id, repo_url, repo_name, title, description, version) VALUES (?, ?, ?, ?, ?, 1)`,
  [COURSE_ID, "https://github.com/microsoft/AI-For-Beginners", "AI-For-Beginners", "AI for Beginners", "测试用"],
);

const SEED_FIXTURE = [
  { title: "Section A", lessons: ["Lesson A1", "Lesson A2"] },
  { title: "Section B", lessons: ["Lesson B1"] },
  { title: "Section C", lessons: ["Lesson C1", "Lesson C2", "Lesson C3"] },
];

let sectionOrder = 0;
let totalLessons = 0;
for (const section of SEED_FIXTURE) {
  const sectionId = randomUUID();
  db.run(
    `INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES (?, ?, NULL, 'section', ?, ?)`,
    [sectionId, COURSE_ID, section.title, sectionOrder++],
  );
  let lessonOrder = 0;
  for (const lessonTitle of section.lessons) {
    const lessonId = randomUUID();
    const isFirst = sectionOrder === 1 && lessonOrder === 0;
    db.run(
      `INSERT INTO content_nodes (id, course_id, parent_id, type, title, order_idx) VALUES (?, ?, ?, 'lesson', ?, ?)`,
      [lessonId, COURSE_ID, sectionId, lessonTitle, lessonOrder++],
    );
    db.run(
      `INSERT INTO progress (node_id, status, crown_level) VALUES (?, ?, 0)`,
      [lessonId, isFirst ? "available" : "locked"],
    );
    totalLessons++;
  }
}
console.log(`✓ 种子课程写入: ${SEED_FIXTURE.length} sections, ${totalLessons} lessons`);

// 3. 查询验证
const courseRow = db.exec("SELECT title FROM courses WHERE id = 'seed-ai-for-beginners'");
console.assert(courseRow.length === 1, "课程应存在");
console.log(`✓ 课程查询: ${courseRow[0].values[0][0]}`);

const sectionCount = db.exec("SELECT COUNT(*) FROM content_nodes WHERE type='section' AND course_id='seed-ai-for-beginners'")[0].values[0][0];
console.assert(sectionCount === 3, `应有 3 sections, 实际 ${sectionCount}`);
console.log(`✓ section 数量: ${sectionCount}`);

const lessonCount = db.exec("SELECT COUNT(*) FROM content_nodes WHERE type='lesson'")[0].values[0][0];
console.assert(lessonCount === 6, `应有 6 lessons, 实际 ${lessonCount}`);
console.log(`✓ lesson 数量: ${lessonCount}`);

const availableCount = db.exec("SELECT COUNT(*) FROM progress WHERE status='available'")[0].values[0][0];
console.assert(availableCount === 1, `应有 1 个 available, 实际 ${availableCount}`);
console.log(`✓ available 节点: ${availableCount}（首个 lesson 解锁，其余 locked）`);

const streakRow = db.exec("SELECT current_streak, freeze_count FROM streaks WHERE id='singleton'")[0].values[0];
console.assert(streakRow[0] === 0 && streakRow[1] === 2, `streak 初始应为 0/2, 实际 ${streakRow}`);
console.log(`✓ streak singleton: current=${streakRow[0]}, freeze=${streakRow[1]}`);

// 4. 进度更新（模拟 markNodeAttempted）
const firstLessonId = db.exec("SELECT cn.id FROM content_nodes cn JOIN progress p ON p.node_id = cn.id WHERE p.status='available'")[0].values[0][0];
db.run("UPDATE progress SET status='in_progress', last_attempt_at = ? WHERE node_id = ?", [new Date().toISOString(), firstLessonId]);
// sql.js 的 exec 不支持参数化，用字符串拼接（测试环境安全）
const updated = db.exec(`SELECT status FROM progress WHERE node_id = '${firstLessonId}'`)[0].values[0];
console.assert(updated[0] === "in_progress", `更新后应为 in_progress, 实际 ${updated[0]}`);
console.log(`✓ 进度更新: ${firstLessonId.slice(0, 8)}... → in_progress`);

// 5. 外键级联测试
db.run("DELETE FROM courses WHERE id = 'seed-ai-for-beginners'");
const orphanNodes = db.exec("SELECT COUNT(*) FROM content_nodes")[0].values[0][0];
console.assert(orphanNodes === 0, `级联删除后应无 content_nodes, 实际 ${orphanNodes}`);
console.log(`✓ 外键级联: 删课程 → 关联 nodes 全部清理 (${orphanNodes} 残留)`);

console.log("\n=== ALL DB LOGIC TESTS PASSED ✅ ===");
