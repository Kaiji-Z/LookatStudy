/**
 * SQLite 数据库连接（sql.js 实现）—— 主进程唯一入口。
 *
 * 为什么用 sql.js 而不是 better-sqlite3？
 * 因为 better-sqlite3 是 native 模块，在 Windows + Node 24 + 某些 VS Build Tools
 * 配置下会因 ClangCL 缺失或证书问题编译失败。这对开源项目的贡献者和最终用户
 * 都是巨大门槛（"clone 下来装不上"）。
 *
 * sql.js 是 SQLite 编译成 WASM 的纯 JS 包，零 native 依赖，双击安装包就能跑。
 * 代价：是内存数据库，需要手动持久化到磁盘。我们用防抖自动保存（500ms）封装掉。
 *
 * DB 文件位置：app.getPath('userData')/lookatstudy.db
 */
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import { app } from "electron";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as schema from "./schema.js";

// vite ?raw import：构建时把 schema.sql 内容内联成字符串。
// 这是 schema 的唯一来源 —— schema.ts 和 verify-db.mjs 都从此派生。
import schemaSql from "./schema.sql?raw";

/**
 * 定位 sql.js 的 wasm 文件所在目录。
 * - vite 编译后 __dirname 是 dist-electron/main/，向上一级到项目根再进 node_modules
 * - require.resolve 优先尝试（dev 时 node_modules 在标准位置）
 */
function locateWasm(): string {
  // 主进程是 CJS（vite.config.ts output.format='cjs'），require.resolve 可用
  try {
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    return dirname(wasmPath);
  } catch {
    // 兜底：__dirname 是 dist-electron/main/，退两级到项目根
    return join(__dirname, "../../node_modules/sql.js/dist");
  }
}

let _db: SQLJsDatabase<typeof schema> | null = null;
let _sqljs: Database | null = null;
let _sqlStatic: SqlJsStatic | null = null;
let _dbPath = "";
let _saveTimer: NodeJS.Timeout | null = null;

export function getDb(): SQLJsDatabase<typeof schema> {
  if (!_db) throw new Error("DB not initialized. Call initDb() first.");
  return _db;
}

/**
 * 标记数据库已修改，触发防抖保存。
 * 所有写 IPC handler 在 mutation 后调一次。
 */
export function markDirty(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flushDb, 500);
}

/** 立即同步到磁盘（app 退出前必调） */
export function flushDb(): void {
  if (!_sqljs || !_dbPath) return;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  const data = _sqljs.export();
  writeFileSync(_dbPath, Buffer.from(data));
}

export async function initDb(): Promise<void> {
  if (_db) return;

  const userDataDir = app.getPath("userData");
  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true });
  }
  _dbPath = join(userDataDir, "lookatstudy.db");

  _sqlStatic = await initSqlJs({ locateFile: (file: string) => join(locateWasm(), file) });

  if (existsSync(_dbPath)) {
    const buffer = readFileSync(_dbPath);
    _sqljs = new _sqlStatic.Database(new Uint8Array(buffer));
  } else {
    _sqljs = new _sqlStatic.Database();
  }

  _sqljs.exec("PRAGMA foreign_keys = ON;");

  _db = drizzle(_sqljs, { schema });

  runMigrations(_sqljs);

  // app 退出前同步落盘
  app.on("before-quit", flushDb);
}

/**
 * 跑 schema.sql 建表（新库）+ 幂等列迁移（已有库）。
 *
 * schema.sql 用 CREATE TABLE IF NOT EXISTS 处理新表；
 * 但 SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS，
 * 所以对 v2 新增列用 PRAGMA table_info 检测后再 ALTER。
 */
function runMigrations(db: Database): void {
  // 1. 执行 schema.sql（CREATE TABLE IF NOT EXISTS 对新库生效，对已有表无副作用）
  db.run(schemaSql);

  // 2. 幂等加列：v2 给已有表新增的列（老库迁移）
  const addColumnIfMissing = (table: string, column: string, def: string) => {
    const cols = db.exec(`PRAGMA table_info(${table})`);
    if (cols.length === 0) return; // 表不存在（不应该，但兜底）
    const names = cols[0].values.map((row) => row[1]);
    if (!names.includes(column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  };

  // v2 新列
  addColumnIfMissing("courses", "lab_type", "TEXT NOT NULL DEFAULT 'doc'");
  addColumnIfMissing("chat_sessions", "provider", "TEXT");
  addColumnIfMissing("chat_sessions", "active_skill", "TEXT");
  // M2 新列：BKT 掌握度
  addColumnIfMissing("progress", "mastery", "REAL");
  // 课节摘要(LLM 生成,导入时批量填)
  addColumnIfMissing("content_nodes", "summary", "TEXT");
  // v0.3 康奈尔笔记法:canvas_items 加溯源 + 练习记录字段
  addColumnIfMissing("canvas_items", "source_type", "TEXT");
  addColumnIfMissing("canvas_items", "source_anchor", "TEXT");
  addColumnIfMissing("canvas_items", "last_result", "TEXT");
  addColumnIfMissing("canvas_items", "result_at", "TEXT");

  // 考试节点(type='exam'):老库的 content_nodes CHECK 约束不含 'exam',
  // 需重建表加约束(SQLite 不能 ALTER CHECK)。幂等:检测现有 CHECK 是否已含 'exam'。
  ensureExamTypeAllowed(db);
}

/** 重建 content_nodes 表以加入 'exam' 到 type CHECK 约束(SQLite 不能直接改 CHECK)。
 *  幂等:若现有 CHECK 已含 'exam' 则跳过。 */
function ensureExamTypeAllowed(db: Database): void {
  // 查现有表 schema,看 CHECK 里有没有 'exam'
  const schemaRows = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='content_nodes'`);
  if (schemaRows.length === 0) return; // 表不存在(新库由 schema.sql 建,已含 exam)
  const currentSchema = String(schemaRows[0].values[0][0] ?? "");
  if (currentSchema.includes("'exam'")) return; // 已有 exam 约束,无需迁移

  // SQLite 重建表标准流程:建临时表 → 复制 → 删旧 → 重命名。
  // 外键引用(threads.focus_node_id 等)在 sql.js 下不受影响(没有 ON UPDATE CASCADE 需求,id 不变)。
  db.run(`CREATE TABLE content_nodes_new (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    parent_id TEXT,
    type TEXT NOT NULL CHECK (type IN ('section', 'lesson', 'concept', 'exam')),
    title TEXT NOT NULL,
    source_path TEXT,
    order_idx INTEGER NOT NULL DEFAULT 0,
    content TEXT
  )`);
  db.run(`INSERT INTO content_nodes_new SELECT * FROM content_nodes`);
  db.run(`DROP TABLE content_nodes`);
  db.run(`ALTER TABLE content_nodes_new RENAME TO content_nodes`);
  // 重建索引(原索引随 DROP TABLE 消失)
  db.run(`CREATE INDEX IF NOT EXISTS idx_content_nodes_course ON content_nodes(course_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_content_nodes_parent ON content_nodes(parent_id)`);
}
