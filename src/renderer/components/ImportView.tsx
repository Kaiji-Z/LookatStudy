/**
 * 导入课程页 —— 把任意 GitHub repo 或 markdown 变成 LookatStudy 课程。
 *
 * 两种导入方式:
 *   A) GitHub URL：粘贴 repo URL → 后端拉 README.md → 解析成章节/课时树
 *   B) Markdown 粘贴：直接贴 markdown 文本（适合网络受限/私有 repo/本地文档）
 *
 * 导入成功后自动选中新课程并留在原地刷新课程列表（不跳转回主界面）。
 *
 * 还支持:课程列表（切换/删除）—— 让用户管理已导入的多门课程。
 */
import { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import type { Course } from "@shared/types";

export function ImportView({
  onCoursesChanged,
  courses,
  selectedCourseId,
  onSelectCourse,
}: {
  /** 课程列表有变动(导入/删除)时调,只刷新列表,不跳转回主界面 */
  onCoursesChanged: () => void;
  courses: Course[];
  selectedCourseId: string | null;
  /** 切换当前课程(用户点了"切换"按钮,会跳转回地图) */
  onSelectCourse: (id: string) => void;
}) {
  const [tab, setTab] = useState<"url" | "markdown" | "folder">("url");
  const [repoUrl, setRepoUrl] = useState("");
  const [mdText, setMdText] = useState("");
  const [repoName, setRepoName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);

  // 订阅导入进度
  useEffect(() => {
    const off = api.on("import:progress", (msg: string) => setProgressMsg(msg));
    return () => off();
  }, []);

  const handleImportUrl = async () => {
    if (!repoUrl.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setProgressMsg(null);
    try {
      const course = await api.importCourseFromRepo(repoUrl.trim());
      setSuccess(`导入成功：${course.title}（${course.repoName}）`);
      setTimeout(() => onCoursesChanged(), 800);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message}\n\n如果是网络受限或私有仓库，请改用「粘贴 Markdown」方式。`
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleImportMd = async () => {
    if (!mdText.trim() || !repoName.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const course = await api.generateCourseFromMarkdown(
        mdText.trim(),
        repoName.trim(),
      );
      setSuccess(`生成成功：${course.title}`);
      setTimeout(() => onCoursesChanged(), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleImportFolder = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setProgressMsg(null);
    try {
      const course = await api.importLocalFolder();
      if (!course) {
        // 用户取消选择
        setBusy(false);
        return;
      }
      setSuccess(`导入成功：${course.title}（${course.repoName}）`);
      setTimeout(() => onCoursesChanged(), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (courseId: string, title: string) => {
    if (!confirm(`确定删除课程「${title}」？所有进度和练习都会被清除。`)) return;
    try {
      await api.deleteCourse(courseId);
      setSuccess(`已删除：${title}`);
      onCoursesChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">📚 导入课程</h2>
      <p className="text-sm text-neutral-400">
        把任意 GitHub Markdown 仓库变成 Duolingo 式课程。系统会按 H2/H3 标题拆成章节/课时。
      </p>

      {/* 方式切换 */}
      <div className="flex gap-2 border-b border-neutral-200 dark:border-neutral-800">
        <button
          onClick={() => setTab("url")}
          className={`px-4 py-2 text-sm border-b-2 ${tab === "url" ? "border-brand text-brand" : "border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-300"}`}
        >
          GitHub URL
        </button>
        <button
          onClick={() => setTab("markdown")}
          className={`px-4 py-2 text-sm border-b-2 ${tab === "markdown" ? "border-brand text-brand" : "border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-300"}`}
        >
          粘贴 Markdown
        </button>
        <button
          onClick={() => setTab("folder")}
          className={`px-4 py-2 text-sm border-b-2 ${tab === "folder" ? "border-brand text-brand" : "border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-300"}`}
        >
          本地文件夹
        </button>
      </div>

      {tab === "url" ? (
        <section className="space-y-3" data-testid="import-url-section">
          <label className="text-sm text-neutral-700 dark:text-neutral-300 block">GitHub 仓库 URL</label>
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            data-testid="repo-url-input"
            className="w-full bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-sm rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none"
          />
          <button
            onClick={handleImportUrl}
            disabled={!repoUrl.trim() || busy}
            data-testid="import-url-btn"
            className="btn-3d-brand px-4 py-2.5 text-sm disabled:opacity-40"
          >
            {busy ? "导入中…" : "导入"}
          </button>
          <p className="text-[11px] text-neutral-600">
            会拉取仓库根目录的 README.md（自动试 main/master 分支）。
          </p>
        </section>
      ) : tab === "markdown" ? (
        <section className="space-y-3" data-testid="import-md-section">
          <div>
            <label className="text-sm text-neutral-700 dark:text-neutral-300 block mb-1">课程名称</label>
            <input
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="例如：React 学习指南"
              data-testid="md-name-input"
              className="w-full bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-sm rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-neutral-700 dark:text-neutral-300 block mb-1">Markdown 内容</label>
            <textarea
              value={mdText}
              onChange={(e) => setMdText(e.target.value)}
              placeholder={"# 课程标题\n\n## 第一章\n\n### 课时1：基础\n内容...\n\n### 课时2：进阶\n..."}
              rows={10}
              data-testid="md-text-input"
              className="w-full bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 text-sm rounded px-3 py-2 border border-neutral-300 dark:border-neutral-700 focus:border-brand focus:outline-none font-mono"
            />
            <p className="text-[11px] text-neutral-600 mt-1">
              H2 (##) → 章节，H3 (###) → 课时。支持 GitHub Flavored Markdown。
            </p>
          </div>
          <button
            onClick={handleImportMd}
            disabled={!mdText.trim() || !repoName.trim() || busy}
            data-testid="import-md-btn"
            className="btn-3d-brand px-4 py-2.5 text-sm disabled:opacity-40"
          >
            {busy ? "生成中…" : "生成课程"}
          </button>
        </section>
      ) : (
        <section className="space-y-3" data-testid="import-folder-section">
          <label className="text-sm text-neutral-700 dark:text-neutral-300 block">选择本地课程文件夹</label>
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            递归扫描文件夹下的 .txt / .md / .html / .pdf,自动提取内容转为课程。
            适合已下载的课程资料包(如 Coursera/edX 下载内容)。同内容的中文版(.zh-CN)优先于英文版(.en)。
          </p>
          <button
            onClick={handleImportFolder}
            disabled={busy}
            data-testid="import-folder-btn"
            className="btn-3d-brand px-4 py-2.5 text-sm disabled:opacity-40"
          >
            {busy ? "处理中…" : "📁 选择文件夹并导入"}
          </button>
          <p className="text-[11px] text-neutral-600">
            导入后会自动用 AI 重组章节结构(需配 API key;无 key 则按文件夹目录结构切分)。
          </p>
        </section>
      )}

      {/* 反馈 */}
      {busy && progressMsg && (
        <div className="bg-neutral-100 dark:bg-neutral-900/50 text-neutral-700 dark:text-neutral-300 text-sm rounded p-3 flex items-center gap-2" data-testid="import-progress">
          <span className="inline-block w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin shrink-0"></span>
          {progressMsg}
        </div>
      )}
      {error && (
        <div className="surface-card p-3 border-red-800/50 text-red-300 text-sm whitespace-pre-wrap" data-testid="import-error">
          ❌ {error}
        </div>
      )}
      {success && (
        <div className="surface-card p-3 border-brand/30 text-brand text-sm" data-testid="import-success">
          ✅ {success}
        </div>
      )}

      {/* 已导入课程列表 */}
      <section className="pt-4 border-t border-neutral-200 dark:border-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">已导入的课程</h3>
        {courses.length === 0 ? (
          <p className="text-xs text-neutral-600">还没有课程。用上面的方式导入第一个吧。</p>
        ) : (
          <ul className="space-y-2" data-testid="course-list">
            {courses.map((c) => (
              <li
                key={c.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  c.id === selectedCourseId ? "border-brand bg-brand/5" : "border-neutral-800"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">{c.title}</div>
                  <div className="text-[11px] text-neutral-500">{c.repoName}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {c.id !== selectedCourseId && (
                    <button
                      onClick={() => {
                        onSelectCourse(c.id);
                        onCoursesChanged();
                      }}
                      className="text-xs text-brand hover:underline"
                    >
                      切换
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(c.id, c.title)}
                    className="text-xs text-red-400 hover:underline"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
