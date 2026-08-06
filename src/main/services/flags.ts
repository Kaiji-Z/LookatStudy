/**
 * Feature-flag 服务。
 *
 * VERIFICATION §4 / §5 step 2 要求：每个新功能必须有一个 flag，默认 off，
 * 让 flag=off 等于改动前的行为，flag=on 才启用新行为。这样任何改动都能用同一份
 * 回归套件在 on/off 两种态下比较，避免"开了新功能静默打坏了旧路径"。
 *
 * 存储位置：settings 表，key 形如 `flag_skill_system`。DB 未初始化时一律返回默认值（off），
 * 所以启动早期、测试环境都能安全调用。
 *
 * 新增 flag 的流程：
 *   1. 在 DEFAULTS 里登记 name → 默认值（默认 false）
 *   2. 在 gating 点调用 isFlagOn(name)
 *   3. verify-flags.mjs 自动覆盖新 flag 的默认值断言（防止悄悄改成 on）
 */
import { getDb } from "../db/index.js";
import { settings as settingsTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  FLAG_DEFAULTS,
  type FlagName,
  isFlagName,
} from "./pure/flag-defaults.js";

export { FLAG_DEFAULTS, type FlagName, isFlagName };

/**
 * 读 flag。DB 未初始化 / 行不存在 / 值不合法 → 返回 DEFAULTS[name]。
 *
 * 注意：DB 未初始化时不抛错（启动早期 getDb 会 throw），这里捕获后返回默认值，
 * 因为 flag 读取可能发生在 initDb 之前的安全检查路径。
 */
export function isFlagOn(name: FlagName): boolean {
  // DB 可能未初始化（测试环境、启动早期）—— 走默认值
  try {
    const db = getDb();
    const row = db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, `flag_${name}`))
      .get();
    if (!row) return FLAG_DEFAULTS[name];
    return row.value === "true";
  } catch {
    return FLAG_DEFAULTS[name];
  }
}

/** 写 flag（管理员/开发用，普通学习者界面一般不暴露） */
export function setFlag(name: FlagName, on: boolean): void {
  // 走运行时 settings 写入；这里不复用 settings:ipc handler，直接用 db
  // 避免循环依赖（settings handler 在 ipc 层）
  const { getDb: gdb, markDirty } = require("../db/index.js");
  const db = gdb();
  db.insert(settingsTable)
    .values({ key: `flag_${name}`, value: String(on), isSecret: 0 })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: String(on), isSecret: 0 },
    })
    .run();
  markDirty();
}
