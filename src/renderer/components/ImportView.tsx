/**
 * 导入课程页 —— 把任意 GitHub repo 或 markdown 变成 LookatStudy 课程。
 *
 * 两种导入方式:
 *   A) GitHub URL：粘贴 repo URL → 后端拉 README.md → 解析成章节/课时树
 *   B) Markdown 粘贴：直接贴 markdown 文本（适合网络受限/私有 repo/本地文档）
 *
 * 导入成功后自动选中新课程并跳回技能树视图（由父组件 onImported 回调控制）。
 *
 * 还支持:课程列表（切换/删除）—— 让用户管理已导入的多门课程。
 */
import { useState, useEffect } from "react";
import { api } from "../lib/api.js";
import type { Course } from "@shared/types";

export function ImportView({
  onImported,
  courses,
  selectedCourseId,
  onSelectCourse,
}: {
  onImported: () => void;
  courses: Course[];
  selectedCourseId: string | null;
  onSelectCourse: (id: string) => void;
}) {
  const [tab, setTab] = useState<"url" | "markdown">("url");
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
      setTimeout(() => onImported(), 800);
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
      setTimeout(() => onImported(), 800);
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
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const [restructuring, setRestructuring] = useState<string | null>(null);
  const handleRestructure = async (courseId: string) => {
    if (restructuring) return;
    setRestructuring(courseId);
    setError(null);
    setSuccess(null);
    setProgressMsg(null);
    try {
      const r = await api.restructureCourse(courseId);
      setSuccess(`结构化完成：${r.sectionCount} 章 / ${r.lessonCount} 课`);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestructuring(null);
      setProgressMsg(null);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">📚 导入课程</h2>
      <p className="text-sm text-neutral-400">
        把任意 GitHub Markdown 仓库变成 Duolingo 式课程。系统会按 H2/H3 标题拆成章节/课时。
      </p>

      {/* 方式切换 */}
      <div className="flex gap-2 border-b border-neutral-800">
        <button
          onClick={() => setTab("url")}
          className={`px-4 py-2 text-sm border-b-2 ${tab === "url" ? "border-brand text-brand" : "border-transparent text-neutral-500 hover:text-neutral-300"}`}
        >
          GitHub URL
        </button>
        <button
          onClick={() => setTab("markdown")}
          className={`px-4 py-2 text-sm border-b-2 ${tab === "markdown" ? "border-brand text-brand" : "border-transparent text-neutral-500 hover:text-neutral-300"}`}
        >
          粘贴 Markdown
        </button>
      </div>

      {tab === "url" ? (
        <section className="space-y-3" data-testid="import-url-section">
          <label className="text-sm text-neutral-300 block">GitHub 仓库 URL</label>
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            data-testid="repo-url-input"
            className="w-full bg-neutral-900 text-neutral-100 text-sm rounded px-3 py-2 border border-neutral-700 focus:border-brand focus:outline-none"
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
      ) : (
        <section className="space-y-3" data-testid="import-md-section">
          <div>
            <label className="text-sm text-neutral-300 block mb-1">课程名称</label>
            <input
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="例如：React 学习指南"
              data-testid="md-name-input"
              className="w-full bg-neutral-900 text-neutral-100 text-sm rounded px-3 py-2 border border-neutral-700 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-neutral-300 block mb-1">Markdown 内容</label>
            <textarea
              value={mdText}
              onChange={(e) => setMdText(e.target.value)}
              placeholder={"# 课程标题\n\n## 第一章\n\n### 课时1：基础\n内容...\n\n### 课时2：进阶\n..."}
              rows={10}
              data-testid="md-text-input"
              className="w-full bg-neutral-900 text-neutral-100 text-sm rounded px-3 py-2 border border-neutral-700 focus:border-brand focus:outline-none font-mono"
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
      )}

      {/* 反馈 */}
      {busy && progressMsg && (
        <div className="bg-neutral-900/50 text-neutral-300 text-sm rounded p-3 flex items-center gap-2" data-testid="import-progress">
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
      <section className="pt-4 border-t border-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-300 mb-3">已导入的课程</h3>
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
                  <div className="text-sm font-medium text-neutral-100 truncate">{c.title}</div>
                  <div className="text-[11px] text-neutral-500">{c.repoName}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleRestructure(c.id)}
                    disabled={restructuring !== null}
                    className="text-xs text-accent hover:underline disabled:opacity-40"
                    title="用 AI 分析课程内容，重新组织章节结构（需要配 API key）"
                  >
                    {restructuring === c.id ? "结构化中…" : "🤖 AI 结构化"}
                  </button>
                  {c.id !== selectedCourseId && (
                    <button
                      onClick={() => {
                        onSelectCourse(c.id);
                        onImported();
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
