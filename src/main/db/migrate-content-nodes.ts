import type { Database } from "sql.js";

/**
 * 重建 content_nodes 表以加入 'exam' 到 type CHECK 约束(SQLite 不能直接改 CHECK)。
 * 幂等:若现有 CHECK 已含 'exam' 则跳过。
 *
 * 从 db/index.ts 抽出为独立模块:不带 schema.sql?raw 导入链,verify 可直接
 * import 做老库迁移行为测试。2026-09-13 审计修复旧实现三处错:
 *  1) 临时表只定义 8 列,而走到这里的旧库已被 runMigrations 上方的 addColumnIfMissing
 *     补到 12 列,`INSERT ... SELECT *` 必然报"12 values for 8 columns"
 *     → 老库升级启动失败死循环;
 *  2) PRAGMA foreign_keys=ON 时 DROP TABLE 触发隐式 DELETE,级联清空
 *     exercises/progress/srs_items/knowledge_component_mastery/exam_attempts/
 *     node_assets/chat_sessions/content_node_translations 等子表
 *     (旧注释声称"外键不受影响"是错的)——重建期间必须先关 FK;
 *  3) 全程无事务,中途失败留半态。
 */
export function ensureExamTypeAllowed(db: Database): void {
  const schemaRows = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='content_nodes'`);
  if (schemaRows.length === 0) return; // 表不存在(新库由 schema.sql 建,已含 exam)
  const currentSchema = String(schemaRows[0].values[0][0] ?? "");
  if (currentSchema.includes("'exam'")) return; // 已有 exam 约束,无需迁移

  const cols = [
    "id",
    "course_id",
    "parent_id",
    "type",
    "title",
    "source_path",
    "order_idx",
    "content",
    "summary",
    "summary_en",
    "world",
    "knowledge_points",
  ];

  // PRAGMA foreign_keys 在事务内是 no-op,必须在 BEGIN 之前关
  db.run(`PRAGMA foreign_keys = OFF`);
  db.run(`BEGIN`);
  try {
    db.run(`CREATE TABLE content_nodes_new (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      parent_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('section', 'lesson', 'concept', 'exam')),
      title TEXT NOT NULL,
      source_path TEXT,
      order_idx INTEGER NOT NULL DEFAULT 0,
      content TEXT,
      summary TEXT,
      summary_en TEXT,
      world TEXT NOT NULL DEFAULT 'study' CHECK (world IN ('study', 'practice')),
      knowledge_points TEXT
    )`);
    db.run(`INSERT INTO content_nodes_new (${cols.join(", ")}) SELECT ${cols.join(", ")} FROM content_nodes`);
    db.run(`DROP TABLE content_nodes`);
    db.run(`ALTER TABLE content_nodes_new RENAME TO content_nodes`);
    // 重建索引(原索引随 DROP TABLE 消失)
    db.run(`CREATE INDEX IF NOT EXISTS idx_content_nodes_course ON content_nodes(course_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_content_nodes_parent ON content_nodes(parent_id)`);
    db.run(`COMMIT`);
  } catch (e) {
    db.run(`ROLLBACK`);
    db.run(`PRAGMA foreign_keys = ON`);
    throw e;
  }
  db.run(`PRAGMA foreign_keys = ON`);
}
