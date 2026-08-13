/**
 * Soul CRUD + 激活服务 —— DB 注入式,便于无头测试。
 *
 * Soul = 教学人设(persona):换 soul = 换老师的性格/姿态,贯穿整轮对话。
 * 与 progress-service.ts 同构:所有函数接收 db 参数,不直接 import getDb。
 *
 * 激活机制:当前激活的 soul 存 settings 表 key='active_soul'。
 * 内置 soul 通过 seedBuiltinSouls 幂等写入(is_builtin=1)。
 *
 * 真 skill(过程性 playbook)是未来模块,与本服务无关。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { souls as soulsTable, settings as settingsTable } from "../../db/schema.js";
import { randomUUID } from "node:crypto";
import { parseFrontmatter } from "../pure/frontmatter.js";
import { BUILTIN_SOUL_FILES } from "./builtins.js";

type Db = SQLJsDatabase<typeof schema>;

export interface Soul {
  id: string;
  name: string;
  description: string;
  type: "builtin" | "custom";
  body: string;
  isBuiltin: boolean;
}

const ACTIVE_SOUL_KEY = "active_soul";

/* ---------- 查询 ---------- */

export function listSouls(db: Db): Soul[] {
  return db.select().from(soulsTable).all().map(mapRow);
}

export function getSoul(db: Db, name: string): Soul | null {
  const row = db
    .select()
    .from(soulsTable)
    .where(eq(soulsTable.name, name))
    .get();
  return row ? mapRow(row) : null;
}

/* ---------- 创建 ---------- */

export function createSoul(
  db: Db,
  input: {
    name: string;
    description: string;
    type: Soul["type"];
    body: string;
  },
): Soul {
  const id = randomUUID();
  db.insert(soulsTable)
    .values({
      id,
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      isBuiltin: false,
    })
    .run();
  return {
    id,
    name: input.name,
    description: input.description,
    type: input.type,
    body: input.body,
    isBuiltin: false,
  };
}

/* ---------- 激活 ---------- */

export function setActiveSoul(db: Db, name: string): void {
  // upsert settings.active_soul
  db.insert(settingsTable)
    .values({ key: ACTIVE_SOUL_KEY, value: name, isSecret: false })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: name, isSecret: false },
    })
    .run();
}

export function getActiveSoul(db: Db): string | null {
  const row = db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, ACTIVE_SOUL_KEY))
    .get();
  return row?.value ?? null;
}

/* ---------- 内置 seed（幂等） ---------- */

/**
 * 把 3 个内置 soul(direct/guide/practice)写入表。幂等:已存在的 name 跳过。
 * 在 main/index.ts 启动时(initDb 之后)调用一次。
 */
export function seedBuiltinSouls(db: Db): void {
  for (const file of BUILTIN_SOUL_FILES) {
    const existing = getSoul(db, file.slug);
    if (existing) continue; // 幂等
    const parsed = parseFrontmatter(file.raw);
    db.insert(soulsTable)
      .values({
        id: randomUUID(),
        name: file.slug,
        description: parsed.description,
        type: "builtin",
        body: file.raw, // 存完整 raw(含 frontmatter),prompt-builder 用 body 部分
        isBuiltin: true,
      })
      .run();
  }
}

/* ---------- 内部 ---------- */

function mapRow(row: {
  id: string;
  name: string;
  description: string;
  type: string;
  body: string;
  isBuiltin: boolean;
}): Soul {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as Soul["type"],
    body: row.body,
    isBuiltin: row.isBuiltin,
  };
}
