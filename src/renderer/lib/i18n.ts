/**
 * 轻量 i18n 系统 —— 中英文 key-value 字典 + useLang hook。
 *
 * 设计:
 *   - 不引入 i18next 等重型库（过度工程）
 *   - key 用点号命名: "header.streak_days" / "settings.title"
 *   - localStorage 存语言偏好 (lookatstudy-lang)
 *   - 默认 zh-CN（当前 UI 主体是中文）
 *
 * 用法:
 *   const { t } = useLang();
 *   <h1>{t("settings.title")}</h1>
 */

export type Lang = "zh-CN" | "en";

const STORAGE_KEY = "lookatstudy-lang";

// 翻译字典
const translations: Record<Lang, Record<string, string>> = {
  "zh-CN": {
    // Header
    "header.xp": "XP",
    "header.theme.dark": "切换到亮色",
    "header.theme.light": "切换到暗色",
    // Views
    "view.tree": "技能树",
    "view.dashboard": "仪表盘",
    "view.import": "导入课程",
    // Chat modes
    "mode.chat": "💬 对话",
    "mode.exercise": "📝 练习",
    "mode.settings": "⚙️ 设置",
    // Chat
    "chat.starter.hint": "💡 从下面选一个开始，或者直接输入你的问题",
    "chat.no_key.title": "还没有配置 AI 模型",
    "chat.no_key.desc": "配置后即可开始 AI 导师对话和练习",
    "chat.no_key.btn": "⚙️ 去配置模型",
    "chat.input.placeholder": "问 AI 导师…（Enter 发送）",
    "chat.input.no_node": "先在右侧选一个 lesson…",
    "chat.send": "发送",
    "chat.stop": "停止",
    "chat.clear": "清空对话历史",
    // Settings
    "settings.title": "⚙️ 设置",
    "settings.provider": "AI 服务商（Provider）",
    "settings.model": "模型（Model）",
    "settings.apikey": "API Key",
    "settings.test": "测试连接",
    "settings.testing": "测试中…",
    "settings.save": "保存设置",
    "settings.saved": "✅ 已保存",
    "settings.daily_goal": "每日学习目标（XP）",
    "settings.custom.add": "＋ 添加自定义 Provider",
    "settings.language": "语言（Language）",
    // Exercise
    "exercise.title": "📝 练习",
    "exercise.generate": "出一道练习",
    "exercise.submit": "提交答案",
    "exercise.next": "下一题 →",
    "exercise.correct": "✅ 答对了！",
    "exercise.wrong": "❌ 答错了",
    "exercise.types.mcq": "选择题",
    "exercise.types.fill_blank": "填空题",
    "exercise.types.true_false": "判断题",
    // Dashboard
    "dashboard.title": "学习仪表盘",
    "dashboard.stat.streak": "连续天数",
    "dashboard.stat.due": "今日待复习",
    "dashboard.stat.mastery": "整体掌握度",
    "dashboard.review": "去复习",
    "dashboard.cleared": "已清空",
    "dashboard.export.md": "📄 导出报告",
    "dashboard.export.json": "导出 JSON",
    "dashboard.section_mastery": "按章节掌握度",
    // Import
    "import.title": "📚 导入课程",
    "import.url": "GitHub URL",
    "import.markdown": "粘贴 Markdown",
    "import.btn": "导入",
    "import.md_btn": "生成课程",
    // Streak
    "streak.days": "天",
  },
  en: {
    // Header
    "header.xp": "XP",
    "header.theme.dark": "Switch to light",
    "header.theme.light": "Switch to dark",
    // Views
    "view.tree": "Skill Tree",
    "view.dashboard": "Dashboard",
    "view.import": "Import Course",
    // Chat modes
    "mode.chat": "💬 Chat",
    "mode.exercise": "📝 Practice",
    "mode.settings": "⚙️ Settings",
    // Chat
    "chat.starter.hint": "💡 Pick one to start, or type your question",
    "chat.no_key.title": "No AI model configured",
    "chat.no_key.desc": "Configure a model to start AI tutoring and practice",
    "chat.no_key.btn": "⚙️ Configure Model",
    "chat.input.placeholder": "Ask your AI tutor… (Enter to send)",
    "chat.input.no_node": "Select a lesson on the right…",
    "chat.send": "Send",
    "chat.stop": "Stop",
    "chat.clear": "Clear chat history",
    // Settings
    "settings.title": "⚙️ Settings",
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
    // Exercise
    "exercise.title": "📝 Practice",
    "exercise.generate": "Generate a question",
    "exercise.submit": "Submit Answer",
    "exercise.next": "Next →",
    "exercise.correct": "✅ Correct!",
    "exercise.wrong": "❌ Wrong",
    "exercise.types.mcq": "Multiple Choice",
    "exercise.types.fill_blank": "Fill in the Blank",
    "exercise.types.true_false": "True or False",
    // Dashboard
    "dashboard.title": "Learning Dashboard",
    "dashboard.stat.streak": "Streak",
    "dashboard.stat.due": "Due Today",
    "dashboard.stat.mastery": "Overall Mastery",
    "dashboard.review": "Review",
    "dashboard.cleared": "Cleared",
    "dashboard.export.md": "📄 Export Report",
    "dashboard.export.json": "Export JSON",
    "dashboard.section_mastery": "Mastery by Section",
    // Import
    "import.title": "📚 Import Course",
    "import.url": "GitHub URL",
    "import.markdown": "Paste Markdown",
    "import.btn": "Import",
    "import.md_btn": "Generate Course",
    // Streak
    "streak.days": "days",
  },
};

/** 获取当前语言 */
export function getLang(): Lang {
  if (typeof localStorage === "undefined") return "zh-CN";
  const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
  return saved || "zh-CN";
}

/** 设置语言 */
export function setLang(lang: Lang): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, lang);
  }
}

/** 翻译函数 */
export function translate(key: string, lang: Lang = getLang()): string {
  return translations[lang]?.[key] ?? translations["zh-CN"]?.[key] ?? key;
}
