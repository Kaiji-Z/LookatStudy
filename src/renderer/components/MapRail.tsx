/**
 * MapRail —— v0.7 左栏(tab 切换:课程地图 / 导入课程)。
 *
 * 左栏全高(顶到底),顶部常驻 tab 栏(导入课程 / 课程地图),
 * 下方滑动内容区:点导入 → 地图向右滑出、导入向右滑入;点地图 → 反向。
 * 切课后自动回到地图面板。
 */
import type { ContentNode, Progress, Course } from "@shared/types";
import { UNLOCK_MASTERY_THRESHOLD } from "@shared/types";
import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Map as MapIcon, FileText, BookOpen, Target, Plus, FolderDown, Link as LinkIcon, Trash2, Check, Globe, Wrench } from "lucide-react";
import { ConfirmCard } from "./ConfirmCard.js";
import {
  computeBalloonLayout,
  balloonSegmentToPath,
  hashStr,
} from "../lib/mapLayout.js";
import { attachSky, attachOrbWeather, pickPreset, PRESETS, type SkyPreset, type OrbPos } from "../lib/skyCanvas.js";
import { api } from "../lib/api.js";
import { useLang } from "../lib/i18n.js";
import { celebrate } from "../lib/celebration.js";

export type MapView = "map" | "import";

interface MapRailProps {
  view: MapView;
  onViewChange: (v: MapView) => void;
  courseTitle: string | null;
  courseId: string | null;
  courses: Course[];
  sections: ContentNode[];
  tree: ContentNode[];
  progressMap: Record<string, Progress>;
  selectedNodeId: string | null;
  dueCount: number;
  dueNodeIds: Set<string>;
  overallMastery: number;
  streak: number;
  streaming: boolean;
  onJumpNode: (nodeId: string) => void;
  /** 课程可用的翻译语言列表 */
  availableLanguages: string[];
  /** 当前显示语言（null = 原文） */
  currentLocale: string | null;
  /** 切换语言 */
  onLocaleChange: (locale: string | null) => void;
  onOpenReview: () => void;
  onSelectCourse: (id: string) => void;
  onCoursesChanged: () => void;
}

export function MapRail(props: MapRailProps) {
  const t = useLang();
  const [panel, setPanel] = useState<"map" | "import">("map");
  /** 当前显示的世界: study(学习) / practice(实操)。默认 study。 */
  const [world, setWorld] = useState<"study" | "practice">("study");
  const navRef = useRef<HTMLElement>(null);
  const mapPathRef = useRef<HTMLDivElement>(null);
  const masteryPct = Math.round(props.overallMastery * 100);

  // 按 world 过滤 section(practice 节点不受学习门控,自由探索)
  const visibleSections = props.sections.filter(
    (s) => (s.world ?? "study") === world,
  );
  const hasPracticeWorld = props.sections.some((s) => s.world === "practice");

  const [skyKey, setSkyKey] = useState<string | null>(null);
  useEffect(() => { setSkyKey(pickPreset(props.courseId)); }, [props.courseId]);
  const skyPreset: SkyPreset | null = skyKey ? PRESETS[skyKey] ?? null : null;

  const prevCourseId = useRef<string | null>(null);
  useEffect(() => {
    if (prevCourseId.current !== null && prevCourseId.current !== props.courseId) setPanel("map");
    prevCourseId.current = props.courseId;
  }, [props.courseId]);

  // Phase 2: 检测节点从 locked→available 的解锁瞬间,触发 celebrate("unlock") 粒子(完成 7 触点闭环)。
  // 比较 progressMap 前后状态;首次加载(prev 为空)不触发,防误报。
  const prevStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const prev = prevStatusRef.current;
    const cur: Record<string, string> = {};
    let unlocked = false;
    for (const n of props.tree) {
      const s = props.progressMap[n.id]?.status ?? "locked";
      cur[n.id] = s;
      if (prev[n.id] === "locked" && s !== "locked") unlocked = true;
    }
    if (unlocked && Object.keys(prev).length > 0) celebrate("unlock");
    prevStatusRef.current = cur;
  }, [props.tree, props.progressMap]);

  return (
    <nav ref={navRef} className="map-rail-scope relative h-full flex flex-col bg-surface-rail w-[300px] shrink-0 overflow-hidden" data-testid="map-rail">
      {/* 天空 canvas:nav 层铺满全高(含 tab 区),两个面板共享同一背景。
          tab 和面板都透明,让 canvas 从顶到底透出来。 */}
      {skyPreset && (
        <>
          <MapSkyCanvas scrollRef={mapPathRef} navRef={navRef} preset={skyPreset} />
          <MapOrbWeatherCanvas scrollRef={mapPathRef} navRef={navRef} preset={skyPreset} />
        </>
      )}

      {/* tab 栏 + 标题:都悬浮(absolute),不占文档流。
          map-path 全高滚动,球和内容从屏幕边缘(tab 顶部)才开始被遮。 */}
      <div className="absolute top-0 left-0 right-0 z-40 px-2 pt-2 pb-2 pointer-events-none [&_button]:pointer-events-auto">
        {/* tab 胶囊 */}
        <div className="flex p-1 rounded-lg gap-1 mb-2" style={{ background: "rgb(var(--surface-rail-rgb) / 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
          <button onClick={() => setPanel("map")} data-testid="map-tab-map" className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-label font-bold transition-colors ${panel === "map" ? "bg-brand/20 text-brand" : "text-white/50 hover:text-white/80"}`}>
            <MapIcon className="w-3 h-3" /> {t("map.tab.map")}
          </button>
          <button onClick={() => setPanel("import")} data-testid="map-tab-import" className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-label font-bold transition-colors ${panel === "import" ? "bg-brand/20 text-brand" : "text-white/50 hover:text-white/80"}`}>
            <FileText className="w-3 h-3" /> {t("map.tab.import")}
          </button>
        </div>
        {/* 标题/进度条(仅地图面板显示) */}
        {panel === "map" && (
          <div className="px-3 py-2 rounded-lg pointer-events-auto" style={{ background: "rgb(var(--surface-rail-rgb) / 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
            <div className="flex items-center gap-1.5">
              <h2 className="text-body font-extrabold text-white truncate flex-1" data-tooltip={props.courseTitle ?? ""}>
                {props.courseTitle ?? t("map.course.none")}
              </h2>
              {props.availableLanguages.length > 0 && (
                <LanguageSwitcher
                  available={props.availableLanguages}
                  current={props.currentLocale}
                  onChange={props.onLocaleChange}
                />
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-2.5 bg-black/40 rounded-full overflow-hidden ring-1 ring-white/10">
                <div className={`h-full rounded-full transition-all duration-500 ${masteryPct >= 100 ? "bg-gold" : "bg-brand"}`} style={{ width: `${Math.max(3, masteryPct)}%` }} />
              </div>
              <span className="text-label font-extrabold tabular-nums text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">{masteryPct}%</span>
            </div>
            <div className="flex items-center justify-end mt-1.5 text-caption">
              {props.dueCount > 0 && (
                <button onClick={props.onOpenReview} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-review/20 ring-1 ring-review/30 hover:bg-review/30 transition-colors" data-testid="map-review-badge">
                  <BookOpen className="w-3 h-3 text-review" />
                  <span className="font-extrabold text-review">{props.dueCount}</span>
                  <span className="text-review/80">{t("map.review.due")}</span>
                </button>
              )}
            </div>
            {/* 两个世界切换器: 学习 / 实操(只在有实操世界时显示) */}
            {hasPracticeWorld && (
              <div className="flex gap-1 mt-1.5 p-0.5 rounded-lg bg-black/30">
                <button
                  onClick={() => setWorld("study")}
                  data-testid="world-tab-study"
                  className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-caption font-bold transition-colors ${world === "study" ? "bg-brand/30 text-brand" : "text-white/50 hover:text-white/80"}`}
                >
                  <BookOpen className="w-3 h-3" /> {t("map.world.study")}
                </button>
                <button
                  onClick={() => setWorld("practice")}
                  data-testid="world-tab-practice"
                  className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-caption font-bold transition-colors ${world === "practice" ? "bg-accent/30 text-accent" : "text-white/50 hover:text-white/80"}`}
                >
                  <Wrench className="w-3 h-3" /> {t("map.world.practice")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 滑动内容区(透明,天空由 nav 层 canvas 提供)。全高,tab/标题悬浮其上。 */}
      <div className="absolute inset-0 overflow-hidden z-10">
        <div className="flex h-full transition-transform duration-300" style={{ transform: panel === "map" ? "translateX(0)" : "translateX(-50%)", width: "200%" }}>
          {/* 地图面板(透明)。map-path 全高滚动(pt-48 留出 tab+标题+XP条+世界切换悬浮空间)。 */}
          <div className="w-1/2 h-full relative">
            <div ref={mapPathRef} className="map-path h-full overflow-y-auto px-2 pt-48 pb-4" data-testid="map-path">
              <div className={`map-sky-content ${skyPreset ? `env-${skyPreset.season} env-${skyPreset.weather}` : ""}`}>
                {props.streaming && (
                  <div className="mb-3 mx-1 px-3 py-2 rounded-xl bg-brand/10 border border-brand/30 flex items-center gap-2 text-label text-brand font-medium backdrop-blur-sm" data-testid="streaming-notice">
                    <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
                    {t("map.streaming.notice")}
                  </div>
                )}
                {props.sections.length === 0 ? (
                  props.courseTitle ? (
                    <div className="text-center text-label text-white/60 mt-8 px-4 flex items-center justify-center gap-2">
                      <span className="typing-dot w-1.5 h-1.5 bg-brand rounded-full inline-block" />
                      {t("map.generating")}
                    </div>
                  ) : (
                    <button onClick={() => setPanel("import")} className="block w-full mt-8 mx-auto p-4 rounded-2xl border-2 border-dashed border-brand/40 hover:border-brand hover:bg-brand/5 transition-all text-center group" data-testid="map-empty-cta">
                      <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">🗺️</div>
                      <div className="text-body font-bold text-white/90 mb-1">{t("map.empty.cta.title")}</div>
                      <div className="text-label text-white/60 leading-relaxed">{t("map.empty.cta.desc")}</div>
                      <div className="mt-2 text-caption text-brand font-bold">{t("map.empty.cta.btn")}</div>
                    </button>
                  )
                ) : visibleSections.length === 0 ? (
                  <div className="text-center text-label text-white/60 mt-8 px-4">
                    {world === "practice" ? t("map.empty.practice") : t("map.generating")}
                  </div>
                ) : (
                  <div className="space-y-6 pt-2">
                    {visibleSections.map((section, sIdx) => (
                      <MapSection key={section.id} section={section} sectionIndex={sIdx} tree={props.tree} progressMap={props.progressMap} selectedNodeId={props.selectedNodeId} dueNodeIds={props.dueNodeIds} onJumpNode={props.onJumpNode} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* 导入面板(透明,共享天空背景)。pt-48 避开悬浮 tab 区域(与地图面板一致) */}
          <div className="w-1/2 h-full overflow-y-auto px-3 pt-48 pb-3 space-y-2.5">
            <ImportPanel courses={props.courses} selectedCourseId={props.courseId} onSelectCourse={(id) => { props.onSelectCourse(id); setPanel("map"); }} onCoursesChanged={props.onCoursesChanged} />
          </div>
        </div>
      </div>
    </nav>
  );
}

/* ---------- 导入面板(原 CourseDrawer 内容,内联) ---------- */
function ImportPanel({ courses, selectedCourseId, onSelectCourse, onCoursesChanged }: { courses: Course[]; selectedCourseId: string | null; onSelectCourse: (id: string) => void; onCoursesChanged: () => void; }) {
  const t = useLang();
  const [tab, setTab] = useState<"url" | "markdown" | "folder">("url");
  const [showImport, setShowImport] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [mdText, setMdText] = useState("");
  const [repoName, setRepoName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /** 导入进度步骤列表（安装式滚动窗口）：新步骤进来时上一条自动打勾 */
  const [progressSteps, setProgressSteps] = useState<{ msg: string; status: "working" | "done"; ts: number }[]>([]);
  /** 每秒 tick 让 working 步骤的"已工作 Xs"实时更新 */
  const [, setTick] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string; rect: DOMRect } | null>(null);
  // 新智能管线: analyzeRepo 的结果暂存(供 importAnalyzed 用)
  const [repoAnalysis, setRepoAnalysis] = useState<import("@shared/types").RepoAnalysis | null>(null);
  /** 进度屏滚动容器:新步骤进来自动滚到底,最新进度始终可见。 */
  const progressScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = api.on("import:progress", (msg: string) => {
      setProgressSteps((prev) => {
        // 含 "X/Y" 进度数字 → 当前步骤的进度更新（不新建步骤）
        const isProgressUpdate = /\d+\/\d+/.test(msg);
        const last = prev[prev.length - 1];
        if (isProgressUpdate && last && last.status === "working") {
          const copy = [...prev];
          copy[copy.length - 1] = { ...last, msg };
          return copy;
        }
        // 新步骤：上一条 working 标 done，push 新步骤
        const copy = prev.map((s) => (s.status === "working" ? { ...s, status: "done" as const } : s));
        copy.push({ msg, status: "working", ts: Date.now() });
        return copy;
      });
    });
    const timer = setInterval(() => setTick((x) => x + 1), 1000);
    return () => { off(); clearInterval(timer); };
  }, []);

  // 进度屏自动滚到底:新步骤进来时把滚动容器拉到底,最新进度可见。
  useEffect(() => {
    const el = progressScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [progressSteps]);

  const handleImportUrl = async () => {
    if (!repoUrl.trim() || busy) return;
    setBusy(true); setError(null); setSuccess(null); setProgressSteps([]);
    setRepoAnalysis(null);
    try {
      // 新管线 Step 1+2: 分析仓库(LLM 判文件角色 + sourceLang + 自动按 pref_lang 选翻译)
      const analysis = await api.analyzeRepo(repoUrl.trim());
      setRepoAnalysis(analysis);
      // selectedLang 已由 pref_lang + sourceLang 自动决定，直接导入（不再弹语言选择）
      await doImport(analysis);
    } catch (e) {
      setError(e instanceof Error ? `${e.message}${t("import.error.network")}` : String(e));
      setBusy(false);
    }
  };

  const doImport = async (analysisOverride?: import("@shared/types").RepoAnalysis | null) => {
    const analysis = analysisOverride ?? repoAnalysis;
    if (!analysis) return;
    // 不清空 progressSteps —— 让 analyze(阶段1)→ import(阶段2)的进度连续累加,
    // 避免用户看到"分析进度爬完→瞬间清空→导入进度从0重开"的两屏断裂感。
    setBusy(true); setError(null); setSuccess(null);
    try {
      // 新管线 Step 3+4+5: 提取大纲 → LLM 设计结构 → 拉正文+图片 → 落库
      const course = await api.importAnalyzed(repoUrl.trim(), analysis);
      setSuccess(`${t("import.success.folder")}: ${course.title}`);
      setRepoAnalysis(null);
      setTimeout(() => { onCoursesChanged(); onSelectCourse(course.id); }, 800);
    } catch (e) { setError(e instanceof Error ? `${e.message}${t("import.error.network")}` : String(e)); } finally { setBusy(false); }
  };
  const handleImportMd = async () => {
    if (!mdText.trim() || !repoName.trim() || busy) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      const course = await api.generateCourseFromMarkdown(mdText.trim(), repoName.trim());
      setSuccess(`${t("import.success.md")}: ${course.title}`);
      setTimeout(() => { onCoursesChanged(); onSelectCourse(course.id); }, 800);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const handleImportFolder = async () => {
    if (busy) return;
    setBusy(true); setError(null); setSuccess(null); setProgressSteps([]);
    try {
      const course = await api.importLocalFolder();
      if (!course) { setBusy(false); return; }
      setSuccess(`${t("import.success.folder")}: ${course.title}`);
      setTimeout(() => { onCoursesChanged(); onSelectCourse(course.id); }, 800);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const handleDelete = async (courseId: string, title: string) => {
    try { await api.deleteCourse(courseId); setSuccess(t("import.deleted", { title })); onCoursesChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <>
      {courses.length === 0 ? (
        <p className="text-label text-white/60 text-center py-8">{t("import.empty")}</p>
      ) : (
        <div className="space-y-2" data-testid="course-list">
          {courses.map((c) => {
            const isCurrent = c.id === selectedCourseId;
            return (
              <button key={c.id} onClick={() => onSelectCourse(c.id)} className={`w-full text-left p-3 rounded-xl border transition-all duration-150 group ${isCurrent ? "border-brand bg-brand/10 shadow-[0_0_0_1px_var(--brand-ring)]" : "border-white/15 hover:border-white/30 hover:bg-white/5"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className={`text-body font-bold truncate ${isCurrent ? "text-brand" : "text-white/90"}`}>{c.title}</div>
                    <div className="text-caption text-white/50 truncate mt-0.5">{c.repoName}</div>
                  </div>
                  {isCurrent && <span className="shrink-0 w-5 h-5 rounded-full bg-brand flex items-center justify-center"><Check className="w-3 h-3 text-white" /></span>}
                </div>
                {!isCurrent && (
                  <button onClick={(e) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setConfirmDelete({ id: c.id, title: c.title, rect }); }} className="mt-2 text-caption text-white/40 hover:text-warning flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-2.5 h-2.5" /> {t("import.delete")}
                  </button>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="pt-3 border-t border-white/10">
        <button onClick={() => setShowImport(!showImport)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white/10 border border-white/20 hover:border-brand/40 hover:bg-brand/10 text-body font-bold text-white/90 hover:text-brand transition-all">
          <Plus className="w-4 h-4" /> {t("import.cta")}
        </button>
        {showImport && (
          <div className="mt-3 space-y-3">
            {busy ? (
              // 一个进度屏:从点导入到完成,连续显示全部步骤(analyze + import 不再分屏)。
              // 导入中表单无意义 —— 进度屏成为唯一焦点,替代表单。
              <div className="rounded-xl bg-black/30 border border-brand/30 p-4" data-testid="import-progress">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="inline-block w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin shrink-0" />
                  <span className="text-body font-bold text-white/90">{t("import.progress.title")}</span>
                </div>
                {(tab === "url" ? repoUrl.trim() : tab === "markdown" ? repoName.trim() : "") ? (
                  <div className="text-caption text-white/40 font-mono truncate mb-2.5">
                    {tab === "url" ? repoUrl.trim() : repoName.trim()}
                  </div>
                ) : null}
                <div ref={progressScrollRef} className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-1">
                  {progressSteps.length === 0 ? (
                    <div className="text-caption text-white/50 py-1">{t("import.progress.starting")}</div>
                  ) : progressSteps.map((step, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-caption">
                      {step.status === "done" ? (
                        <Check className="w-3 h-3 text-brand shrink-0 mt-px" />
                      ) : (
                        <span className="inline-block w-2.5 h-2.5 border-2 border-brand border-t-transparent rounded-full animate-spin shrink-0 mt-px" />
                      )}
                      <span className={step.status === "done" ? "text-white/40" : "text-white/90"}>
                        {step.msg}
                        {step.status === "working" && (
                          <span className="text-white/35 ml-1">（{t("import.progress.elapsed", { s: Math.floor((Date.now() - step.ts) / 1000) })}）</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-1 p-1 bg-black/30 rounded-lg">
                  {([ { k: "url" as const, label: t("import.tab.url"), icon: LinkIcon }, { k: "markdown" as const, label: t("import.tab.md"), icon: FileText }, { k: "folder" as const, label: t("import.tab.folder"), icon: FolderDown }]).map(({ k, label, icon: Icon }) => (
                    <button key={k} onClick={() => setTab(k)} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-label font-bold transition-colors ${tab === k ? "bg-brand/15 text-brand" : "text-white/50 hover:text-white/80"}`}>
                      <Icon className="w-3 h-3" /> {label}
                    </button>
                  ))}
                </div>
                {tab === "url" ? (
                  <section className="space-y-2" data-testid="import-url-section">
                    <input type="text" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo" data-testid="repo-url-input" className="w-full bg-black/30 text-white placeholder:text-white/40 text-body rounded-lg px-2.5 py-2 border border-white/20 focus:border-brand focus:outline-none" />
                    <button onClick={handleImportUrl} disabled={!repoUrl.trim() || busy} data-testid="import-url-btn" className="btn-3d-brand w-full px-3 py-2 text-body disabled:opacity-40">{t("import.btn.url")}</button>
                  </section>
                ) : tab === "markdown" ? (
                  <section className="space-y-2" data-testid="import-md-section">
                    <input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder={t("import.placeholder.name")} data-testid="md-name-input" className="w-full bg-black/30 text-white placeholder:text-white/40 text-body rounded-lg px-2.5 py-2 border border-white/20 focus:border-brand focus:outline-none" />
                    <textarea value={mdText} onChange={(e) => setMdText(e.target.value)} placeholder={t("import.placeholder.md")} data-testid="md-text-input" rows={4} className="w-full bg-black/30 text-white placeholder:text-white/40 text-body rounded-lg px-2.5 py-2 border border-white/20 focus:border-brand focus:outline-none resize-none" />
                    <button onClick={handleImportMd} disabled={!mdText.trim() || !repoName.trim() || busy} data-testid="import-md-btn" className="btn-3d-brand w-full px-3 py-2 text-body disabled:opacity-40">{t("import.btn.md")}</button>
                  </section>
                ) : (
                  <section className="space-y-2" data-testid="import-folder-section">
                    <p className="text-caption text-white/50 leading-relaxed">{t("import.folder.desc")}</p>
                    <button onClick={handleImportFolder} disabled={busy} data-testid="import-folder-btn" className="btn-3d-brand w-full px-3 py-2 text-body disabled:opacity-40">{t("import.btn.folder")}</button>
                  </section>
                )}
              </>
            )}
            {error && <div className="border border-warning/40 text-warning-light text-label rounded-lg p-2 whitespace-pre-wrap" data-testid="import-error">{error}</div>}
            {success && <div className="border border-brand/30 text-brand text-label rounded-lg p-2" data-testid="import-success"><Check className="inline-block w-3.5 h-3.5 mr-1 align-[-3px]" />{success}</div>}
          </div>
        )}
      </div>

      {/* 删除课程的内联确认(替代 native confirm) */}
      {confirmDelete && (
        <ConfirmCard
          anchorRect={confirmDelete.rect}
          message={`${confirmDelete.title} — ${t("import.delete.confirm")}`}
          danger
          confirmLabel={t("import.delete")}
          testid="course-delete-confirm"
          onConfirm={() => { handleDelete(confirmDelete.id, confirmDelete.title); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}

function MapSkyCanvas({
  scrollRef,
  navRef,
  preset,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  navRef: React.RefObject<HTMLElement | null>;
  preset: SkyPreset;
}) {
  const skyCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = skyCanvasRef.current;
    const scroll = scrollRef.current;
    const nav = navRef.current;
    if (!canvas || !scroll || !nav) return;
    const detach = attachSky(canvas, scroll, nav, preset);
    return detach;
  }, [scrollRef, navRef, preset]);
  return (
    <canvas ref={skyCanvasRef} className="map-sky-canvas" aria-hidden="true" />
  );
}

/* ---------- 球天气装饰层(canvas,nav 子元素,z-20 盖在球 DOM 上)----------
   与天空 canvas 同层(nav 的 absolute 子元素),但 z-20。
   getOrbs 坐标相对 nav;球滚入 header 区域时不画(防天气效果穿透 header)。 */
function MapOrbWeatherCanvas({
  scrollRef,
  navRef,
  preset,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  navRef: React.RefObject<HTMLElement | null>;
  preset: SkyPreset;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const nav = navRef.current;
    const scroll = scrollRef.current;
    if (!canvas || !nav || !scroll) return;
    // canvas 在 nav 层 → 坐标相对 nav 算
    // 性能(Phase 0):缓存 .lesson-bubble 节点引用 + navRect,不每帧 querySelectorAll
    // (原每帧重建 NodeList 是布局重排主因,随课程规模恶化)。
    // 节点增删/重排由 MutationObserver 失效重建;navRect 仅 window resize 时变(nav 固定容器)。
    // 每帧仍读 N 次 getBoundingClientRect(浏览器批处理为一次布局刷新),位置含 balloon-bob 实时位移。
    let cachedBtns: HTMLButtonElement[] | null = null;
    let cachedNavRect: DOMRect | null = null;
    const invalidate = () => { cachedBtns = null; cachedNavRect = null; };
    const mo = new MutationObserver(invalidate);
    mo.observe(scroll, { childList: true, subtree: true });
    window.addEventListener("resize", invalidate);
    const getOrbs = (): OrbPos[] => {
      if (!cachedBtns) cachedBtns = Array.from(scroll.querySelectorAll<HTMLButtonElement>(".lesson-bubble"));
      const navRect = cachedNavRect ?? nav.getBoundingClientRect();
      cachedNavRect = navRect;
      const out: OrbPos[] = [];
      for (const b of cachedBtns) {
        const r = b.getBoundingClientRect();
        if (r.bottom < navRect.top || r.top > navRect.bottom) continue;
        out.push({
          x: r.left - navRect.left + r.width / 2,
          y: r.top - navRect.top + r.height / 2,
          r: r.width / 2,
        });
      }
      return out;
    };
    const detach = attachOrbWeather(canvas, nav, preset, getOrbs);
    return () => { detach(); mo.disconnect(); window.removeEventListener("resize", invalidate); };
  }, [scrollRef, navRef, preset]);
  return (
    <canvas ref={canvasRef} className="map-orb-weather-canvas" aria-hidden="true" />
  );
}

/* ---------- 章节单元(含气球路径) ---------- */
function MapSection({
  section,
  sectionIndex,
  tree,
  progressMap,
  selectedNodeId,
  dueNodeIds,
  onJumpNode,
}: {
  section: ContentNode;
  sectionIndex: number;
  tree: ContentNode[];
  progressMap: Record<string, Progress>;
  selectedNodeId: string | null;
  dueNodeIds: Set<string>;
  onJumpNode: (nodeId: string) => void;
}) {
  const lessons = tree
    .filter((n) => n.parentId === section.id)
    .sort((a, b) => a.orderIdx - b.orderIdx);

  // 考试解锁条件:同 section 的所有 lesson 节点 mastery 都 ≥ UNLOCK_MASTERY_THRESHOLD(整章通关感)。
  const chapterLessonNodes = lessons.filter((n) => n.type === "lesson");
  const chapterLessonsMastered =
    chapterLessonNodes.length > 0 &&
    chapterLessonNodes.every((l) => (progressMap[l.id]?.mastery ?? 0) >= UNLOCK_MASTERY_THRESHOLD);

  // 测量章节路径容器宽度,供布局引擎算 x 坐标。
  const pathRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(268);
  useEffect(() => {
    if (!pathRef.current) return;
    const measure = () => {
      const w = pathRef.current?.clientWidth ?? 268;
      setContainerW(w > 0 ? w : 268);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pathRef.current);
    return () => ro.disconnect();
  }, []);

  // v0.6:气球布局(种子确定性抖动)+ v0.8 贪心防重叠。同 section id 每次渲染位置稳定。
  const layout = computeBalloonLayout(lessons.length, containerW, section.id);
  const pathHeight = layout.height;
  const NODE_W = 110; // MapNode 卡片宽(球+名字)
  const NODE_H = 76;  // 球 56 + 名字行 20

  return (
    <section
      data-testid={`map-section-${section.id.slice(0, 8)}`}
      className="py-3 px-2"
    >
      {/* 章节路牌:像游戏关卡指示牌(羊皮纸/木牌感)。毛玻璃 + 金边圆牌数字 */}
      <div className="map-signpost flex items-center gap-2 mb-3 px-2.5 py-1.5 rounded-lg shadow-sm">
        <span className="w-6 h-6 rounded-full bg-gold text-neutral-900 text-caption font-extrabold flex items-center justify-center shrink-0 ring-2 ring-gold/40 shadow-sm">
          {sectionIndex + 1}
        </span>
        <span className="text-label font-bold text-white truncate flex-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
          {section.title}
        </span>
      </div>

      {/* 绳子 + 气球:绝对定位,统一像素坐标系 */}
      <div ref={pathRef} className="relative" style={{ minHeight: pathHeight }}>
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden="true"
          style={{ height: pathHeight }}
        >
          {layout.segments.map((seg) => {
            // 绳子颜色:前置节点已通过 → 走过的路(brand 实线);否则未走过(灰虚线)
            const fromLesson = lessons[seg.index];
            const fromProgress = fromLesson ? progressMap[fromLesson.id] : undefined;
            const isPassed =
              fromProgress?.status === "mastered" ||
              fromProgress?.status === "in_progress" ||
              fromProgress?.status === "available";
            return (
              <path
                key={seg.index}
                d={balloonSegmentToPath(seg)}
                stroke={isPassed ? "var(--brand)" : "var(--ink-faint)"}
                strokeWidth={isPassed ? 4 : 2.5}
                strokeOpacity={isPassed ? 0.6 : 0.5}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={isPassed ? "none" : "3 7"}
                style={
                  isPassed
                    ? ({ pathLength: 1, animation: "path-draw 600ms var(--ease-out-expo)" } as CSSProperties)
                    : undefined
                }
              />
            );
          })}
        </svg>

        {/* 气球节点:绝对定位居中于 layout.x/layout.y,加漂浮动画(每节点相位/周期错峰) */}
        {lessons.map((lesson, i) => {
          const node = layout.nodes[i];
          if (!node) return null;
          const h = hashStr(lesson.id);
          const bobDelay = `${(h % 40) / 10}s`;
          const bobDuration = `${5 + (h % 30) / 10}s`;
          return (
            <div
              key={lesson.id}
              className="absolute balloon-bob hover:z-30"
              style={{
                left: node.x - NODE_W / 2,
                top: node.y - NODE_H / 2 + 12,
                width: NODE_W,
                // @ts-expect-error CSS custom props
                "--bob-delay": bobDelay,
                "--bob-duration": bobDuration,
              }}
            >
              <MapNode
                lesson={lesson}
                progress={progressMap[lesson.id]}
                isSelected={lesson.id === selectedNodeId}
                isDue={dueNodeIds.has(lesson.id)}
                chapterLessonsMastered={chapterLessonsMastered}
                onClick={() => onJumpNode(lesson.id)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- 单个地图节点(多邻国式大圆球) ---------- */
function MapNode({
  lesson,
  progress,
  isSelected,
  isDue,
  chapterLessonsMastered,
  onClick,
}: {
  lesson: ContentNode;
  progress?: Progress;
  isSelected: boolean;
  isDue: boolean;
  /** 同 section 所有 lesson mastery 都 ≥0.5(考试解锁条件)。 */
  chapterLessonsMastered: boolean;
  onClick: () => void;
}) {
  const t = useLang();
  const status = progress?.status ?? "locked";
  const crown = progress?.crownLevel ?? 0;
  const isExam = lesson.type === "exam";
  // 考试节点的星数 = crownLevel(1-3,考试得分)。普通课节点不再用星(crown 只在 mastered 时=5)。
  const examStars = Math.min(3, crown);
  // 锁定逻辑:
  //   - 普通课:status === "locked"(受 mastery≥0.5 硬门控解锁)
  //   - 考试:要求同 section 所有 lesson 都 mastery≥0.5 才解锁(整章通关感)
  const isLocked = isExam ? !chapterLessonsMastered : status === "locked";
  const examLocked = isExam && isLocked; // 考试专属锁定态(用于样式/文案)
  // in_progress(仅普通课):用 mastery 算进度环(0-1 → 0-100%)
  const masteryPct = status === "in_progress" && !isExam ? Math.round((progress?.mastery ?? 0) * 100) : 0;
  // 节点位置由外层布局引擎(MapSection)绝对定位决定,这里只管自身样式。
  // index 仅用于 testid/可访问性,不参与定位(原 alignLeft/margin 逻辑已废弃)。

  return (
    <div className="group relative flex flex-col items-center w-full">
      <button
        onClick={() => !isLocked && onClick()}
        disabled={isLocked}
        data-testid={`${isExam ? "exam-node" : "map-node"}-${lesson.id.slice(0, 8)}`}
        className={`group relative w-14 h-14 flex items-center justify-center text-2xl rounded-full transition-all duration-200 ${
          isExam
            ? examLocked
              ? "lesson-bubble exam-bubble-locked"
              : examBubbleClass(crown > 0)
            : bubbleClass(status)
        } ${isLocked ? "cursor-not-allowed" : "cursor-pointer hover:scale-105"} ${
          isSelected ? "ring-4 ring-accent ring-offset-2 ring-offset-neutral-50 dark:ring-offset-neutral-950" : ""
        }`}
        title={undefined}
        data-tooltip={
          examLocked
            ? `🔒 ${lesson.title}${t("node.locked.chapterHint")}`
            : isExam
              ? `🎯 ${lesson.title}`
              : isLocked
                ? `🔒 ${lesson.title}`
                : isDue
                  ? `📖 ${lesson.title}${t("node.due.hint")}`
                  : lesson.title
        }
      >
        {/* in_progress 进度环(仅普通课;考试不画进度环) */}
        {status === "in_progress" && !isExam && (
          <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 56 56" aria-hidden="true">
            <circle cx="28" cy="28" r="25" fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="2.5" />
            <circle
              cx="28" cy="28" r="25"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${(masteryPct / 100) * 157} 157`}
              className="transition-all duration-500"
            />
          </svg>
        )}
        {isExam ? (
          // 考试节点:锁定态显示 🔒,解锁后 🎯
          examLocked ? (
            <span aria-label="exam-locked" className="relative z-10 opacity-60">🔒</span>
          ) : (
            <Target aria-label="exam" className="relative z-10 w-6 h-6 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]" strokeWidth={2.5} />
          )
        ) : isLocked ? (
          <span aria-label="locked" className="relative z-10 opacity-50">🔒</span>
        ) : status === "mastered" ? (
          <span aria-label="mastered" className="relative z-10 drop-shadow-lg crown-sparkle">👑</span>
        ) : status === "in_progress" ? (
          <BookOpen aria-label="in-progress" className="relative z-10 w-6 h-6 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]" strokeWidth={2.5} />
        ) : (
          <span aria-label="available" className="relative z-10 drop-shadow">⭐</span>
        )}
        {/* 待复习标记(仅普通课) */}
        {isDue && !isLocked && !isExam && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-review text-white text-caption flex items-center justify-center font-bold border-2 border-neutral-50 dark:border-neutral-950">
            !
          </span>
        )}
      </button>

      {/* 星星(仅考试节点:显示考试得分 1-3 星)。普通课节点不再显示星星。 */}
      {isExam && (
        <div className="flex gap-0.5 mt-1" data-testid={`map-stars-${lesson.id.slice(0, 8)}`}>
          {[0, 1, 2].map((s) => (
            <span
              key={s}
              className={`text-caption ${s < examStars ? "text-gold" : "text-white/25"}`}
            >
              ★
            </span>
          ))}
        </div>
      )}

      {/* 节点名:仅选中态常驻显示(绿牌)。其余节点名靠 hover 的 GlobalTooltip(data-tooltip)显示,
          保持地图干净——只有焦点节点有文字标签。 */}
      {isSelected && (
        <div className="mt-1 text-caption text-center leading-tight max-w-[120px] font-bold px-1.5 py-0.5 rounded-md bg-brand/90 text-white shadow-sm">
          {lesson.title}
        </div>
      )}
    </div>
  );
}

/* ---------- 样式辅助 ---------- */
function bubbleClass(status: string): string {
  // 复用 v0.1 的 lesson-bubble 3D 样式(在 index.css)
  switch (status) {
    case "locked": return "lesson-bubble lesson-bubble-locked";
    case "available": return "lesson-bubble lesson-bubble-available";
    case "in_progress": return "lesson-bubble lesson-bubble-in-progress";
    case "mastered": return "lesson-bubble lesson-bubble-mastered";
    default: return "lesson-bubble lesson-bubble-locked";
  }
}
/** 考试节点气泡:紫色(关底 boss 专属色),已通过(有星)时更亮。 */
function examBubbleClass(passed: boolean): string {
  return passed ? "lesson-bubble exam-bubble-passed" : "lesson-bubble exam-bubble";
}

/** 🌐 语言切换器:显示当前语言，点击弹出可用语言列表 */
function LanguageSwitcher({ available, current, onChange }: { available: string[]; current: string | null; onChange: (locale: string | null) => void }) {
  const t = useLang();
  const [open, setOpen] = useState(false);
  // BCP-47 → 显示名（简化版，常见语言）
  const LOCALE_NAMES: Record<string, string> = {
    "zh-CN": "中文", "zh-TW": "繁體", "ja": "日本語", "ko": "한국어", "fr": "Français",
    "de": "Deutsch", "es": "Español", "pt-BR": "Português", "ru": "Русский", "it": "Italiano",
    "ar": "العربية", "hi": "हिन्दी", "tr": "Türkçe", "pl": "Polski", "nl": "Nederlands",
    "id": "Indonesia", "vi": "Tiếng Việt", "th": "ไทย", "sv": "Svenska", "fi": "Suomi",
  };
  const displayName = current ? (LOCALE_NAMES[current] ?? current) : t("lang.original");
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-caption font-bold text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        data-testid="lang-switcher-btn"
      >
        <Globe className="w-3 h-3" />
        {displayName}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 z-50 bg-surface-0 rounded-lg shadow-elevated p-1 min-w-[100px] max-h-48 overflow-y-auto">
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              className={`w-full text-left px-2 py-1 rounded-md text-caption font-bold transition-colors ${current === null ? "bg-brand/15 text-brand" : "text-ink-muted hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
            >
              {t("lang.original")}
            </button>
            {available.map((code) => (
              <button
                key={code}
                onClick={() => { onChange(code); setOpen(false); }}
                className={`w-full text-left px-2 py-1 rounded-md text-caption font-bold transition-colors ${current === code ? "bg-brand/15 text-brand" : "text-ink-muted hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
              >
                {LOCALE_NAMES[code] ?? code}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
