/**
 * Skill CRUD + 激活服务 —— DB 注入式，便于无头测试。
 *
 * 与 progress-service.ts 同构：所有函数接收 db 参数，不直接 import getDb。
 * IPC handler（ipc/index.ts）会变成薄壳：getDb() → 调本服务。
 *
 * 激活机制：当前激活的 skill 存 settings 表 key='active_skill'（HANDOFF §8.1）。
 *
 * 内置 skill 通过 seedBuiltinSkills 幂等写入（is_builtin=1）。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { skills as skillsTable, settings as settingsTable } from "../../db/schema.js";
import { randomUUID } from "node:crypto";
import { parseSkillFrontmatter } from "../pure/skill-frontmatter.js";
import { BUILTIN_SKILL_FILES } from "./builtins.js";

type Db = SQLJsDatabase<typeof schema>;

export interface Skill {
  id: string;
  name: string;
  description: string;
  type: "learning-mode" | "subject-pack" | "user-custom";
  body: string;
  isBuiltin: boolean;
}

const ACTIVE_SKILL_KEY = "active_skill";

/* ---------- 查询 ---------- */

export function listSkills(db: Db): Skill[] {
  return db.select().from(skillsTable).all().map(mapRow);
}

export function getSkill(db: Db, name: string): Skill | null {
  const row = db
    .select()
    .from(skillsTable)
    .where(eq(skillsTable.name, name))
    .get();
  return row ? mapRow(row) : null;
}

/* ---------- 创建 ---------- */

export function createSkill(
  db: Db,
  input: {
    name: string;
    description: string;
    type: Skill["type"];
    body: string;
  },
): Skill {
  const id = randomUUID();
  db.insert(skillsTable)
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

export function setActiveSkill(db: Db, name: string): void {
  // upsert settings.active_skill
  db.insert(settingsTable)
    .values({ key: ACTIVE_SKILL_KEY, value: name, isSecret: false })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: name, isSecret: false },
    })
    .run();
}

export function getActiveSkill(db: Db): string | null {
  const row = db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, ACTIVE_SKILL_KEY))
    .get();
  return row?.value ?? null;
}

/* ---------- 内置 seed（幂等） ---------- */

/**
 * 把 4 个内置 learning-mode skill 写入表。幂等：已存在的 name 跳过。
 * 在 main/index.ts 启动时（initDb 之后）调用一次。
 */
export function seedBuiltinSkills(db: Db): void {
  for (const file of BUILTIN_SKILL_FILES) {
    const existing = getSkill(db, file.slug);
    if (existing) continue; // 幂等
    const parsed = parseSkillFrontmatter(file.raw);
    db.insert(skillsTable)
      .values({
        id: randomUUID(),
        name: file.slug,
        description: parsed.description,
        type: "learning-mode",
        body: file.raw, // 存完整 raw（含 frontmatter），prompt-builder 用 body 部分
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
}): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as Skill["type"],
    body: row.body,
    isBuiltin: row.isBuiltin,
  };
}
