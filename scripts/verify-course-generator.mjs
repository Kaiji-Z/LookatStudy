/**
 * Course Generator 验证 —— 测真实 course-generator.ts（确定性部分，不调 LLM）。
 *
 * 不变量：
 *   - md → 落库：course + section + lesson + progress 行都建了
 *   - LabType 推断正确（有代码块→code）
 *   - 第一个 lesson available，其余 locked
 *   - 幂等：同 courseId 再生成不重复
 *   - content 写进 content_nodes.content（供 M3 RAG）
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../src/main/db/schema.ts";
import { generateCourseFromMarkdown } from "../src/main/services/course-generator.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

async function makeDb() {
  const wasmDir = join(ROOT, "node_modules/sql.js/dist");
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
  const sqljs = new SQL.Database();
  sqljs.run("PRAGMA foreign_keys = ON;");
  sqljs.run(readFileSync(join(ROOT, "src/main/db/schema.sql"), "utf8"));
  return { sqljs, db: drizzle(sqljs, { schema }) };
}

const MD = `# 测试课程

## 第一节
介绍性段落

### 子课 A
A 的内容，含代码：
\`\`\`python
print("hello")
\`\`\`

### 子课 B
B 的内容

## 第二节
### 子课 C
C 的内容
`;

const { db } = await makeDb();
const result = generateCourseFromMarkdown(db, MD, {
  repoName: "test-repo",
  repoUrl: "https://github.com/x/test-repo",
});

// === T1: 返回摘要正确 ===
assert.strictEqual(result.title, "测试课程", "T1: 标题");
assert.strictEqual(result.labType, "code", `T1: labType 应 code（有 python 块）, 实际 ${result.labType}`);
assert.strictEqual(result.sectionCount, 2, `T1: 2 section`);
assert.strictEqual(result.lessonCount, 3, `T1: 3 lesson`);
console.log(`✓ T1 摘要：title="${result.title}", labType=${result.labType}, 2s/3l`);

// === T2: course 行真的写进去了 ===
const courseRow = db.select().from(schema.courses).all();
assert.strictEqual(courseRow.length, 1, "T2: 1 course 行");
assert.strictEqual(courseRow[0].labType, "code", "T2: course.labType=code");
console.log(`✓ T2 course 行：labType=${courseRow[0].labType}`);

// === T3: content_nodes 行数 = 2 section + 3 lesson ===
const nodes = db.select().from(schema.contentNodes).all();
const sections = nodes.filter((n) => n.type === "section");
const lessons = nodes.filter((n) => n.type === "lesson");
assert.strictEqual(sections.length, 2, `T3: 2 section`);
assert.strictEqual(lessons.length, 3, `T3: 3 lesson`);
console.log(`✓ T3 content_nodes：2 section + 3 lesson`);

// === T4: 第一个 lesson available，其余 locked ===
const progress = db.select().from(schema.progress).all();
const available = progress.filter((p) => p.status === "available");
const locked = progress.filter((p) => p.status === "locked");
assert.strictEqual(available.length, 1, `T4: 1 available`);
assert.strictEqual(locked.length, 2, `T4: 2 locked`);
console.log(`✓ T4 初始 progress：1 available + 2 locked`);

// === T5: lesson content 写进去了（供 RAG）===
const lessonWithContent = lessons.find((l) => l.content && l.content.includes("hello"));
assert.ok(lessonWithContent, "T5: 应有 lesson content 含代码正文");
console.log(`✓ T5 lesson content 写入（供 RAG 检索）`);

// === T6: 幂等——同 courseId 再生成不重复 ===
const result2 = generateCourseFromMarkdown(db, MD, { repoName: "test-repo" });
assert.strictEqual(result2.courseId, result.courseId, "T6: 同 courseId");
const nodes2 = db.select().from(schema.contentNodes).all();
assert.strictEqual(
  nodes2.length,
  nodes.length,
  `T6: 再生成不重复（${nodes2.length} == ${nodes.length}）`,
);
console.log(`✓ T6 幂等：同 courseId 再生成不重复`);

// === T7: 不同 repoName → 不同 courseId ===
const result3 = generateCourseFromMarkdown(db, "# 另一课\n## A\n### a1\n", {
  repoName: "other-repo",
});
assert.notStrictEqual(result3.courseId, result.courseId, "T7: 不同 courseId");
console.log(`✓ T7 不同 repo → 不同 courseId`);

// === T8: 纯文档（无代码）→ labType=doc ===
const { db: db2 } = await makeDb();
const docResult = generateCourseFromMarkdown(db2, "# 纯文\n## A\n纯文字无代码\n", {
  repoName: "doc-repo",
});
assert.strictEqual(docResult.labType, "doc", `T8: 纯文档 labType=doc`);
console.log(`✓ T8 纯文档 → labType=doc`);

console.log("\n=== ALL COURSE GENERATOR TESTS PASSED ✅ ===");
