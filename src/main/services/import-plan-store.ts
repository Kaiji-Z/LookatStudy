/**
 * ImportPlan 文件存取 —— `userData/import-plans/{planId}.json`。
 *
 * 为什么文件而不是 DB 表:plan 就是课程包本体(导出=复制文件);150-300KB 级 JSON
 * 不拖累 sql.js 整库重写;零 schema 迁移。store 用工厂注入目录(verify 用临时目录)。
 * 写入原子:先写 .tmp 再 rename,半截文件不会被 parse 到(parsePlan 也会兜住)。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  type ImportPlan,
  type PlanIdentity,
  parsePlan,
  planIdentityKey,
  serializePlan,
} from "./pure/import-plan.js";

export interface PlanStore {
  save(plan: ImportPlan): void;
  load(planId: string): ImportPlan | null;
  list(): ImportPlan[];
  /** store 落盘目录(诊断日志用——排查"plan 为什么没写成"先看写到哪了) */
  dir(): string;
  /** 同一导入源最新的 plan(github owner/repo 或 folder absPath),无则 null */
  findByIdentity(identity: PlanIdentity): ImportPlan | null;
  findByCourse(courseId: string): ImportPlan | null;
  delete(planId: string): void;
  deleteByCourse(courseId: string): void;
}

export function createPlanStore(dir: string): PlanStore {
  const pathOf = (planId: string) => join(dir, `${planId}.json`);
  const safeInit = () => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  };

  return {
    save(plan) {
      safeInit();
      const tmp = pathOf(plan.planId) + ".tmp";
      writeFileSync(tmp, serializePlan(plan), "utf8");
      renameSync(tmp, pathOf(plan.planId));
    },
    load(planId) {
      try {
        const p = pathOf(planId);
        if (!existsSync(p)) return null;
        return parsePlan(readFileSync(p, "utf8"));
      } catch {
        return null;
      }
    },
    list() {
      try {
        safeInit();
        const plans: ImportPlan[] = [];
        for (const f of readdirSync(dir)) {
          if (!f.endsWith(".json")) continue;
          const parsed = parsePlan(readFileSync(join(dir, f), "utf8"));
          if (parsed) plans.push(parsed);
        }
        // updatedAt 新的在前( findByIdentity 取最新用 )
        plans.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return plans;
      } catch {
        return [];
      }
    },
    dir() {
      return dir;
    },
    findByIdentity(identity) {
      const key = planIdentityKey(identity);
      if (key === "unknown") return null;
      return this.list().find((p) => planIdentityKey(p) === key) ?? null;
    },
    findByCourse(courseId) {
      return this.list().find((p) => p.courseId === courseId) ?? null;
    },
    delete(planId) {
      try {
        const p = pathOf(planId);
        if (existsSync(p)) unlinkSync(p);
      } catch { /* 尽力而为 */ }
    },
    deleteByCourse(courseId) {
      for (const p of this.list()) {
        if (p.courseId === courseId) this.delete(p.planId);
      }
    },
  };
}
