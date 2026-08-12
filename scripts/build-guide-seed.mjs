/**
 * build-guide-seed.mjs — 把 LookatStudy 使用指南课程定义导出为 seed-course.json。
 * 课程内容直接内联在此文件里（Markdown），脚本生成 SeedData JSON。
 * 不依赖网络 / LLM。跑 npx tsx scripts/build-guide-seed.mjs 重新生成。
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, "..", "src", "main", "assets", "seed-course.json");
const COURSE_ID = "seed-lookatstudy-guide";

// 辅助：把多行数组拼成字符串（避免模板字面量 backtick 冲突）
const m = (...lines) => lines.join("\n");

const sections = [
  {
    title: "快速上手",
    summary: "安装、导入第一个课程、了解三栏布局",
    lessons: [
      {
        title: "欢迎使用 LookatStudy",
        summary: "了解 LookatStudy 是什么、它能帮你做什么",
        content: m(
"# 欢迎使用 LookatStudy",
"",
"**LookatStudy** 是一个本地优先、AI 驱动的桌面学习平台。它能把任意 GitHub 学习仓库或本地文件夹变成一个多邻国式的互动课程——带有技能地图、AI 导师、间隔重复和游戏化激励。",
"",
"## 它能帮你做什么",
"",
"- 📚 **把任何仓库变课程**：粘贴 GitHub URL，或选择本地文件夹，自动解析成有章节、有课程、有测验的结构化课程",
"- 🗺️ **技能地图导航**：多邻国风格的气球节点地图，逐课解锁，视觉化你的学习进度",
"- 🤖 **AI 个人导师**：内置 BKT（贝叶斯知识追踪）掌握度模型，AI 根据你的理解程度动态调整教学策略",
"- 📝 **康奈尔笔记本**：三区设计（理解 / 笔记 / 练习），AI 生成概念图、对比表、流程图，你画线加笔记",
"- 🔁 **间隔重复**：SM-2 算法安排复习，连续打卡 + XP + 皇冠激励持续学习",
"",
"## 设计理念",
"",
"- **本地优先**：所有数据存在本地 SQLite，你的学习记录永远在你手里",
"- **BYO Key**：自带 LLM API Key，你的对话不经过任何中间服务器",
"- **AI 起草、人确认**：AI 永远不直接修改你的学习记录——每次状态变更都通过 Propose → Apply 协议，你审批后才生效",
"",
"## 接下来",
"",
"点开下一课「导入你的第一个课程」，开始你的学习之旅！",
        ),
      },
      {
        title: "导入你的第一个课程",
        summary: "三种导入方式：GitHub URL / 本地文件夹 / 粘贴 Markdown",
        content: m(
"# 导入你的第一个课程",
"",
"LookatStudy 支持三种导入方式，覆盖几乎所有学习材料来源。",
"",
"## 方式一：GitHub URL",
"",
"点击左侧导入课程标签，粘贴 GitHub 仓库地址即可。导入管线会自动：拉取 README 识别课程大纲、扫描完整文件树（支持 9 种文档格式 + 30+ 代码语言）、AI 判断每个文件的角色、AI 设计课程结构、图片自动 base64 内联。",
"",
"进度窗口会实时显示每一步的进展和耗时。",
"",
"## 方式二：本地文件夹",
"",
"点击本地文件夹按钮，选择一个包含学习材料的文件夹。支持递归扫描子目录，自动识别文档、代码、图片。",
"",
"适用场景：下载的 Coursera/Udemy 课程包、本地 clone 的仓库、自己整理的学习笔记文件夹。",
"",
"## 方式三：粘贴 Markdown",
"",
"直接粘贴 Markdown 文本。适用场景：私有仓库、网络受限环境、快速把一段笔记变成课程。",
"",
"## 导入后",
"",
"导入完成后，左侧技能地图会显示课程结构。第一个课时自动解锁——点击气球节点开始学习！",
        ),
      },
      {
        title: "三栏布局导览",
        summary: "技能地图 · AI 对话 · 康奈尔笔记本",
        content: m(
"# 三栏布局导览",
"",
"LookatStudy 采用三栏布局，每一栏对应学习的不同环节。",
"",
"## 左栏：技能地图",
"",
"多邻国风格的气球节点地图：每个气球代表一个课时，点击它过滤中间栏的对话。节点状态从灰色锁定到彩色可学到金色已掌握。按 Ctrl+B 可以折叠/展开左栏。",
"",
"## 中栏：AI 对话",
"",
"与 AI 导师的交互区域：顶部标签页（每个课时可以有多个对话线程）、对话流（AI 回复以流式输出）、底部输入区（含字号调节、技能模式切换、快捷提问按钮）。按 Ctrl+K 打开命令面板，Ctrl+Tab 循环切换对话线程。",
"",
"## 右栏：康奈尔笔记本",
"",
"三区设计的笔记本：讲解 Tab 显示课时正文（Markdown 渲染），可以选中文字画线加笔记。笔记 Tab 包含三个区域——理解区（AI 产物）、笔记区（你的画线笔记）、练习区（测验 + 答题记录）。",
"",
"## 焦点锁定",
"",
"当 AI 正在回复时，切换课时和对话线程会被临时锁定——确保你不会在 AI 输出到一半时丢失上下文。",
        ),
      },
    ],
  },
  {
    title: "技能地图",
    summary: "节点状态、解锁机制、双线推进、章节测验",
    lessons: [
      {
        title: "气球节点与解锁机制",
        summary: "locked → available → in_progress → mastered",
        content: m(
"# 气球节点与解锁机制",
"",
"技能地图上每个气球节点代表一个课时，有四种状态：",
"",
"| 状态 | 外观 | 含义 |",
"|------|------|------|",
"| 🔒 locked | 灰色半透明 | 还未解锁 |",
"| 🟢 available | 彩色可点击 | 已解锁，可以开始学习 |",
"| 🔵 in_progress | 彩色 + 脉冲动画 | 正在学习中 |",
"| ⭐ mastered | 金色光环 | 已掌握（BKT 达标）|",
"",
"## 解锁逻辑",
"",
"LookatStudy 采用双线推进策略，不会让你卡死在某一个课时上：点当前章节任意一课时，同时解锁同章的下一课和下一章节的第一课。实操课时默认 unlocked，不阻塞主线。",
"",
"这意味着你总有至少两个可学的课时——不会因为某一课卡住而完全停滞。",
"",
"## 掌握度判定",
"",
"掌握度由 BKT（贝叶斯知识追踪）模型计算，不是简单的答题正确率。BKT 会根据你的答题历史动态估计你对这个知识点的真实掌握概率。详见第三章。",
        ),
      },
      {
        title: "双线推进策略",
        summary: "同章下一课 + 下一章首课同时解锁",
        content: m(
"# 双线推进策略",
"",
"传统的线性课程有一个痛点：卡在某一课就完全停滞。LookatStudy 用双线推进解决这个问题。",
"",
"## 什么是双线推进",
"",
"当你点击当前章节的任意一个课时开始学习时，系统同时解锁同章下一课（保持逐课推进感）和下一章首课（确保你总能探索新内容）。",
"",
"## 为什么这样设计",
"",
"- **防卡死**：某课太难？先去下一章换个主题，回头再战",
"- **保连贯**：同章内仍然是线性的，不会跳来跳去",
"- **给选择**：你可以按顺序学完一章再进下一章，也可以先广泛探索再回头深入",
"",
"## 实操世界不阻塞",
"",
"所有 practice（实操）类型的课时默认 unlocked。你可以随时练习，不需要先学完所有理论课。这让边学边练成为可能。",
"",
"## 章节测验",
"",
"每个有至少 2 个讲解课时的章节会自动添加一个章节测验节点（关底 boss）。通过测验证明你掌握了这一章的核心知识。",
        ),
      },
      {
        title: "章节测验与星级评分",
        summary: "关底 boss 节点，星号评分",
        content: m(
"# 章节测验",
"",
"每个包含至少 2 个讲解课时的章节，会自动出现一个章节测验节点。",
"",
"## 测验形式",
"",
"章节测验是 AI 生成的综合性题目，覆盖该章节的核心知识点：选择题（MCQ）、填空题、判断题。题目数量和难度由 AI 根据章节内容自动调整。",
"",
"## 星级评分",
"",
"测验结果以星号展示：三星全部正确、两星大部分正确、一星需要复习。",
"",
"## 测验与掌握度",
"",
"测验结果会更新 BKT 掌握度模型——答对了相关课时的掌握概率上升，答错了下降。这影响课时节点的 mastered 状态判定。",
"",
"## 重做测验",
"",
"测验可以无限次重做。每次重做会生成新的题目（AI 根据你的上次表现调整），确保你不是在背答案而是在真正理解。",
        ),
      },
    ],
  },
  {
    title: "AI 导师",
    summary: "对话模式、BKT 掌握度追踪、Propose→Apply 协议",
    lessons: [
      {
        title: "对话模式与技能切换",
        summary: "苏格拉底 / 考试准备 / 调试 / 教学四种模式",
        content: m(
"# 对话模式与技能切换",
"",
"LookatStudy 的 AI 导师支持多种教学风格，你可以在输入框上方的模式选择器切换。",
"",
"## 四种内置模式",
"",
"| 模式 | 风格 | 适用场景 |",
"|------|------|---------|",
"| 🏛️ 苏格拉底模式（默认）| 用问题引导思考，不直接给答案 | 深入理解概念 |",
"| 📝 考试准备模式 | 定时、不给提示、模拟考试压力 | 考前冲刺 |",
"| 🐛 调试模式 | 帮你找出代码或理解中的错误 | 排查问题 |",
"| 📖 教学模式 | 直接讲解，清晰易懂 | 快速入门 |",
"",
"## 模式不影响知识，影响教学法",
"",
"同一个知识点，不同模式的 AI 会用不同方式回应：苏格拉底模式会问你引导性问题，教学模式会直接给出讲解，考试准备模式会让你限时作答。",
"",
"## 快捷提问",
"",
"输入框上方还有快捷提问按钮（根据当前课时的掌握度动态推荐）。不确定问什么时，点一个试试！",
        ),
      },
      {
        title: "BKT 掌握度追踪",
        summary: "贝叶斯知识追踪模型，AI 动态调整教学策略",
        content: m(
"# BKT 掌握度追踪",
"",
"LookatStudy 不用简单的正确率来衡量你的掌握程度——它用 BKT（贝叶斯知识追踪）模型。",
"",
"## 什么是 BKT",
"",
"BKT 是教育数据挖掘领域经典的掌握度模型。它维护一个 0 到 1 之间的概率值，表示你真正掌握这个知识点的概率。",
"",
"每次你答题，BKT 会用贝叶斯更新来调整这个概率：答对了掌握概率上升（但不是 100%——可能猜对的），答错了下降（但不是 0%——可能手滑的），不答题也会随时间衰减。",
"",
"## 掌握阈值",
"",
"当掌握概率超过阈值（默认 0.9）时，课时标记为已掌握。",
"",
"## AI 怎么用掌握度",
"",
"AI 导师能看到你对每个知识点的掌握概率：低掌握度时更详细讲解多用类比，高掌握度时给出更高级的挑战，中等时检查理解确认没有误解。",
"",
"这就是为什么 AI 有时候会追问你确定吗——它检测到你的掌握概率不够高。",
        ),
      },
      {
        title: "Propose → Apply 协议",
        summary: "AI 起草状态变更，你确认后才生效",
        content: m(
"# Propose → Apply 协议",
"",
"LookatStudy 的核心设计原则之一：AI 永远不直接修改你的学习记录。",
"",
"## 为什么需要这个协议",
"",
"AI 会犯错（幻觉、误判）。如果 AI 能直接改你的掌握度、标记已掌握、调整进度——一旦出错，你的学习数据就被污染了。",
"",
"## 协议流程",
"",
"1. AI 判断需要变更，起草 Proposal（提案）",
"2. 你看到提案内容，确认（Apply）或拒绝（Reject）",
"3. 确认后才写入数据库",
"",
"## 哪些操作走 Propose → Apply",
"",
"标记掌握：AI 认为你掌握了某个知识点，提议标记 mastered。调整进度：AI 评估后提议调整课时状态。解锁课时：AI 提议跳过某些课时。",
"",
"## 你始终拥有最终决定权",
"",
"你可以接受提案让变更生效，或拒绝保持原状。AI 不会反复推送被拒绝的提案。",
"",
"大多数学习 App 在后台静默修改你的进度数据。LookatStudy 把这个过程透明化——你能看到 AI 想改什么、为什么改，然后自己决定。",
        ),
      },
    ],
  },
  {
    title: "康奈尔笔记本",
    summary: "三区设计、画线溯源、生成式 UI",
    lessons: [
      {
        title: "三区设计：理解 / 笔记 / 练习",
        summary: "康奈尔笔记法在 LookatStudy 的实现",
        content: m(
"# 三区设计：理解 / 笔记 / 练习",
"",
"LookatStudy 的右栏笔记本基于康奈尔笔记法（Cornell Notes），分为三个区域。",
"",
"## 🗺️ 理解区（AI 产物）",
"",
"AI 生成的可视化学习辅助：概念图（知识点关系网络）、对比表（相似概念异同对比）、流程图（步骤可视化）、代码讲解（逐行注释）。这些是 AI 在你学习时自动生成的。",
"",
"## ✏️ 笔记区（你的画线笔记）",
"",
"你在讲解页面上选中文字画线加笔记的所有标记：每条画线保留原始文字，可以添加批注，点击画线可以溯源跳转回原文对应位置。",
"",
"## 📝 练习区（测验 + 答题记录）",
"",
"该课时的练习题和你的答题历史：AI 生成的测验题，每次答题结果都保留，答错的题目会在间隔重复系统中安排复习。",
"",
"## 两个 Tab",
"",
"右栏顶部有两个 Tab：讲解 Tab 显示课时正文（Markdown 渲染），笔记 Tab 展示上述三区。讲解和笔记分开，让你在阅读正文时不被笔记干扰。",
        ),
      },
      {
        title: "画线加笔记与溯源跳转",
        summary: "选中文本画线，带溯源链接跳回原文",
        content: m(
"# 画线加笔记与溯源跳转",
"",
"## 怎么画线",
"",
"在右栏讲解 Tab 中用鼠标选中一段文字，选中后会出现加笔记按钮，点击后选中的文字被高亮标记并可添加批注。画线会持久保存。",
"",
"## 溯源跳转",
"",
"每条画线笔记都带有溯源链接。在笔记 Tab 的笔记区点击任意一条画线，自动跳回讲解 Tab，滚动到画线对应的段落并闪烁高亮。",
"",
"## 技术原理",
"",
"画线定位不依赖 DOM 偏移量（ReactMarkdown 重渲染时 DOM 会变，偏移量不稳定）。LookatStudy 用纯文本搜索方案：记录选中文字的内容，在重渲染后重新定位。这保证了画线在 React 重新渲染后仍然准确。",
"",
"## 对称设计",
"",
"讲解页面的画线和对话中的画线是对称的——不论来自讲解还是对话，所有画线统一管理在笔记区。",
        ),
      },
      {
        title: "生成式 UI：概念图 / 对比表 / 流程图",
        summary: "AI 动态生成的可视化学习工具",
        content: m(
"# 生成式 UI",
"",
"LookatStudy 的 AI 导师不只会输出文字——它会生成交互式可视化组件。",
"",
"## 五种生成式 UI 组件",
"",
"| 组件 | 用途 |",
"|------|------|",
"| 🗺️ 概念图 | 展示知识点之间的关系 |",
"| 📊 对比表 | 并列对比多个概念 |",
"| 📐 流程图 | 可视化步骤或流程 |",
"| 💻 代码讲解 | 逐行解释代码 |",
"| 📝 测验 | 即时生成练习题 |",
"",
"## 怎么触发",
"",
"AI 自动生成（判断知识点适合可视化时调用），你主动请求（在对话中说画个概念图），或快捷按钮（输入框上方根据内容推荐）。",
"",
"## 生成式 UI 存在哪",
"",
"所有 AI 生成的组件出现在中栏对话流和右栏笔记 Tab 的理解区（持久保存）。AI 生成的概念图不是聊完就消失——它们留在你的笔记本里随时回顾。",
        ),
      },
    ],
  },
  {
    title: "记忆系统",
    summary: "间隔重复、连续打卡、XP 与皇冠",
    lessons: [
      {
        title: "SM-2 间隔重复",
        summary: "科学算法安排复习时间，对抗遗忘曲线",
        content: m(
"# SM-2 间隔重复",
"",
"学过的知识会遗忘——这是人类的生理限制。LookatStudy 用 SM-2 算法科学地安排复习。",
"",
"## 什么是 SM-2",
"",
"SM-2（SuperMemo 2）是间隔重复的经典算法，也是 Anki 等主流记忆 App 的核心。每次答对复习题，下次复习间隔变长（1天→3天→8天→21天…）；答错则间隔重置。",
"",
"## 在 LookatStudy 中怎么运作",
"",
"答错的课时题目进入复习队列，SM-2 算法计算每个题目的下次复习日期，到期的复习题出现在学习任务里。你不需要手动管理——系统自动安排。",
"",
"## 与 BKT 的关系",
"",
"BKT 判断你当前是否掌握（影响课时状态），SM-2 判断你未来什么时候会忘（影响复习安排）。两者互补：BKT 管学习进度，SM-2 管记忆持久性。",
        ),
      },
      {
        title: "连续打卡与冻结",
        summary: "Streak 机制，冻结保护不断链",
        content: m(
"# 连续打卡与冻结",
"",
"## 连续打卡（Streak）",
"",
"每天至少完成一次学习活动，你的连续打卡天数就会 +1。连续打卡是多邻国验证过的最强激励之一：看到数字增长就不想断链，从而持续学习。",
"",
"## 冻结（Freeze）",
"",
"生活中总有无法学习的日子。冻结机制保护你的连续打卡不断链：拥有冻结时某天没学习不会断链，冻结自动消耗。这让连续打卡既有激励效果又不会变成焦虑源。",
"",
"## 打卡状态",
"",
"界面显示当前连续天数（火焰图标）、上次学习日期、是否有可用冻结。保持连续打卡不需要每天学很多——哪怕做一道题就够了。关键是保持习惯。",
        ),
      },
      {
        title: "XP 与皇冠",
        summary: "经验值系统与掌握度皇冠",
        content: m(
"# XP 与皇冠",
"",
"LookatStudy 用 XP（经验值）和皇冠量化你的学习成就。",
"",
"## XP 系统",
"",
"| 行为 | XP 奖励 |",
"|------|---------|",
"| 答对一题 | +10 XP |",
"| 答错一题 | +1 XP |",
"| 掌握一个课时 | +50 XP |",
"",
"XP 按日累计——你可以在仪表盘看到今日 XP 和历史趋势。",
"",
"## 皇冠",
"",
"皇冠代表课时掌握度：课时掌握后显示金色光环，章节测验星级评分也展示在节点上，皇冠数量 = 你真正掌握的课时数。",
"",
"XP 可以靠大量低质量答题刷上去。皇冠要求你真正通过 BKT 掌握度判定——不能靠刷只能靠理解。XP 管过程激励，皇冠管结果验证。",
        ),
      },
    ],
  },
  {
    title: "进阶功能",
    summary: "自定义 Provider、多语言翻译、导出报告",
    lessons: [
      {
        title: "自定义 LLM Provider",
        summary: "BYO API Key，支持任意 OpenAI 兼容端点",
        content: m(
"# 自定义 LLM Provider",
"",
"LookatStudy 是 BYO Key（Bring Your Own Key）架构——你用自己的 API Key，对话不经过任何中间服务器。",
"",
"## 内置预设 Provider",
"",
"GLM（智谱）、DeepSeek、Kimi、Qwen、SiliconCloud、OpenRouter、OpenAI、Anthropic、Google——共 10 个预设。",
"",
"## 自定义 Provider",
"",
"如果内置预设不满足需求，可以添加自定义 Provider：进入 Settings 填入 API Base URL、API Key、Model Name。只要兼容 OpenAI API 格式的端点都能用。",
"",
"自定义 Provider 的 Key 存在本地 DB，优先级高于预设 Provider。",
"",
"## 测试连接",
"",
"配置完成后点击测试连接按钮验证 Key 是否有效。系统会发送一个简短的测试请求，检查连通性和模型可用性。",
        ),
      },
      {
        title: "多语言翻译支持",
        summary: "自动检测翻译约定，按偏好语言切换",
        content: m(
"# 多语言翻译支持",
"",
"LookatStudy 能自动识别仓库的翻译结构，让你用偏好的语言学习。",
"",
"## 语言偏好设置",
"",
"在 Settings 里设置你的偏好语言：English、简体中文、繁體中文。首次启动时按系统语言自动检测默认值。",
"",
"## 自动翻译决策",
"",
"导入课程时系统自动判断仓库原文语言，检测仓库有哪些翻译版本，按偏好语言 + 原文语言决定导入哪个翻译。严格 fallback：仓库没有你偏好的翻译就用原文。",
"",
"## 支持的翻译布局",
"",
"系统自动检测三种翻译目录约定：translations/语言代码/（微软风格）、语言代码/平行目录（Vue/Docusaurus 风格）、文件名.语言代码.md 后缀风格（博客风格）。",
"",
"## 翻译图片处理",
"",
"翻译版正文里的图片不另外下载（机翻图片质量差），而是按出现位置替换成原文对应位置的图片。结果：翻译正文 = 翻译文字 + 原文图片。",
        ),
      },
      {
        title: "导出学习报告",
        summary: "JSON / Markdown 格式导出全部学习数据",
        content: m(
"# 导出学习报告",
"",
"你的学习数据存在本地——你可以随时导出。",
"",
"## JSON 格式",
"",
"结构化数据，包含课程列表和完成度、每个课时的掌握度（BKT 概率）、答题历史、连续打卡记录、XP 历史、间隔重复队列状态。适合数据分析、备份、迁移。",
"",
"## Markdown 格式",
"",
"人类可读的学习报告，包含学习概要（总课时/已掌握/连续天数/总 XP）、各章节掌握度、重点笔记摘录。适合分享学习成果和复习总结。",
"",
"## 怎么导出",
"",
"点击课程菜单的导出选项，选择格式（JSON 或 Markdown），选择保存位置。",
"",
"## 数据所有权",
"",
"导出功能是本地优先理念的直接体现：你的学习记录不锁定在任何云端，不需要账号不需要订阅，随时可以带着你的数据离开。这是你的数据，你拥有完全的控制权。",
        ),
      },
    ],
  },
];

// ============================================================
// 生成 SeedData JSON
// ============================================================

function generateSeedData() {
  const nodes = [];
  const progress = [];

  sections.forEach((sec, secIdx) => {
    const secId = "guide-sec-" + (secIdx + 1);
    nodes.push({
      id: secId, parentId: null, type: "section",
      title: sec.title, sourcePath: "ch" + (secIdx + 1),
      orderIdx: secIdx, content: null, summary: sec.summary || null,
    });
    progress.push({ nodeId: secId, status: secIdx === 0 ? "available" : "locked", crownLevel: 0 });

    sec.lessons.forEach((lesson, lesIdx) => {
      const lesId = "guide-les-" + (secIdx + 1) + "-" + (lesIdx + 1);
      nodes.push({
        id: lesId, parentId: secId, type: "lesson",
        title: lesson.title,
        sourcePath: "ch" + (secIdx + 1) + "/lesson-" + (lesIdx + 1) + ".md",
        orderIdx: lesIdx, content: lesson.content, summary: lesson.summary || null,
      });
      const isFirst = secIdx === 0 && lesIdx === 0;
      const isSecondChapterFirst = secIdx === 1 && lesIdx === 0;
      progress.push({
        nodeId: lesId,
        status: (isFirst || isSecondChapterFirst) ? "available" : "locked",
        crownLevel: 0,
      });
    });

    if (sec.lessons.length >= 2) {
      const examId = "guide-exam-" + (secIdx + 1);
      nodes.push({
        id: examId, parentId: secId, type: "exam",
        title: sec.title + " · 章节测验", sourcePath: null,
        orderIdx: sec.lessons.length, content: null, summary: null,
      });
      progress.push({ nodeId: examId, status: "available", crownLevel: 0 });
    }
  });

  return {
    version: 1,
    courseId: COURSE_ID,
    course: {
      id: COURSE_ID, repoUrl: null, repoName: "LookatStudy Guide",
      title: "LookatStudy 使用指南",
      description: "学习如何使用 LookatStudy 的全部功能——从导入课程到 AI 导师到间隔重复",
      labType: "doc",
    },
    locale: "zh-CN",
    nodes, progress,
    translations: [],
  };
}

const data = generateSeedData();
const lessons = data.nodes.filter((n) => n.type === "lesson");
const exams = data.nodes.filter((n) => n.type === "exam");
const secs = data.nodes.filter((n) => n.type === "section");
console.log("课程: " + data.course.title);
console.log("  " + secs.length + " 章 / " + lessons.length + " 课 / " + exams.length + " 测验");
console.log("  " + data.nodes.length + " 总节点 / " + data.progress.length + " 进度记录");

const nodeIds = new Set(data.nodes.map((n) => n.id));
for (const p of data.progress) {
  if (!nodeIds.has(p.nodeId)) throw new Error("progress 引用不存在的 nodeId: " + p.nodeId);
}

writeFileSync(OUTPUT, JSON.stringify(data, null, 2), "utf8");
console.log("\n已写入: " + OUTPUT);
console.log("文件大小: " + (JSON.stringify(data).length / 1024).toFixed(1) + " KB");
