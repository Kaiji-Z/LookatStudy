/**
 * dsh-import-map —— dsh-plugin-lookatstudy state.json → LookatStudy 行计划的纯映射层。
 *
 * 兼容策略(实测驱动,见 scripts/import-dsh-progress.mjs 的迁移史核对):
 * - state v1(插件 0.4.x)字段是 v2 子集:无 kind/examStars/xp/streak → 全走默认分支;
 * - state v2(插件 0.5.0 → 0.20.0)只加字段从未改名 → 逐字段可选读取;
 * - v3+ 诚实拒绝(字段可能改名,宁拒不猜)。
 *
 * 纯函数零 IO:JSON.parse 后的 unknown 进来,确定性行计划出去(id 全部 dsh-<hash8>
 * 确定性生成 → 导入幂等)。db 侧的 create/map/refresh 决策在 service 层。
 */
import { createHash } from "node:crypto";

export const DSH_STATE_VERSION_SUPPORTED = 2;

/** dsh state 的宽松输入形状(逐字段可选;normalize 负责校验)。 */
export interface DshLessonInput {
  id?: unknown;
  title?: unknown;
  anchor?: unknown;
  body?: unknown;
  kind?: unknown;
  status?: unknown;
  concepts?: unknown;
  conceptMastery?: unknown;
  mastery?: unknown;
  lastAnsweredAt?: unknown;
  sm2?: unknown;
  dueAt?: unknown;
  completedAt?: unknown;
  examStars?: unknown;
}
export interface DshSectionInput {
  title?: unknown;
  anchor?: unknown;
  lessons?: unknown;
}
export interface DshCourseInput {
  id?: unknown;
  title?: unknown;
  source?: unknown;
  sourceRef?: unknown;
  createdAt?: unknown;
  sections?: unknown;
}
export interface DshStateInput {
  version?: unknown;
  courses?: unknown;
  xp?: unknown;
  streak?: unknown;
}

/** 规范化后的课程(结构合法、至少一课)。 */
export interface NormalizedDshCourse {
  key: string;
  id: string;
  title: string;
  source: string | null;
  sourceRef: string | null;
  createdAt: string;
  sections: {
    id: string;
    title: string;
    anchor: string | null;
    lessons: {
      id: string;
      nodeId: string;
      sectionId: string;
      title: string;
      anchor: string | null;
      type: "lesson" | "exam";
      world: "study" | "practice";
      orderIdx: number;
      content: string;
      knowledgePoints: string | null;
      status: "locked" | "available" | "in_progress" | "mastered";
      crownLevel: number;
      mastery: number | null;
      lastAttemptAt: string | null;
      kc: { id: string; kcIndex: number; mastery: number }[];
      srs: { id: string; easeFactor: number; intervalDays: number; repetitions: number; dueAt: string; lastReviewedAt: string | null } | null;
      exam: { id: string; at: string; stars: number } | null;
    }[];
  }[];
}

export interface NormalizedDshState {
  version: number;
  courses: NormalizedDshCourse[];
  xp: { total: number; todayKey: string; todayXp: number } | null;
  streak: { currentStreak: number; longestStreak: number; lastActiveDate: string | null; freezeCount: number } | null;
  skippedCourses: string[];
}

/** sha256 前 8 位,确定性 id 生成。 */
export function dshKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 8);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

const STATUS_MAP: Record<string, "locked" | "available" | "in_progress" | "mastered"> = {
  locked: "locked",
  available: "available",
  in_progress: "in_progress",
  mastered: "mastered",
};

/**
 * 校验 + 规范化 dsh state(parse 后的 unknown)。
 * 逐课独立容错:坏课跳过并记录,不炸整个导入。
 */
export function normalizeDshState(raw: unknown): { ok: true; state: NormalizedDshState } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "state 不是 JSON 对象" };
  const version = raw.version;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return { ok: false, error: "state 缺少 version 字段(确认这是 dsh-plugin-lookatstudy 的 state.json)" };
  }
  if (version > DSH_STATE_VERSION_SUPPORTED) {
    return { ok: false, error: `state 版本 ${version} 比支持的(${DSH_STATE_VERSION_SUPPORTED})新——请升级 LookatStudy` };
  }
  if (!Array.isArray(raw.courses)) return { ok: false, error: "state 缺少 courses 数组" };

  const courses: NormalizedDshCourse[] = [];
  const skippedCourses: string[] = [];
  for (const c of raw.courses) {
    if (!isObj(c)) { skippedCourses.push("(非对象)"); continue; }
    const courseTitle = str(c.title) ?? "(未命名课程)";
    const courseId = str(c.id) ?? "";
    const sectionsIn = Array.isArray(c.sections) ? c.sections : [];
    const sections: NormalizedDshCourse["sections"] = [];
    let order = 0;
    let lessonTotal = 0;
    sectionsIn.forEach((s, si) => {
      if (!isObj(s)) return;
      const lessonsIn = Array.isArray(s.lessons) ? s.lessons : [];
      const sec: NormalizedDshCourse["sections"][number] = {
        id: `dsh-sec-${dshKey(courseId, String(si))}`,
        title: str(s.title) ?? `第 ${si + 1} 章`,
        anchor: str(s.anchor),
        lessons: [],
      };
      for (const l of lessonsIn) {
        if (!isObj(l)) continue;
        const lid = str(l.id);
        const ltitle = str(l.title);
        if (!lid || !ltitle) continue; // 没有稳定 id/标题的行无法幂等,跳过
        const kind = str(l.kind);
        const type: "lesson" | "exam" = kind === "exam" ? "exam" : "lesson";
        const nodeId = `dsh-${dshKey(lid, ltitle)}`;
        const concepts =
          Array.isArray(l.concepts)
            ? (l.concepts.filter((x) => isObj(x) && str(x.title)) as { title?: unknown; description?: unknown }[])
            : [];
        const conceptMastery = isObj(l.conceptMastery) ? l.conceptMastery : null;
        const kc: NormalizedDshCourse["sections"][number]["lessons"][number]["kc"] = [];
        const status = STATUS_MAP[str(l.status) ?? ""] ?? "locked";
        // KC 行:conceptMastery 键必须是有效下标且值为有限数;locked 课不写(与脚本行为一致)
        if (conceptMastery && status !== "locked") {
          for (const [k, v] of Object.entries(conceptMastery)) {
            const idx = Number(k);
            const m = num(v);
            if (Number.isInteger(idx) && idx >= 0 && m !== null) {
              kc.push({ id: `dsh-kc-${dshKey(nodeId, k)}`, kcIndex: idx, mastery: m });
            }
          }
        }
        const sm2 = isObj(l.sm2) ? l.sm2 : null;
        const dueAt = iso(l.dueAt);
        const sm2Ease = num(sm2?.easeFactor);
        const srs =
          sm2 && dueAt && sm2Ease != null
            ? {
                id: `dsh-srs-${dshKey(nodeId)}`,
                easeFactor: Math.round(sm2Ease * 100),
                intervalDays: Math.max(0, Math.round(num(sm2?.intervalDays) ?? 0)),
                repetitions: Math.max(0, Math.round(num(sm2?.repetitions) ?? 0)),
                dueAt,
                lastReviewedAt: iso(l.completedAt),
              }
            : null;
        const examStars = num(l.examStars);
        sec.lessons.push({
          id: lid,
          nodeId,
          sectionId: sec.id,
          title: ltitle,
          anchor: str(l.anchor),
          type,
          world: kind === "practice" ? "practice" : "study",
          orderIdx: order++,
          content: typeof l.body === "string" ? l.body : "",
          knowledgePoints:
            concepts.length > 0
              ? JSON.stringify(concepts.map((x) => ({ title: String(x.title), description: typeof x.description === "string" ? x.description : "" })))
              : null,
          status,
          crownLevel: status === "mastered" ? 1 : 0,
          mastery: num(l.mastery),
          lastAttemptAt: iso(l.lastAnsweredAt),
          kc,
          srs,
          exam:
            type === "exam" && examStars != null
              ? { id: `dsh-exam-${dshKey(nodeId)}`, at: iso(l.lastAnsweredAt) ?? new Date().toISOString(), stars: Math.round(examStars) }
              : null,
        });
        lessonTotal++;
      }
      if (sec.lessons.length > 0) sections.push(sec);
    });
    if (lessonTotal === 0) { skippedCourses.push(courseTitle); continue; }
    courses.push({
      key: `dsh-${dshKey(courseId, courseTitle)}`,
      id: courseId,
      title: courseTitle,
      source: str(c.source),
      sourceRef: str(c.sourceRef),
      createdAt: iso(c.createdAt) ?? new Date().toISOString(),
      sections,
    });
  }

  const xpIn = isObj(raw.xp) ? raw.xp : null;
  const streakIn = isObj(raw.streak) ? raw.streak : null;
  return {
    ok: true,
    state: {
      version,
      courses,
      xp: xpIn ? { total: num(xpIn.total) ?? 0, todayKey: str(xpIn.todayKey) ?? "", todayXp: num(xpIn.todayXp) ?? 0 } : null,
      streak: streakIn
        ? {
            currentStreak: num(streakIn.currentStreak) ?? 0,
            longestStreak: num(streakIn.longestStreak) ?? 0,
            lastActiveDate: str(streakIn.lastActiveDate),
            freezeCount: num(streakIn.freezeCount) ?? 0,
          }
        : null,
      skippedCourses,
    },
  };
}

/** streak 合并:两侧取较大、活跃日期取较晚(幂等:max 天然重入安全)。 */
export function mergeStreak(
  cur: { currentStreak: number; longestStreak: number; lastActiveDate: string | null; freezeCount: number },
  incoming: NonNullable<NormalizedDshState["streak"]>,
): { currentStreak: number; longestStreak: number; lastActiveDate: string | null; freezeCount: number } {
  return {
    currentStreak: Math.max(cur.currentStreak, incoming.currentStreak),
    longestStreak: Math.max(cur.longestStreak, incoming.longestStreak),
    lastActiveDate:
      (cur.lastActiveDate ?? "") > (incoming.lastActiveDate ?? "") ? cur.lastActiveDate : incoming.lastActiveDate,
    freezeCount: Math.max(cur.freezeCount, incoming.freezeCount),
  };
}

/** XP 增量合并计划:只补"插件 total 相对上次见过值"的差量(幂等;插件后续再涨再补)。
 *  今日 XP 只在插件 todayKey == 本地今天 且 该天未并入过时并入。 */
export function planXpMerge(
  current: { totalXp: number; seenTotal: number; mergedDayKey: string | null },
  plugin: NonNullable<NormalizedDshState["xp"]>,
  todayKey: string,
): { totalDelta: number; dailyKey: string | null; dailyAdd: number; seenTotal: number; mergedDayKey: string | null } {
  const totalDelta = Math.max(0, plugin.total - current.seenTotal);
  const daily =
    plugin.todayKey === todayKey && plugin.todayXp > 0 && current.mergedDayKey !== plugin.todayKey
      ? { key: `daily_xp_${todayKey}`, add: plugin.todayXp }
      : null;
  return {
    totalDelta,
    dailyKey: daily?.key ?? null,
    dailyAdd: daily?.add ?? 0,
    seenTotal: Math.max(current.seenTotal, plugin.total),
    mergedDayKey: daily ? plugin.todayKey : current.mergedDayKey,
  };
}
