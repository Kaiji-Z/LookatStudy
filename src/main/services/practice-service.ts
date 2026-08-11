/**
 * 实操世界关联服务 —— 通过 source_path 同目录前缀匹配学习课 ↔ 实操节点。
 *
 * 零 schema 改动:不存关联表,运行时靠 source_path 的目录前缀做 LIKE 匹配。
 * 同目录的 README.md(学习) 和 notebook.ipynb(实操) 共享目录前缀,天然关联。
 */
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { contentNodes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { ContentNode } from "@shared/types";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 找某学习课对应的实操节点(同 source_path 目录的 practice 节点)。
 *
 * 例: lesson 的 sourcePath = "lessons/3-NN/03-Perceptron/README.md#perceptron"
 *     目录前缀 = "lessons/3-NN/03-Perceptron/"
 *     同目录的 practice 节点 = notebook.ipynb 等
 */
export function findPracticeForLesson(db: Db, lessonId: string): ContentNode[] {
  const lesson = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.id, lessonId))
    .get();
  if (!lesson?.sourcePath) return [];

  // 取目录前缀(去掉文件名 + 锚点)
  const pathPart = lesson.sourcePath.split("#")[0]!;
  const lastSlash = pathPart.lastIndexOf("/");
  if (lastSlash < 0) return [];
  const dir = pathPart.slice(0, lastSlash);

  // 同课程、同目录前缀、practice 世界的 lesson 节点
  return db
    .select()
    .from(contentNodes)
    .all()
    .filter(
      (n) =>
        n.courseId === lesson.courseId &&
        n.world === "practice" &&
        n.type === "lesson" &&
        n.id !== lessonId &&
        n.sourcePath?.startsWith(dir + "/"),
    );
}

/**
 * 找某实操节点对应的学习课(同 source_path 目录的 study 节点)。
 */
export function findLessonForPractice(db: Db, practiceNodeId: string): ContentNode | null {
  const practice = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.id, practiceNodeId))
    .get();
  if (!practice?.sourcePath) return null;

  const pathPart = practice.sourcePath.split("#")[0]!;
  const lastSlash = pathPart.lastIndexOf("/");
  if (lastSlash < 0) return null;
  const dir = pathPart.slice(0, lastSlash);

  const lessons = db
    .select()
    .from(contentNodes)
    .all()
    .filter(
      (n) =>
        n.courseId === practice.courseId &&
        (n.world ?? "study") === "study" &&
        n.type === "lesson" &&
        n.id !== practiceNodeId &&
        n.sourcePath?.startsWith(dir + "/"),
    )
    .sort((a, b) => a.orderIdx - b.orderIdx);

  return lessons[0] ?? null;
}
