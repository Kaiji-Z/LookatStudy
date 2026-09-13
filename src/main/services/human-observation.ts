/**
 * human-observation —— 节点级"人工观测"标记读写(2026-09-13 审计后续 · IP3)。
 *
 * 人工观测 = 学习者亲手作答并被确定性判分的事件:
 *   - quiz 产物点选 → quiz:recordAnswer(ipc 层)
 *   - exercise 提交判分 → submitExerciseAnswer(exercise-service)
 * 考试按设计不回写 BKT,不算 mastery 观测(与既有语义一致)。
 *
 * 标记只置位永不撤除(once-human, always-human);settings 行 key=human_obs:{nodeId}。
 * DB 注入式;markDirty 由调用方做(与 proposal-service 同款纪律)。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import type * as schema from "../db/schema.js";
import { settings as settingsTable } from "../db/schema.js";
import { humanObsKey } from "./pure/mastery-cap.js";

type Db = SQLJsDatabase<typeof schema>;

/** 节点是否有过人工观测。 */
export function hasHumanObservation(db: Db, nodeId: string): boolean {
  const row = db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.key, humanObsKey(nodeId)))
    .get();
  return !!row?.value;
}

/** 置位人工观测标记(幂等 upsert)。 */
export function markHumanObservation(db: Db, nodeId: string): void {
  db.insert(settingsTable)
    .values({ key: humanObsKey(nodeId), value: "1", isSecret: false })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: "1" } })
    .run();
}
