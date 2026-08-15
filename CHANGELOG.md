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
- **GitHub Actions CI(`.github/workflows/ci.yml`)** —— push(main)/PR/手动触发,ubuntu 跑 oxlint + 双 tsc typecheck + 65 个 verify 套件 + vite build,外部坏 PR 在 CI 就被挡住。运行器与 engines 底线定为 **Node 22**(tsx 4 在 Node 20 上经 data: URL 解析相对导入会挂,verify 套件在 20 跑不起来;本机开发环境是 Node 24)。
- **多平台打包 workflow(`.github/workflows/package.yml`)** —— workflow_dispatch(任意分支可试跑,可带 `release_tag` 输入让 CI 云端直挂安装包到既有 release,免本机中转)或推 `v*` 标签触发,windows/macos/ubuntu 矩阵各跑构建,产物(NSIS exe / arm64 dmg / AppImage / deb)传 workflow artifacts;attach 任务用 `gh release upload --clobber` 挂到对应 GitHub Release。三个实测才修对的配置:mac `identity: null` 免签名(CI 无 Apple 证书,未签名 dmg 首开需右键打开)、`electron-builder --publish never`(GH Actions 里检测到 CI 会默认自动 publish,找不到 GH_TOKEN 而死)、workflow 声明 `permissions: contents: write`(默认 GITHUB_TOKEN 只读,gh release upload 403);deb 元数据还要求 package.json 的 author 带 email(已补)。v0.9.0 release 据此挂齐四平台安装包,exe 换成 CI 可复现构建。
- **CONTRIBUTING.md** —— 人类贡献者指引(环境/验证清单/最容易踩的铁律/commit 与 changelog 约定),与 AGENTS.md 互为补充。
- **`npm run shots` —— README 截图自动采集模式(`--shots`)** —— 无头窗口 + .env 真 provider + 预置"学过一阵"状态(皇冠/进度环/锁定球/待复习徽章/XP 能量条/Boss 考试球解锁),驱动真实 UI(点开始学习 → 真 LLM 二选一猜测卡 → 揭晓;点第一章考试球 → 后台分批生成 → 开考计时答一题)并 capturePage 截**两套各 3 张** PNG:`docs/screenshots/`(中文,README.zh-CN 用)与 `docs/screenshots/en/`(英文,README 用)——跑两遍(`--shots` / `--shots-en`),各自独立临时 DB(每次启动先删,对话/考试题库按当遍界面语言产生,互不污染);英文遍启动即英文(localStorage 界面语言 + 课程 🌐 en 直写 settings + loadFile 二次加载,不做事中切换)。本模式独享例外:GPU 加速保持开启(capturePage 需要合成,生产路径仍 disableHardwareAcceleration)。实战修出的鲁棒性(每条都是真实踩坑):capturePage 偶发 0 字节/拒绝(长 LLM 等待后窗口闲置相关),唤起窗口重试至多 5 次且**绝不用 0 字节覆盖磁盘上的好图**;启动后语言门校验按钮文案符合当遍语言(中英对称),不符宁可失败退出也不静默存错语言图(js() 吞错曾把失败变成"成功");二次加载用 loadFile 而非 reload()(后者会以 display surface 不可用 reject 后悬挂);localStorage 语言写进共享 userData,截完必须还原否则正常启动残留英文界面;runShots 任何异常保证 app.quit 不悬挂;每张截图前 hide/show 强制重合成并记录 DOM 语言探针(输入框占位符/助手消息语言),截图像素与文档语言可对照核验。
- **内置引导课程双语化(原文 zh-CN + 内置 en 翻译)** —— 种子课程(LookatStudy 使用指南,SEED_VERSION 10→11)从单语变双语,和导入课程同一套机制:30 条英文翻译(6 章 + 18 课 + 6 考试标题)进 `content_node_translations`,地图标题卡的 🌐 切换器开箱即可演示原文/翻译切换,离线无 LLM。英文课文全部手工撰写(内联在 `build-guide-seed.mjs`),构建期自检缺译即报错。灌入逻辑抽成 `seed-apply.ts`(db 注入式,绕开 seed.ts→db/index 的 `?raw` 导入链),新增 `verify-seed-bilingual.mjs` 7 断言(结构/灌入/幂等/版本 bump 重建含 UNIQUE 冲突回归陷阱,闭环已证)。顺手修一个真 bug:🌐 切换器 `LOCALE_NAMES` 缺 `en` 条目,英文翻译显示成原始码 "en"(ui-test 新断言抓到)。
- **AI 输出语言跟随界面语言(对话 + 出题)** —— 此前导师讲解、出题的提示词全部硬编码"用中文回答",英文界面用户被强行中文教学。现定位为**界面语言 = 偏好输出语言**(课程 🌐 只决定读哪份课文,不决定 AI 说什么):渲染层把 i18n 界面语言随消息/出题请求穿到主进程(`agent:chatThread`/`exam:prepare`/`exercise:generate` 加 locale 参),`resolveOutputLang`(`@shared/locales` 纯函数)解析后注入提示词——zh 路径与旧硬编码**逐字节一致**(默认行为零变化,verify 断言锁死),非 zh 用英文指令并显式点名工具参数(generate_quiz 的题干/选项/解析)也必须跟随;soul 人设是中文写的,注入后追加一句"人设只管行为不管语言"提醒。语言组装抽 `agent/base-prompt.ts` + 出题语言行 `questionLanguageLine`,exam/exercise prompt 同链;考试题库一次性生成,语言在生成时定格。新增 `verify-agent-locale.mjs` 10 断言(映射/指令/组装/解析,两轮闭环已证:破坏 locale 传递与解析各红一次)。

### Changed
- **README 双语重写(showcase 骨架 + 维护者第一人称行文)+ MIT LICENSE 文件** —— 英文主版 + 简体中文镜像(README.zh-CN.md,互链切换)。骨架保留 GitHub 流行式(徽章行/居中头部/三张内嵌截图/快速开始),文字按 human-writing 技能全部重写为作者自述体(为什么写这个/两个没后悔的设计/目前做不到的事),中文版过 check_prose.py 全绿(翻案句 0/破折号 0/提示性冒号 0/黑话 0)。新增 MIT LICENSE 全文(此前只口头声明);`docs/` 目录启用存截图。

### Fixed
- **课程摘要双语化：随界面语言切换** —— 首点节点球的那次“摘要+KC”生成，此前只产中文摘要（英文界面下摘要卡是残留中文）。现在同一次 LLM 调用同时产出中文摘要（`summary`，与旧行为一致）和英文摘要（新列 `content_nodes.summary_en`，`addColumnIfMissing` 幂等迁移），批量版 `generateLessonSummaries` 同链；`getNodeSummary(nodeId, locale)` 按界面语言选版本——历史节点只有中文时单独补一次小调用翻译英文摘要（`generateLessonSummaryEn`，绝不动已有 summary/KC，防重写 KC 弄散掌握度归因），全部缺失回退中文。旧输出无 `summaryEn` 字段完全兼容（undefined 不落库）。内置指南课程的 24 条英文摘要（6 章+18 课）手工撰写进种子（SEED_VERSION 11→12）。verify-lesson-summary-kc 扩 T8-T11（解析保留/向后兼容/提示词双语静态扫描/种子 24 条齐备，闭环已证）。
- **「开始学习」开场提示词跟随界面语言** —— 按钮气泡文案早就走 i18n,但发给 LLM 的完整开场指令模板一直硬编码中文(五段提示词)。英文界面下对话里会混进一条长中文用户消息,把导师后续回合拖回中文(实测 en 会话:hook 英文、揭晓变中文)。模板迁 `chat.action.startLearningPrompt`({title} 插值),zh 与旧硬编码逐字节一致(verify-agent-locale 新增 2 断言锁死,闭环已证)。
- **巩固选择按钮跟随界面语言** —— 4 个 starter prompts(深入这点/举个例子/考考我/我没太懂)的 label/hint/发送消息原先硬编码中文，英文界面下是唯一一处整排中文(截图里显眼)。服务端返回加稳定 `key`(go-deeper/give-example/quiz-me/confused)，渲染层(App)按界面语言查 `starter.{key}.*` 字典覆盖 label/hint/message，消息里的课名取当前课程语言下的节点标题(与界面显示一致);中文路径输出与原字符串逐字一致。verify-starter-prompts 扩 T8/T9(key 唯一性 + 16 键双语言静态扫描防漂移，闭环已证)。

## [0.9.0] — 2026-08-15

### Added
- **按钮消息只展示动作,不展示提示词(`chat_messages.display_text` 新列)** —— 此前点「🚀 开始学习」/巩固选择/命令面板,发给 LLM 的整段提示词会作为用户消息裸奔在聊天窗(用户像在自己 prompt 自己,而不是被 AI 开场接待)。现在按钮触发的消息分两轨:**`content` 存完整提示词**(LLM 上下文照旧只见它)、**`display_text` 存短动作标签**(气泡只显示它,如「开始学习「人工智能简介」」);只有输入框手打的字才原样展示(`display_text=null`)。全链路透传:useChatStream.send 第三参 → `agent:chatThread` IPC → `appendMessage` → 落库 → 重载读回(ChatMessageRow/V2 带 displayText);会话 tab 标题同样用短标签(不再是整段提示词)。接入的按钮:开始学习 / 4 个巩固选择(深入·举个例子·考考我·我没太懂,标签=按钮文字)/ 命令面板 6 命令(标签=命令名)。verify-threads +T9 往返断言(闭环已证:弄坏 schema 列→5 红);ui-test +T8e(点开始学习→气泡=「开始学习「X」」+提示词不出现在 DOM,34 断言)。旧消息无 display_text → 原样展示,零迁移语义变化。
- **课程搜索(左栏搜索药丸 → 全栏搜索面板)** —— 大课程(100+ 课时)此前找课只能滚地图。MapRail 标题卡新增「搜索」入口(与「复习」并排),打开覆盖左栏的搜索面板:**空查询 = 树状导航**(全部章节→课时,编号路牌与地图同视觉,锁定行与地图球同规则 disabled,兼作课程大纲);**关键词 = 双路检索**——标题多词 AND 过滤(章节命中→整章保留,命中片段 brand 色高亮)+ 全文内容匹配(唤醒休眠的 `search:content` IPC,LIKE 兜底,只留本课节点、与标题命中去重,防抖 250ms)。点行跳转 = 自动切到目标世界(实操课切实操页)+ 走 onJumpNode(继承流式锁/考试离开守卫)+ 面板收起 + 地图平滑滚动到对应球(不可见时)。Enter 跳第一个可点结果,Esc/×/切课收起。过滤/锁定/高亮计算抽纯函数 `lib/course-tree-filter.ts`(`verify-course-search.mjs` 9 断言,闭环已证);ui-test 加 T22(开面板→24 行全树→"欢迎"过滤到 1→点行跳转选中环),共 33 断言。
- **种子课程内容全量刷新（SEED_VERSION 9→10）** —— 「LookatStudy 使用指南」多课内容已落后于实际版本，按当前产品设计重写：①考试课整课重写为考试 v2（后台按知识点生成/进度显示 KC 覆盖/可切走+完成通知/就绪页/每题 60s·90s 限时/离开即终止未答计错/结算页 KC 分解/重考重排题序选项序/**考试不回写 BKT**——旧文错误声称"测验结果更新 BKT"）；②AI 导师课从已废弃的"苏格拉底/考试准备/调试/教学四模式"重写为**教学人设 soul（精讲/引导/实战）**+ 开始学习 hook + 四个巩固选择；③BKT 课更新为**知识点级**（课时掌握度=min 各 KC、0.5 解锁/0.9 毕业、考试不更新）；④导入课补**空选启动/手动选课/后台导入可离开/就地删除课程**；⑤Provider 课更新为 19 个预设 + custom- 优先级；⑥SM-2 课补**复习抽屉**（四象限/交错复习/自评三档）与 BKT↔SRS 双向联动；⑦XP 课更新为顶栏今日能量+等级徽章+庆祝动效。结构与节点 id 不变（6 章 18 课 6 考试，guide-les-X-Y 稳定，ui-test 引用不破），15.5KB。verify:core/self-test/ui-test 全绿。
- **章节考试 v2(后台生成 + KC 出题 + 限时考试 + attempt 档案)** —— 考试从"点击即阻塞等 LLM 的问答页"升级为有生命周期的对象(generating→ready⇄answering→result)。**后台生成**:点考试节点自动触发,KC 按 ≤3 个/批分组逐批 LLM 出题,真实进度(完成批数/总批数)经新 `exam:status` 事件推送;用户可切走(生成在 main 后台继续),完成后 toast 通知,切回见就绪页(N 题/M 知识点/预计时长)。失败保留原因 + 重新生成入口。旧版把互斥锁写进 `content_nodes.content` 列的 hack 删除(单窗口进程内 `exam-generation-store` Map + 共享 promise 即互斥)。**按知识点出题**:章节 KC = 同 section 所有 lesson 的 knowledge_points 去重合并(无 KC 老课程用课时标题伪 KC 兜底);题量 = `clamp(ceil(KC数×1.5), 5, 15)` round-robin 分配;题目带 `exercises.kc_title` 标签(新列)。**限时考试**:每题 60s(题干 ≥200 字或含代码 90s),≤10s 变 warning 色,到 0 自动记当前选择进下一题;离开警告模态打开期间计时暂停。**离开即终止**:考试中切换节点/课程/Ctrl+Tab → 居中警告模态(ConfirmCard 风格 + focus trap + Esc),确认 = terminate 提交(未答=错计分,同样计星计 XP)再导航。**attempt 档案**(第 20 张表 `exam_attempts`):开始考试建行,每答一题增量持久化 answers_json(崩溃安全);app 崩溃/强关的悬挂 attempt 在下次 getStatus 自动按"未答=错"判死并标注;切回节点默认落结算页(星数 + 按知识点分解[薄弱 KC 标注] + 逐题回顾 + 历史最好/次数);**重新考试** = 新 attempt + attemptId 种子重排题序和选项序(`shared/exam-logic.ts` 纯函数,提交前显示位映射回原始下标判分,verify-exam T4 闭环已证)。维持"考试独立"原则:结果不回写 BKT/KC 掌握度,KC 分解纯展示。新 IPC:exam:prepare/getStatus/startAttempt/recordAnswer/submitAttempt(旧 exam:start/submit 移除)。verify-exam 重写为 14 断言。
- **学习者记忆系统 Phase 1(agent 终于"认识"用户)** —— 此前 agent 功能上无记忆(`memory` 表+CRUD 是休眠骨架,agent-engine 从不读/写)。定位为**学习者模型(定性层)**,正交补 BKT(定量掌握度)+ friction_log(原始卡点事件)之缺——记的是"怎么学/什么讲法管用/跨节点反复卡点",而非从"提问+讲解"窗口里抽不到的个人画像。写侧:agent 第 11 个 tool `remember`(flag `memory_system` 门控)→ **写时 LLM 合并**(注入式 merge,生产 `defaultLlmMerge` 去重/解冲突/保简洁,测试确定性 stub)→ 按 `(category,nodeId)` 槽位 upsert(global/node/friction_pattern),合并而非覆盖防"越用越乱"。读侧:`getLearnerMemory` 拼块注入 system(空则不注入,新用户零副作用)。**借 Mem0 的 extract+merge 算法,不移植包**(向量/抽取 pass 与 local-first/BYO-key/无 native 三重冲突)。新增 `memory-service.ts` + `verify-memory.mjs`(9 断言,闭环已证)。Phase 1.5 将建 learner-model 投影统一 mastery+friction+memory 三处注入;Phase 3 friction_pattern 自动提炼。
- **学习者记忆系统 Phase 1(agent 终于"认识"用户)** —— 此前 agent 功能上无记忆(`memory` 表+CRUD 是休眠骨架,agent-engine 从不读/写)。定位为**学习者模型(定性层)**,正交补 BKT(定量掌握度)+ friction_log(原始卡点事件)之缺——记的是"怎么学/什么讲法管用/跨节点反复卡点",而非从"提问+讲解"窗口里抽不到的个人画像。写侧:agent 第 11 个 tool `remember`(flag `memory_system` 门控)→ **写时 LLM 合并**(注入式 merge,生产 `defaultLlmMerge` 去重/解冲突/保简洁,测试确定性 stub)→ 按 `(category,nodeId)` 槽位 upsert(global/node/friction_pattern),合并而非覆盖防"越用越乱"。读侧:`getLearnerMemory` 拼块注入 system(空则不注入,新用户零副作用)。**借 Mem0 的 extract+merge 算法,不移植包**(向量/抽取 pass 与 local-first/BYO-key/无 native 三重冲突)。新增 `memory-service.ts` + `verify-memory.mjs`(9 断言,闭环已证)。Phase 1.5 将建 learner-model 投影统一 mastery+friction+memory 三处注入;Phase 3 friction_pattern 自动提炼。
- **学习者模型读投影 Phase 1.5(三处散注收口)** —— 此前 agent 的学习者状态散在三处拼进 system:① 掌握度+教学策略织在 nodeContext 里、② buildFrictionContext 单独拼、③ Phase1 的 memory 又单独拼。新建 `learner-model-service.ts` 的 `buildLearnerSnapshot(db,nodeId,{includeMemory})` **读投影**(CQRS 思路)把三者合成一个"【学习者当前状态】"块;agent-engine 的 nodeContext 瘦身回纯"教什么"(课程结构+节点内容),学习者状态统一走 snapshot。`getTeachingStrategy` 从 agent-engine 移入本服务(它本就是学习者模型逻辑)。**不合并底层 store**——BKT/friction/memory 是不同数据类型(定量标量/原始事件流/综合),揉一起降正交,且 BKT 还喂解锁/地图/dashboard 不能塞进 agent 专属;只在读侧投影。`includeMemory` 显式传入(解耦 flag 机制,可纯测)。新增 `verify-learner-model.mjs`(6 断言,闭环已证)。三连 verify:core(31 套件)/vite/self-test 全绿。
- **记忆课程隔离(方案2)** —— memory 表加 `course_id` 列。`friction_pattern`(领域性卡点)**按课程隔离**——学 React 时记的"混淆参数/变量"不会串到微积分会话;`global`(学习风格/偏好)**仍跨课程**(风格是关于人的,不分课程);`node` 靠 node_id(节点自带课程)。`remember/getLearnerMemory/buildLearnerSnapshot` 透传 `courseId`(agent-engine 从当前节点 `node.courseId` 取,agent 不感知)。趁 flag 没开、无真实数据,零迁移成本。verify-memory 加 T10-T12、verify-learner-model 加 T7(课程隔离断言,闭环已证)。
- **记忆固化 consolidation(Phase 3 重定义为核心)** —— 把 Phase 3 从窄的"friction 自动提炼"重定义为**通用记忆固化**:从原始数据(对话/friction/答题)一次 LLM 提炼+合并进**全三类**(global/node/friction_pattern),不靠 agent 自觉——是 agent `remember`(实时手动)的系统级兜底。核心 `consolidate(db,window,fn)` **触发无关、纯函数**(window 由采集层传入;`defaultLlmConsolidate` 一次 LLM extract+merge,看 raw+existing→JSON,非合法 JSON 保守不写);注入式 fn 可确定性测。覆盖全三类=回应"consolidation 该覆盖所有 memory"。新增 `verify-consolidation.mjs`(8 断言,闭环已证)。三连 verify:core(32 套件)/vite/self-test 全绿。**触发已建**:`gatherConsolidationWindow` 采集窗口 + on-demand `consolidate:run` IPC + **里程碑触发**(节点首次 mastered=拿皇冠,quiz:recordAnswer/proposal:apply 两处 fire-and-forget;**非时间节流**——里程碑稀有,避免无脑烧 token,且"刚完成成就"是最自然的固化时机)。**watermark 增量**:gather 传 `since`(每课程水位 `consolidate_watermark:<courseId>`),只采上次固化之后的新数据,彻底消除重复处理。**crown-once 正确性**:两处触发点都做过渡检测(`!wasMastered`)——一个节点只拿一次皇冠=只触发一次固化(此前 proposal:apply 的 mark_mastered hook 漏了过渡检测,会对已 mastered 节点重复触发,已修)。verify-consolidation 11 断言(闭环证)。live-test 真模型验证过(产出质量好,无 bug)。
- **UI/UX 全量打磨(a11y + light mode + token 一致性)** —— (1) 全局 `:focus-visible` 焦点环(WCAG 2.4.7;101 个按钮原先仅 1 个有 focus-visible→全应用键盘焦点可见);(2) `btn-icon-3d` 圆形 3D 按钮词汇(发送/停止钮复刻 3D 手感但 rounded-full,消除裸 bg-brand 圆形钮);(3) `map-rail-scope` 左栏锁深色(游戏化场景不参与 light 切换);(4) 中右栏 90 处 neutral 双套写→ink/surface token(浅色模式真正可用);(5) 6 个 artifacts amber→warning;(6) NotebookPanel nested card 消除 + 标题字号语义化(text-xl/lg→text-title);(7) PRODUCT/AGENTS 承认双主题(原先误标 dark-only)。
- **底部按钮重构:语境化 4 巩固选择 + 撤 ? 卡点表单(接住 hook 之后的动量)** —— 原 starter chips
  进节点就给(语境前 = 决策税)、含义模糊、hint 只靠 hover;? 卡点是无标签图标 + 糊涂/卡住/受挫三选
  下拉(在认知负荷最高处做元数据归类,反学习习惯)。重构:starter 改成固定的 4 个"一瞥→懂"巩固选择
  (深入这点=精加工 / 举个例子=具体化 / 考考我=检索 / 我没太懂=困惑处置,各有学习科学依据),
  **仅在对话开始后出现**(语境前零决策税);hint 默认可见(2×2 grid,不靠 hover);原 ? 折进
  「我没太懂」(点它 → 发消息让 AI 追问"哪部分?" + 暗记一条 friction)。不再按 mastery 分档。
  shared `StarterPrompt` 加 `frictionCategory` 字段;verify-starter-prompts 重写(7 断言);闭环证明已做。
- **"开始学习"的猜测升级为二选一按钮卡(hook 起手式 v2)** —— v1 的猜测是纯文字(要打字),
  v2 改成一点即猜的按钮(比打字更低门槛,更像 Duolingo)。新增第 6 个展示型 tool `pose_guess`
  (schema:prompt + 恰好 2 选项;不计分、不碰掌握度),AI 先写一两句散文钩子再调它 → 渲染成
  `GuessArtifact` 按钮卡。学习者点选项 →"我猜:X"发进对话 → AI 下一回合揭晓。复用既有
  `onPickAction` 透传,无新铺线。artifact-harness 加 guess 类型(schema `.length(2)` + sanitize
  补占位);verify-artifact-harness T18-20;live-test-hook-opener 升级为 tool-calling 断言
  (真 GLM 验证模型主动调 pose_guess + 合规参数 + 无计分语言)。
- **"开始学习"重塑为 hook 起手式(动机层)** —— 用户点进节点时往往"提不起劲"(streak 断了/冷启动)。
  此前"开始学习"发的是"讲核心概念 + 出一道小问题"——在意志力最低的瞬间堆两次摩擦(吸收讲座 +
  被评估),是作业形状,不是吸引形状。现改成:**反直觉钩子 + 二选一猜测 + 不计分**。把"考"(有失败
  风险)改成"猜"(玩),用好奇心缺口做内驱(补上 streak 断了之后缺失的拉力);顺序从"先给答案再考"
  反过来成"先吊胃口、让他想要、再揭晓"。`handleStartLearning` 的 canned prompt 重写,明令起手不用
  `generate_quiz` 工具、不计分。**live-test-hook-opener** 拿真 GLM(glm-5.2)验证形状(有钩子 +
  二选一 + 不计分 + 不抢答),非"粘段 prompt 然后嘴硬"。
- **答完题下一步动作(常开,消灭死胡同)**:quiz 完成卡不再"到此为止"——按答对率 + 掌握度给出
  ≥2 个明确去向(讲讲我答错的 / 再来一组 / 深入原理 / 确认我掌握了 / 下一个知识点)。纯函数
  `getPostQuizActions` 驱动,永远 ≥2 个动作;首动作用 `btn-3d-brand` 引导。verify-post-quiz-actions
  覆盖。
- **复习可见性 + 交错练习 + 仪表盘薄弱点(learning-experience 收尾)**:
  - **待复习顶出(P2.3)**:session 开始若有到期复习,弹一次 nudge(每进程最多一次,不刷屏);
    持久 surface 复用 MapRail 的 map-review-badge(待复习数 + 入口)。
  - **交错复习(P2.4)**:复习抽屉加「🔀 混合练习」入口——随机抽一个待复习节点(随机化检索顺序
    = desirable difficulty,区别于默认顺序)。
  - **仪表盘薄弱点(P3.4)+ 消费此前丢弃的数据(P4.5)**:getDashboard 新增 `frictionByNode`
    (按节点聚合人类卡点次数,排除 agent_error,上限 5);复习抽屉加「章节掌握度热力图 + 薄弱点」
    面板——此前 dashboard.sections 被算了就丢,现在真正面世。verify-dashboard T8(frictionByNode);
    ui-test T4b(待复习徽章)+ T4c(抽屉 shuffle + dashboard-mini 面板)。
- **毕业时刻 + ParticleFx 庆祝(learning-experience Phase 4b)**:mastery 跨过 0.9 → mastered 此前**静默**
  发生(数据库里改一行,用户无感)——最该有的"我做到了"峰值缺失。现在:quiz:recordAnswer 返回
  `mastered` 过渡标志(检测本次从非mastered→mastered);答对/毕业经 `celebrate` 事件总线驱动 ParticleFx
  (CSS 粒子爆发,有品味、非随机盲盒,受 prefers-reduced-motion 约束)+ 顶栏 toast `👑 你掌握了这一课`。
  AI 主动 mark_mastered 被应用也触发庆祝。新增 `lib/celebrate.ts`(EventTarget 总线,零依赖);
  ParticleFx 从 no-op 桩落地为真实 CSS 实现(playSfx 音效仍按 PRODUCT.md 留作专门设计 pass)。
  verify-proposals T10(毕业过渡:2 次答对→mastered+crown5+mastery≥0.9);ui-test T4a 加 ParticleFx 挂载断言。
- **能力感反馈:累计 XP + 等级 + freeze 可见(learning-experience Phase 4)**:此前 XP 午夜清零、无等级
  /累计——Duolingo 式最高的"升级"峰值完全缺失;freeze 默认 2 但从不渲染(安全网不可见)。现在:
  addXp 同写持久 `total_xp`(永不重置,跨天保留),由二次曲线派生等级(50·L²:L1=50,L2=200,L5=1250,
  早期快后期缓);header 加 `Lv.{n}` 徽章;StreakBadge 加 🛡️ 剩余冻结数(可见的试错安全网=autonomy)。
  等级是持久成长线(非消耗型货币),全程在 PRODUCT.md 反暗黑红线内。ParticleFx 按 PRODUCT.md 预留为桩
  (留作专门设计 pass)。抽出 `levelFromTotalXp` 纯函数;verify-xp.mjs 扩展 T13-T15(等级曲线 + 累计持久
  + 跨天保留);ui-test T4a(level+freeze 徽章)。
- **激活 friction_log:让 AI 看见你的卡点(learning-experience Phase 3)**:此前 friction_log 表
  设计完好却近乎空转——唯一写入方是 prompt-builder 的 agent_error,还把 nodeId 列复用存 skill 名;
  人类卡点(confused/blocked/frustrated)从不被记录。现在:ChatComposer 加 🤔 "我卡住了" 入口
  (选感受 + 可选一句)→ 写 friction_log;agent 下轮 system prompt 注入该节点近期人类卡点(排除系统
  agent_error,上限 5 条),AI 据此调整讲法。这是 SDT relatedness 在 solo 学习 app 里的最可行代理——
  一个"注意到你卡住并记得它"的 tutor,同时给自适应难度供数据。抽出 `pure/friction-context.ts`
  (insertFrictionDb + buildFrictionContext,db 注入);修 prompt-builder 不再滥用 nodeId;
  新增 `verify-friction.mjs`(break→fail 闭环验证)。
- **冷启动沉浸(learning-experience Phase 1)**:点"开始学习"现在直接进入学习——先讲核心概念、
  再出一个检索题,而非"商量怎么学"(意志力最高的瞬间应进入学习本身)。修复无 AI key 时点🚀
  → 建空会话 → 报错 toast 的冷启动死胡同:无 key 时空状态改显"内容已在右侧,先读一读 +
  去配置"卡(种子首课内容本就静态、离线可读),配 key 解锁的是 AI 家教而非"学习"本身。
  新增空会话问候(👋 降低启动能垒,纯前端无 DB 写)。新增 ui-test 闭环断言:T8d(问候+🚀
  渲染)+ T20(删 provider→重载→keyless-card 显示且🚀 隐藏,已验证能抓回归)。地图首可用节点常显标题
  ("从这里开始"指引,P1.5 + ui-test map-next-label 断言)。
- **游戏感动效基础设施(Phase 0,见动效重构计划)**:为"丝滑 + 游戏感 + 沉浸式玩中学习"奠基。
  新增 `motion` 库(PRODUCT.md sanction 的唯一新增依赖)+ 中央庆祝总线(`lib/celebration.ts`
  的 `celebrate(kind)` event bus + `CelebrationLayer` 根级 canvas 粒子层,任何组件一行
  `celebrate("correct")` 触发,渲染解耦)+ `usePrefersReducedMotion`(a11y 双轨:默认粒子爆发,
  系统选"减少动效"时降级为静态图标淡入——WCAG 底线,非审美)+ `motion-presets`(spring/stagger
  复用)+ main→renderer `state:changed` 推送通道(`state-emitter` 模块,xp/streak/mastery 变化 emit)。
  **修原 bug**:能量条/连击以前只在启动拉一次,答题后 main 写 DB 但 renderer 不知道 → 从不动;
  现在订阅 state:changed 精准重拉。**性能**:skyCanvas `getOrbs` 每帧 `querySelectorAll`+布局
  重排(随课程规模恶化)→ 缓存节点引用 + MutationObserver 失效。**a11y 修复**:skyCanvas
  reduced-motion bug(`frame()` 无条件 self-reschedule + `attachOrbWeather` 无视 reduced →
  实际没降级)。新增 `scripts/verify-motion-infra.mjs`(26 项静态回归断言,覆盖 Phase 0+1)。
- **游戏感动效 Phase 1(高光时刻接入庆祝总线)**:7 个反馈点接入 `celebrate()` 总线 ——
  答对/答错(QuizArtifact 练习 + ReviewPanel SRS 自评)、考试通过(ExamView 得星)、能量充满
  (App 订阅 XP 首次跨 100,用 prevXpRef 防重复触发)、连击递增(App 订阅 streak)、掌握度达成
  (App 订阅 mastery 加冕)。所有高光时刻统一由 CelebrationLayer 渲染粒子爆发(reduced-motion
  自动降级静态图标),触发与渲染解耦 —— 新增反馈点 = 一行 celebrate()。
- **游戏感动效 Phase 2(节点解锁高光,完成 7 触点闭环)**:MapRail 检测节点从 locked→available
  的解锁瞬间,触发 `celebrate("unlock")`。至此 7 个高光时刻全部接入庆祝总线:
  correct/wrong/unlock/mastery/streak/energy-full/exam-pass。环境沉浸(错峰入场/微交互/皇冠
  加冕视觉)作为后续迭代。
- **PDF 文本提取改用 pdf-inspector(layout-aware)**:本地 PDF 导入的文本提取从 `pdf-parse`
  改为优先 `@firecrawl/pdf-inspector`(预编译 napi-rs, layout-aware markdown — 标题层级 +
  多栏阅读顺序), 失败/平台不支持(Intel Mac/Windows ARM 无预编译)时自动回退 `pdf-parse`。
  PDF 图片提取不变(仍走 `lib/pdf-renderer.ts`)。**已知局限**: 不解码数学公式(文本层赛道
  本质局限, STEM 教材留给未来 vision 渲染路径)。新增 `scripts/verify-pdf-text.mjs`;
  `LOOKATSTUDY_NO_PDF_INSPECTOR=1` 可强制走 pdf-parse(测试/调试)。
- **PPTX(PowerPoint)本地导入支持**:新增 `.pptx` 格式。`lib/pptx-parser.ts` 用
  officeparser(纯 JS, 无原生依赖)走 AST, 每张 slide 转一个 `##`(讲者备注用非标题
  写法随 slide 走)→ 现有导入管线自动把每张 slide 变成一节课, 零新分块代码。内嵌图片
  提取进 asset 管线(复用 pdf_page source, 避开 schema CHECK 迁移)。**已知局限**:
  SmartArt/图表等复杂视觉只取文本(留给未来 vision 路径);仅 `.pptx`(老 `.ppt` 二进制
  不支持);仅本地导入(GitHub PPTX 后续)。新增 `scripts/verify-pptx-parser.mjs`(devDep
  pptxgenjs 测试内造 deck)。
- **顶栏"今日能量"**:替换原"每日 XP / 目标"显示。能量值 = 今日所得 XP(`todayXp`),
  闪电图标(Zap)+ 进度条(软参考 100 满条,无配置目标)+ 数字。≥100 时 Zap 填充为实心
  表示"充满"。颜色用 brand 绿(PRODUCT.md:绿=进度/能量;gold 仍专属 mastery/crown)。
- **UI 全量 i18n + 设计系统收敛(6 组件文件)**:此前的 i18n 只完成了 chrome 外壳,
  切到 English 后中栏对话 / 右栏笔记本 / 考试页 / 会话标签仍是中文。本轮把
  ChatStream / NotebookPanel / MapRail / ExamView / ThreadSwitcher+ChatComposer /
  ErrorBoundary+artifacts 全部硬编码中文抽到 i18n(新增 ~110 个 key,zh-CN/en 双语),
  EN 用户现在拿到完整英文界面。同时清理 chrome emoji(违设计系统"emoji 仅限 skill-tree
  节点 + 空状态卡"):🚀→Rocket、📋→ClipboardList、✓→Check/Copy、⚠️→AlertTriangle、
  💬→MessageCircle、📷→ImageIcon、💡→Lightbulb、产物头 📊🗺️🔍🧩→Table2/Share2/Code2/Puzzle、
  quiz ✅/❌→颜色徽章(去掉 emoji)。NotebookPanel 的 ZoneSection/ARTIFACT_ICON 的 `icon`
  prop 从 string 升级为 ReactNode 以容纳 lucide 组件。ErrorBoundary 作为 class 组件,
  抽出 `DefaultFallback` 函数组件来用 useLang。
- **响应式 i18n(中英文全量提取)**:`lib/i18n.ts` 重写为 `useSyncExternalStore` 响应式
  store,新增 `useLang()` hook(身份稳定,可安全入 useCallback 依赖)。切换语言即时重渲染,
  **移除 `SettingsView` 的 `window.location.reload()` hack**。字典从 ~40 key 扩展到 ~120 key
  × 2 语言,覆盖 MapRail/CommandPalette/ReviewPanel/SettingsView/NotebookPanel/ChatComposer/
  Toast/Header 全部 chrome 文案。ui-test 新增断言验证:切到 en 后 `map-tab` 文本变 "Course Map"。
- **设置页全量 i18n + 设计系统收敛(SettingsView)**:此前切到 English 后,设置页大半仍为
  中文(自定义表单/主题/多模态/语言偏好/删除确认)。补齐 35 个 i18n key(zh-CN/en),
  全部用户可见字符串走 `useLang()`。同时:chrome 内 emoji 全数换为 lucide 图标
  (`🔧`→`Wrench`、`＋`→`Plus`、`🔄`→`RotateCw`、`🌐`→`Globe`、`✅/❌`→`CheckCircle2/XCircle`,
  旋转图标在加载时 `animate-spin`),表单控件统一 `fieldCls`(token 化 `bg-surface-1` +
  `border-[var(--border)]` + `placeholder:text-ink-faint`),两个开关补 `role="switch"`+
  `aria-checked`+`aria-label`,所有 pill 按钮(provider/主题/语言/语言偏好)共用同一组
  active/inactive class。
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
- **考试生成进度改按知识点覆盖显示** —— 生成页的进度数字从技术味的"X / Y 批"（LLM 出题批数，每批 ≤3 个知识点）改为用户可懂的"已覆盖 X / Y 个知识点"：total = 本章知识点总数，每完成一批累加该批覆盖的知识点数（`ExamStatus.done/total` 语义同步为 KC 计数）。副标题文案同步调整。
- **导入面板顶部留白收敛** —— 导入面板内容顶部 padding 从 `pt-48`(192px) 收到 `pt-20`(80px)：那个大留白是给地图面板的悬浮标题卡（课程名+进度条+世界切换）预留的，导入面板头上只有悬浮 tab 栏（约 56px），课程列表被无谓压低约 112px。地图面板不动。
- **课程选择空态化 + 删除课程就地确认** —— (1) 启动不再自动选中第一门课程：每次开启软件落在"未选课"初始状态（左栏导入面板提供选课/导入入口 + 中栏选课引导空态），由用户手动选择要学习的课程或导入新课程；(2) 已选课程也可删除：地图头课程标题旁新增删除按钮（不用切到课程管理面板），导入面板课程行的删除按钮同样开放给当前课，两处均就地弹 ConfirmCard 危险确认，不发生界面跳转；(3) 删除当前课后自动清空全部课程维度状态（选中课/节点/树/进度图/翻译语言），回到未选课初始态并切回导入面板。ui-test 新增 T0（启动空选）/T0b（手动选课）/T21（地图头删除→ConfirmCard→回空态）三断言（32/32），闭环已证（break→恰 T0+T21 红→restore→绿）。
- **教学模式正名为「教学人设 soul」(精讲/引导/实战 三选一)** —— 原 `skills` 系统混了两个不同
  概念:(1) 教学人设(persona,贯穿对话的行为姿态,本应是 system-prompt overlay);(2) 未来才该有的
  真 skill(过程性多步 playbook)。把 (1) 正名为 **soul**,与未来真 skill 彻底分开。同时把原来
  混了三条正交轴(教学姿态/考试压力/内容范围)的 4 个模式重做成 3 个教育学依据分明的 soul:
  **精讲**(worked-example + 费曼,新手/低能耗友好)、**引导**(productive struggle,有基础时用)、
  **实战**(围绕真实世界非结构化问题的 PBL,覆盖理论科目)。砍掉的 exam-prep/review 归位到
  quiz 工具 + SRS 排程(它们是内容范围/压力档,不是教学姿态)。表 `skills`→`souls`、列
  `active_skill`→`active_soul`、IPC `skill:*`→`soul:*`、删 `flag_skill_system`(soul 注入常开,
  `active_soul=null` 即等价关闭)。老库幂等迁移(留用户自建 soul、弃旧 builtin)。新增
  `verify-souls.mjs`(含迁移专项)+ 改附带测试;闭环证明已做(break→fail→restore→pass)。
- **BKT↔SRS 闭环(learning-experience Phase 2)**:修复掌握度与间隔复习解耦的问题——此前
  唯一耦合点是"毕业时 recordReview(5)",答错既不回写掌握度也不重排复习。现在一次答题观测
  **同时**更新 BKT 与 SRS:答对推迟复习、答错重置到 1 天近期重练(可验证:连续答对 interval
  1→6d,答错卡 1d)。三处接线:`proposal:apply`(覆盖 exercise/AI-record 的 pending 提议 apply 路径,
  update_mastery→recordReview)、`quiz:recordAnswer`(经 service 直接 apply,补 SRS 写)、`srs:record`
  (自评复习 quality≤2/≥4 反向回写 BKT,走 service apply 不双写)。抽出 `pure/srs-db.ts`(
  recordReviewDb,db 注入,不触 electron)让 verify 脚本可直测。新增 `verify-srs-bkt-loop.mjs`
  (已 break→fail/fix→pass 闭环验证)。
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
- **设置页重排为分组设置(iOS / Linear 式)**:删掉重复的"设置"标题(只留抽屉头一个);
  6 个平铺卡片合并成 3 个语义组(AI 模型 / AI 看图 / 外观与语言),每组一张 surface-card,
  卡内用发丝线(`border-t border-faint`)分行(左标签右控件);自定义 provider 表单从嵌套卡
  改为卡内扁平展开;抽屉加宽 `max-w-md → max-w-lg`;新增粘性页脚(保存按钮 + 即时/显式语义 hint)。
- **移除"每日目标"设置项**:不再可配置;顶栏改由"今日能量"展示今日所得(见上)。
  XP service 后端逻辑不变(仍读 daily_goal_xp 兜底默认,只是 UI 不再写/显示)。
- **图片下载改为永久开启**:`flag_image_download` 默认 true 且设置页移除其开关 ——
  导入时下载 md/notebook 引用图片是默认合理行为,无需用户干预。AI 看图开关保留
  (不是所有模型都支持 vision)。
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
- **README 与实现对齐(文档过时声明全面修正)** —— 逐项对照代码核实后同步:种子课程(AI-For-Beginners→LookatStudy 使用指南 6 章 18 课 6 考试 + 空选启动手动选课)、教学人设(soul 精讲/引导/实战 替换已废弃的"四学习模式")、provider 预设 10→19、文档格式 9→10(补 `.pptx`)、图片下载改为永久开启(非 multimodal flag)、测试计数(verify:core 32→62 套件、ui-test 18→32 断言)、设置入口(tab→顶栏齿轮抽屉)与导入入口(左栏 tab)、复习抽屉替代独立 Dashboard、移除每日目标设置、仓库结构树(`skills/`→`souls/`、`skill-frontmatter.ts`→`frontmatter.ts`、`docs/`→`dev-docs/` gitignored)、GitHub 导入描述(README 候选清单/分支/Tree API+README 链接兜底/后台 job)。AGENTS.md 同步 llm-presets 行 10→19。
- **导入面板删除按钮冒泡误选课（"删除时跳界面"的根因）** —— 课程列表行原是嵌套 button（外层=选课、内层=删除），点内层"删除"会冒泡触发外层选课 onClick：等于删哪门就顺手选中哪门、并经 `setPanel("map")` 跳到地图界面；确认删除后旧逻辑还会自动选中列表第一门课，选中态彻底错乱（删的是唯一课时选中 id 悬挂到已删课程）。重构为行容器 div + 选择/删除兄弟按钮（合法 HTML，删除钮 `stopPropagation` 兜底 + 键盘 focus 可见），删除确认浮层统一收到 MapRail 层（课程行/地图头删除按钮共用），删除反馈从面板内 success 行改为全局 Toast。
- **ui-test 交错复习断言预存红(main 上已红)** —— 复习抽屉重构后"交错复习"按钮只在 `startedLessons>0` 时渲染,而 ui-test 全新 temp DB 在断言时点(首课点击前)无任何 in_progress 课时 → `review-interleave` 不渲染 → P2.4 断言失败。修法:ui-test seed 块补一条首课 `progress` 行(status=in_progress,幂等 onConflictDoUpdate,不动 mastery 不影响解锁/enabledCount 断言)。ui-test 回到 30/30 全绿。
- **提议卡/产物卡切走即消失(parts 持久化)** —— `chat_messages.parts_json` 列一直在,但 main 从不写入(只存纯文本 `content`),重载时 `useChatStream` 把每条还原成纯文本(注释"parts_json 暂不复原")。后果:AI 提议已掌握的卡、quiz 产物、概念图、流程图——一切非文本 part 切节点再回来全消失。根因修法:`accumulatePart`+`ChatMessagePart`+`ChatMessageV2` 从渲染层搬到 **`shared/part-accumulator.ts`**(main/renderer 单一真源);`runAgentTurn` 本地累积 parts 返回,`handleAgentChatThread` 落库 `JSON.stringify(parts)` 作 partsJson;渲染层重载时 `deserializeParts` 复原(解析失败回退纯文本兜底)。附带修两个次生 bug:① 同会话点完采纳/拒绝按钮仍显示(渲染层从不读 `output.status`);② 跨会话重载已 apply 的卡重现按钮、点击触发 `applyProposal` 的 "not pending" 报错——新增 `getThreadMessagesForDisplay`(扫 parts_json 的 proposalId,批量查 proposals 表真值 status patch 回 output.status,IPC `thread:getMessages` 改调它;agent-engine 仍用原 `getThreadMessages` 不受影响)。
- **提议卡可读性重设计(三态)** —— 旧卡:小号 muted "AI 提议" + 灰字正文 + "应用/拒绝" 抽象按钮,mark_mastered 与 record_answer 长得一样、正文落到泛化 fallback。重设计(mark_mastered 是实际唯一的待决卡):待决态=brand 图标徽章(GraduationCap)+ "AI 建议你已掌握这节课" 标题 + rationale 正文(AI 掌握理由)+ 后果提示("采纳后本课解锁皇冠、进入复习排期")+ "确认掌握/再练练" 直白按钮;mark_mastered 工具输出加 `message: rationale` 让卡自包含。已采纳=金色 CheckCircle 徽章(gold=mastery);已忽略=muted CircleSlash。遵守 impeccable(lucide 非 emoji、surface 深度、btn-3d 词汇、6 级字号)。新增 6 个 i18n key(zh+en)。新增 `verify-stream-parts.mjs` T9(直接 import 真·shared accumulatePart,守一致性+纯函数+JSON 往返持久化契约,闭环已证)。
- **ui-test SRS 种子幂等 + 清死代码**(feat/adaptive-tutor 顺带修的预存债):
  - `--ui-test` 播的到期 SRS 项此前用裸 `insert`,持久 DB 下重复运行触发
    `UNIQUE constraint failed: srs_items.id` → 种子静默失败 → "待复习"徽章断言红。
    改为 `onConflictDoUpdate`(幂等),2 个预存 ui-test 失败(due-review / interleaved)转绿。
  - 删 App.tsx 里写而不读的死状态 `dueCount`(`dueInCourseCount` 才是活变量)→ renderer tsc 0 错误。
- **清理预存类型债 + 2 个误标 knownFail**:
  - `tsc --noEmit`(renderer)与 `tsc -p tsconfig.electron.json`(main)现在**零错误**(此前长期红的:
    App.tsx 未用 `theme`、MapRail 未用 `PRESET_KEYS`/`index`/死代码 `MapNavBtn`+`statusClass`+`statusIcon`
    + `pathLength` 样式类型、skyCanvas 的 `ctx` 可能 null(hoist 函数捕获 const 不收窄)+ 未用 `now` 参、
    pptx-parser 的 `OfficeMimeType` 比较无重叠)。
  - ui-test 的 T15(三区折叠)/T19(aria-expanded)长期标 knownFail,根因被记成"canvas 异步时序",
    实为**种子课程无 canvas_item → notes tab 命中 total===0 空态、三区不渲染**。补播一条 canvas_item
    后两测试真通过,移除 knownFail。ui-test 现 **knownFail=0 / realFails=0**。
- **live-test 烟雾检查误判**:`verify-live-test-smoke.mjs` 的 API-key guard 模式只认
  `process.exit(0)`,但 `live-test-smart-import.mjs` 用的是合法的 `process.exit(1)`(缺 key 报错退出
  也是有效 guard),导致 verify:core 长期 33/34。改为认 `exit(0|1)`,verify:core 现在全绿。
- **导入进度"两屏断裂"修复**:此前 URL 导入分两阶段 —— `analyzeRepo`(分析)进度爬完后,
  `doImport` 开头 `setProgressSteps([])` **把进度清空重开**,用户看到"分析进度→瞬间清零→
  导入进度从0重爬"的两个断开屏。删掉该 reset,让 analyze→import 进度连续累加。同时把进度
  从表单下方 `max-h-52` 小框改为 `busy` 时**整块进度屏替代表单**(`max-h-[40vh]` + 自动滚到底
  + 步骤标题/目标 URL),从点导入到完成一个屏显示全部进度。
  `text-neutral-500 dark:text-neutral-600 dark:text-neutral-400`,后者覆盖前者,
  意图错乱)的系统性问题,本轮扫净所有出现点 —— ChatStream(9 处)、NotebookPanel
  (15+ 处,含 `dark:text-neutral-400 dark:text-neutral-600` 反序变体)、ExamView
  (7 处)、artifacts(7 处)。全部迁移到 `text-ink-muted` token,深浅模式自动适配。
  "浅色模式验证"测试套件全绿。
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

### Changed
- **导入改为后台任务（可继续浏览其他课程 + 可取消）** —— 导入是分钟级重管线，此前
  renderer 全程 await、完成后强制跳转到新课程，且中途切课会看到半成品课程。现改
  job 化：`import:localFolder` / 新增 `import:github`（analyze+import 合一）选完即返
  jobId，管线在 main 后台跑（进度 `import:progress`、结束 `import:done`）；完成只
  刷新课程列表 + Toast，不再强制跳转（用户自己决定何时查看）；进度屏新增"取消导入"
  按钮（`import:cancel`，拉取阶段生效，写库前零残留）+ "后台进行可继续浏览"提示。
  配套把 `executeImport` 重构为两阶段——拉取（可取消、零写库）+ 落库（无 await 的
  同步段一次性写完课程+全部节点，消除半成品可见窗口；中途意外失败自动清理残留行）。
  新增 verify-import-cancel（3 断言，闭环已证）。Markdown 生成路径是同步短任务，
  维持原行为。

### Fixed
- **KC（知识组件）提取断链接通：首次点击节点球时摘要+KC 一次调用双落库** —— KC
  此前在新管线（GitHub/本地导入）课程上是彻底断链的：导入不写 knowledge_points，
  唯一写入方 generateLessonSummaries 的 IPC 在 UI 上零调用方，唯一的自动路径挂在
  已不用的旧版 importFromRepo 里——新导入课程的 per-KC BKT 静默失效。修：把首次
  点击节点球即懒生成的 `generateLessonSummary`（原只产摘要）升级为**一次 LLM 调用
  同时产出 1-2 句摘要 + 3-7 个 KC**（KC 搭摘要的车，调用次数零增加），两字段
  （summary + knowledge_points）立即落库 + markDirty（顺带修掉原实现写库不
  markDirty、只靠 before-quit 兜底落盘的 bug）；读取守卫改为"双字段齐备才命中"，
  历史遗留只有摘要的节点下次点击自动补齐 KC，齐备后永不再调 LLM（省 token）。
  前提成立性：考试节点在课程球未学完前不解锁，KC 只在课内答题归因时需要——
  首点懒生成正好覆盖。新增 `parseLessonSummaryKc` 纯函数（容错：纯文本当摘要/
  坏 JSON 返 null 重试/KC <2 丢弃/上限 7）+ verify-lesson-summary-kc（7 断言闭环）；
  live-test-local-import 扩展首点预热验证（真实 LLM 双落库 + 二次纯命中）。
- **双语课程导入：翻译检测 + 配对全链路修复（本地 + GitHub）** —— 成对双语文件夹
  （xxx.en.txt / xxx.zh-CN.txt）此前导入后 🌐 切换器无数据、英文原稿被吞。三层缺陷：
  (1) 扫描器 `dedupByLang` 是翻译系统前的"中文优先"hack——同 key 只留中文，英文原稿
  在扫描层就被丢弃，配对信息永远到不了翻译管线；(2) suffix 布局检测只认 .md 系扩展、
  且不剥原文自带的语言后缀——.txt 双语对检测不到，xxx.en.txt 的翻译路径会错算成
  xxx.en.zh-CN.md；(3) `executeImport` 的 translationFiles 参数是死的（从不传给落库
  函数），LLM 的 translation 角色类型定义了但解析/分类从不用。修：dedupByLang 改为
  同语言内部去重（双语配对保留，分流交分类层）；suffix 认 txt/html +
  `resolveSuffixTranslationPath` 剥原文语言后缀（单一实现）；classifyFileRoles 规则
  分流（LLM 前）+ LLM translation 角色（lang+translates 显式配对，全量集合防幻觉）；
  落库显式配对优先于布局猜路径；本地 handler 语言决策合并 translations/ 目录 + 布局/
  LLM 检出语言；GitHub analyzeRepo/importAnalyzed 透传配对。效果：原文成课 + 现成
  翻译零 LLM 成本落 content_node_translations + 🌐 可切换 + 无重复课。新增
  verify-translation-roles / verify-translation-import，verify-translation-layout 扩
  4 例，verify-local-scanner T6/T7 改锁新语义（均闭环先红后绿）；
  live-test-local-import 升级双语场景真实 LLM 验证通过（en 原文 3 课 + zh-CN 翻译落库）。
- **本地导入纯 .txt/.html/.pdf 文件夹生成"空课程"** —— `import:localFolder` 把扫描器已解析
  的 docs 又过了一遍面向 GitHub 的 `pathsToDiscoveredFiles`，后者只保留 .md/.ipynb/代码，对
  .txt/.html/.htm/.pdf/.pptx 走 `else continue` 静默丢弃，100% 内容被滤掉 → 分类空 → 结构空 →
  落库一条只有课程行、零课时的"空课程"（验证器只打印不抛错）。修：(1) 本地路径改用新增的
  `docsToDiscoveredFiles`，直接用扫描器结果不再二次过滤；(2) `executeImport` 加空结构守卫——
  零课时时在任何写库前抛错，不再留空课程残行（保护两个导入 handler）。新增
  `verify-import-empty-guard.mjs` + `verify-local-filelist.mjs`（均闭环已证）。
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
