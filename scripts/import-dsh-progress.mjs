#!/usr/bin/env node
/**
 * import-dsh-progress.mjs —— 把 dsh 插件版 LookatStudy 的学习进度迁入独立版 LookatStudy。
 *
 * 用法(零依赖,Node ≥ 22,建议 23+):
 *   node import-dsh-progress.mjs            # 自动探测两边路径
 *   node import-dsh-progress.mjs --db D:\path\lookatstudy.db --state C:\Users\you\.dsh\lookatstudy-plugin\state.json
 *
 * 行为:
 *   - 迁移前自动备份 lookatstudy.db(同目录 .bak-dsh-import-<时间戳>)
 *   - 课程(含章节/课时/考试节点与正文)、进度状态、per-KC 掌握度、SM-2 复习计划、
 *     考试最好星数、XP(相加)、streak(取较大值)全部迁入
 *   - 幂等:重复运行刷新进度,不建课程副本;同标题课程结构一致时直接写进它
 *   - LookatStudy 必须处于关闭状态(sql.js 退出时整库落盘,运行中改会被覆盖)
 */
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// node:sqlite 在 Node 22.5–22.x 需要 --experimental-sqlite;加载失败时带 flag 重生自己
let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  const r = spawnSync(process.execPath, ["--experimental-sqlite", ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const die = (msg) => { console.error("✗ " + msg); process.exit(1); };
const hash8 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 8);

/* ---------- 路径探测 ---------- */
const statePath =
  argOf("--state") ??
  join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "lookatstudy-plugin", "state.json");
const defaultDb = () => {
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "LookatStudy", "lookatstudy.db");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "LookatStudy", "lookatstudy.db");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "LookatStudy", "lookatstudy.db");
};
const dbPath = argOf("--db") ?? defaultDb();

if (!existsSync(statePath)) die(`找不到 dsh 插件状态文件: ${statePath}(用 --state 指定)`);
if (!existsSync(dbPath)) die(`找不到 LookatStudy 数据库: ${dbPath}(用 --db 指定;独立版至少启动过一次)`);

/* ---------- 解析与校验 ---------- */
let state;
try {
  state = JSON.parse(readFileSync(statePath, "utf8"));
} catch (e) {
  die(`state.json 不是合法 JSON: ${e.message}`);
}
const SUPPORTED = 2;
if (typeof state?.version !== "number") die("state.json 形状不对(缺 version)——确认这是 dsh-plugin-lookatstudy 的状态文件");
if (state.version > SUPPORTED) die(`state 版本 ${state.version} 比本脚本支持的(${SUPPORTED})新——请更新 LookatStudy 后用新脚本`);
if (!Array.isArray(state.courses)) die("state.json 里没有课程(courses 为空)");

/* ---------- 备份 ---------- */
const stamp = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Date.now() % 1000}`;
const backupPath = `${dbPath}.bak-dsh-import-${stamp}`;
copyFileSync(dbPath, backupPath);
console.log(`✓ 已备份原库 → ${backupPath}`);

/* ---------- 导入 ---------- */
const db = new DatabaseSync(dbPath);
db.exec("BEGIN");

const esc = (s) => (s == null ? null : String(s));
const nodeStatusMap = { locked: "locked", available: "available", in_progress: "in_progress", mastered: "mastered" };

try {
  const summary = { courses: 0, createdCourses: 0, nodes: 0, progress: 0, kc: 0, srs: 0, exams: 0 };

  for (const course of state.courses) {
    const lessons = course.sections.flatMap((s) => s.lessons);
    if (lessons.length === 0) { console.log(`– 跳过空课程 ${course.title}`); continue; }
    summary.courses++;

    const courseId = `dsh-${hash8(course.id + "|" + course.title)}`;

    // 目标解析:① 我们建过的课程(幂等重导) ② 同标题且结构一致(写进它) ③ 新建
    let targetCourseId = db.prepare("SELECT id FROM courses WHERE id = ?").get(courseId)?.id ?? null;
    let mode = "create";
    let titleConflict = false; // 同名但结构对不上 → 新课程标题加后缀区分
    if (targetCourseId) {
      mode = "refresh";
    } else {
      const sameTitle = db.prepare("SELECT id FROM courses WHERE title = ? OR title = ?").get(course.title, `${course.title}(dsh 导入)`)?.id ?? null;
      if (sameTitle) {
        const shape = db.prepare(
          "SELECT s.id AS sid FROM content_nodes s WHERE s.course_id = ? AND s.type = 'section' ORDER BY s.order_idx",
        ).all(sameTitle);
        const shapeMatches =
          shape.length === course.sections.length &&
          course.sections.every((sec, i) =>
            db.prepare("SELECT COUNT(*) AS n FROM content_nodes WHERE parent_id = ? AND type IN ('lesson','exam')").get(shape[i].sid).n === sec.lessons.length,
          );
        if (shapeMatches) { targetCourseId = sameTitle; mode = "map"; }
        else { titleConflict = true; console.log(`! 同名课程「${course.title}」结构与插件不一致,另建新课程`); }
      }
    }

    if (mode === "create" || mode === "refresh") {
      db.prepare(
        `INSERT INTO courses (id, repo_url, repo_name, title, description, version, lab_type, source_lang, created_at)
         VALUES (?, NULL, ?, ?, ?, 1, 'doc', NULL, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(
        courseId,
        course.title,
        titleConflict ? `${course.title}(dsh 导入)` : course.title,
        `从 dsh 插件导入(source: ${esc(course.source) ?? "?"}, ${esc(course.sourceRef) ?? "no ref"})`,
        course.createdAt ?? new Date().toISOString(),
      );
      if (mode === "create") summary.createdCourses++;
    }

    // 节点 id:map 模式复用既有节点;create/refresh 模式用确定性 id(`dsh-` + 插件 lesson id)
    const nodeIds = []; // 与 lessons 逐位对齐
    if (mode === "map") {
      const secs = db.prepare(
        "SELECT id FROM content_nodes WHERE course_id = ? AND type = 'section' ORDER BY order_idx",
      ).all(targetCourseId);
      for (const s of secs) {
        nodeIds.push(
          ...db.prepare(
            "SELECT id FROM content_nodes WHERE parent_id = ? AND type IN ('lesson','exam') ORDER BY order_idx",
          ).all(s.id).map((r) => r.id),
        );
      }
    } else {
      let order = 0;
      course.sections.forEach((sec, si) => {
        const secId = `dsh-sec-${hash8(course.id + "|" + si)}`;
        db.prepare(
          `INSERT INTO content_nodes (id, course_id, parent_id, type, title, source_path, order_idx, content, world, knowledge_points)
           VALUES (?, ?, NULL, 'section', ?, ?, ?, NULL, 'study', NULL)
           ON CONFLICT(id) DO NOTHING`,
        ).run(secId, courseId, sec.title ?? `第 ${si + 1} 章`, sec.anchor ?? null, si);
        for (const l of sec.lessons) {
          const id = `dsh-${hash8(l.id + "|" + l.title)}`;
          const world = l.kind === "practice" ? "practice" : "study";
          db.prepare(
            `INSERT INTO content_nodes (id, course_id, parent_id, type, title, source_path, order_idx, content, world, knowledge_points)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          ).run(
            id,
            courseId,
            secId,
            l.kind === "exam" ? "exam" : "lesson",
            l.title,
            l.anchor ?? null,
            order++,
            l.body || "",
            world,
            l.concepts ? JSON.stringify(l.concepts.map((c) => ({ title: c.title, description: c.description ?? "" }))) : null,
          );
          nodeIds.push(id);
          summary.nodes++;
        }
      });
    }

    lessons.forEach((l, i) => {
      const nodeId = nodeIds[i];
      if (!nodeId) return;

      // progress(状态词汇表同源,直映射)
      const status = nodeStatusMap[l.status] ?? "locked";
      db.prepare(
        `INSERT INTO progress (node_id, status, crown_level, last_attempt_at, mastery)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET status = excluded.status, crown_level = excluded.crown_level,
           last_attempt_at = excluded.last_attempt_at, mastery = excluded.mastery`,
      ).run(nodeId, status, l.status === "mastered" ? 1 : 0, l.lastAnsweredAt ?? null, l.mastery ?? null);
      summary.progress++;

      // per-KC 掌握度(concepts 定义在 create 模式已随节点写入;map 模式依赖既有 knowledge_points,行数按插件侧写)
      if (l.conceptMastery && l.status !== "locked") {
        for (const [idx, m] of Object.entries(l.conceptMastery)) {
          db.prepare(
            `INSERT INTO knowledge_component_mastery (id, node_id, kc_index, mastery, tested_count)
             VALUES (?, ?, ?, ?, 0)
             ON CONFLICT(node_id, kc_index) DO UPDATE SET mastery = excluded.mastery`,
          ).run(`dsh-kc-${hash8(nodeId + "|" + idx)}`, nodeId, Number(idx), m);
          summary.kc++;
        }
      }

      // SM-2(毕业课才有)
      if (l.sm2 && l.dueAt) {
        db.prepare(
          `INSERT INTO srs_items (id, node_id, ease_factor, interval_days, repetitions, due_at, last_reviewed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET ease_factor = excluded.ease_factor, interval_days = excluded.interval_days,
             repetitions = excluded.repetitions, due_at = excluded.due_at, last_reviewed_at = excluded.last_reviewed_at`,
        ).run(
          `dsh-srs-${hash8(nodeId)}`,
          nodeId,
          Math.round(l.sm2.easeFactor * 100),
          Math.round(l.sm2.intervalDays ?? 0),
          Math.round(l.sm2.repetitions ?? 0),
          l.dueAt,
          l.completedAt ?? null,
        );
        summary.srs++;
      }

      // 考试星数(插件只存最好星数 → 一行汇总 attempt;逐题明细插件侧没有,留空)
      if (l.kind === "exam" && l.examStars != null) {
        const at = l.lastAnsweredAt ?? new Date().toISOString();
        db.prepare(
          `INSERT INTO exam_attempts (id, exam_node_id, started_at, finished_at, terminated, correct_count, total_count, stars, answers_json)
           VALUES (?, ?, ?, ?, 0, 0, 0, ?, '{}')
           ON CONFLICT(id) DO NOTHING`,
        ).run(`dsh-exam-${hash8(nodeId)}`, nodeId, at, at, Math.round(l.examStars));
        summary.exams++;
      }
    });
    console.log(`✓ 课程「${course.title}」${mode === "create" ? "新建并导入" : mode === "map" ? "写入既有同名课程" : "刷新进度"}(${lessons.length} 课)`);
  }

  // streak:两侧取较大值、活跃日期取较晚(合并语义,不丢任何一边)
  const pstreak = state.streak;
  if (pstreak) {
    const cur = db.prepare("SELECT * FROM streaks WHERE id = 'singleton'").get() ?? { current_streak: 0, longest_streak: 0, last_active_date: null, freeze_count: 2 };
    db.prepare(
      "UPDATE streaks SET current_streak = ?, longest_streak = ?, last_active_date = ?, freeze_count = ? WHERE id = 'singleton'",
    ).run(
      Math.max(cur.current_streak ?? 0, pstreak.currentStreak ?? 0),
      Math.max(cur.longest_streak ?? 0, pstreak.longestStreak ?? 0),
      (cur.last_active_date ?? "") > (pstreak.lastActiveDate ?? "") ? cur.last_active_date : pstreak.lastActiveDate,
      Math.max(cur.freeze_count ?? 0, pstreak.freezeCount ?? 0),
    );
    console.log(`✓ streak 合并(取较大):current ${Math.max(cur.current_streak ?? 0, pstreak.currentStreak ?? 0)}`);
  }

  // XP:增量合并(记住上次见过的插件 total,重跑只补差量 → 幂等;插件侧后续再涨再补)
  const pxp = state.xp;
  if (pxp) {
    const settingOf = (k) => db.prepare("SELECT value FROM settings WHERE key = ?").get(k)?.value ?? null;
    const setOf = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
    const seenTotal = Number(settingOf("dsh_import_xp_seen") ?? 0);
    const delta = Math.max(0, (pxp.total ?? 0) - seenTotal);
    if (delta > 0) {
      const totalNow = Number(settingOf("total_xp") ?? 0) || 0;
      setOf("total_xp", String(totalNow + delta));
      setOf("dsh_import_xp_seen", String(pxp.total ?? 0));
      console.log(`✓ XP 合并:total_xp +${delta}`);
    }
    const todayKey = new Date().toISOString().slice(0, 10);
    if (pxp.todayKey === todayKey && pxp.todayXp && settingOf("dsh_import_xp_day") !== pxp.todayKey) {
      const dk = `daily_xp_${todayKey}`;
      const dNow = Number(settingOf(dk) ?? 0) || 0;
      setOf(dk, String(dNow + pxp.todayXp));
      setOf("dsh_import_xp_day", pxp.todayKey);
      console.log(`✓ 今日 XP 并入:+${pxp.todayXp}`);
    }
  }

  db.exec("COMMIT");
  console.log(`\n完成:${summary.createdCourses} 门新建课程 / ${summary.progress} 条进度 / ${summary.kc} 条 KC 掌握度 / ${summary.srs} 条复习计划 / ${summary.exams} 条考试记录`);
  console.log("现在启动 LookatStudy 即可看到迁移结果。");
} catch (e) {
  db.exec("ROLLBACK");
  die(`导入失败,已回滚(原库未动,备份在 ${backupPath}):${e.message}`);
}
