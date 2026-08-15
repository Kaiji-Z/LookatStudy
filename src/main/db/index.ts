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
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
 * 测试专用:注入一个内存 DB,绕过依赖 Electron app 的 initDb()。
 * 仅 verify-*.mjs 脚本使用;生产代码绝不调用。返回前一次的 db(便于还原)。
 */
export function setDbForTesting(db: SQLJsDatabase<typeof schema>): SQLJsDatabase<typeof schema> | null {
  const prev = _db;
  _db = db;
  return prev;
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

  // --ui-test 模式:独立全新 temp DB。避免持久化 userData DB 的累积状态(threads/provider/
  // SRS)污染 ui-test 断言(empty-state/keyless/due 等)。每次先删 → 全新 → ensureSeedCourse
  // + ui-test 自带 seed 重新灌,断言确定性。
  if (process.argv.includes("--ui-test") || process.argv.includes("--shots") || process.argv.includes("--shots-en")) {
    _dbPath = join(
      tmpdir(),
      process.argv.includes("--shots-en")
        ? "lookatstudy-shots-en.db"
        : process.argv.includes("--shots")
          ? "lookatstudy-shots.db"
          : "lookatstudy-uitest.db",
    );
    if (existsSync(_dbPath)) {
      try {
        rmSync(_dbPath);
      } catch {
        /* 文件锁等无法删——继续(下次尽量全新) */
      }
    }
  } else {
    const userDataDir = app.getPath("userData");
    if (!existsSync(userDataDir)) {
      mkdirSync(userDataDir, { recursive: true });
    }
    _dbPath = join(userDataDir, "lookatstudy.db");
  }

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
  // soul 重构:active_skill → active_soul(新库 schema.sql 已直接建 active_soul;
  // 老库在此补列,migrateSoulRename 再把 active_skill 数据搬过来)
  addColumnIfMissing("chat_sessions", "active_soul", "TEXT");
  // M2 新列：BKT 掌握度
  addColumnIfMissing("progress", "mastery", "REAL");
  // 课节摘要(LLM 生成,导入时批量填)
  addColumnIfMissing("content_nodes", "summary", "TEXT");
  addColumnIfMissing("content_nodes", "summary_en", "TEXT");
  // 两个世界: study(学习主线) / practice(实操练习)
  addColumnIfMissing("content_nodes", "world", "TEXT NOT NULL DEFAULT 'study'");
  // Per-KC BKT: 知识组件定义(JSON array of {title, description})
  addColumnIfMissing("content_nodes", "knowledge_points", "TEXT");
  // 章节考试:题目挂 KC 标签(结算页按知识点分组分解)
  addColumnIfMissing("exercises", "kc_title", "TEXT");
  // 仓库原文语言 (LLM Step 2 判断)
  addColumnIfMissing("courses", "source_lang", "TEXT");
  // 学习者记忆:friction_pattern 课程隔离(方案2);NULL=跨课程(如 global 风格)
  addColumnIfMissing("memory", "course_id", "TEXT");
  // course_id 列加完后再建索引(不能放 schema.sql——旧库迁移时列还没加,建索引会崩)
  db.run("CREATE INDEX IF NOT EXISTS idx_memory_course ON memory(course_id);");
  // v0.3 康奈尔笔记法:canvas_items 加溯源 + 练习记录字段
  addColumnIfMissing("canvas_items", "source_type", "TEXT");
  addColumnIfMissing("canvas_items", "source_anchor", "TEXT");
  addColumnIfMissing("canvas_items", "last_result", "TEXT");
  addColumnIfMissing("canvas_items", "result_at", "TEXT");
  // 按钮触发的消息:气泡只显示短动作标签,完整提示词留在 content(发给 LLM)
  addColumnIfMissing("chat_messages", "display_text", "TEXT");

  // 考试节点(type='exam'):老库的 content_nodes CHECK 约束不含 'exam',
  // 需重建表加约束(SQLite 不能 ALTER CHECK)。幂等:检测现有 CHECK 是否已含 'exam'。
  ensureExamTypeAllowed(db);

  // soul 重构:skills 表 → souls 表 + active_skill → active_soul + 删 flag_skill_system
  migrateSoulRename(db);
}

/**
 * Soul 重构迁移(幂等):
 *  - skills 表(老的教学模式:socratic/exam/project/review)→ souls 表。
 *    老 builtin 内容已废弃(由 3 个新 soul direct/guide/practice 取代),只搬运用户自建的。
 *  - chat_sessions.active_skill → active_soul(复制数据;旧列留死列,SQLite 老版本不便 DROP COLUMN)。
 *  - settings: active_skill → active_soul;删 flag_skill_system(soul 注入常开,不再门控)。
 * 新库(schema.sql 已建 souls/active_soul)跑此函数基本 no-op:skills 表不存在、列已在。
 */
function migrateSoulRename(db: Database): void {
  const tableRows =
    db.exec(`SELECT name FROM sqlite_master WHERE type='table'`)[0]?.values.map((r) => String(r[0])) ??
    [];

  // 1. skills → souls:只搬用户自建的(is_builtin=0),老 builtin 废弃由新 seed 取代
  if (tableRows.includes("skills")) {
    db.run(`INSERT OR IGNORE INTO souls (id, name, description, type, body, is_builtin, created_at)
            SELECT id, name, description, 'custom', body, 0, created_at
            FROM skills WHERE is_builtin = 0`);
    db.run(`DROP TABLE skills`);
  }

  // 2. chat_sessions.active_skill → active_soul(两列并存时搬数据)
  const cols =
    db.exec(`PRAGMA table_info(chat_sessions)`)[0]?.values.map((r) => String(r[1])) ?? [];
  if (cols.includes("active_skill") && cols.includes("active_soul")) {
    db.run(
      `UPDATE chat_sessions SET active_soul = COALESCE(active_soul, active_skill) WHERE active_soul IS NULL`,
    );
  }

  // 3. settings: active_skill → active_soul
  const hasOldKey = db.exec(`SELECT 1 FROM settings WHERE key='active_skill' LIMIT 1`).length > 0;
  const hasNewKey = db.exec(`SELECT 1 FROM settings WHERE key='active_soul' LIMIT 1`).length > 0;
  if (hasOldKey && !hasNewKey) {
    db.run(
      `INSERT INTO settings(key, value, is_secret) SELECT 'active_soul', value, is_secret FROM settings WHERE key='active_skill'`,
    );
  }
  db.run(`DELETE FROM settings WHERE key='active_skill'`);
  // 4. 删 flag_skill_system(soul 注入常开)
  db.run(`DELETE FROM settings WHERE key='flag_skill_system'`);
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
