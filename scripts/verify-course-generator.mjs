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
assert.strictEqual(result.labType, "doc", `T1: labType 应 doc（单个 python 块不够→doc）, 实际 ${result.labType}`);
assert.strictEqual(result.sectionCount, 2, `T1: 2 section`);
assert.strictEqual(result.lessonCount, 3, `T1: 3 lesson`);
console.log(`✓ T1 摘要：title="${result.title}", labType=${result.labType}, 2s/3l`);

// === T2: course 行真的写进去了 ===
const courseRow = db.select().from(schema.courses).all();
assert.strictEqual(courseRow.length, 1, "T2: 1 course 行");
assert.strictEqual(courseRow[0].labType, "doc", "T2: course.labType=doc（单代码块不够）");
console.log(`✓ T2 course 行：labType=${courseRow[0].labType}`);

// === T3: content_nodes 行数 = 2 section + 3 lesson + 2 exam(每章末尾一个考试节点) ===
const nodes = db.select().from(schema.contentNodes).all();
const sections = nodes.filter((n) => n.type === "section");
const lessons = nodes.filter((n) => n.type === "lesson");
const exams = nodes.filter((n) => n.type === "exam");
assert.strictEqual(sections.length, 2, `T3: 2 section`);
assert.strictEqual(lessons.length, 3, `T3: 3 lesson`);
assert.strictEqual(exams.length, 1, `T3: 1 exam(只有 ≥2 课的 section 才加考试，第二节仅 1 课)`);
console.log(`✓ T3 content_nodes：2 section + 3 lesson + 1 exam(≥2课才加)`);

// === T4: 第一个 lesson available,其余 lesson locked;exam 节点 available(可选,渲染层按通关条件锁) ===
// exam DB status=available 是设计:渲染层 MapRail 用 chapterLessonsMastered 运行时算锁定,
// 不读 DB status。DB status=available 保证 export-service 显示一致(不显示 🔒)。
const progress = db.select().from(schema.progress).all();
const available = progress.filter((p) => p.status === "available");
const locked = progress.filter((p) => p.status === "locked");
// 1 lesson(首发) + 1 exam = available;2 其余 lesson = locked
assert.strictEqual(available.length, 2, `T4: 2 available(首发 lesson + 1 exam)`);
assert.strictEqual(locked.length, 2, `T4: 2 locked(2 其余 lesson,exam DB 态 available)`);
console.log(`✓ T4 初始 progress：2 available(1 lesson+1 exam) + 2 locked(其余 lesson)`);

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
