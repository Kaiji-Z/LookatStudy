/**
 * Learner-Model 读投影（Phase 1.5）—— 把散落的三处学习者状态注入收成一个 snapshot。
 *
 * 此前 agent-engine 把学习者状态散在三处拼进 system:
 *   ① mastery/status/teachingStrategy 织在 nodeContext 里
 *   ② buildFrictionContext 单独拼
 *   ③ learnerMemory(Phase1)又单独拼
 * 本服务提供一个**纯读投影**(CQRS 思路)把三者合成一个"【学习者当前状态】"块。
 *
 * 设计原则(与用户共识):
 *   - **不合并底层 store**。BKT(progress.mastery,定量标量,还喂解锁/地图/dashboard)、
 *     friction_log(原始事件流)、memory(综合/模式)是不同数据类型,揉一起会降正交性。
 *   - 只在**读侧投影**:本函数读三处、组合成字符串,不持久化、不写。
 *   - includeMemory 显式传入:memory_system flag 由 agent-engine 读(isFlagOn 读 app 的 getDb,
 *     测试用独立 db 测不了),结果传进来 → 解耦 flag 机制,snapshot 可纯测。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { progress as progressTable } from "../db/schema.js";
import { buildFrictionContext } from "./pure/friction-context.js";
import { getLearnerMemory } from "./memory-service.js";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 按 mastery 选教学策略（从 agent-engine 移入——它本就是学习者模型逻辑，归本服务）。
 * mastery=null 或 <0.1: 刚开始，建直觉;  <0.4: 检验+纠误;  <0.7: 深化对比;  ≥0.7: 综合应用+费曼。
 */
export function getTeachingStrategy(mastery: number | null): string {
  if (mastery === null || mastery < 0.1) {
    return "学习者刚开始学这一课。先建立直觉再讲细节:用类比引入概念,确认理解后再深入。不要一次性倾倒所有信息,分步骤引导。";
  }
  if (mastery < 0.4) {
    return "学习者有初步了解但还不扎实。用提问检验理解('你能用自己的话说说X是什么吗?'),发现误解时立即纠正。多给实际例子。";
  }
  if (mastery < 0.7) {
    return "学习者基本理解了核心内容。现在要深化:对比相似概念的区别,考察边界情况,引导思考'什么时候不该用这个'。可以出一些有迷惑性的问题。";
  }
  return "学习者接近掌握。进入综合应用阶段:让学习者尝试教别人(费曼技巧),考察知识在更大系统中的角色。如果学习者能清晰复述并举例,考虑提议标记掌握。";
}

/**
 * 读投影:把 mastery + status + 策略 + 近期 friction + memory 合成一个快照块。
 * @param nodeId 焦点节点;null/undefined → 返回 null(没节点就没学习者状态)
 * @param opts.includeMemory 是否含 memory 综合层(agent-engine 传 isFlagOn("memory_system"))
 * @returns "【学习者当前状态】..." 块字符串,或 null
 */
export function buildLearnerSnapshot(
  db: Db,
  nodeId: string | null | undefined,
  opts?: { includeMemory?: boolean; courseId?: string | null },
): string | null {
  if (!nodeId) return null;

  // 定量层:BKT 掌握度 + 进度状态
  const prog = db.select().from(progressTable).where(eq(progressTable.nodeId, nodeId)).get();
  const mastery = prog?.mastery ?? null;
  const status = prog?.status ?? "未开始";
  const strategy = getTeachingStrategy(mastery);

  // 原始事件层:近期 friction
  const friction = buildFrictionContext(db, nodeId);

  // 综合层:memory(可选;courseId 用于 friction_pattern 课程隔离)
  const memory = opts?.includeMemory ? getLearnerMemory(db, nodeId, opts.courseId) : null;

  const lines: string[] = [];
  lines.push("【学习者当前状态】");
  lines.push(`掌握度:${mastery != null ? mastery.toFixed(2) : "未知"} | 进度:${status}`);
  lines.push(`教学策略:${strategy}`);
  if (friction) lines.push(friction);
  if (memory) lines.push(memory);
  return lines.join("\n");
}
