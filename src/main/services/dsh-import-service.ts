/**
 * dsh-import-service —— 把 dsh-plugin-lookatstudy 的 state.json 学习进度导入当前库。
 *
 * 全平台设计(真实用户从 dsh 插件版迁独立版):
 * - importFromText:通用通道(渲染层 <input type=file> 读文本)——Electron 三平台
 *   与 serve/web(手机浏览器)同一条路;
 * - importFromPath + detectDshStateFile:主进程自动探测 ~/.dsh(桌面=用户本机一键导)。
 *
 * 写入语义(与 scripts/import-dsh-progress.mjs 同源,实测幂等):
 * - 课程三态:refresh(我们建过的,幂等重导)/ map(同标题同结构 → 写进既有节点,
 *   不覆盖内容)/ create(新建,标题冲突才加后缀);
 * - 行 id 全部 dsh-<hash8> 确定性生成 → 重跑 upsert 不重复;
 * - XP 增量合并(dsh_import_xp_seen 水位)/ streak 取较大;导入前先 flushDb 再备份
 *   数据库文件(running app 内存是真相,直接拷文件会拿到陈旧快照)。
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { eq, sql } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import {
  courses as coursesTable,
  contentNodes as contentNodesTable,
  progress as progressTable,
  knowledgeComponentMastery as kcTable,
  examAttempts as examAttemptsTable,
  srsItems as srsItemsTable,
  streaks as streaksTable,
  settings as settingsTable,
  canvasItems as canvasItemsTable,
  frictionLog as frictionLogTable,
  memory as memoryTable,
  contentNodeTranslations as translationsTable,
} from "../db/schema.js";
import {
  normalizeDshState,
  mergeStreak,
  planXpMerge,
  dshKey,
  type NormalizedDshCourse,
} from "./pure/dsh-import-map.js";

/** 渲染层展示用的导入结果(shared/types.ts 的 DshImportSummary 同源)。 */
export interface DshImportResult {
  ok: boolean;
  error?: string;
  backupPath: string | null;
  stateVersion: number;
  coursesCreated: number;
  coursesMapped: number;
  coursesRefreshed: number;
  nodes: number;
  progressRows: number;
  kcRows: number;
  srsRows: number;
  examRows: number;
  xpDelta: number;
  dailyXpAdded: number;
  streakMerged: boolean;
  skippedCourses: string[];
  /** 逐课落点(refresh/map 模式=既有课程 id,create=dsh key;驱动 import:done 刷新) */
  importedCourses: { courseId: string; title: string }[];
  /* v2 全量迁移:笔记/黑板产物/学习者记忆/卡点/翻译 */
  noteRows: number;
  artifactRows: number;
  memoryRows: number;
  frictionRows: number;
  translationRows: number;
  /** 无画布对应的产物类型数(如 guess)——诚实披露 */
  skippedArtifacts: number;
}

type Db = SQLJsDatabase<typeof schema>;

/** dsh 插件 state.json 的默认位置(DSH_HOME 感知,与插件 state.ts 同口径)。 */
export function defaultDshStatePath(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "lookatstudy-plugin", "state.json");
}

/** 探测本机(serve 模式=服务器侧)dsh 插件数据。found 但 version=null 表示文件在但解析失败。 */
export function detectDshStateFile(): { found: boolean; path: string | null; version: number | null } {
  const path = defaultDshStatePath();
  if (!existsSync(path)) return { found: false, path: null, version: null };
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const version = typeof (raw as { version?: unknown })?.version === "number" ? (raw as { version: number }).version : null;
    return { found: true, path, version };
  } catch {
    return { found: true, path, version: null };
  }
}

function settingOf(db: Db, key: string): string | null {
  return db.select().from(settingsTable).where(eq(settingsTable.key, key)).get()?.value ?? null;
}
function setSettingRaw(db: Db, key: string, value: string): void {
  db.insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value } })
    .run();
}

/** 某课程下按序取 section/课时节点 id(map 模式的逐位对齐基础)。 */
function sectionNodeIds(db: Db, courseId: string): { sections: { id: string }[]; lessonsBySection: string[][] } {
  const sections = db
    .select({ id: contentNodesTable.id })
    .from(contentNodesTable)
    .where(sql`${contentNodesTable.courseId} = ${courseId} and ${contentNodesTable.type} = 'section'`)
    .orderBy(contentNodesTable.orderIdx)
    .all();
  const lessonsBySection = sections.map((s) =>
    db
      .select({ id: contentNodesTable.id })
      .from(contentNodesTable)
      .where(sql`${contentNodesTable.parentId} = ${s.id} and ${contentNodesTable.type} in ('lesson','exam')`)
      .orderBy(contentNodesTable.orderIdx)
      .all()
      .map((r) => r.id),
  );
  return { sections, lessonsBySection };
}

/** 结构一致性:章数与每章课时数逐位相等 → 视为同一门课(map 模式)。 */
function shapeMatches(db: Db, courseId: string, course: NormalizedDshCourse): boolean {
  const { sections, lessonsBySection } = sectionNodeIds(db, courseId);
  if (sections.length !== course.sections.length) return false;
  return course.sections.every((sec, i) => lessonsBySection[i]!.length === sec.lessons.length);
}

/**
 * 导入 state 文本。dbFilePath 非空且存在时先做文件备份(调用方须先 flushDb)。
 * 任何写入失败整体回滚,库保持导入前状态。
 */
export function importDshStateFromText(
  db: Db,
  text: string,
  dbFilePath: string | null,
  now: Date = new Date(),
): DshImportResult {
  const base: DshImportResult = {
    ok: false,
    backupPath: null,
    stateVersion: 0,
    coursesCreated: 0,
    coursesMapped: 0,
    coursesRefreshed: 0,
    nodes: 0,
    progressRows: 0,
    kcRows: 0,
    srsRows: 0,
    examRows: 0,
    xpDelta: 0,
    dailyXpAdded: 0,
    streakMerged: false,
    skippedCourses: [],
    importedCourses: [],
    noteRows: 0,
    artifactRows: 0,
    memoryRows: 0,
    frictionRows: 0,
    translationRows: 0,
    skippedArtifacts: 0,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ...base, error: `state.json 不是合法 JSON:${e instanceof Error ? e.message : String(e)}` };
  }
  const norm = normalizeDshState(parsed);
  if (!norm.ok) return { ...base, error: norm.error };
  const state = norm.state;

  let backupPath: string | null = null;
  if (dbFilePath && existsSync(dbFilePath)) {
    const stamp = `${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${now.getTime() % 1000}`;
    backupPath = `${dbFilePath}.bak-dsh-import-${stamp}`;
    copyFileSync(dbFilePath, backupPath);
  }

  try {
    db.run(sql`BEGIN`);
    const summary: DshImportResult = { ...base, ok: true, backupPath, stateVersion: state.version, skippedCourses: state.skippedCourses };
    // 插件 id → 实际落点(map 模式含既有节点/课程),供黑板产物与课级模式记忆挂靠
    const lessonNodeMap = new Map<string, string>();
    const lessonCourseMap = new Map<string, string>();
    const courseTargetMap = new Map<string, string>();

    for (const course of state.courses) {
      // 目标解析:refresh(我们建过)/ map(同标题同结构)/ create(新建)
      let mode: "refresh" | "map" | "create" = "create";
      let targetCourseId =
        db.select({ id: coursesTable.id }).from(coursesTable).where(eq(coursesTable.id, course.key)).get()?.id ?? null;
      let titleConflict = false;
      if (targetCourseId) {
        mode = "refresh";
      } else {
        const sameTitle =
          db.select({ id: coursesTable.id }).from(coursesTable).where(eq(coursesTable.title, course.title)).get()?.id
          ?? db.select({ id: coursesTable.id }).from(coursesTable).where(eq(coursesTable.title, `${course.title}(dsh 导入)`)).get()?.id
          ?? null;
        if (sameTitle && shapeMatches(db, sameTitle, course)) {
          targetCourseId = sameTitle;
          mode = "map";
        } else if (sameTitle) {
          titleConflict = true;
        }
      }

      if (mode !== "map") {
        db.insert(coursesTable)
          .values({
            id: course.key,
            repoName: course.title,
            title: titleConflict ? `${course.title}(dsh 导入)` : course.title,
            description: `从 dsh 插件导入(source: ${course.source ?? "?"}, ${course.sourceRef ?? "no ref"})`,
            createdAt: course.createdAt,
          })
          .onConflictDoNothing()
          .run();
        if (mode === "create") summary.coursesCreated++;
        else summary.coursesRefreshed++;
        course.sections.forEach((sec, si) => {
          db.insert(contentNodesTable)
            .values({
              id: sec.id,
              courseId: course.key,
              parentId: null,
              type: "section",
              title: sec.title,
              sourcePath: sec.anchor,
              orderIdx: si,
            })
            .onConflictDoNothing()
            .run();
          for (const l of sec.lessons) {
            db.insert(contentNodesTable)
              .values({
                id: l.nodeId,
                courseId: course.key,
                parentId: sec.id,
                type: l.type,
                title: l.title,
                sourcePath: l.anchor,
                orderIdx: l.orderIdx,
                content: l.content,
                world: l.world,
                knowledgePoints: l.knowledgePoints,
                summary: l.summary,
              })
              .onConflictDoNothing()
              .run();
            // refresh 重导:摘要以插件侧为准更新(仅我们自己的 dsh- 节点,map 模式不进此分支)
            if (l.summary) {
              db.update(contentNodesTable).set({ summary: l.summary }).where(eq(contentNodesTable.id, l.nodeId)).run();
            }
            summary.nodes++;
          }
        });
      } else {
        summary.coursesMapped++;
      }
      if (course.id) courseTargetMap.set(course.id, targetCourseId ?? course.key);
      summary.importedCourses.push({ courseId: targetCourseId ?? course.key, title: course.title });

      // map 模式:既有节点按 (章序,课序) 逐位对齐
      const nodeIds: string[] =
        mode === "map" && targetCourseId ? sectionNodeIds(db, targetCourseId).lessonsBySection.flat() : [];

      const flat = course.sections.flatMap((s) => s.lessons);
      flat.forEach((l, i) => {
        const nodeId = mode === "map" ? nodeIds[i] : l.nodeId;
        if (!nodeId) return;
        lessonNodeMap.set(l.id, nodeId);
        lessonCourseMap.set(l.id, targetCourseId ?? course.key);
        db.insert(progressTable)
          .values({
            nodeId,
            status: l.status,
            crownLevel: l.crownLevel,
            lastAttemptAt: l.lastAttemptAt,
            mastery: l.mastery,
          })
          .onConflictDoUpdate({
            target: progressTable.nodeId,
            set: { status: l.status, crownLevel: l.crownLevel, lastAttemptAt: l.lastAttemptAt, mastery: l.mastery },
          })
          .run();
        summary.progressRows++;
        for (const kc of l.kc) {
          db.insert(kcTable)
            .values({ id: kc.id, nodeId, kcIndex: kc.kcIndex, mastery: kc.mastery, testedCount: 0 })
            .onConflictDoUpdate({ target: [kcTable.nodeId, kcTable.kcIndex], set: { mastery: kc.mastery } })
            .run();
          summary.kcRows++;
        }
        if (l.srs) {
          db.insert(srsItemsTable)
            .values({
              id: l.srs.id,
              nodeId,
              easeFactor: l.srs.easeFactor,
              intervalDays: l.srs.intervalDays,
              repetitions: l.srs.repetitions,
              dueAt: l.srs.dueAt,
              lastReviewedAt: l.srs.lastReviewedAt,
            })
            .onConflictDoUpdate({
              target: srsItemsTable.id,
              set: {
                easeFactor: l.srs.easeFactor,
                intervalDays: l.srs.intervalDays,
                repetitions: l.srs.repetitions,
                dueAt: l.srs.dueAt,
                lastReviewedAt: l.srs.lastReviewedAt,
              },
            })
            .run();
          summary.srsRows++;
        }
        if (l.exam) {
          db.insert(examAttemptsTable)
            .values({
              id: l.exam.id,
              examNodeId: nodeId,
              startedAt: l.exam.at,
              finishedAt: l.exam.at,
              terminated: false,
              correctCount: 0,
              totalCount: 0,
              stars: l.exam.stars,
              answersJson: "{}",
            })
            .onConflictDoNothing()
            .run();
          summary.examRows++;
        }
        // 康奈尔笔记 → canvas_items(user_note):quote 当画线文本、note 正文当注释
        for (const n of l.notes) {
          db.insert(canvasItemsTable)
            .values({
              id: n.key,
              nodeId,
              courseId: targetCourseId ?? course.key,
              artifactType: "user_note",
              title: n.title,
              data: JSON.stringify({ text: n.text }),
              pinned: n.pinned ? 1 : 0,
              createdAt: n.at,
              notes: n.quote ? n.body : null,
              sourceType: n.source,
            })
            .onConflictDoUpdate({
              target: canvasItemsTable.id,
              set: { title: n.title, data: JSON.stringify({ text: n.text }), pinned: n.pinned ? 1 : 0, notes: n.quote ? n.body : null },
            })
            .run();
          summary.noteRows++;
        }
        // 卡点日志 → friction_log(词汇表同源:confused/blocked/frustrated)
        for (const f of l.friction) {
          db.insert(frictionLogTable)
            .values({ id: f.key, nodeId, category: f.category, summary: f.summary, createdAt: f.at })
            .onConflictDoNothing()
            .run();
          summary.frictionRows++;
        }
        // 课级记忆 → memory(node 槽)
        if (l.memory) {
          db.insert(memoryTable)
            .values({
              id: `dsh-mem-node-${l.nodeId}`,
              nodeId,
              summary: l.memory,
              category: "node",
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
            })
            .onConflictDoUpdate({ target: memoryTable.id, set: { summary: l.memory, updatedAt: now.toISOString() } })
            .run();
          summary.memoryRows++;
        }
        // 配对翻译 → content_node_translations(map 模式不碰既有课的翻译)
        if (l.translation && mode !== "map") {
          db.insert(translationsTable)
            .values({
              id: `dsh-tr-${dshKey(l.nodeId, l.translation.lang)}`,
              nodeId,
              courseId: course.key,
              locale: l.translation.lang,
              title: l.title,
              content: l.translation.content,
            })
            .onConflictDoUpdate({
              target: [translationsTable.nodeId, translationsTable.locale],
              set: { content: l.translation.content, title: l.title },
            })
            .run();
          summary.translationRows++;
        }
      });
    }

    // 黑板产物 → canvas_items(源 ai;guess 无画布对应已在 normalize 过滤计数)
    for (const art of state.artifacts) {
      const nodeId = lessonNodeMap.get(art.lessonId);
      const courseIdOf = lessonCourseMap.get(art.lessonId);
      if (!nodeId || !courseIdOf) continue; // 挂靠的课行未导入(被跳过),诚实丢弃
      db.insert(canvasItemsTable)
        .values({
          id: art.key,
          nodeId,
          courseId: courseIdOf,
          artifactType: art.artifactType,
          title: art.title,
          data: art.data,
          createdAt: art.createdAt,
          sourceType: "ai",
        })
        .onConflictDoUpdate({ target: canvasItemsTable.id, set: { title: art.title, data: art.data } })
        .run();
      summary.artifactRows++;
    }

    // 学习者记忆:全局风格槽 + 课级模式槽(course 作用域)
    if (state.memoryGlobal) {
      db.insert(memoryTable)
        .values({
          id: "dsh-mem-global",
          summary: state.memoryGlobal,
          category: "global",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        })
        .onConflictDoUpdate({ target: memoryTable.id, set: { summary: state.memoryGlobal, updatedAt: now.toISOString() } })
        .run();
      summary.memoryRows++;
    }
    for (const pat of state.memoryPatterns) {
      const cid = courseTargetMap.get(pat.courseId);
      if (!cid) continue; // 该课未被导入,模式记忆无处挂靠
      db.insert(memoryTable)
        .values({
          id: `dsh-mem-pat-${dshKey(pat.courseId)}`,
          courseId: cid,
          summary: pat.text,
          category: "friction_pattern",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        })
        .onConflictDoUpdate({ target: memoryTable.id, set: { summary: pat.text, updatedAt: now.toISOString() } })
        .run();
      summary.memoryRows++;
    }
    summary.skippedArtifacts = state.skippedArtifacts;

    // streak:取较大 / 日期取较晚(max 幂等)
    if (state.streak) {
      const cur = db.select().from(streaksTable).where(eq(streaksTable.id, "singleton")).get();
      const merged = mergeStreak(
        {
          currentStreak: cur?.currentStreak ?? 0,
          longestStreak: cur?.longestStreak ?? 0,
          lastActiveDate: cur?.lastActiveDate ?? null,
          freezeCount: cur?.freezeCount ?? 2,
        },
        state.streak,
      );
      db.update(streaksTable)
        .set({
          currentStreak: merged.currentStreak,
          longestStreak: merged.longestStreak,
          lastActiveDate: merged.lastActiveDate,
          freezeCount: merged.freezeCount,
        })
        .where(eq(streaksTable.id, "singleton"))
        .run();
      summary.streakMerged = true;
    }

    // XP:增量合并(水位防重复累加)
    if (state.xp) {
      const totalXpNow = Number(settingOf(db, "total_xp") ?? 0) || 0;
      const plan = planXpMerge(
        {
          totalXp: totalXpNow,
          seenTotal: Number(settingOf(db, "dsh_import_xp_seen") ?? 0) || 0,
          mergedDayKey: settingOf(db, "dsh_import_xp_day"),
        },
        state.xp,
        now.toISOString().slice(0, 10),
      );
      if (plan.totalDelta > 0) {
        setSettingRaw(db, "total_xp", String(totalXpNow + plan.totalDelta));
        summary.xpDelta = plan.totalDelta;
      }
      if (plan.dailyKey && plan.dailyAdd > 0) {
        const dNow = Number(settingOf(db, plan.dailyKey) ?? 0) || 0;
        setSettingRaw(db, plan.dailyKey, String(dNow + plan.dailyAdd));
        summary.dailyXpAdded = plan.dailyAdd;
      }
      if (plan.seenTotal > 0) setSettingRaw(db, "dsh_import_xp_seen", String(plan.seenTotal));
      if (plan.mergedDayKey) setSettingRaw(db, "dsh_import_xp_day", plan.mergedDayKey);
    }

    db.run(sql`COMMIT`);
    return summary;
  } catch (e) {
    try {
      db.run(sql`ROLLBACK`);
    } catch {
      /* 连接已自动回滚 */
    }
    return {
      ...base,
      error: `导入失败(已回滚${backupPath ? `,备份在 ${backupPath}` : ""}):${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** 从文件导入(自动探测路径的直读通道)。 */
export function importDshStateFromPath(db: Db, path: string, dbFilePath: string | null, now?: Date): DshImportResult {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    return { ...baseResult(), error: `读取失败:${e instanceof Error ? e.message : String(e)}` };
  }
  return importDshStateFromText(db, text, dbFilePath, now);
}

function baseResult(): DshImportResult {
  return {
    ok: false,
    backupPath: null,
    stateVersion: 0,
    coursesCreated: 0,
    coursesMapped: 0,
    coursesRefreshed: 0,
    nodes: 0,
    progressRows: 0,
    kcRows: 0,
    srsRows: 0,
    examRows: 0,
    xpDelta: 0,
    dailyXpAdded: 0,
    streakMerged: false,
    skippedCourses: [],
    importedCourses: [],
    noteRows: 0,
    artifactRows: 0,
    memoryRows: 0,
    frictionRows: 0,
    translationRows: 0,
    skippedArtifacts: 0,
  };
}
