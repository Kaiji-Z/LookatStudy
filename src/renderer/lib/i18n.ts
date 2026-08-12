/**
 * 轻量 i18n 系统 —— 中英文 key-value 字典 + 响应式 useLang hook。
 *
 * 设计:
 *   - 不引入 i18next 等重型库（过度工程）
 *   - key 用点号命名: "header.streak_days" / "settings.title"
 *   - localStorage 存语言偏好 (lookatstudy-lang)
 *   - 默认 zh-CN（当前 UI 主体是中文）
 *   - v0.8 响应式:useSyncExternalStore 让组件跟随语言切换重渲染,无需 reload
 *     (原 SettingsView 切语言 window.location.reload() 的 hack 已移除)
 *
 * 用法:
 *   const t = useLang();            // 订阅,lang 变化时重渲染
 *   <h1>{t("settings.title")}</h1>
 *   // 非组件上下文(如 toast 回调 / 模块顶层常量):
 *   translate("settings.title");    // 读当前 lang,不订阅
 */

import { useSyncExternalStore, useCallback } from "react";

export type Lang = "zh-CN" | "en";

const STORAGE_KEY = "lookatstudy-lang";

// —— 响应式 store(setLang 通知所有 useLang 订阅者重渲染)——
let currentLang: Lang = (() => {
  if (typeof localStorage === "undefined") return "zh-CN";
  return (localStorage.getItem(STORAGE_KEY) as Lang | null) || "zh-CN";
})();

const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// 翻译字典
const translations: Record<Lang, Record<string, string>> = {
  "zh-CN": {
    // —— Header / 通用动作 ——
    "action.close": "关闭",
    "action.delete": "删除",
    "action.undo": "撤销",
    "action.confirm": "确认",
    "action.cancel": "取消",
    "header.toggleLeft": "切换左栏 (Ctrl+B)",
    "header.toggleRight": "切换右栏",
    "header.font.smaller": "缩小字号",
    "header.font.larger": "放大字号",
    "header.settings": "设置 (Ctrl+S)",
    "header.xp": "XP",
    "header.theme.dark": "切换到亮色",
    "header.theme.light": "切换到暗色",

    // —— 左栏 MapRail ——
    "map.tab.map": "课程地图",
    "map.tab.import": "导入课程",
    "map.course.none": "未选择课程",
    "map.review.due": "待复习",
    "map.world.study": "学习",
    "map.world.practice": "实操",
    "map.streaming.notice": "AI 正在回答,完成后可切换节点",
    "map.generating": "正在生成课程路径…",
    "map.empty.cta.title": "开始你的第一门课",
    "map.empty.cta.desc": "导入一个 GitHub 学习仓库,自动生成选关路径",
    "map.empty.cta.btn": "点这里导入 →",
    "map.empty.practice": "这个课程暂无实操练习内容",
    "node.locked.chapterHint": "(完成本章所有课时后解锁)",
    "node.due.hint": "(待复习)",

    // —— 导入面板 ——
    "import.empty": "还没有课程。用下方导入第一个吧。",
    "import.cta": "导入新课程",
    "import.tab.url": "URL",
    "import.tab.md": "MD",
    "import.tab.folder": "文件夹",
    "import.btn.url": "导入",
    "import.btn.url.busy": "导入中…",
    "import.placeholder.name": "课程名称",
    "import.placeholder.md": "粘贴 Markdown 内容…",
    "import.btn.md": "生成课程",
    "import.btn.md.busy": "生成中…",
    "import.folder.desc": "递归扫描 .txt/.md/.html/.pdf,适合已下载的课程资料包。",
    "import.btn.folder": "选择文件夹",
    "import.btn.folder.busy": "处理中…",
    "import.delete": "删除",
    "import.delete.confirm": "所有进度和练习都会清除,无法撤销。",
    "import.success.md": "生成成功",
    "import.success.folder": "导入成功",
    "import.error.network": "\n\n网络受限或私有仓库请改用「Markdown」方式。",
    "import.progress.elapsed": "已 {s}s",

    // —— Toast ——
    "toast.threadCreateFailed": "会话创建失败,请重试",
    "toast.threadCreated": "已新建会话",
    "toast.threadRenamed": "已重命名",
    "toast.threadArchived": "已归档会话",
    "toast.threadDeleted": "已删除会话",
    "toast.threadDefault": "新会话",
    "toast.restored": "已恢复",
    "toast.noteSaved": "已加到笔记 · 记录区",
    "toast.noteDeleted": "已删除笔记",
    "toast.artifactSaved": "已保存到笔记本",

    // —— 产物类型 ——
    "artifact.type.concept_map": "概念图",
    "artifact.type.quiz": "练习题",
    "artifact.type.compare_table": "对比表",
    "artifact.type.diagram": "流程图",
    "artifact.type.code_walkthrough": "代码讲解",
    "artifact.type.unknown": "产物",

    // —— 命令面板 ——
    "command.placeholder": "输入指令或问题…(↑↓ 选择,Enter 确认)",
    "command.empty.node": "没有匹配的命令",
    "command.empty.nonode": "先在左侧选一个节点,才能用这些命令",
    "command.footer.hint": "AI 导师会根据指令生成对应内容",
    "command.footer.keys": "↵ 确认 · esc 关闭",
    "command.group.node": "基于当前节点",
    "command.group.mode": "学习模式",
    "command.group.nav": "导航",
    "command.explain_simple": "用大白话解释这一节",
    "command.quiz_3": "出 3 道练习题考考我",
    "command.concept_map": "画个概念图理清结构",
    "command.compare_prev": "和上一节做对比表",
    "command.socratic": "切到苏格拉底模式(提问引导)",
    "command.exam_mode": "切到考试冲刺模式",

    // —— 复习 ——
    "review.title": "复习",
    "review.loading": "正在检查哪些课该复习了…",
    "review.empty.title": "还没有复习项",
    "review.empty.desc": "完成一些练习后,这里会出现间隔复习提醒",
    "review.due.count": "个待复习",
    "review.start": "开始复习",
    "review.quadrant.overdue": "逾期",
    "review.quadrant.short": "短期",
    "review.quadrant.long": "长期",
    "review.quadrant.inactive": "待激活",
    "review.quadrant.more": "更多",
    "review.tip": "复习采用 SM-2 间隔重复算法。逾期项优先复习;长期记忆项间隔更长。单次复习封顶 {n} 题,避免积压压垮节奏。",
    "review.selfrated": "✓ 已记录,掌握度已更新",
    "review.selfrate.title": "复习完了吗?给自己打分",
    "review.selfrate.again": "再来一次",
    "review.selfrate.remembered": "记住了",
    "review.selfrate.mastered": "完全掌握",

    // —— 语言切换器 ——
    "lang.original": "原文",

    // —— 错误 ——
    "error.checkReadyFailed": "无法检查就绪状态",

    // —— 笔记本(NotebookPanel)——
    "notebook.tab.explain": "讲解",
    "notebook.tab.notes": "笔记",
    "notebook.zone.understand": "理解",
    "notebook.zone.note": "记录",
    "notebook.zone.practice": "练习",
    "notebook.empty.explain.title": "选一节课开始",
    "notebook.empty.explain.desc": "在左侧地图选一个课时,这里会显示讲解内容",
    "notebook.empty.notes.title": "还没有笔记",
    "notebook.empty.notes.desc": "选中讲解文字画线,或让 AI 生成概念图/对比表,会出现在这里",

    // —— 设置(SettingsView)——
    "settings.heading.provider": "AI 服务商",
    "settings.heading.custom": "自定义 Provider",
    "settings.heading.goal": "学习目标",
    "settings.heading.language": "界面语言",
    "settings.heading.multimodal": "多模态 / 图片",
    "settings.title": "设置",

    // —— Views / 兼容旧 key ——
    "view.tree": "技能树",
    "view.dashboard": "仪表盘",
    "view.import": "导入课程",

    // —— Chat modes(兼容)——
    "mode.chat": "💬 对话",
    "mode.exercise": "📝 练习",
    "mode.settings": "⚙️ 设置",

    // —— Chat ——
    "chat.starter.hint": "💡 从下面选一个开始,或者直接输入你的问题",
    "chat.no_key.title": "还没有配置 AI 模型",
    "chat.no_key.desc": "配置后即可开始 AI 导师对话和练习",
    "chat.no_key.btn": "去配置模型",
    "chat.input.placeholder": "问 AI 导师…(Enter 发送)",
    "chat.input.no_node": "先在右侧选一个 lesson…",
    "chat.send": "发送",
    "chat.stop": "停止",
    "chat.clear": "清空对话历史",
    "chat.selection.quote": "提问这段",
    "chat.mode.label": "模式:",
    "chat.no_key.short": "未配置 AI 模型",
    "chat.no_key.cta": "去配置 →",
    "skill.socratic": "苏格拉底",
    "skill.exam": "考试冲刺",
    "skill.project": "项目实战",
    "skill.review": "复习",
    "skill.socratic.desc": "苏格拉底模式 · 学新概念时用。不直接给答案,用引导性问题帮你自己推导",
    "skill.exam.desc": "考试冲刺模式 · 考前用。模拟真实考试压力,计时答题,答错给标准答案和失分点",
    "skill.project.desc": "项目实战模式 · 想动手时用。每个概念配最小可运行任务,在做中学",
    "skill.review.desc": "复习模式 · 日常巩固用。只出到期的复习题,巩固长期记忆",

    // —— Settings(兼容)——
    "settings.provider": "AI 服务商(Provider)",
    "settings.model": "模型(Model)",
    "settings.apikey": "API Key",
    "settings.test": "测试连接",
    "settings.testing": "测试中…",
    "settings.save": "保存设置",
    "settings.saved": "✅ 已保存",
    "settings.daily_goal": "每日学习目标(XP)",
    "settings.custom.add": "＋ 添加自定义 Provider",
    "settings.language": "语言(Language)",

    // —— Exercise ——
    "exercise.title": "📝 练习",
    "exercise.generate": "出一道练习",
    "exercise.submit": "提交答案",
    "exercise.next": "下一题 →",
    "exercise.correct": "✅ 答对了!",
    "exercise.wrong": "❌ 答错了",
    "exercise.types.mcq": "选择题",
    "exercise.types.fill_blank": "填空题",
    "exercise.types.true_false": "判断题",

    // —— Dashboard ——
    "dashboard.title": "学习仪表盘",
    "dashboard.stat.streak": "连续天数",
    "dashboard.stat.due": "今日待复习",
    "dashboard.stat.mastery": "整体掌握度",
    "dashboard.review": "去复习",
    "dashboard.cleared": "已清空",
    "dashboard.export.md": "📄 导出报告",
    "dashboard.export.json": "导出 JSON",
    "dashboard.section_mastery": "按章节掌握度",

    // —— Import(兼容)——
    "import.title": "导入课程",
    "import.url": "GitHub URL",
    "import.markdown": "粘贴 Markdown",
    "import.btn": "导入",
    "import.md_btn": "生成课程",

    // —— Streak ——
    "streak.days": "天",
    "streak.title": "连续学习 {n} 天 · 最长 {m} 天",
  },
  en: {
    // —— Header / common actions ——
    "action.close": "Close",
    "action.delete": "Delete",
    "action.undo": "Undo",
    "action.confirm": "Confirm",
    "action.cancel": "Cancel",
    "header.toggleLeft": "Toggle left pane (Ctrl+B)",
    "header.toggleRight": "Toggle right pane",
    "header.font.smaller": "Decrease font size",
    "header.font.larger": "Increase font size",
    "header.settings": "Settings (Ctrl+S)",
    "header.xp": "XP",
    "header.theme.dark": "Switch to light",
    "header.theme.light": "Switch to dark",

    // —— MapRail ——
    "map.tab.map": "Course Map",
    "map.tab.import": "Import",
    "map.course.none": "No course selected",
    "map.review.due": "due",
    "map.world.study": "Learn",
    "map.world.practice": "Practice",
    "map.streaming.notice": "AI is responding. Switch nodes after it finishes.",
    "map.generating": "Generating course path…",
    "map.empty.cta.title": "Start your first course",
    "map.empty.cta.desc": "Import a GitHub learning repo to auto-generate a skill path",
    "map.empty.cta.btn": "Click to import →",
    "map.empty.practice": "No practice content for this course",
    "node.locked.chapterHint": "(unlocks after completing all lessons in this chapter)",
    "node.due.hint": "(due for review)",

    // —— Import panel ——
    "import.empty": "No courses yet. Import your first one below.",
    "import.cta": "Import New Course",
    "import.tab.url": "URL",
    "import.tab.md": "MD",
    "import.tab.folder": "Folder",
    "import.btn.url": "Import",
    "import.btn.url.busy": "Importing…",
    "import.placeholder.name": "Course name",
    "import.placeholder.md": "Paste Markdown content…",
    "import.btn.md": "Generate Course",
    "import.btn.md.busy": "Generating…",
    "import.folder.desc": "Recursively scans .txt/.md/.html/.pdf. For downloaded course material packs.",
    "import.btn.folder": "Select Folder",
    "import.btn.folder.busy": "Processing…",
    "import.delete": "Delete",
    "import.delete.confirm": "All progress and exercises will be erased. This cannot be undone.",
    "import.success.md": "Generated",
    "import.success.folder": "Imported",
    "import.error.network": "\n\nFor restricted networks or private repos, use the Markdown method.",
    "import.progress.elapsed": "{s}s elapsed",

    // —— Toast ——
    "toast.threadCreateFailed": "Failed to create thread. Please retry.",
    "toast.threadCreated": "Thread created",
    "toast.threadRenamed": "Renamed",
    "toast.threadArchived": "Thread archived",
    "toast.threadDeleted": "Thread deleted",
    "toast.threadDefault": "New thread",
    "toast.restored": "Restored",
    "toast.noteSaved": "Saved to notes",
    "toast.noteDeleted": "Note deleted",
    "toast.artifactSaved": "Saved to notebook",

    // —— Artifact types ——
    "artifact.type.concept_map": "Concept Map",
    "artifact.type.quiz": "Quiz",
    "artifact.type.compare_table": "Comparison Table",
    "artifact.type.diagram": "Diagram",
    "artifact.type.code_walkthrough": "Code Walkthrough",
    "artifact.type.unknown": "Artifact",

    // —— Command palette ——
    "command.placeholder": "Type a command or question… (↑↓ to select, Enter to confirm)",
    "command.empty.node": "No matching commands",
    "command.empty.nonode": "Select a node on the left first",
    "command.footer.hint": "The AI tutor generates content based on your command",
    "command.footer.keys": "↵ confirm · esc to close",
    "command.group.node": "Current Node",
    "command.group.mode": "Study Mode",
    "command.group.nav": "Navigation",
    "command.explain_simple": "Explain this section in plain words",
    "command.quiz_3": "Give me 3 practice questions",
    "command.concept_map": "Draw a concept map",
    "command.compare_prev": "Compare with the previous section",
    "command.socratic": "Switch to Socratic mode (guided questions)",
    "command.exam_mode": "Switch to Exam prep mode",

    // —— Review ——
    "review.title": "Review",
    "review.loading": "Checking what to review…",
    "review.empty.title": "No reviews yet",
    "review.empty.desc": "Complete some exercises and spaced-repetition reminders will appear here",
    "review.due.count": "due",
    "review.start": "Start Review",
    "review.quadrant.overdue": "Overdue",
    "review.quadrant.short": "Short-term",
    "review.quadrant.long": "Long-term",
    "review.quadrant.inactive": "Inactive",
    "review.quadrant.more": "more",
    "review.tip": "Review uses the SM-2 spaced repetition algorithm. Overdue items first; long-term memory items have longer intervals. Capped at {n} items per session to avoid backlog overwhelm.",
    "review.selfrated": "✓ Recorded. Mastery updated.",
    "review.selfrate.title": "Done reviewing? Rate yourself",
    "review.selfrate.again": "Again",
    "review.selfrate.remembered": "Remembered",
    "review.selfrate.mastered": "Mastered",

    // —— Language switcher ——
    "lang.original": "Original",

    // —— Errors ——
    "error.checkReadyFailed": "Could not check readiness",

    // —— Notebook ——
    "notebook.tab.explain": "Explain",
    "notebook.tab.notes": "Notes",
    "notebook.zone.understand": "Understand",
    "notebook.zone.note": "Notes",
    "notebook.zone.practice": "Practice",
    "notebook.empty.explain.title": "Pick a lesson to start",
    "notebook.empty.explain.desc": "Select a lesson in the map on the left; its explanation shows here.",
    "notebook.empty.notes.title": "No notes yet",
    "notebook.empty.notes.desc": "Highlight text in the explanation, or have the AI generate a concept map / comparison table — it shows up here.",

    // —— Settings ——
    "settings.heading.provider": "AI Provider",
    "settings.heading.custom": "Custom Provider",
    "settings.heading.goal": "Study Goal",
    "settings.heading.language": "Interface Language",
    "settings.heading.multimodal": "Multimodal / Images",
    "settings.title": "Settings",

    // —— Views (legacy) ——
    "view.tree": "Skill Tree",
    "view.dashboard": "Dashboard",
    "view.import": "Import Course",

    // —— Chat modes (legacy) ——
    "mode.chat": "💬 Chat",
    "mode.exercise": "📝 Practice",
    "mode.settings": "⚙️ Settings",

    // —— Chat ——
    "chat.starter.hint": "💡 Pick one to start, or type your question",
    "chat.no_key.title": "No AI model configured",
    "chat.no_key.desc": "Configure a model to start AI tutoring and practice",
    "chat.no_key.btn": "Configure Model",
    "chat.input.placeholder": "Ask your AI tutor… (Enter to send)",
    "chat.input.no_node": "Select a lesson on the right…",
    "chat.send": "Send",
    "chat.stop": "Stop",
    "chat.clear": "Clear chat history",
    "chat.selection.quote": "Ask about this",
    "chat.mode.label": "Mode:",
    "chat.no_key.short": "AI model not configured",
    "chat.no_key.cta": "Configure →",
    "skill.socratic": "Socratic",
    "skill.exam": "Exam prep",
    "skill.project": "Project",
    "skill.review": "Review",
    "skill.socratic.desc": "Socratic mode · for new concepts. Guiding questions instead of direct answers, so you derive and truly understand",
    "skill.exam.desc": "Exam prep mode · before tests. Timed practice under real exam pressure, with standard answers and point-loss analysis",
    "skill.project.desc": "Project mode · for hands-on learners. Each concept pairs with a minimal runnable task — learn by doing",
    "skill.review.desc": "Review mode · daily reinforcement. Only due review items to consolidate long-term memory",

    // —— Settings (legacy) ——
    "settings.provider": "AI Provider",
    "settings.model": "Model",
    "settings.apikey": "API Key",
    "settings.test": "Test Connection",
    "settings.testing": "Testing…",
    "settings.save": "Save Settings",
    "settings.saved": "✅ Saved",
    "settings.daily_goal": "Daily Goal (XP)",
    "settings.custom.add": "＋ Add Custom Provider",
    "settings.language": "Language",

    // —— Exercise ——
    "exercise.title": "📝 Practice",
    "exercise.generate": "Generate a question",
    "exercise.submit": "Submit Answer",
    "exercise.next": "Next →",
    "exercise.correct": "✅ Correct!",
    "exercise.wrong": "❌ Wrong",
    "exercise.types.mcq": "Multiple Choice",
    "exercise.types.fill_blank": "Fill in the Blank",
    "exercise.types.true_false": "True or False",

    // —— Dashboard ——
    "dashboard.title": "Learning Dashboard",
    "dashboard.stat.streak": "Streak",
    "dashboard.stat.due": "Due Today",
    "dashboard.stat.mastery": "Overall Mastery",
    "dashboard.review": "Review",
    "dashboard.cleared": "Cleared",
    "dashboard.export.md": "📄 Export Report",
    "dashboard.export.json": "Export JSON",
    "dashboard.section_mastery": "Mastery by Section",

    // —— Import (legacy) ——
    "import.title": "Import Course",
    "import.url": "GitHub URL",
    "import.markdown": "Paste Markdown",
    "import.btn": "Import",
    "import.md_btn": "Generate Course",

    // —— Streak ——
    "streak.days": "days",
    "streak.title": "{n}-day streak · longest {m} days",
  },
};

/** 获取当前语言 */
export function getLang(): Lang {
  return currentLang;
}

/** 设置语言(通知所有 useLang 订阅者重渲染,无需 reload) */
export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, lang);
  }
  listeners.forEach((l) => l());
}

/** 翻译函数(非组件上下文用:读当前 lang,不订阅)。
 *  支持简单占位符:translate("key", lang, { n: 10 }) → "key" 中的 {n} 被替换。 */
export function translate(key: string, lang: Lang = currentLang, vars?: Record<string, string | number>): string {
  let s = translations[lang]?.[key] ?? translations["zh-CN"]?.[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** 响应式 hook:组件内用,lang 变化时自动重渲染。返回 translate 函数(绑定当前 lang)。
 *  返回值用 useCallback 稳定身份,只在 lang 变化时换新 —— 可安全放进下游 useCallback 依赖。 */
export function useLang(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(key, lang, vars),
    [lang],
  );
}
