# Changelog

All notable changes to LookatStudy are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches 1.0.0. Pre-1.0 versions are milestone-tagged and may break
persistence between bumps (the SQLite schema is migrated idempotently via
`runMigrations()`).

Entry conventions for contributors:
- Group changes under `Added` / `Changed` / `Removed` / `Fixed` / `Security`.
- One bullet = one user- or developer-visible change. Commits that only touch
  build glue or refactor internals can be folded into a single "internal" line.
- Reference the issue or design doc when relevant: `(see dev-docs/DESIGN-PLAN-v0.2.md)`.

## [Unreleased]

### Added
- **Generative UI 产物 harness 化**:5 种 AI 产物(概念图/练习题/对比表/流程图/代码讲解)
  现在经过 schema 语义校验 + graceful 修复(`artifact-harness.ts`):丢弃坏 edge、clamp 越界索引、
  对齐表格行列、剥离 markdown 围栏。质量指南拼进 tool description 引导 LLM 高质量产出。
  新测试套件 `verify-artifact-harness.mjs`(19 个测试,含闭环验证)。
- **Mermaid 真渲染**:流程图/时序图/状态图从"显示源码 + 外链"升级为 dynamic import mermaid
  真渲染 SVG(parse 预检 + error SVG 检测双重防护)。dagre 重写概念图布局(卡片节点 + 贝塞尔连线)。
  两个图产物支持缩放按钮 + Ctrl+滚轮 + 抓手拖动平移(useDragPan hook)。
- **对话流内联渲染产物**:AI 产物直接在对话流内联显示(不再只是小徽章),quiz 答题触发掌握度更新。
- **康奈尔笔记法三区重构**:笔记页从"产物堆叠"重构为三区 —— 🗺️理解区(AI 产物)、
  ✏️笔记区(用户画线 user_note,带溯源跳转)、📝练习区(quiz + last_result 答题记录)。
  砍掉「全部」tab(笔记跟随节点,跨节点靠地图切换)。
- **手动画线 + 溯源跳转**:讲解区/对话流选区 → `✏️ 加笔记` → user_note 带 source_anchor。
  讲解区持久绿色下划线(文本搜索方案,不依赖 DOM offset);点溯源跳转加粗闪烁。
  对话流画线溯源到消息(msgId 稳定性:`chat:done` 带回 DB id 替换临时 id)。
- **导入本地文件夹(第三种导入方式)**:支持把任意本地课程文件夹(如 Coursera/edX
  下载包)转为课程。用 Electron 文件选择对话框选目录,递归扫描 .txt/.md/.html/.pdf,
  提取内容,落库,再走 LLM 结构化。
  - 通用扫描器:`local-folder-scanner.ts` 不硬编码任何文件夹结构,递归收所有文本类文件。
  - 中文优先去重:同内容的 .zh-CN 和 .en 只保留中文版。
  - HTML 转纯文本(`<co-content>` 富文本质量足够);PDF 用 `pdf-parse` 提取文字。
  - 文件名 NN_ 前缀自然排序;排除 node_modules/.git/translations。
  - 新依赖 `pdf-parse`(纯 JS,无 native,vite external)。
  - ImportView 加"本地文件夹"tab;`import:localFolder` IPC + dialog.showOpenDialog。
- **整仓 .md 递归导入**:URL 导入现在优先用 GitHub Tree API 一次性发现全仓 .md 文件
  (不只 README 链接的),自动降级:jsdelivr 文件列表 → README 链接 + 一层递归 → 报错。
  文件上限 80 个(防爆)。适配网络偶发不稳:每级失败自动降级 + 进度提示当前在用哪条路。
- **导入后自动 AI 结构化**:course 型导入成功后,若已配 API key,自动跑
  analyzeCourseStructure → applyCourseStructure → 补 exam 节点 → generateLessonSummaries。
  无 key 则跳过(降级到纯确定性导入,可后续手动结构化)。失败不阻塞。

### Changed
- **buildCourseFromFiles 按顶层目录分组**(减碎片):同章节目录的文件归到一个 section
  (如 `lessons/3-NN/03-Perceptron` 和 `lessons/3-NN/04-Deep` 归 "3-NN"),
  不再每文件一个 section(之前 AI-For-Beginners 47 碎片)。
- **考试节点需本章通关才解锁**:同 section 所有 lesson mastery≥0.5 才能进入考试
  (之前一开始就能进)。锁定态显示暗灰紫球 + 🔒。course-generator exam seed 改 locked。

### Fixed
- **考试结算 16 题 bug**:React StrictMode 双调用 ExamView 导致 startExam 并发两次,
  两次都在对方插入前读到 0 题 → 双重生 8 题 = 16 行;ExamView 显示前 8 题,submit 读
  16 行 → 后 8 题无答案判错。修法:startExam 用 examNode.content 字段做 DB 级生成锁
  (写 `__exam_generating:<时间>__`,2 分钟 TTL,轮询等待)。sql.js 同步写,StrictMode
  第二次调用读到锁态 → 等第一个完成 → 返回同一批题。

### Added(之前提交的功能)
- **章节考试节点(关底 boss)**:把纠缠的进度环/星星/皇冠拆成两种正交节点类型。
  - **普通课节点**(type=lesson):只保留进度环(mastery)+ 满皇冠(mastered),**删掉星星**。
  - **章节考试节点**(type=exam,每章末尾自动生成):可选支线,不限时一组选择题,
    正确率分档给 1-3 星(≥60%→1,≥80%→2,≥95%→3),完全独立不影响下一章解锁。
    星数取最高(可重考)。考试题目复用 exercises 表(node_id=考试节点),整章 lesson
    作为出题上下文。
  - 新增 `exam-service.ts`(start/submit + 正确率分档 `accuracyToStars`)、
    `ExamView.tsx`(考试 UI:答题 + 进度条 + 得分卡 + 逐题回顾)、`exam:start`/`exam:submit` IPC。
  - course-generator 给每个 section 末尾插 exam 节点;`ensureExamNodesForExistingCourses`
    幂等补丁给老库导入的课程补 exam 节点(启动时自动跑)。
  - MapRail 考试节点用紫色专属气泡(`exam-bubble`)区分于普通课,🎯 图标 + 星星。
  - 点击考试节点 → 中栏渲染 ExamView 替代 ChatStream(不进 chat,进考试)。
- **`.env` 支持**:新增轻量零依赖 env 加载器(`src/main/services/env.ts`),
  主进程启动时读 `.env`(已 gitignore)。`getZaiConfig()` 供 ui-test seed provider 用。
- `verify-exam.mjs`(8 测试:accuracyToStars 分档、submitExam 判分、重考不降星、
  ensureExamNodes 幂等、考试不污染 dashboard、按节点隔离)。

### Changed
- **普通课节点不再显示星星**:星星归考试节点专用。`update_mastery` proposal 不再派生
  crownLevel(回退上一提交的设计);普通课 crown 只在 mark_mastered 时设 5(满皇冠)。
  自动毕业(mastery≥0.9)、解锁硬门控(mastery≥0.5)、dashboard 混合指标 保留。
- ui-test 加 provider seed:启动时若库无 provider 则造一个(优先用 `.env` 的真实 ZAI key),
  让 `agentReady=true`、ChatComposer 渲染 skill-picker,测试不再依赖用户手动配 provider。
- **迷你地图驱动逻辑闭环**:打通 progress 字段写入链路,让进度环/星星/总进度
  条都能随学习动作真正动起来(之前多处断点)。
  - `markNodeAttempted`(点节点)首次尝试时初始化 `mastery = BKT pInit(0.5)`,
    进度环不再从空开始,有初始弧度。
  - `update_mastery` proposal 应用后派生 `crownLevel`(用已有的 `masteryToCrown()`,
    mastery→1-5 crown),**星星出现 1-2-3 中间态**(之前只有全灰/全亮两态)。
  - `update_mastery` 应用后若 `mastery ≥ 0.9` **自动转 `mastered`** 并发 +50 XP,
    不再只靠 AI `mark_mastered` 一锤定音。
  - **硬门控解锁**:下一课的解锁条件从"点上一课"改为"上一课 mastery ≥ 0.5"。
    `markNodeAttempted` 和 `update_mastery` 应用后都检查阈值(首次尝试 pInit=0.5
    刚好达标,保留"开始就能往下走"的顺畅感)。
  - `mark_mastered` 不再硬编码覆盖 mastery,尊重 BKT 累积值(`max(已有, 0.95)`)。
  - `dashboard.overallMastery` 改为**混合指标**(mastered=1.0 / in_progress=mastery /
    available=0.1 / locked=0 的全课平均),点课(available→in_progress)立刻推进总进度条
    (之前纯 mastery 平均,点课无反馈)。

### Fixed
- `in_progress` 节点中心的 `📘` emoji(蓝色书)和蓝色球体背景撞色,看起来像凹陷的
  矩形坑。改用白色 lucide `BookOpen` 图标 + drop-shadow,对比清晰。

## [0.5.0] — 2026-08-07

### Added
- **Three-pane layout** (MapRail · ChatStream+Composer · NotebookPanel) replacing
  the v0.1 dual-pane. Each node on the map is a session *group*; clicking it
  swaps the middle pane's threads, not the conversation itself.
- **Thread model**: `threads` + `chat_messages` tables. Each thread is bound to a
  node (`focus_node_id`); AI gets course-level cross-thread memory via the
  existing `memory` table. Chrome-style horizontal `ThreadSwitcher` tabs with
  rename / archive / delete (soft-delete + undo).
- **Canvas (black-board notebook)**: AI artifacts persist as `canvas_items`.
  Pinned artifacts survive across sessions; unpinned roll with the active
  thread. 讲解 / 笔记 / 全部 tabs.
- **Generative UI via parts-based streaming** (`chat:part` event + `ChatStreamPart`
  discriminated union). Five display tools: `show_concept_map`,
  `generate_quiz`, `compare_table`, `draw_diagram` (Mermaid),
  `show_code_walkthrough`. GFM markdown with copy-enabled code blocks.
- **Playful skill-map art**: radial-gradient nodes with 4-state differentiation
  (locked / available / in_progress / mastered), winding SVG path, in-progress
  progress ring, section tints. (see `dev-docs/DESIGN-PLAN-v0.3.md`)
- **Toast feedback system** with action buttons (undo) for destructive ops.
- **Keyboard shortcuts**: `Ctrl+K` command palette, `Ctrl+B` toggle map,
  `Ctrl+Tab` cycle threads.
- **Font-size control** (A- / A+) with three tiers persisted to localStorage.
- **Focus lock**: node/thread switching is blocked while the AI is streaming,
  so the learner stays in one context until the turn completes.
- **5 new verify suites**: `verify-stream-parts` (incl. StrictMode double-invoke
  regression), `verify-artifacts`, `verify-color-semantics`, `verify-canvas`,
  `verify-threads` (23 total).

### Changed
- **PRODUCT.md register**: `Product` → `Playful Product`. Color strategy
  `Committed` → `Full Palette` (brand=progress, accent=interact, gold=mastery,
  warning/orange=review). Iconography standardized on `lucide-react` (emoji kept
  only on skill-tree nodes + empty states).
- **Theme**: dark-only. `html.dark` is forced; theme toggle removed.

### Removed
- **Light mode** entirely. v0.5 light-mode pairings were riddled with
  unreadable pairs; rather than ship half-fixed, light mode is dropped and will
  return as a dedicated milestone with systematic theme pairing.

### Fixed
- **StrictMode streaming stutter**: `accumulatePart` mutated `last.text +=`,
  doubling every character under React 19 StrictMode's double invoke. Now a pure
  function (returns new arrays/objects). Regression test added.
- **Input-box freeze**: switching to a node with no thread left `streaming=true`
  forever because the null-threadId branch never reset the flag.
- **Two-step first message**: `ensureThreadForSend` + deferred `chat.send` showed
  an intermediate empty state. `send(text, overrideThreadId?)` now creates and
  sends in one render.
- **Gear menu clipped** by `overflow:auto` in `ThreadSwitcher`; switched to
  `position:fixed` + `getBoundingClientRect` coordinates.
- **vite IPv6 binding on Windows**: vite bound `[::1]` but `wait-on` checked
  `127.0.0.1`; fixed with `server: { host: true }` in `vite.config.ts`.
- **package.json `verify:core`** corrupted by an unescaped `&&` in a `sed`;
  rewritten cleanly.

## [0.2.0] — 2026-08-05

### Added
- **Full repo `.md` import** via `cdn.jsdelivr.net` README link discovery
  (the only reliably reachable GitHub source from the renderer). `detectRepoPattern`
  auto-classifies course / single-file / unsupported.
- **LLM course structuring** with anti-hallucination context injection (course
  title + outline + lesson content, not lesson content alone — prevents the
  "FDE = Full Stack" fabrication class of bugs).
- **Section summary generation** (LLM) with prerequisite edges.
- **Mastery-tiered starter prompts** and teaching strategy in the agent engine.
- **i18n system** (zh-CN / en) with `translate()`; all hardcoded strings migrated.
- **Learning report export** (JSON + Markdown) from the Dashboard.
- **Theme toggle** (dark / light) — later removed in v0.5.

### Fixed
- **Windows dual-drive black screen + blank renderer**: GPU cache + vite root
  resolving relatively. One-line fixes each in `main.ts` / `vite.config.ts`.

## [0.1.0] — 2026-07-29

First tagged milestone. Local-first Electron learning app: gated skill tree,
AI tutor with BKT mastery tracking, SM-2 spaced repetition, XP / streak / freeze,
BYO-key multi-provider LLM (GLM / DeepSeek / Kimi / Qwen / SiliconCloud /
OpenRouter / OpenAI / Anthropic / Google), 14 SQLite tables, 18 verify suites.

### Added
- Core services: `agent-engine`, `llm-client` (3 protocols + error
  classification), `course-generator`, `srs` (SM-2), `xp-service`, `streak`,
  `proposal-service` (Propose→Apply state machine), lightweight RAG (`LIKE`
  fallback — sql.js WASM lacks fts5), memory system.
- Seed course from the FDE README (54 KB → 12 sections / 44 lessons).
- 13 → 18 deterministic `verify-*.mjs` suites run via `tsx`.
- `VERIFICATION.md` red lines + supervisor-judge protocol (§3.2).
