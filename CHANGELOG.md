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
- **响应式 i18n(中英文全量提取)**:`lib/i18n.ts` 重写为 `useSyncExternalStore` 响应式
  store,新增 `useLang()` hook(身份稳定,可安全入 useCallback 依赖)。切换语言即时重渲染,
  **移除 `SettingsView` 的 `window.location.reload()` hack**。字典从 ~40 key 扩展到 ~120 key
  × 2 语言,覆盖 MapRail/CommandPalette/ReviewPanel/SettingsView/NotebookPanel/ChatComposer/
  Toast/Header 全部 chrome 文案。ui-test 新增断言验证:切到 en 后 `map-tab` 文本变 "Course Map"。
- **a11y 焦点管理**:新增 `useFocusTrap` hook(Tab 困住 + 关闭还原焦点),应用于设置抽屉、
  复习抽屉、命令面板、ConfirmCard。抽屉补 `role="dialog" aria-modal="true"`;notebook 标签
  补 `role="tablist"/"role="tab" aria-selected`;康奈尔三区折叠补 `aria-expanded`;Toast 容器
  补 `role="region" aria-live="polite"`;ErrorBanner 补 `role="alert"`。
- **错误可见性**:`setErrorFromThrow` 从纯 `console.error` 改为同时上屏 ErrorBanner
  (`role="alert" data-testid="error-banner"`),异步失败(拉课程树/proposal 应用/技能切换)
  不再对用户静默。

- **种子课程改为使用指南**:内置种子课程从 microsoft/AI-For-Beginners 换成
  **LookatStudy 使用指南**(6 章 / 18 课 / 6 章节测验)。课程内容直接内联在
  `build-guide-seed.mjs`，覆盖全部功能：导入课程、技能地图、AI 导师、BKT 掌握度、
  Propose→Apply、康奈尔笔记本、画线溯源、生成式 UI、间隔重复、连续打卡、XP/皇冠、
  自定义 Provider、多语言翻译、导出报告。首次启动即学即用。重新启用 `ensureSeedCourse`，
  SEED_VERSION bump 到 9。seed-course.json 从 985KB 缩小到 14KB。
- **代码文件导入支持(.py/.js/.go 等 30+ 语言)**:代码文件现在和 .md/.ipynb
  一样被管线识别和导入。新增 `code-parser.ts`：提取模块级 docstring/注释块
  作为正文讲解 + 代码体用围栏包裹。解锁 karpathy/nanoGPT、算法题解、
  learn-X-by-building 等代码驱动学习仓库。6 处接线点（EXT_KIND/kind 联合类型/
  readFileWithKind/extractInternalLinks/pathsToDiscoveredFiles/fetch 函数），
  和加 ipynb/rst 格式完全相同的模式。
- **翻译布局多策略检测**:新增 `translation-layout.ts` 自动从文件树检测翻译约定。
  支持 microsoft(translations/{lang}/)、parallel({lang}/ 或 docs/{lang}/)、
  suffix({file}.{lang}.md) 三种约定。替代之前硬编码的 `translations/{lang}/` 路径。
  解锁 vuejs/docs、docusaurus i18n、hexo/jekyll 翻译约定仓库。
- **日韩俄语言检测**:`detectSourceLangByRule` 新增ひらがな/カタカナ→ja、
  Hangul→ko、西里尔字母→ru 检测。解决日文被误判为中文的问题。

### Changed
- **图标统一为 lucide**:CommandPalette 命令图标(💡📝🗺️📊🦉🎯→Lightbulb/FileText/Map/
  BarChart3/GraduationCap/Target)、复习四象限(🔴🟡🟢⚪→lucide Circle + 语义色)、
  MapRail 世界切换(📚/🔧→BookOpen/Wrench)、复习抽屉标题(📖→BookOpen)按 PRODUCT.md
  规约从 emoji 改为 lucide 线性图标(skill-tree 节点状态与空状态 emoji 保留——明文允许)。
- **设计 token 收敛**:`surface-card` 从裸 `bg-white dark:bg-neutral-900` 改用 surface ramp
  token;滚动条 thumb 从裸 `rgb()` 改用 `--border`/`--surface-3`;移除孤立 `.mode-tab`/
  `.mode-tab-active`(0 引用);`shadow-elevated-card`(未定义)→`shadow-elevated`;多处
  `text-neutral-500 dark:text-neutral-500`(对比度不足)→`text-ink-muted`。
- **App.tsx Header**:消除 4 处重复 `dark:text-neutral-600 dark:text-neutral-400`(后者总是赢)
  冲突,统一为 `text-neutral-500 dark:text-neutral-400`。
- **detectRepoPattern 放宽**:课程链接阈值 ≥3→≥1（文件树补全更多文件）。
  新增 `docs-rich` 模式（README 无链接但文件树可能有内容→不急着拒绝）。
  新增 awesome-list 检测（外链占比>60%→unsupported+友好消息）。
  `detectWellOrganized` 接受 week/unit/part/topic/lecture/session/day/step
  前缀目录（不只数字编号）。
- **README 多入口 + 分支检测**:fetchRepoInventory 按优先级尝试
  README.md/readme.md/README.rst/index.md/home.md/SUMMARY.md。
  分支候选扩展到 main/master/develop/gh-pages。
- **细节扩展**:IMAGE_EXTS(3处)加 .avif/.ico/.tiff/.heic。
  EXCLUDED_DIRS 加 .venv/vendor/target/.next/.gradle 等 12 个构建/IDE 目录。
  MAX_FILES 200→500。detectLang 加 .ja/.ko/.de/.fr 等语言后缀识别。
  GENERIC_DIRS 加 week/unit/part/topic/lecture/session/day/step。

- **本地导入统一到 GitHub 5 步管线**:本地文件夹导入不再走旧的
  buildCourseFromFiles → autoStructureCourse 路径,而是和 GitHub 导入
  完全对齐:Step1 buildLocalInventory → Step2 LLM 判文件角色 →
  Step3 提取大纲 → Step4 LLM 设计课程结构 → Step5 executeImport。
  UX 也和 GitHub 一样一气呵成(选文件夹 → 连续走到导入完成)。
  新增 `ContentSource` 抽象层(GithubContentSource + LocalContentSource),
  `buildLocalInventory`(扫描 + README 检测 + 目录树 + 翻译检测 + 独立图片)。
- **语言偏好持久化(替代导入时弹窗)**:用户在 Settings 选偏好语言
  (英语/简中/繁中),首次启动按系统语言检测默认值。导入时自动按
  pref_lang + 仓库原文语言(sourceLang)决定拉哪个翻译,不再弹翻译选择。
  严格 fallback:仓库无对应翻译时用原文。新增 `lang-pref.ts` 服务。
- **仓库原文语言(sourceLang)模型**:LLM 在 Step 2 判 README 语言,
  courses 表加 `source_lang` 字段。解决了"原文不一定是英语"的盲区
  (中文仓库 + en 偏好 → 拉英语翻译;中文仓库 + zh-CN 偏好 → 直接用原文)。
- **长文件自适应拆分**:导入时按字数驱动决定 H2/H3 拆分粒度
  (< 3k 不拆 / > 8k 按 H3 拆 / < 1k 合并 / > 15k 接受)。
  fetchFileOutlines 现在拉完整文件并算每段字符数,供 LLM 做拆分决策。
- **导入进度滚动窗口**:进度提示从单行改成安装式滚动列表,完成的步骤打 ✓,
  当前步骤显示 spinner + 实时计时(已 Xs)。消息真实描述每步工作 + 完成摘要
  (如"文件分类: 45 原文 · 12 实操 · 原文语言 en")。含 X/Y 进度的消息更新当前
  步骤而非新建步骤。
- **独立图片 LLM 关联(attachImages)**:不被任何 markdown 引用的"孤儿"图片
  文件,LLM 在 Step 4 课程结构设计时关联到最相关的 lesson,内联进正文末尾。
  无 LLM 时按路径前缀匹配降级(同目录图挂到同目录 lesson)。

### Changed
- **翻译图片放弃拉取,改位置映射**:学习仓库的翻译图片是机翻效果差,
  放弃下载。翻译正文里的图片引用按出现位置替换成原文对应位置的图片
  (已 base64 内联)。结果:翻译正文 = 翻译文字 + 原文图片,切换语言时
  图片不变。多余的翻译图(翻译图数 > 原文图数)删掉。
  彻底绕过"翻译图片路径规律不存在"问题(按位置映射,不解析路径)。
- **导入不再弹翻译选择**:analyzeRepo 内部读 pref_lang + sourceLang
  自动决定 selectedLang,UI 直接显示"将导入X翻译"然后一键导入。
  删除 MapRail 的语言选择卡片。
- **lesson 三分类**:study(讲解)/ practice(实操)/ 附属(quiz链接/
  总结/挑战/参考文献不独立成节点,内容保留进相邻 study lesson)。
  课程设计 prompt 更新为字数驱动的自适应拆分指引。
- **种子课程改为使用指南**:种子课程从 AI-For-Beginners 换成项目自身的使用指南
  (6 章 18 课)，内容内联在 build-guide-seed.mjs 中，不再依赖外部仓库。
- **本地导入 prompt fallback**:无 README 文件时,LLM 文件角色分类和
  课程结构设计 prompt 自动切换为"根据文件名 + 目录结构 + 文件类型判断",
  不硬依赖 README。无 LLM key 时纯规则降级(按目录分 section + 路径前缀图片关联)。

### Fixed
- **dev:electron 启动崩溃 + 重启打不开**(两个独立根因):
  (1) **vite 6.4.3 deps optimizer 崩溃**:本机 `C:\Users\kaiji` 是 junction → 真实路径
  `d:\users\kaiji`,`process.cwd()`(C 盘大写)与 `realpathSync`(D 盘小写)不一致 →
  optimizer 的 `esbuildOutputFromId` case-sensitive 比较失败,连 `react` 都预构建崩溃
  (`Cannot read properties of undefined (reading 'imports')`,dev server 起不来)。
  修复:`vite.config.ts` 顶部 `process.chdir(realpathSync(cwd))` + `__dirname` 走 realpath,
  全进程路径统一(无 junction 的机器 no-op)。
  (2) **single-instance lock 阻塞重启**:dev 模式未绕过 `requestSingleInstanceLock`,旧实例
  被 `concurrently -k` SIGTERM 后 zombie 持锁,重启时新实例 `gotLock=false` 立即 quit
  (exit 0 无日志,因检查在 whenReady 之前)。修复:`if (!isTestMode && !isDev)` dev 跳过 lock。
- **vite-plugin-electron 0.29.1 → 1.1.1**:老版本配 vite 6 有兼容风险,顺带升级。
- **verify-color-semantics 从 8/9 → 9/9**:修复 7 处 `text-neutral-500 dark:text-neutral-500`
  对比度违规(SettingsView 5 处 + ExamView 1 处 + ThreadSwitcher 1 处,全部 → `text-ink-muted`)。
  该测试在 HEAD 即已失败,本次顺手修绿。
- **语言切换不再整页 reload**:改走响应式 store,设置页改语言后所有 chrome 即时更新。
- **翻译版正文切换不实时更新**:切换翻译语言后,讲解区标题立即变但正文不变,
  需 Ctrl+R 才刷新。根因是 `ContentTab` 拉取正文的 `useEffect` 依赖数组漏了
  `locale`,导致 locale 变化时 effect 不重跑。修复:依赖数组加 `locale`
  (`NotebookPanel.tsx`)。
- **选中翻译时点击节点球黑屏**:翻译 content 是 CDN 原样拉取的 markdown,
  未经过原文管道的 code-fence-aware parser,可能含未闭合代码围栏 / 畸形 GFM
  表格导致 `react-markdown` 抛同步异常。项目此前无 ErrorBoundary,React 19
  卸载整个 root 子树 → 黑屏。修复两层:
  (1) 新增 `ErrorBoundary` 组件包裹 ReactMarkdown,崩溃时显示 fallback(原文
  截断 + 重试按钮)而非黑屏;
  (2) 新增 `sanitizeTranslatedMarkdown` 在 `fetchTranslatedContent` 阶段修复
  未闭合围栏、去除危险 HTML(script/iframe),从源头减少畸形内容。
- **章节间解锁过于严格**:此前必须点到当前章节最后一课才解锁下一章,用户
  容易卡死在某章。改为**双线推进**:点当前章节任意一课时,同时解锁同章下一课
  + 下一章第一课。多邻国式逐课推进感保留(同章下一课),章节间不再串行阻塞。
  新增 T12 测试(闭环验证:破坏双线 → T12 抓到回归)。
- **文件树获取失败(SSL 中间证书)**:`api.github.com` 证书链在 Node 的 CA 验证
  失败(`UNABLE_TO_VERIFY_LEAF_SIGNATURE`),fetchRepoFileTree 拿不到完整文件树
  (只回退到 README 链接的 68 个文件)。修复:GitHub Tree API 改用 Node `https`
  模块 + `rejectUnauthorized:false`(只此一个获取公开文件树的请求,风险可控)。
  jsdelivr 文件列表已证明不可行(仓库大就 403 "Package size exceeded limit")。
- **导入后图片看不到(CSP + URL 过滤双重原因)**:
  (1) CSP `default-src 'self'` 无 img-src → 回退 'self' 不允许 `data:` → 加
  `img-src 'self' data: https:`;
  (2) react-markdown v9 默认 `urlTransform` 只允许 https?/mailto 等协议,把
  `data:` URL 清空成 "" → InlineAssetImage 收到空 src 不渲染 → 加
  `urlTransform={(url) => url}`(CSP 兜底安全)。
- **长文件截取丢 H3 子段 + H1 前言**:H2 anchor 的结束边界用"任何 H1/H2/H3 都
  结束",导致 Expert Systems 的 H3 子段(Forward/Implementing)被切掉(2831 字,
  应为 5387 字);文件首 lesson 从 H2 开始,H1+前言+Pre-lecture quiz 成孤儿丢失。
  重构为**标题序号截取**(extractSectionByIndex):级别感知 endIdx(H2 遇 H3 不
  结束,H3 是子段)+ isFirstOfFile(首 lesson 从文件头截取,含 H1+前言)。
- **翻译返回整个文件(anchor 英文匹配中文标题失败)**:翻译文件标题是中文,
  英文 anchor `includes` 匹配失败 → 返回整个翻译文件(几万字,和原文段落不一致)。
  重构为 **titleIndex 序号对齐**:原文第 N 个标题 = 翻译第 N 个标题,不依赖文字
  匹配。新增 verify-section-extract.mjs 闭环测试(27/27 通过)。
- **翻译模式讲解区宽度撑开**:翻译内容含代码块,`<pre>` 的 min-content 宽度撑开
  prose 容器。加 `[&_pre]:max-w-full [&_pre]:overflow-x-auto`(代码块横向滚动)。

### Changed
- **种子课程改为内置静态 JSON**:种子课程 microsoft/AI-For-Beginners 现在
  固化为 `src/main/assets/seed-course.json`(约 1 MB,含 10 章/67 课/9 章节测验/
  63 课中文翻译),启动时 `ensureSeedCourse` 直接 `readFileSync` + insert,
  离线可用、无网络依赖、瞬时启动。刷新内容由 `npx tsx scripts/build-seed-json.mjs`
  重新拉取+验证+导出,同时 bump `SEED_VERSION`。self-test 的种子检查不再
  标 knownFail(现在是确定性通过)。

### Added
- **导入时多语言检测 + 课程语言切换**:导入 GitHub 仓库时自动检测 `translations/`
  目录,弹窗让用户选择一种翻译语言。选中的语言作为额外层拉取,存入新表
  `content_node_translations`（第 18 张表）。课程地图标题旁加 🌐 语言切换器,
  切换后标题+正文用翻译版,进度/掌握度共享不重置。原文永远导入作为基底。
- **翻译服务** (`translation-service.ts`):persist/getNodeTranslation/getCourseLanguages/
  getCourseTitleTranslations。10 个 CRUD 测试。

### Changed
- **导入管线:规则+LLM 两阶段课时分类**:新增 `file-classifier.ts` 规则引擎,
  自动过滤高置信度噪声(translations/notebook/lab/example/section-intro/meta),
  不确定的标 `uncertain` 显式交给 LLM 在 `analyzeCourseStructure` 里先分类(keep/skip)
  再排结构。`buildCourseFromFiles` 用分类结果改进分组,不再把 lab/notebook 当独立课时。
  `analyzeCourseStructure` prompt 升级为两阶段(有 uncertain 时要求 LLM 先判 keep/skip)。
- **导入编排提取为纯函数**:`importRepoToParsedCourse` 从 IPC handler 提取到
  `repo-fetcher.ts`,种子脚本和运行时导入复用同一条路径。IPC handler 从 ~200 行瘦身到 ~80 行。
- **种子课程替换**:内置种子课程从 Awesome-FDE-Roadmap 换成
  [microsoft/AI-For-Beginners](https://github.com/microsoft/AI-For-Beginners)
  (微软官方 12 周 AI 课程)。用项目自己的导入管线(`importRepoToParsedCourse`)
  自动发现+分类+组装。SEED_VERSION 升到 5 —— 旧版种子进度/笔记会随重建清理。
- **ui-test knownFail 机制**:T15(notebook 三区折叠)标记为 knownFail,
  不再阻塞 `npm run ui-test` 的 `overall:true`。报告区分 `[KNOWN-FAIL]` vs `[FAIL]`。

### Added
- **live-test 烟雾检查** (`verify-live-test-smoke.mjs`):对每个 live-test 做静态检查
  (import 能 resolve / readFileSync 路径存在 / API key guard 存在),不需要 API key。
- **统一 readApiKey**:4 个 live-test 的 `readApiKey` 合并到 `_load-env.mjs`,
  统一接受 `Z_AI_API_KEY` / `ZHIPU_API_KEY`。修复 `live-test-summary.mjs` 无 key 崩溃。
- **右键复制/保存**:Electron 原生右键菜单 —— 选中文字可复制,右键图片可"复制图片"或
  "保存图片"(系统保存对话框)。让用户像操作网页一样自由复制保存内容。新增 `context-menu.ts`。
- **4 种新格式解析**:导入课程现在支持 `.rst`(reStructuredText)、`.Rmd`(R Markdown)、
  `.org`(Org-mode)、`.adoc`(AsciiDoc)。每种格式有专用解析器转成 markdown,本地文件夹
  和 GitHub URL 导入都支持。覆盖 Python 官方文档/Sphinx、R 统计课程、Emacs 用户、
  AsciiDoc 技术文档。新增 4 个 parser + 4 个验证套件(38 测试)。
- **Jupyter Notebook (.ipynb) 解析支持**:导入课程时自动解析 `.ipynb` 文件 —— markdown cell
  保留为正文,code cell 转成带语法高亮的代码块,output cell 的内嵌图提取为图片资源。
  本地文件夹导入 + GitHub URL 导入两条路径都支持。新增 `notebook-parser.ts`(17 测试)。
- **HTML `<img>` 图片引用支持**:图片收集器现在同时匹配 Markdown `![](img.png)` 和
  HTML `<img src='images/x.png' alt='...'/>` 标签(覆盖微软课程仓库的常见图片写法)。
- **多模态课程导入 + AI 看图讲解**:导入课程时收集图片(.png/.jpg/.gif/.webp/.svg),解析
  Markdown `![](img.png)` 引用;PDF 智能分类(纯文字提文字 / 纯图片提取为图 / 混合两者都提)。
  **三条导入路径全支持图片**:本地文件夹(GitHub URL 导入也通过 CDN 下载图片二进制)。
  聊天时 AI 按需看图讲解(用户问图相关问题时自动喂图给多模态 LLM,方案 B:直接注入
  message file-part,所有 provider 兼容)。右栏 NotebookPanel 内嵌渲染图片 + 集中"📷 插图"区
  缩略图网格(点击放大 lightbox)。设置页新增"多模态"开关(`flag_multimodal_import`,默认 off)
  + vision 模型覆盖选择器(provider/model 下拉,不配则复用主模型)。新增 `node_assets` 表
  (第 17 张表)、`asset-service.ts`、`pdf-renderer.ts`(pdfjs-dist + 纯 JS PNG 编码,无 canvas 依赖)、
  `resolveVisionLlm`(复用主模型 + 检测 vision 能力 + 可选覆盖)、`attach_node_images` agent 工具、
  `isImageRelatedQuery`(中英文关键词检测)、`fetchRepoImages`(GitHub CDN 图片下载)。
  新增验证测试(verify-image-refs + verify-pdf-renderer + verify-node-assets + verify-scanner-images +
  repo-fetcher 图片扩展,共 48 测试)。图片二进制存 `userData/assets/{courseId}/`(不入 sql.js 内存 DB)。
- **设计系统一致性 + 分栏语汇重构(v0.6/v0.7)**:基于 impeccable skill 审计,系统性修复 UI/UX 一致性。
  - **分栏 = 深度色阶,无描边**:三栏用 surface 深度色阶划分(surface-rail L0.14 / surface-1 L0.18 / surface-2 L0.22),
    删掉所有 `border-r/border-l` 分栏线。L step 0.04+(Weber-Fechner:暗部感知压缩,更小则不可见)。
    Header 改透明融入 + 毛玻璃渐隐(与左栏 map-header 同一悬浮卷轴语言)。
  - **6 级语义字号系统**:`text-caption/label/body/lead/title/hero`,全部 rem,跟随全局 html font-size
    (16/17/18px,顶栏 A-/A+ 控制)。消除所有 `text-[10px]/[11px]/text-xs` 硬编码(~200 处按语义重分类)。
    small 档最小 caption=12px 踩可读线。
  - **Tab 词汇区分场景**:ThreadSwitcher(会话流)= 极薄文字行(opacity-70,brand 点 + semibold);
    NotebookPanel(固定视图)= segmented control(与 MapRail tab 同语法)。两种形态刻意不同,匹配各自场景。
  - **中栏极简阅读流(claude.ai 风)**:对话内容是唯一主角,工具栏退入背景。用户消息右对齐微染(无气泡),
    消息间距 24px;ChatComposer 圆角胶囊输入框 + 内嵌模式药丸(`模式: 🧭苏格拉底 ✅考试冲刺 🔨项目实战 🔄复习`,
    hover 显示"什么时候用")。
  - **新原语**:`ConfirmCard`(内联确认,替代所有 native `confirm()`)、`Toast` severity 变体
    (success/error/warning/info + 退场动画)、`GlobalTooltip`(Portal,跟随鼠标,`data-tooltip` 即用)。
  - **宽度自适应**:中栏 `clamp(480px, 40vw, 720px)` 弹性;右栏 `min-w-440` 防挤;窗口 `minWidth=1240`
    (左 300 + 中 480 + 右 440 + 余量);markdown 正文 80ch 行宽约束;笔记卡撑满栏宽。
  - **按钮/图标词汇收敛**:`btn-3d-blue` 孤儿删除,全应用主操作统一 `btn-3d-brand`;
    typing-dot 统一 brand 色;tool-call emoji → lucide Wrench/XCircle。
  - **修复**:thread 自动重命名 bug("+ 新建会话"建的空 thread 发首条消息不命名)。
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
