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
}
