/**
 * 轻量 RAG + 记忆系统服务（M3）。
 *
 * RAG v0.1：LIKE 兜底检索（ROADMAP R2 风险项）。
 * 原因：sql.js 的 WASM 构建不含 FTS5 扩展模块，CREATE VIRTUAL TABLE fts5 会报
 * "no such module: fts5"。v0.1 用 LIKE 在 content_nodes.content + title 上搜，
 * 中文按子串匹配（够用，内容规模小）。v0.2 换含 FTS5 的 SQLite 构建后再升级。
 *
 * 记忆系统：跨会话 SUMMARY 滚动摘要，updateMemory upsert + getMemory 读。
 *
 * DB 注入式（FTS 操作走 sqljs 原生 exec 支持 LIKE 参数）。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { memory as memoryTable } from "../db/schema.js";
import { randomUUID } from "node:crypto";

type Db = SQLJsDatabase<typeof schema>;

/* ---------- LIKE 兜底检索 ---------- */

/** sqljs 原生 exec 接口形状（避免 drizzle 对 raw 查询的限制） */
type SqljsExec = {
  exec: (sql: string, params?: unknown[]) => Array<{ values: unknown[][] }>;
};

export interface SearchHit {
  nodeId: string;
  title: string;
  /** 命中片段（v0.1 手工截取上下文窗口，v0.2 换 FTS5 snippet） */
  snippet: string;
  /** 相关度（v0.1 用命中次数粗排，越多越前） */
  rank: number;
}

/**
 * 全文检索（LIKE 兜底）。在 title + content 上按子串匹配（不区分大小写）。
 * 多关键词用空格分，AND 关系（每个词都得命中）。
 */
export function searchContent(
  sqljs: SqljsExec,
  query: string,
  limit = 10,
): SearchHit[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  // 每个 term 用 LIKE '%term%' 匹配 title 或 content；AND 组合
  const clauses = terms
    .map(
      () =>
        "(LOWER(content_nodes.title) LIKE ? OR LOWER(IFNULL(content_nodes.content,'')) LIKE ?)",
    )
    .join(" AND ");
  const params: (string | number)[] = terms.flatMap((t) => [
    `%${t.toLowerCase()}%`,
    `%${t.toLowerCase()}%`,
  ]);
  params.push(limit);

  const rows = sqljs.exec(
    `SELECT id, title, content FROM content_nodes
     WHERE type IN ('lesson','concept','section') AND ${clauses}
     LIMIT ?`,
    params,
  );
  if (rows.length === 0) return [];

  return rows[0].values.map((row) => {
    const nodeId = String(row[0]);
    const title = String(row[1] ?? "");
    const content = String(row[2] ?? "");
    // 手工 snippet：取第一个 term 命中位置前后 30 字符
    const lower = content.toLowerCase();
    let pos = -1;
    for (const t of terms) {
      const p = lower.indexOf(t.toLowerCase());
      if (p >= 0) {
        pos = p;
        break;
      }
    }
    const start = pos >= 0 ? Math.max(0, pos - 20) : 0;
    const snippet =
      (start > 0 ? "…" : "") +
      content.slice(start, start + 60) +
      (start + 60 < content.length ? "…" : "");
    // rank：命中 term 数越多越前（用负数，小=相关）
    const hitCount = terms.filter(
      (t) =>
        lower.includes(t.toLowerCase()) ||
        title.toLowerCase().includes(t.toLowerCase()),
    ).length;
    return { nodeId, title, snippet, rank: -hitCount };
  });
}

/* ---------- 记忆系统 ---------- */

export interface MemoryEntry {
  id: string;
  nodeId: string | null;
  summary: string;
  category: "global" | "node" | "friction_pattern";
}

/**
 * Upsert 记忆：同 nodeId + category 已存在则更新 summary + updatedAt；否则插入。
 * 这就是"跨会话记忆"——下次会话开始时 agent 读 getMemory 恢复上下文。
 */
export function updateMemory(
  db: Db,
  input: {
    nodeId?: string | null;
    summary: string;
    category: "global" | "node" | "friction_pattern";
  },
): MemoryEntry {
  const category = input.category;
  const nodeId = input.nodeId ?? null;

  const all = db.select().from(memoryTable).all();
  const existing = all.find(
    (m) => m.category === category && (m.nodeId ?? null) === nodeId,
  );

  const now = new Date().toISOString();
  if (existing) {
    db.update(memoryTable)
      .set({ summary: input.summary, updatedAt: now })
      .where(eq(memoryTable.id, existing.id))
      .run();
    return {
      id: existing.id,
      nodeId: existing.nodeId,
      summary: input.summary,
      category: existing.category as MemoryEntry["category"],
    };
  }
  const id = randomUUID();
  db.insert(memoryTable)
    .values({ id, nodeId, summary: input.summary, category })
    .run();
  return { id, nodeId, summary: input.summary, category };
}

export function getMemory(
  db: Db,
  nodeId: string | null,
  category?: "global" | "node" | "friction_pattern",
): MemoryEntry[] {
  let rows = db.select().from(memoryTable).all();
  rows = rows.filter((r) => (r.nodeId ?? null) === nodeId);
  if (category) rows = rows.filter((r) => r.category === category);
  return rows.map((r) => ({
    id: r.id,
    nodeId: r.nodeId,
    summary: r.summary,
    category: r.category as MemoryEntry["category"],
  }));
}
