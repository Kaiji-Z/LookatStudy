/**
 * Friction(卡点)上下文 —— 让 AI "看见并记住学习者在哪挣扎"。
 *
 * 从 prompt-builder / agent-engine 抽出到 pure/ 的原因:那些文件经 db/index.js 间接 import
 * electron,tsx/纯 node 无法加载。本文件只依赖 schema + drizzle,verify 脚本可直接 import。
 *
 * 两条职责:
 *   1. insertFrictionDb:写一条 friction_log(db 注入)。人类卡点(🤔入口)+ 系统 agent_error 共用。
 *   2. buildFrictionContext:把某节点近期人类卡点格式化成段,注入 agent system prompt。
 *
 * 这是 SDT relatedness 在 solo 学习 app 里的最可行代理:一个"注意到你卡住并记得它"的 tutor,
 * 同时给自适应难度供数据。排除 agent_error(那是系统自记,不代表学习者主观卡点)。
 */
import { and, eq, ne, desc } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { randomUUID } from "node:crypto";
import * as schema from "../../db/schema.js";

type Db = SQLJsDatabase<typeof schema>;

/** 用户可主动上报的卡点类型(agent_error 由系统自记,不暴露给用户)。 */
export type HumanFrictionCategory = "confused" | "blocked" | "frustrated";

/** friction_log.category 完整枚举(含系统 agent_error)。 */
type FrictionCategory = HumanFrictionCategory | "agent_error";

const CATEGORY_LABEL: Record<HumanFrictionCategory, string> = {
  confused: "糊涂",
  blocked: "卡住",
  frustrated: "受挫",
};

/**
 * 写一条 friction 日志(db 注入,headless 可测)。
 * @param nodeId  绑定节点;null = 非节点绑定(如 agent_error)
 * @param category  confused/blocked/frustrated(人类)或 agent_error(系统)
 * @param summary  一句话描述(可空)
 */
export function insertFrictionDb(
  db: Db,
  nodeId: string | null,
  category: FrictionCategory,
  summary: string | null,
): void {
  db.insert(schema.frictionLog)
    .values({ id: randomUUID(), nodeId, category, summary })
    .run();
}

/**
 * 构造注入 agent 的"近期卡点"上下文:该节点最近 5 条人类卡点(排除 agent_error)。
 * 返回 "" 表示无卡点(调用方据此决定是否拼接)。
 */
export function buildFrictionContext(db: Db, nodeId: string): string {
  const rows = db
    .select()
    .from(schema.frictionLog)
    .where(
      and(
        eq(schema.frictionLog.nodeId, nodeId),
        ne(schema.frictionLog.category, "agent_error"),
      ),
    )
    .orderBy(desc(schema.frictionLog.createdAt))
    .limit(5)
    .all();
  if (rows.length === 0) return "";
  const lines = rows.map((r) => {
    const label = CATEGORY_LABEL[r.category as HumanFrictionCategory] ?? r.category;
    return ` - ${label}: ${r.summary ?? "(无描述)"}`;
  });
  return `学习者近期在本节点卡点(共 ${rows.length} 条):\n${lines.join("\n")}`;
}
