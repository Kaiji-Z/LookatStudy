/**
 * 种子课程加载器 —— 从内置静态 JSON 加载 microsoft/AI-For-Beginners。
 *
 * 不联网、不调 LLM、不跑翻译管线 —— 这些都在构建前由
 * `scripts/_audit-seed.mjs` 一次性完成,产物固化为 `src/main/assets/seed-course.json`。
 * 启动时直接 insert,瞬时完成,离线可用。
 *
 * 数据来源(运行 `_audit-seed.mjs` 重新生成):
 *   importRepoToParsedCourse → generateCourseFromRepoFiles →
 *   fetchTranslatedContent → persistTranslations → 导出 course/nodes/progress/translations
 *
 * 幂等:已存在且版本号匹配 → 跳过。版本号 bump 触发重建(删旧 + 重灌)。
 *
 * 为什么用 readFileSync 而非 ?raw:JSON 文件较大(~1MB),且 vite-plugin-electron
 * 的 rollup 子构建对 .json?raw 解析不稳定(schema.sql?raw 能解析是因为 sql 后缀
 * 被当 unknown asset,而 .json 被 json 插件拦截)。运行时读文件最稳,dev 和打包
 * 后路径都可靠(主进程 CJS 的 __dirname 在两种场景都指向 dist-electron/main/)。
 */
import { getDb, markDirty } from "../db/index.js";
import { courses, contentNodes, contentNodeTranslations, progress } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** JSON 顶层结构(与 _audit-seed.mjs 导出格式对齐) */
interface SeedData {
  version: number;
  courseId: string;
  course: {
    id: string;
    repoUrl: string | null;
    repoName: string;
    title: string;
    description: string | null;
    labType: "doc" | "code" | "notebook";
  };
  locale: string;
  nodes: Array<{
    id: string;
    parentId: string | null;
    type: "section" | "lesson" | "exam";
    title: string;
    sourcePath: string | null;
    orderIdx: number;
    content: string | null;
    summary: string | null;
  }>;
  progress: Array<{
    nodeId: string;
    status: "locked" | "available" | "in_progress" | "mastered";
    crownLevel: number;
  }>;
  translations: Array<{
    nodeId: string;
    title: string;
    content: string | null;
  }>;
}

/**
 * 解析内置 JSON 路径。
 *
 * - dev:__dirname = <projectRoot>/dist-electron/main 或 src/main(取决于 vite 缓存)
 * - prod(打包):__dirname = <app>/resources/app/dist-electron/main
 * - tsx 脚本(verify/self-test 走 tsx):__dirname = src/main/services
 *
 * JSON 源文件在 src/main/assets/,无论从哪个 __dirname 出发,
 * 都向上找直到定位 src/main/assets/seed-course.json。
 */
function loadSeedData(): SeedData {
  const fileName = "seed-course.json";
  const candidates = [
    // tsx 直跑(verify 脚本):__dirname = .../src/main/services
    join(__dirname, "..", "assets", fileName),
    // dev/prod vite 构建:__dirname = .../dist-electron/main → 项目根 → src/main/assets
    join(__dirname, "..", "..", "src", "main", "assets", fileName),
    // 打包后:__dirname 在 resources/app/dist-electron/main → 需把 assets 复制到 dist
    join(__dirname, "assets", fileName),
  ];
  // ESM __dirname 兜底(主进程是 CJS,但有 tsx 直跑场景)
  let lastErr: unknown = null;
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      lastErr = e;
    }
  }
  // 最后兜底:用 import.meta.url(ESM 路径)
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "..", "assets", fileName), "utf8"));
  } catch {
    // fallthrough
  }
  throw new Error(
    `seed-course.json 未找到,试过: ${candidates.join(", ")} — 请运行 npx tsx scripts/_audit-seed.mjs 重新生成。lastErr=${String(lastErr)}`,
  );
}

const SEED_DATA: SeedData = loadSeedData();
const COURSE_ID = SEED_DATA.courseId;
// 种子版本号:bump 触发重建(删旧课程 + 重新灌入)。
// 改这里的同时应重新跑 _audit-seed.mjs 更新 JSON 内容。
const SEED_VERSION = 8;

/**
 * 幂等灌入内置种子课程。同步、离线、瞬时。
 * 已存在且 version 匹配 → 跳过。
 */
export function ensureSeedCourse(): void {
  const db = getDb();

  const existing = db.select().from(courses).where(eq(courses.id, COURSE_ID)).get();

  // 幂等:已存在且版本号匹配 → 跳过
  if (existing && (existing.version ?? 1) >= SEED_VERSION) return;

  // 版本号旧或不存在 → 删除旧种子课程(含 content_nodes 由 FK CASCADE,
  // 但 sql.js 的 FK 有时不稳,显式删更安全)
  // 兼容清理:旧版种子 id 是 seed-fde-roadmap
  const oldFde = db.select().from(courses).where(eq(courses.id, "seed-fde-roadmap")).get();
  if (oldFde) {
    db.delete(contentNodes).where(eq(contentNodes.courseId, "seed-fde-roadmap")).run();
    db.delete(courses).where(eq(courses.id, "seed-fde-roadmap")).run();
  }
  if (existing) {
    db.delete(contentNodes).where(eq(contentNodes.courseId, COURSE_ID)).run();
    db.delete(courses).where(eq(courses.id, COURSE_ID)).run();
  }

  // ── 灌入 course 行 ──
  // COURSE_ID 来自顶层 courseId 字段,作单一权威;course.id 应与之一致(JSON 校验)。
  const c = SEED_DATA.course;
  if (c.id !== COURSE_ID) {
    throw new Error(
      `seed-course.json 数据不一致:courseId="${COURSE_ID}" vs course.id="${c.id}"`,
    );
  }
  db.insert(courses)
    .values({
      id: COURSE_ID,
      repoUrl: c.repoUrl,
      repoName: c.repoName,
      title: c.title,
      description: c.description,
      version: SEED_VERSION,
      labType: c.labType,
    })
    .run();

  // ── 灌入 content_nodes ──
  for (const n of SEED_DATA.nodes) {
    db.insert(contentNodes)
      .values({
        id: n.id,
        courseId: COURSE_ID,
        parentId: n.parentId,
        type: n.type,
        title: n.title,
        sourcePath: n.sourcePath,
        orderIdx: n.orderIdx,
        content: n.content,
        summary: n.summary,
      })
      .run();
  }

  // ── 灌入 初始 progress ──
  for (const p of SEED_DATA.progress) {
    db.insert(progress)
      .values({
        nodeId: p.nodeId,
        status: p.status,
        crownLevel: p.crownLevel,
      })
      .run();
  }

  // ── 灌入 zh-CN 翻译 ──
  for (const t of SEED_DATA.translations) {
    const transId = `${t.nodeId}-${SEED_DATA.locale}`;
    db.insert(contentNodeTranslations)
      .values({
        id: transId,
        nodeId: t.nodeId,
        courseId: COURSE_ID,
        locale: SEED_DATA.locale,
        title: t.title,
        content: t.content,
      })
      .run();
  }

  markDirty();

  const sectionCount = SEED_DATA.nodes.filter((n) => n.type === "section").length;
  const lessonCount = SEED_DATA.nodes.filter((n) => n.type === "lesson").length;
  console.error(
    `[lookatstudy] 种子课程就绪(内置): ${sectionCount} 章 / ${lessonCount} 课 / ${SEED_DATA.translations.length} 课中文翻译`,
  );
}
