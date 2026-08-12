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
    "import.progress.title": "正在导入课程…",
    "import.progress.starting": "正在启动…",

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
    "settings.group.ai": "AI 模型",
    "settings.group.vision": "AI 看图",
    "settings.group.appearance": "外观与语言",
    "settings.row.provider": "服务商",
    "settings.row.theme": "主题",
    "settings.row.interface_lang": "界面语言",
    "settings.row.import_lang": "导入偏好",
    "settings.custom.form_title": "添加自定义 Provider",
    "settings.footer.hint": "AI 模型区的改动需保存后生效,其余即时生效",
    "settings.footer.save": "保存 AI 配置",
    "header.energy": "今日能量",
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
    "chat.input.no_node": "先在左侧选一个 lesson…",
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

    // —— 设置页扩展(SettingsView 全量 i18n)——
    "settings.add_custom": "自定义",
    "settings.custom.label_ph": "名称",
    "settings.custom.baseurl_ph": "Base URL(如 https://api.example.com/v1)",
    "settings.custom.model_ph": "模型 ID",
    "settings.custom.apikey_ph": "API Key(可选)",
    "settings.custom.save": "保存",
    "settings.delete_custom": "删除此自定义 Provider",
    "settings.delete_custom_confirm": "删除自定义 Provider「{name}」?无法撤销。",
    "settings.key.overwrite_ph": "覆盖…",
    "settings.key.paste_ph": "粘贴 key",
    "settings.key.get": "获取 →",
    "settings.refresh": "刷新",
    "settings.discovering": "刷新中…",
    "settings.discover_failed": "刷新失败(可能网络受限)",
    "settings.daily_goal.hint": "XP / 天(每答对一题 +10 XP)",
    "settings.heading.theme": "外观",
    "settings.theme.auto": "跟随系统",
    "settings.theme.light": "浅色",
    "settings.theme.dark": "深色",
    "settings.theme.following": "当前跟随系统:{mode}",
    "settings.heading.lang_pref": "语言偏好",
    "settings.lang_pref.desc": "导入课程时自动按此偏好选择翻译。仓库原文语言与偏好一致时直接用原文;无对应翻译时也用原文。",
    "settings.img_download": "图片下载",
    "settings.img_download.desc": "导入课程时自动下载 md/notebook 里引用的图片(默认开启)",
    "settings.multimodal.toggle": "AI 看图(聊天时)",
    "settings.multimodal.toggle.desc": "开启后,聊天时 AI 能看到当前课关联的图片并讲解;问图/图表/架构图时生效(需 vision 模型)。导入时下载图片由上面的「图片下载」控制。",
    "settings.multimodal.current_model": "当前主模型:{model}",
    "settings.multimodal.not_selected": "(未选)",
    "settings.multimodal.hint_custom": "自定义 provider — 视觉能力未知。如不支持看图,在下方覆盖一个 vision 模型。",
    "settings.multimodal.hint_preset": "如当前模型不支持 vision,可在下方配置专门的 vision 模型。常见:GLM-4V / GPT-4o / Claude 3.5 / Gemini。",
    "settings.multimodal.override_title": "Vision 模型覆盖(可选 — 留空则复用主模型)",
    "settings.multimodal.no_override": "(不覆盖 — 用主模型)",
    "settings.multimodal.group_preset": "预设 Provider",
    "settings.multimodal.group_custom": "自定义 Provider",
    "settings.multimodal.vision_capable": "vision",
    "settings.multimodal.save_override": "保存覆盖配置",
    "settings.saved_text": "已保存",
    "settings.key.configured": "已配置",
    "settings.custom.test_label": "(测试)",
    "settings.proto.openai": "OpenAI 兼容",

    // —— Chat(空状态/摘要/笔记/提议/复制/工具标签)——
    "chat.empty.overview": "这是这一课的概览",
    "chat.empty.summary.title": "本课摘要",
    "chat.empty.summary.none": "暂无摘要,点开始学习让 AI 帮你了解这一课",
    "chat.empty.start": "开始学习",
    "chat.empty.quick_hint": "或从下面的快捷按钮选一个",
    "chat.empty.no_node.title": "从左侧地图选一个节点",
    "chat.empty.no_node.desc": "点击圆球节点开始学习。绿色=可学,金色=已掌握,紫色=章节考试",
    "chat.scroll.bottom": "回到底部",
    "chat.note.add": "加笔记",
    "chat.note.add.title": "把这段对话存到记录区",
    "chat.reasoning.label": "思考过程",
    "chat.reasoning.chars": "{n} 字",
    "chat.proposal.title": "AI 提议",
    "chat.proposal.fallback": "提议({tool})",
    "chat.proposal.apply": "应用",
    "chat.proposal.reject": "拒绝",
    "chat.copy": "复制",
    "chat.copied": "已复制",
    "chat.tool.get_node_info": "读取节点信息",
    "chat.tool.record_answer": "记录答题观测",
    "chat.tool.mark_mastered": "标记掌握",
    "chat.tool.show_concept_map": "生成概念图",
    "chat.tool.generate_quiz": "出练习题",
    "chat.tool.compare_table": "生成对比表",
    "chat.tool.draw_diagram": "画流程图",
    "chat.tool.show_code_walkthrough": "代码讲解",

    // —— Thread(会话标签)——
    "thread.empty.no_node": "未选节点",
    "thread.empty.hint": "输入问题开始",
    "thread.actions.label": "操作",
    "thread.new.label": "新建会话",
    "thread.menu.rename": "重命名",
    "thread.menu.archive": "归档",
    "thread.delete.confirm": "删除会话「{name}」?消息也会一并删除。",

    // —— Notebook(康奈尔笔记:讲解/笔记标签全量文案)——
    "notebook.empty.select_node": "从左侧地图选一个节点开始学习,讲解会显示在这里",
    "notebook.empty.no_notes_message": "这一节还没有笔记。选中讲解文字「加笔记」,或问 AI「画个概念图」「出 3 道题」「做个对比表」",
    "notebook.node_type.section": "章节",
    "notebook.node_type.concept": "概念",
    "notebook.node_type.lesson": "课时",
    "notebook.content.loading": "正在加载这一节的讲解…",
    "notebook.content.load_failed": "内容加载失败。",
    "notebook.content.retry": "重试",
    "notebook.content.render_failed": "这段内容渲染失败(可能翻译格式有问题)。",
    "notebook.content.truncated": "…(截断)",
    "notebook.content.retry_render": "重试渲染",
    "notebook.content.empty": "这一节还没有讲解内容。问 AI 导师:「给我讲讲这一节」",
    "notebook.images.heading": "插图({n})",
    "notebook.quote.template": "关于这段内容「{text}」,我不太懂,请帮我解释:",
    "notebook.quote.ask": "提问",
    "notebook.quote.add_note": "加笔记",
    "notebook.quote.save_note.title": "把选中文字存到记录区,带溯源跳转",
    "notebook.quote.hint": "选中讲解文字点「加笔记」;AI 生成的概念图/对比表/练习卡会自动进「笔记」标签",
    "notebook.source.label": "来源",
    "notebook.source.jump_content": "跳到讲解原位",
    "notebook.source.jump_chat": "跳到对话原位",
    "notebook.zone.understand.subtitle": "AI 帮你梳理的知识结构",
    "notebook.zone.understand.empty_hint": "问 AI「画个概念图」「做个对比表」梳理这一节",
    "notebook.zone.note.subtitle": "你的画线,点击可跳回原位",
    "notebook.zone.note.empty_hint": "选中讲解或对话的文字,点「加笔记」存到这里",
    "notebook.zone.practice.subtitle_empty": "做题检验掌握,可重做",
    "notebook.zone.practice.subtitle_stats": "{n} 题 · 上次答对 {c} · 答错 {w}",
    "notebook.zone.practice.empty_hint": "问 AI「出 3 道题考考我」,题目会自动进这里",
    "notebook.note.comment.ph_new": "写下你对这段画线的注释…",
    "notebook.note.comment.ph_edit": "编辑注释…(清空保存即可删除)",
    "notebook.action.save": "保存",
    "notebook.action.cancel": "取消",
    "notebook.note.edit_comment": "编辑注释",
    "notebook.note.add_comment": "加注释",
    "notebook.note.pinned": "已置顶",
    "notebook.note.pin": "置顶",
    "notebook.note.unpin": "取消置顶",
    "notebook.note.delete": "删除",
    "notebook.quiz.last_correct": "上次答对",
    "notebook.quiz.last_wrong": "上次答错",
    "notebook.artifact.broken": "产物数据损坏",
    "notebook.asset.loading": "加载中…",

    // —— Exam(考试页)——
    "exam.loading": "正在生成章节考试题…",
    "exam.errorTitle": "考试加载失败",
    "exam.errorEmpty": "题目生成失败,请稍后重试",
    "exam.reload": "重新加载",
    "exam.question.label": "第 {n} 题",
    "exam.next": "下一题",
    "exam.submit": "提交考试",
    "exam.accuracy": "正确率 {n}%",
    "exam.stars.congrats": "恭喜,获得 {n} 星!",
    "exam.stars.thisAndBest": "本次 {n} 星 · 历史最佳 {m} 星",
    "exam.stars.failed": "未达 60%,再接再厉",
    "exam.review.title": "逐题回顾",
    "exam.review.questionFallback": "(题目 {n})",
    "exam.review.yourAnswer": "你的答案:",
    "exam.review.correctAnswer": "正确:",
    "exam.review.unanswered": "(未答)",
    "exam.retry": "重新考试(题目已缓存)",

    // —— Error / Artifacts / Quiz 产物 ——
    "error.renderFailed": "这部分内容渲染失败(可能格式有问题)。",
    "error.retry": "重试",
    "artifact.unknownHeader": "产物(未识别类型)",
    "artifact.zoomOut": "缩小",
    "artifact.zoomReset": "重置缩放",
    "artifact.zoomIn": "放大",
    "artifact.conceptmap.stats": "{nodes} 个概念 · {edges} 个关系 · Ctrl+滚轮缩放 · 拖动平移",
    "artifact.codewalk.sectionLabel": "逐段讲解(点击定位代码)",
    "artifact.codewalk.lineSingle": "第 {n} 行",
    "artifact.codewalk.lineRange": "第 {a}-{b} 行",
    "artifact.diagram.flowchart": "流程图",
    "artifact.diagram.sequence": "时序图",
    "artifact.diagram.state": "状态图",
    "artifact.mermaid.openLive": "在 mermaid.live 打开(可编辑)",
    "artifact.mermaid.rendering": "渲染图中…",
    "artifact.mermaid.renderFailed": "渲染失败,显示源码(可复制到 mermaid.live 查看)",
    "artifact.mermaid.errorPrefix": "错误: {msg}",
    "artifact.mermaid.hint": "Ctrl+滚轮缩放 · 拖动平移查看",
    "quiz.questionProgress": "第 {cur}/{total} 题",
    "quiz.answeredCorrect": "已答对 {n}",
    "quiz.correct": "答对了",
    "quiz.wrong": "答错了",
    "quiz.finish": "完成练习",
    "quiz.scoreSummary": "{correct}/{total} 答对",
    "quiz.allCorrectHint": "全部答对,掌握度已提议更新",
    "quiz.tryAgainHint": "再练一组巩固一下",

    // —— Import(补充)——
    "import.deleted": "已删除:{title}",

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
    "import.progress.title": "Importing course…",
    "import.progress.starting": "Starting…",

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
    "settings.group.ai": "AI Model",
    "settings.group.vision": "AI Vision",
    "settings.group.appearance": "Appearance & Language",
    "settings.row.provider": "Provider",
    "settings.row.theme": "Theme",
    "settings.row.interface_lang": "Interface language",
    "settings.row.import_lang": "Import preference",
    "settings.custom.form_title": "Add custom provider",
    "settings.footer.hint": "AI Model changes need Save; everything else is instant.",
    "settings.footer.save": "Save AI config",
    "header.energy": "Today's energy",
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
    "chat.input.no_node": "Select a lesson on the left…",
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

    // —— Settings page full i18n ——
    "settings.add_custom": "Custom",
    "settings.custom.label_ph": "Name",
    "settings.custom.baseurl_ph": "Base URL (e.g. https://api.example.com/v1)",
    "settings.custom.model_ph": "Model ID",
    "settings.custom.apikey_ph": "API Key (optional)",
    "settings.custom.save": "Save",
    "settings.delete_custom": "Delete this custom provider",
    "settings.delete_custom_confirm": "Delete custom provider \"{name}\"? This cannot be undone.",
    "settings.key.overwrite_ph": "Overwrite…",
    "settings.key.paste_ph": "Paste key",
    "settings.key.get": "Get key →",
    "settings.refresh": "Refresh",
    "settings.discovering": "Refreshing…",
    "settings.discover_failed": "Refresh failed (network may be restricted)",
    "settings.daily_goal.hint": "XP / day (+10 XP per correct answer)",
    "settings.heading.theme": "Appearance",
    "settings.theme.auto": "System",
    "settings.theme.light": "Light",
    "settings.theme.dark": "Dark",
    "settings.theme.following": "Following system: {mode}",
    "settings.heading.lang_pref": "Language Preference",
    "settings.lang_pref.desc": "When importing a course, auto-pick the translation matching this preference. If the repo's source language already matches, the original is used; if no translation exists, the original is used as well.",
    "settings.img_download": "Image download",
    "settings.img_download.desc": "Auto-download images referenced in markdown/notebooks during import (on by default)",
    "settings.multimodal.toggle": "AI vision (in chat)",
    "settings.multimodal.toggle.desc": "When on, the AI can see and explain this lesson's images during chat — used for diagrams/charts/architecture (needs a vision model). Import-time image download is controlled by “Image download” above.",
    "settings.multimodal.current_model": "Current main model: {model}",
    "settings.multimodal.not_selected": "(none)",
    "settings.multimodal.hint_custom": "Custom provider — vision capability unknown. If it can't see images, override a vision model below.",
    "settings.multimodal.hint_preset": "If the current model lacks vision, configure a dedicated vision model below. Common: GLM-4V / GPT-4o / Claude 3.5 / Gemini.",
    "settings.multimodal.override_title": "Vision model override (optional — leave blank to reuse main model)",
    "settings.multimodal.no_override": "(no override — use main model)",
    "settings.multimodal.group_preset": "Preset providers",
    "settings.multimodal.group_custom": "Custom providers",
    "settings.multimodal.vision_capable": "vision",
    "settings.multimodal.save_override": "Save override",
    "settings.saved_text": "Saved",
    "settings.key.configured": "Configured",
    "settings.custom.test_label": "(test)",
    "settings.proto.openai": "OpenAI-compatible",

    // —— Chat (empty state / summary / note / proposal / copy / tool labels) ——
    "chat.empty.overview": "Overview of this lesson",
    "chat.empty.summary.title": "Lesson Summary",
    "chat.empty.summary.none": "No summary yet — click Start to let the AI walk you through this lesson.",
    "chat.empty.start": "Start Learning",
    "chat.empty.quick_hint": "or pick a quick prompt below",
    "chat.empty.no_node.title": "Pick a node from the map on the left",
    "chat.empty.no_node.desc": "Click a node to start learning. Green = available, Gold = mastered, Purple = chapter exam",
    "chat.scroll.bottom": "Scroll to bottom",
    "chat.note.add": "Add note",
    "chat.note.add.title": "Save this message to your notes",
    "chat.reasoning.label": "Reasoning",
    "chat.reasoning.chars": "{n} chars",
    "chat.proposal.title": "AI Proposal",
    "chat.proposal.fallback": "Proposal ({tool})",
    "chat.proposal.apply": "Apply",
    "chat.proposal.reject": "Reject",
    "chat.copy": "Copy",
    "chat.copied": "Copied",
    "chat.tool.get_node_info": "Read node info",
    "chat.tool.record_answer": "Record answer",
    "chat.tool.mark_mastered": "Mark mastered",
    "chat.tool.show_concept_map": "Generate concept map",
    "chat.tool.generate_quiz": "Generate quiz",
    "chat.tool.compare_table": "Generate comparison table",
    "chat.tool.draw_diagram": "Draw diagram",
    "chat.tool.show_code_walkthrough": "Code walkthrough",

    // —— Thread ——
    "thread.empty.no_node": "No node selected",
    "thread.empty.hint": "Type to start",
    "thread.actions.label": "Actions",
    "thread.new.label": "New thread",
    "thread.menu.rename": "Rename",
    "thread.menu.archive": "Archive",
    "thread.delete.confirm": "Delete thread \"{name}\"? Messages will also be deleted.",

    // —— Notebook (Cornell: explain / notes tab full copy) ——
    "notebook.empty.select_node": "Pick a node from the map on the left — its explanation shows here.",
    "notebook.empty.no_notes_message": "No notes for this lesson yet. Select explanation text to \"Add note\", or ask the AI to \"draw a concept map\", \"generate 3 questions\", or \"make a comparison table\".",
    "notebook.node_type.section": "Chapter",
    "notebook.node_type.concept": "Concept",
    "notebook.node_type.lesson": "Lesson",
    "notebook.content.loading": "Loading this lesson…",
    "notebook.content.load_failed": "Failed to load content. ",
    "notebook.content.retry": "Retry",
    "notebook.content.render_failed": "This content failed to render (possibly malformed translation).",
    "notebook.content.truncated": "…(truncated)",
    "notebook.content.retry_render": "Retry render",
    "notebook.content.empty": "No explanation for this lesson yet. Ask the AI tutor: \"Walk me through this lesson.\"",
    "notebook.images.heading": "Images ({n})",
    "notebook.quote.template": "About this passage 「{text}」, I don't quite get it. Please explain:",
    "notebook.quote.ask": "Ask",
    "notebook.quote.add_note": "Add note",
    "notebook.quote.save_note.title": "Save the selected text to your notes (with source jump)",
    "notebook.quote.hint": "Select any text in the explanation to add a note; AI-generated concept maps, comparison tables, and quiz cards land in the Notes tab automatically.",
    "notebook.source.label": "Source",
    "notebook.source.jump_content": "Jump to explanation",
    "notebook.source.jump_chat": "Jump to chat message",
    "notebook.zone.understand.subtitle": "Knowledge structure the AI lays out for you",
    "notebook.zone.understand.empty_hint": "Ask the AI to \"draw a concept map\" or \"make a comparison table\" to structure this lesson",
    "notebook.zone.note.subtitle": "Your highlights — click to jump back to source",
    "notebook.zone.note.empty_hint": "Select text in the explanation or chat, then \"Add note\" to save here",
    "notebook.zone.practice.subtitle_empty": "Test your grasp; redoable",
    "notebook.zone.practice.subtitle_stats": "{n} questions · last correct {c} · wrong {w}",
    "notebook.zone.practice.empty_hint": "Ask the AI \"give me 3 questions\" — they land here",
    "notebook.note.comment.ph_new": "Write a note about this highlight…",
    "notebook.note.comment.ph_edit": "Edit note… (clear + save to delete)",
    "notebook.action.save": "Save",
    "notebook.action.cancel": "Cancel",
    "notebook.note.edit_comment": "Edit note",
    "notebook.note.add_comment": "Add note",
    "notebook.note.pinned": "Pinned",
    "notebook.note.pin": "Pin",
    "notebook.note.unpin": "Unpin",
    "notebook.note.delete": "Delete",
    "notebook.quiz.last_correct": "Last correct",
    "notebook.quiz.last_wrong": "Last wrong",
    "notebook.artifact.broken": "Broken artifact data",
    "notebook.asset.loading": "Loading…",

    // —— Exam ——
    "exam.loading": "Generating exam questions…",
    "exam.errorTitle": "Exam failed to load",
    "exam.errorEmpty": "Failed to generate questions. Please try again later.",
    "exam.reload": "Reload",
    "exam.question.label": "Question {n}",
    "exam.next": "Next",
    "exam.submit": "Submit Exam",
    "exam.accuracy": "Accuracy {n}%",
    "exam.stars.congrats": "Congratulations! {n} stars earned!",
    "exam.stars.thisAndBest": "This run: {n} stars · Best: {m} stars",
    "exam.stars.failed": "Below 60%. Keep practicing!",
    "exam.review.title": "Question Review",
    "exam.review.questionFallback": "(Question {n})",
    "exam.review.yourAnswer": "Your answer:",
    "exam.review.correctAnswer": "Correct:",
    "exam.review.unanswered": "(no answer)",
    "exam.retry": "Retake exam (questions cached)",

    // —— Error / Artifacts / Quiz ——
    "error.renderFailed": "This content failed to render (possibly malformed).",
    "error.retry": "Retry",
    "artifact.unknownHeader": "Artifact (unknown type)",
    "artifact.zoomOut": "Zoom out",
    "artifact.zoomReset": "Reset zoom",
    "artifact.zoomIn": "Zoom in",
    "artifact.conceptmap.stats": "{nodes} concepts · {edges} relations · Ctrl+scroll to zoom · drag to pan",
    "artifact.codewalk.sectionLabel": "Step-by-step notes (click to jump to code)",
    "artifact.codewalk.lineSingle": "Line {n}",
    "artifact.codewalk.lineRange": "Lines {a}-{b}",
    "artifact.diagram.flowchart": "Flowchart",
    "artifact.diagram.sequence": "Sequence",
    "artifact.diagram.state": "State",
    "artifact.mermaid.openLive": "Open in mermaid.live (editable)",
    "artifact.mermaid.rendering": "Rendering diagram…",
    "artifact.mermaid.renderFailed": "Render failed. Showing source (copy to mermaid.live to view).",
    "artifact.mermaid.errorPrefix": "Error: {msg}",
    "artifact.mermaid.hint": "Ctrl+scroll to zoom · drag to pan",
    "quiz.questionProgress": "Q {cur}/{total}",
    "quiz.answeredCorrect": "{n} correct",
    "quiz.correct": "Correct",
    "quiz.wrong": "Wrong",
    "quiz.finish": "Finish",
    "quiz.scoreSummary": "{correct}/{total} correct",
    "quiz.allCorrectHint": "All correct! Mastery update proposed.",
    "quiz.tryAgainHint": "Practice another set to consolidate.",

    // —— Import (extra) ——
    "import.deleted": "Deleted: {title}",

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
