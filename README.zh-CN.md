# LookatStudy

**[English](README.md) | 简体中文**

> 开源、本地优先、AI 驱动的桌面学习平台。把任意学习仓库变成一门你真的能学完的多邻国式课程。

LookatStudy 接管任何文档 / 学习路线 / 课程仓库,把它变成一条有结构、有门控的学习路径:一寸寸解锁的技能地图、随你的掌握度自适应的 AI 导师、让知识留得住的间隔重复、让你每天回来的连续学习。一切都在本地运行——数据不出你的机器,大模型 API key 自己带(BYOK)。

## 为什么做

大多数"读文档式"的学习会失败,因为文档不是课程:没有结构、没有进度、没有反馈、没有留存。LookatStudy 补上让"课程"成立的四件事:

- **🗺️ 门控技能地图** —— 仓库变成 章节→课时 的路径,一节解锁下一节,你永远知道今天该学什么。
- **🧠 带掌握度追踪的 AI 导师** —— 贝叶斯知识追踪(BKT)模型记录你对每个概念掌握到什么程度;导师提问、专打你的薄弱点。掌握度精确到**知识点级**,课时掌握度 = 各知识点中的最小值(防"假毕业")。
- **🔁 间隔重复 + 连续学习** —— SM-2 调度 + 多邻国式连续学习(含 freeze 补签),让你持续回来。
- **🔁 提议→采纳(Propose → Apply)** —— AI 的每一次状态变更(掌握度更新、"标记毕业")都以**提议**形式起草、由你批准,AI 永远不会静默改写你的学习记录。

## 功能特性

- **课程生成器** —— 支持 **10 种文档格式 + 30+ 种代码文件**:Markdown、Jupyter Notebook(`.ipynb`)、reStructuredText(`.rst`)、R Markdown(`.Rmd`)、Org-mode(`.org`)、AsciiDoc(`.adoc`)、PDF、PowerPoint(`.pptx`)、HTML、纯文本,外加源代码文件(`.py`/`.js`/`.ts`/`.go`/`.rs`/`.java`/`.c`/`.cpp`/`.rb`/`.sh` 等——代码也是教学材料)。支持 GitHub 仓库 URL、本地文件夹导入,或直接粘贴 Markdown。每种格式都有专属解析器,统一转成内部 Markdown 表示。
- **多模态图片** —— 导入时自动收集课程图片(Markdown `![]()`、HTML `<img>`、Notebook 输出图、PDF 内嵌图),本地存储、笔记栏内联展示;可选 AI 视觉模型,问图表也能答。
- **原生右键菜单** —— 复制选中文字、复制/保存图片(系统保存对话框)、输入框标准编辑操作,像网页一样和内容交互。
- **3 个内置教学人设(可随时切换)** —— 输入框里的药丸切换导师的教学方式(`null` = 关闭,仅基础提示词):
  - `direct` 精讲 —— 先讲清楚,完整例题,不留猜测
  - `guide` 引导 —— 用问题引导,让你自己迈出下一步
  - `practice` 实战 —— 围绕真实问题上手做
- **AI 出题** —— 对话里的"考考我"生成选择/填空/判断题,落进笔记本练习区并留答题记录;章节考试节点在后台按知识点分批生成限时考试(可切走、完成有通知),答题自动判分,回写知识点级 BKT 掌握度与 SM-2 排程(考试本身不回写,保持独立)。
- **三栏工作区** —— 左栏:多邻国式技能地图(门控课时节点)+ 课程搜索;中栏:AI 导师对话(流式、工具调用、Generative UI 产物、多会话线程);右栏:康奈尔式笔记本(讲解内联图片、画线笔记带溯源跳转、AI 生成的概念图/测验/流程图/对比表)。
- **复习抽屉 + 掌握度仪表盘** —— 今日到期复习(SM-2 四象限)、分章节掌握度手风琴、交错复习;顶栏显示连续学习与每日 XP 能量条。
- **轻量 RAG + 学习者记忆** —— 导师可以跨全部课时内容检索"这个在哪讲过",并保留滚动摘要以记住你过往会话(记忆系统 flag 门控)。
- **BYOK + 自定义 Provider** —— 19 个预设 provider(GLM 标准/CodingPlan、DeepSeek、Kimi、通义、SiliconCloud、OpenRouter、OpenAI、Anthropic、Google、Groq、Together、Mistral、xAI、火山、百度、MiniMax、百川、阶跃)+ 不限量自定义 provider(baseUrl + model + key 全自定义)。可选视觉模型覆盖,用于多模态问答。设置页带 provider/模型选择、连接测试、外观与语言选项。密钥只存在于主进程。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  渲染进程 (React 19 + Vite + Tailwind,双主题)              │
│  - 多邻国式技能地图 + 课程搜索                              │
│  - 掌握度仪表盘 / 复习抽屉                                  │
│  - 教学人设选择器                                          │
│  - 只通过 window.api.* 与主进程通信 (contextBridge)        │
└───────────────────────┬─────────────────────────────────┘
                        │ IPC (domain:action 通道)
┌───────────────────────▼─────────────────────────────────┐
│  主进程 (Electron 33, CJS / Node.js)                     │
│  - Agent 引擎 (Vercel AI SDK v5 streamText + tools)      │
│  - Soul 系统 (教学人设 → system prompt 注入)               │
│  - 知识点级 BKT 掌握度模型                                  │
│  - 提议→采纳管线 (AI 起草,人类批准)                         │
│  - 课程生成器 (5 步智能导入管线)                            │
│  - RAG (LIKE 检索) + 记忆 + SM-2 + 连续学习                │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
   sql.js (SQLite WASM)            LLM API (自带 key)
   本地 .db 文件                    (密钥不离开主进程)
```

**关键边界**:渲染进程永远碰不到数据库、文件系统和 API 密钥。所有跨进程调用都是 `shared/types.ts` 里的类型化 IPC 方法(`ApiExpose`)。

## 项目结构

```
lookatstudy/
├── src/
│   ├── main/                      # Electron 主进程 (CJS)
│   │   ├── index.ts               # 入口 + --self-test / --ui-test 模式
│   │   ├── ipc/index.ts           # 全部 IPC handler (domain:action)
│   │   ├── db/
│   │   │   ├── schema.sql         # ★ schema 唯一真源
│   │   │   ├── schema.ts          # drizzle 定义(派生)
│   │   │   └── index.ts           # sql.js 连接 + 迁移 + 持久化
│   │   └── services/
│   │       ├── pure/              # 零依赖可测纯函数核心
│   │       │   ├── sm2.ts                 # SM-2 间隔重复
│   │       │   ├── streak-transition.ts   # 连续学习/freeze 状态机
│   │       │   ├── bkt.ts                 # 贝叶斯知识追踪
│   │       │   ├── markdown-course.ts     # MD → 课程树
│   │       │   ├── notebook-parser.ts     # .ipynb → markdown + 图片
│   │       │   ├── rst/rmd/org/adoc-parser.ts # 各格式 → markdown
│   │       │   ├── code-parser.ts         # .py/.js/.go → markdown(代码即内容)
│   │       │   ├── translation-layout.ts  # 自动检测翻译目录约定
│   │       │   ├── local-folder-scanner.ts # 文件夹扫描(10 文档 + 30 代码格式)
│   │       │   └── repo-fetcher.ts        # GitHub 仓库 → 课程文件
│   │       ├── souls/             # 教学人设(soul 系统)
│   │       ├── agent/             # Agent 引擎 + LLM provider
│   │       ├── proposal-service.ts        # 提议→采纳
│   │       ├── exam-service.ts            # 章节考试 v2(后台生成/限时/attempt 档案)
│   │       └── ...
│   ├── preload/index.ts           # contextBridge → window.api
│   └── renderer/                  # React 前端
│       ├── App.tsx                # 三栏外壳(地图 · 对话 · 笔记)
│       ├── lib/api.ts             # 类型化 window.api 包装
│       └── index.html / index.css # CSP 锁定, Tailwind 基础
├── shared/types.ts                # ★ IPC 契约 (ApiExpose 接口)
├── scripts/verify-*.mjs           # 63 个逻辑测试套件 (tsx 运行)
├── dev-docs/                      # 开发过程文档(ARCHITECTURE / ROADMAP / BUILD-NOTES — gitignore,仅本地)
├── electron-builder.yml           # 打包配置
└── vite.config.ts / tsconfig*.json / tailwind.config.ts / package.json
```

## 快速开始

### 前置条件

- Node.js ≥ 20
- 任一 LLM API key(GLM / DeepSeek / OpenAI / Anthropic / Google 等)——浏览 UI 不需要,AI 导师和出题需要

### 安装运行

```bash
npm install
npm run dev:electron      # 打开应用(内置指南课程,离线可用)
```

应用内置离线种子课程——**LookatStudy 使用指南**(6 章 / 18 课 / 6 章节考试),没有 API key 也能体验技能地图。启动时不预选课程:在左栏课程列表里手动选它即可。

### 配置 AI 导师

顶栏齿轮图标打开设置:
1. 选 provider(国内推荐 GLM;DeepSeek 推理强;OpenAI/Anthropic/Google 需海外网络)
2. 下拉选模型(如 `glm-4-flash`、`deepseek-v4-flash`、`gpt-4o-mini`、`claude-3-5-haiku-latest`、`gemini-1.5-flash`)
3. 粘贴 API key(设置页有各 provider 控制台链接)
4. 点 **测试连接** 验证 key 和网络
5. 点 **保存设置**

密钥本地存储、只存在于主进程;渲染进程只知道"是否已配置"(掩码显示如 `sk-1…abcd`)。

### 把任意仓库变成课程

点左栏 **导入课程** 标签:
- **GitHub URL** —— 粘贴 `https://github.com/owner/repo`;自动拉 README(跨 `main`/`master`/`develop`/`gh-pages` 分支尝试多种文件名)、经 Tree API 发现文件树,拉取并解析全部课程文件。导入是后台任务、有实时进度——期间可以继续浏览其它课程。
- **本地文件夹** —— 选本地目录(下载的课程包、clone 的仓库等);递归扫描文档 + 代码 + 图片 + 翻译并解析。
- **粘贴 Markdown** —— 直接粘贴原始 markdown(私有仓库、无网络环境、本地笔记)。

支持的格式:`.md`、`.ipynb`、`.rst`、`.Rmd`、`.org`、`.adoc`、`.pdf`、`.pptx`、`.html`、`.txt`,加 **30+ 种代码文件**(`.py`/`.js`/`.ts`/`.go`/`.rs`/`.java`/`.c`/`.cpp`/`.rb`/`.sh`/`.lua`/`.sql`/`.r`/`.jl`/`.dart`/`.scala`/`.kt`/`.swift`/`.php`/`.cs` 等——代码即教学材料,模块 docstring 提取为正文)。图片(`.png`/`.jpg`/`.gif`/`.webp`/`.svg` 等)导入时始终收集;AI 视觉是独立可选开关。

粘贴的 markdown 走确定性结构化(H2→章节、H3→课时)。GitHub 和文件夹导入走 5 步智能管线:LLM 判定每个文件的角色并设计课程树(无 key 时纯规则降级)。首课初始 `available`(其余锁定),实操类内容进自由探索的"实操"世界。同一标签页里可管理多门课程(切换/删除)。

## 测试

LookatStudy 采用测试先行纪律。逻辑测试用 `tsx` 直接跑**真实源码**(从不跑内联副本),每个里程碑都附闭环证明(弄坏源码 → 测试变红 → 还原 → 变绿)。

```bash
npm run verify:core       # 63 套件 / 200+ 断言 — 纯逻辑(DB/SRS/streak/BKT/KC-BKT/proposals/RAG/souls/dashboard/课程生成/出题/llm-presets/导入/notebook/rst/rmd/org/adoc/pdf/pptx/考试/记忆/课程搜索)
npm run self-test         # 无头 Electron DB 层自检 → .self-test-result.json
npm run ui-test           # 无头真 GUI 检查(34 条 DOM 断言:三栏布局、课程门控、技能地图、设置、导入、复习抽屉、课程搜索、a11y + 响应式 i18n)→ .ui-test-result.json
```

任何改动后的标准三连:
```bash
npm run verify:core && npx vite build && npm run self-test
```

## 技术栈

| 层 | 选型 | 原因 |
|---|---|---|
| 语言 | TypeScript | 主进程 + 渲染进程同一语言 |
| 渲染层 | React 19 + Vite 6 + Tailwind v3 | |
| 桌面 | Electron 33(CJS 产物) | 跨平台桌面(CJS 主进程——避开 vite-plugin-electron 的 ESM 边角案例) |
| AI | Vercel AI SDK v5 + @ai-sdk/openai/anthropic/google | 3 种协议(OpenAI 兼容 / Anthropic / Google)覆盖 19 预设 + 自定义 |
| 工具 schema | zod v3 | AI SDK v5 必需 |
| 数据库 | sql.js(SQLite → WASM)+ Drizzle ORM | 零原生编译(better-sqlite3 在 Windows 是构建陷阱) |
| 状态 | Zustand + TanStack Query | |
| 测试 | tsx + node:assert | 测试直接 import 真实 TS 源码;可无头运行 |

## 状态

核心学习闭环已完成并验证:**课程生成(10 文档格式 + 30 代码类型)→ 技能地图 UI → 带 BKT + 提议/采纳的 AI 导师 → RAG + 记忆 + 仪表盘**。已包含:三栏布局(地图 · 对话 · 笔记)、多会话线程、Generative UI(概念图/测验/Mermaid 图/对比表/代码讲解)、多邻国式地图美术、康奈尔笔记本(理解/笔记/练习三区 + 画线溯源)、多模态图片导入 + AI 视觉、原生右键复制/保存、明暗双主题、章节考试 v2、课程搜索、自定义 provider。完整版本历史见 `CHANGELOG.md`(中文)。

## 许可证

MIT。
