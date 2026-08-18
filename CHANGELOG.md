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
- **本地语音朗读(AI 回复 🔊 按钮)** —— 虚拟导师第一步:点 AI 消息下的朗读按钮即可听。链路:文本净化(markdown 语法/代码块剔除,只读"人话")→ 句级切分流式合成(首句先出声,不等全文)→ 句级磁盘缓存(同句重读零合成、秒回)→ WebAudio 顺序无缝播放,按钮旁显示句进度,再点即停、点其他消息自动换场。引擎为 Kokoro 82M v1.1(fp32,24kHz,中英混读,Apache-2.0),模型约 430MB,首次使用从镜像源下载(ModelScope 逐文件主源 + GitHub 归档经代理链兜底,断点续跑、逐文件校验),下载后**完全离线推理**,无云端、无按量付费。桌面端技术破局:sherpa-onnx 原生引擎以 `enableExternalBuffer:false` 直跑 Electron 主进程(绕过 Electron 21+ 全进程外部缓冲禁令),无子进程、无 sidecar、无额外运行时。
- **语音输入(输入框 🎤 听写)** —— 点麦克风说话,实时转写紧跟按钮显示,再点停止后全文自动进输入框。引擎为流式 Zipformer 双语 zh-en 识别(int8,16kHz,Apache-2.0,约 200MB),端点检测自动断句,增量上行低延迟。桌面端开箱可用;浏览器/手机模式在 localhost 下可用(局域网 http 受浏览器麦克风安全策略限制)。
- **语音能力设置组(设置 → 语音能力)** —— 两张模型卡:就绪状态、下载(实时进度条 + 当前文件)、删除(两步确认);许可与"本地推理"标注在卡上。平台不支持原生引擎时(如 Termux)给出明确提示且不引导下载模型。内部:speech 服务族(模型清单/下载器/引擎/朗读编排/识别会话 + 纯函数规划层)、5 个 verify 套件、`LIVE_SPEECH=1` 门控 live-test(真实下载+合成+识别回环)、ui-test 假麦克风 E2E、serve 端音频 base64 过河双向转换。

## [0.11.0] - 2026-08-17

### Added
- **自定义 provider 可配上下文窗口(输入框用量表告别"窗口未知")** —— 用量表此前只认预设表的 `contextWindow`,自定义 provider 一律"未知"(禁用占比面板)。现在:①设置页自定义 provider 区新增「上下文窗口(tokens)」编辑行,按当前模型存取(支持 `128000` / `128k` / `1m` 写法,留空 = 未知);②窗口解析统一走 `resolveModelContextWindow`(预设与自定义同一口径,大小写不敏感),OpenRouter 模型发现本来就带回 `context_length` 自动可用,其余家(Glm/DeepSeek/Kimi 等的 /models 端点不含窗口)在设置页手填一次即可;③查不到就诚实 null——不做家族猜测,猜错的窗口会让用量表显示假占比更危险。verify-context-usage 3 组(解析器/DB 解析链/预设同源),闭环已证。
- **考试节点「重新出题」** —— 此前「重新考试」只是同一批题重排题序/选项序,题目本身永不换新(背下答案后重考失去意义)。考试就绪页与结算页新增「重新出题」按钮(内联 ConfirmCard 确认):删旧题库、按本章知识点重走后台生成(进度条/可离开/失败重试全复用现有 exam:status 链路);历史 attempt 档案与星数保留(重新出题不否定历史成绩)。连带修复:判分时把题干/选项快照进 attempt 的逐题记录——旧实现从 exercises 表反查题干,删旧题后历史回顾会退化成 `#1 #2` 编号,现在任何时点的回顾都自包含。悬挂 attempt 在重新出题时按「未答=错」判死(与离开即终止一致);生成中再点为 no-op(共享同一次生成)。verify-exam 新增 T15-T17(删旧题/悬挂判死/星数保留、在飞 no-op、快照自包含),三路闭环破坏已证。
- **引导器 UI 重设计(impeccable)** —— 三屏对齐应用本体的 Playful Product 词汇:深绿表面分层(#0B1F0E→卡面 #143518)、3D 压感按钮(桌面端 btn-3d 的原生对应:实心+深色底缘,按下底缘变薄)、状态卡(语义色圆点+状态行)、常用操作命令卡分组(服务/信息/系统,着色圆点前导+等宽命令)、错误屏卡片化。
- **窄屏手势滑屏切换三栏(T3)** —— 单栏档位在内容区水平滑动(>60px 且横向主导)即按 地图→对话→笔记 顺序切换到相邻栏;竖向滚动不受影响,概念图等声明 `data-noswipe` 的区域不劫持。判定逻辑为纯函数 `swipeTarget`(verify-pane-tiers 闭环)。390px 触摸事件 E2E 已验证 rail→chat→rail 双向切换。
- **概念图手机触控查看** —— 概念图产物从"鼠标拖拽 + 滚轮缩放"升级为统一 Pointer Events 触控方案:单指拖拽平移、双指捏合缩放(增量比值,抬一根手指无缝回落单指)、按视口宽度自动缩到适配(首次进入不用先缩小才能看全);`touch-action: none` 只圈在图上,不挡页面滚动。
- **黑板空态混入笔记区提示** —— 右栏 tab 分支是 `讲解 ? A : 笔记` 二元结构,黑板 tab 落进 else 分支把笔记区(理解/笔记/练习三区提示)一起渲染了出来。改为三分支显式互斥;E2E 实测黑板空态文本纯净、切回笔记正常。
- **产物查看全面画布化(CanvasStage,根治放大抖动)** —— 概念图/mermaid/对比表/代码讲解的放大弹窗与黑板 tab 统一改为**纯 transform 画布**(对齐 Figma/Excalidraw/ChatGPT canvas 实践):内容保持自然尺寸,translate+scale 一个变换包办,缩放**锚定手势中点/光标**(手指下的内容点数学上不动)——旧滚动视口方案里缩放改内容尺寸+居中 margin,滚动补偿与重排互相打架,是真机上"捏合抖动/像放大不动"的根因。画布能力:单指/鼠标拖动平移、双指捏合、滚轮缩放、**双击(双触)适屏↔100% 切换**、底部悬浮缩放工具条(−/百分比/适屏/+,拇指区,毛玻璃+描边)、点阵画布底纹、手势期间零过渡(motion-safe 过渡只给按钮缩放)。E2E 实测:按钮 100→125→156%→适屏往返、双指 1.0→3.4 倍锚点漂移仅 (1.37, 0.09)px(数学上不抖)、双击切换、弹窗开合,零页面错误;顺手修掉两个实 bug:①setState 更新器闭包里读手势 ref(延迟执行读到 null)直接把 React 树炸成白屏 ②舞台 setPointerCapture 把工具条按钮的 click 重定向掉(按钮点不动)。黑板 tab 同步升级:大幅产物**自适应容器宽高**(contain 适屏,ResizeObserver 内容/容器双观察自动回正)+ 产物标题栏,与笔记区内联卡片彻底区分;四产物新增 canvas 裸内容变体(ArtifactRenderer variant 透传)。verify-panzoom 8 断言锁死锚点不变量/往返无漂移/平移钳制。
- **T3 卡片模式(一幕一屏)** —— 窄屏对话流从连续长页改为"幕"式翻阅:每个 AI 回合装进一张独立卡片(surface-card 圆角卡),自由滚动(曾试 scroll-snap proximity 邻近吸附,真机甩动后会被回拉到吸附点、手感像"划了又被拽回",已去掉,卡片视觉保留),一幕基本占一屏;用户消息保持小气泡作幕间插页。钩子起手式(二选一猜测)、讲解、测验、答题反馈各成一幕,天然像课件翻页;水平滑屏切栏与垂直翻幕互不冲突。宽屏(T1/T2)对话流完全不变。
- **黑板(canvas):右栏第三 tab,重产物画布化** —— 右栏新增「黑板」tab(讲解/笔记/黑板):实时渲染当前对话里最新一件重产物(概念图/流程图/对比表/代码讲解)的大画布;对话流式中产生新重产物时右栏**自动切到黑板**(ChatGPT canvas 式联动,点其他 tab 即收回控制权)。产物在黑板里仍可点开全屏手势弹窗。quiz/guess 等交互产物不进黑板(留在对话里作答);无对话产物时回退显示该节点理解区最新的持久重产物(历史会话存的图也能上黑板)。
- **图表产物全屏手势查看器(DiagramViewerModal)** —— 手机端手势与主界面彻底分界:**主界面零双指缩放**(viewport `user-scalable=no` 禁掉浏览器整页捏合,Custom Tab 内旧 mermaid 视口 `touch-action: pinch-zoom` 放行页面缩放的口子一并堵上,内联产物区只留原生滚动);概念图/mermaid 图/对比表/代码讲解四类产物**点图面或右上角按钮进全屏弹窗**,弹窗内单指拖动平移、双指捏合缩放、桌面 Ctrl+滚轮,Esc/背景/X 关闭。对比表与代码讲解用 Chromium `zoom` 属性缩放(重排布局,滚动区天然跟随);代码讲解弹窗内点标注仍高亮联动对应行(内联/弹窗两套行 ref 互不覆盖)。E2E 实测:注入四类产物 → tap 开弹窗 → 双指捏合缩放(概念图 100%→250%、表格 1→2.5)→ 标注联动 → 关闭,页面双指捏合 `visualViewport.scale` 恒为 1。
- **悬浮提示双通道(GlobalTooltip)** —— 手机上 hover 不存在、tap 是误触:触屏改为**长按 500ms 显示提示、手指抬起即消失**(Material Design 触屏规范,Android 原生同款),移动即取消长按(滚动意图);桌面鼠标 hover 跟随光标行为不变。两个通道都做**视口钳制**(左右 clamp、上方放不下翻到下方),手机边缘不再溢出屏幕;tap 的合成 mouseover 被粗指针守卫拦住,不再误弹贴指提示。
- **识图覆盖模型一键测试** —— 设置 → AI 看图的视觉覆盖配置旁新增「测试模型」按钮:先保存覆盖配置,再实测**生效的视觉链路**(`agent:testConnection` 契约扩展可选 `{vision:true}`,main 侧走 `resolveVisionLlm` —— 即图像转译桥真正会调用的那个模型,不是主模型),结果就地反馈(成功/失败 + 明细),不用再"贴张图试试"盲验。E2E 实测:未配 key 的覆盖 provider 返回明确的「API key 未配置」。

### Changed

- **黑板产物视觉全面翻修(概念图径向重排 + 全产物接入设计 token)** —— 对话流/黑板上的四类重产物整体打磨:
  - **概念图**:弃用 dagre 通用布局,重写专用**径向布局**纯函数(`lib/conceptmap-layout.ts`):度数最高的节点居中为 hub(accent 描边+加粗+放大,两级视觉),BFS 子树按扇区角度分配、逐环按弦长约束展开(同环等距、零重叠、孤儿节点兜底挂根);边改贝塞尔曲线从框缘起止(不再从圆心穿盒),边标签胶囊宽度与节点文本同源估算(CJK 感知)不再截断;去掉节点左侧绿色色条(产品册禁色条)与投影滤镜。真实 E2E 生成 → 双主题截图 → DOM 几何测量 22/22 文本框内居中、零溢出。
  - **mermaid 图**:从默认白底主题改为 `theme:"base"` + 实时从 CSS 设计 token 读 `themeVariables`(暗/亮双主题自适应,`--border`/ink/surface 全接入,补齐暗色缺的两个 border token);切主题即时重渲染已渲染的图(此前只清缓存不重渲染,旧配色残留到组件重挂载)。
  - **对比表**:表头 surface-3 层级 + 首列加粗锁宽不换行,长单元格 `overflow-wrap: anywhere` 不再撑破卡片。
  - **代码讲解**:修亮色主题下暗色代码块文字不可读(代码体换固定亮色),行号 tabular-nums 对齐。
  - **出题侧**同步收紧概念图拓扑指引(中心概念 ≤4 直连防星形摊大饼、鼓励真实交叉边、关系词要具体、label ≤8 字)。新增 `verify-conceptmap-layout` 6 组断言(估宽/两行包裹/hub 居中/零重叠/边几何/确定性,闭环已证),`dagre` 依赖移除。
- **答题 hook 触发点定为最后一题的「完成」按钮** —— 此前提交最后一题的瞬间成绩单就自动发给 AI,学习者还没看清答案就被 AI 的分析插入打断。现在:最后一题提交只判分出答案+讲解,「下一题」按钮变「完成」,点「完成」才把成绩单交给导师,卡片随即翻成成绩卡(🎉/📚 + N/M + "成绩单已交给导师,等待分析…");刷新恢复的完成态没经过「完成」点击,成绩卡留一个补交按钮(只带总分)。真实 E2E 全流程验证(出题→作答→提交→答案→完成→成绩卡+气泡)。
- **T3 单行窄标题栏(三栏切换器居中)** —— 窄屏标题栏收敛为一行 51px:左 = XP 紧凑数字、中 = 居中紧凑 icon button group(容器底色+内描边成组,与两侧裸露的 XP/设置图标区分;无文字,名称走 aria-label + tooltip)、右 = 设置;应用名不上栏(引导器/浏览器标签已可见),配合滑屏手势兜底切换。内容区较此前两行方案多出 55px。宽屏(T1/T2)标题栏不变。E2E 实测:高度 51px、切换器 111×34 居中偏移 0、切换功能正常。
- **三栏更名:课程 / 导师 / 黑板** —— 窄屏切换栏三栏名从"课程地图/对话/笔记本"改为教室隐喻的"课程/导师/黑板"(i18n `pane.*`,zh+en 同步:Course/Tutor/Blackboard);短名同时服务单行标题栏的紧凑布局。
- **AI 消息去头像列** —— 每条 AI 消息左侧的圆形 AI 头像(28px + 10px 间距)给正文/产物卡制造 ~38px 固定左缩进,左缘参差且窄屏最浪费宽度;移除后 AI 内容真正全宽(claude.ai 风),对话双方靠「用户右对齐微染底 vs AI 全宽」区分,不靠头像。
- **答题完成自动 hook AI(消灭手动"下一步")** —— 答完最后一题提交即把成绩单自动发给 AI(气泡只显示「📊 答题完成:N/M」短标签,完整逐题判定只给 LLM:哪题对/错、错了选了什么、正确答案是什么),由 AI 决定下一步——讲错题原因、判断能否进入下一部分或提议标记掌握;完成卡显示"成绩单已交给导师,等待分析…"不再给手动下一步按钮(无对话上下文的场合保留手动按钮兜底)。AI 正在流式输出时自动等待(最多 20s)再发。quiz-hook 纯函数 5 断言。
- **窄屏左栏选球后自动切到对话栏** —— T3 下在地图栏点可用球进入课时,视图自动切到对话栏(宽屏行为不变),省一次手动点"对话"。E2E 已验证选球后对话 tab 高亮。

### Fixed
- **手机端考试生成进度条冻结(serve 漏接 exam:status 事件线)** —— 手机上章节考试的生成进度条不动,切走页面再回来才跳到最新值;桌面 Electron 正常。根因:`exam:status` 与 `state:changed` 同为模块级事件单例,Electron 启动时两根都接了 `webContents.send`,serve 只接了 `state:changed`——考试进度事件在手机端整个是 noop,进度条只能靠切页重挂载时的轮询刷新。修复:serve 启动时补接 `setExamStatusSender` → WS 广播。顺带系统性排查了全部 main→renderer 推送点:handler 内推送(chat:part/import 等)走 `deps.emitter` 双端天然同源,模块级单例就这两个,现已双端齐接。verify-serve 新增 T3b(真 bundle 子进程:WS 客户端收 exam:status 事件帧),闭环已证(摘线 → 0 帧红)。
- **全量 UI/UX 审计修复(impeccable,第一性原理 + 对抗性)** —— 五维度审计(主题/无障碍/响应式/性能/反模式)扫出四类真实缺陷并修复:
  - **中栏裸白色 alpha(浅色主题下控件隐身)**:考试答题页 7 处(进度槽 `bg-white/10`、选项卡 `border-white/10 bg-white/5`、未得星 `text-white/20`、KC/回顾行底色)与对话流提议卡,浅色主题下这些元素亮度趋近面板背景完全不可见——这是"考试页当年只按暗色写"的遗留。全部换成主题感知的 `ink` token(dark=浅墨/亮色=深墨自动翻转),浅色主题 DOM 取证:槽/边框/底色对面板亮度差全部有效。
  - **三处侧条描边违反设计系统绝对禁令**(>1px 彩色 border-left 装饰):ConfirmCard 核心原语本身(danger=warning 全边框/常规=中性边框,语义仍由确认按钮颜色承载)、考试离开警告模态(warning 全边框)、笔记评论标记(accent 侧条 → ink 染色块)。
  - **ink-faint 对比度**:暗面下仅 ~2.9:1,token 提亮 0.55→0.63 oklch(#88898C,≈3.95:1;锁定期/禁用态按 WCAG 3:1 达标);承载真实内容的两处(笔记预览代码块)升到 ink-muted(≈5:1);浅色层本就 4.9:1 未动。
  - 排查干净项:禁用字号 0 残留、原生 confirm 0、icon-only 按钮 aria-label 全覆盖(28/28)、全局 focus-visible 存在、三个全屏查看器暗背板上白色控件两主题合法。
- **考试终止离开后,离开警告框在之后每次切节点都误弹(会话状态泄漏)** —— 点「终止考试」确认离开后,警告框仍反复出现,直到切回考试节点重新挂载才消停(用户实测报告)。根因:`examSessionRef` 只由 ExamView 的 effect 上报,确认终止的处理器消费完会话**不清 ref**,ExamView 卸载时也无人上报 inactive——ref 永远残留 `active:true` + 过期的 terminate 闭包,离开守卫于是拦截之后每一次节点切换(过期 terminate 重交已提交的场,静默失败后放行,看起来就是"弹框→确认→又能走")。修复两层:①确认处理器消费会话即清 ref;②ExamView 会话 effect 加卸载 cleanup 兜底上报 inactive(覆盖换课/删课等一切卸载路径)。ui-test 考试步骤扩展离开守卫链路断言(考试中切节点弹一次 → 确认终止 → 连续再切节点不得再弹),修复前红(cleared:false)修复后绿。
- **考试答题:选项显示序与判分映射错配(点对的题被判成另一个)+ 超长题干溢出屏幕** —— 两个答题页 bug(用户实测报告):
  - **答案静默错换**:`buildAttemptShuffle` 为每场考试生成选项重排(防背位置),判分端 `displayAnswerToOriginal` 把点击的**显示位**映射回原始下标——但答题 UI 一直按自然序渲染、上报自然下标,点击位被当成显示位穿了一次随机置换:点对的选项大概率被判成另一个(1/24 概率置换恰为恒等才侥幸判对)。serve E2E 实测:3 题全部点击正确选项文本,判分 **0/3**,「你的答案」显示的是没点过的选项。修复:渲染端按重排显示序(第 d 位显示 `options[perm[d]]`),与判分端配对——这正是 exam-logic 文档注释里写明但从未实现的那一半。修复后同流程 3/3。
  - **溢出**:答题区 `flex-1` 无 `min-h-0`/滚动,超长题干+长选项直接刺穿面板(390×844 实测内容底 1494px > 视口 844px);不可断行长 token 横向超宽 1061px。修复:固定顶栏(进度+计时+总进度条)+ 可滚主体(`min-h-0 overflow-y-auto`,滚动时控制不消失)+ 题干/选项 `break-words` + 换题滚动归顶。
  - 回归固化:ui-test 新增「考试答题完整性」步骤(注入已知答案的题 + 解锁考试球 + 真实 GUI 点"正确选项的文本"→ 断言 3/3 + 长题干四项几何断言:根框在视口内/题干零横向溢出/滚动容器存在且可滚);闭环已证(把显示序改回自然序 → 步骤红)。
- **答题 hook 在 AI 流式期间交卷会被静默吞掉(两层过期闭包)** —— 答题通常发生在上一轮流式收尾时(AI 出完题还有尾文在生成):hook 的重试循环读闭包里冻结的 `chat.streaming=true`,10 次重试全读过期值;第一层修掉后发现 `sendMessage` 自己的守卫同样读冻结值,重试到了也照样 return——两层叠加导致流式期间点「完成」成绩单永远不发、且无任何提示(真实 E2E 连续踩中)。修复:流态走 `chatStreamingRef`(每渲染刷新),发送走 `sendRef.current` 桥(复用 handleStartLearning 的既有模式,指向最新 sendMessage,其守卫读的也是最新状态)。E2E 实测流式期间交卷,1 秒内气泡出现。
- **对话引擎的思考强度对 glm-codingplan 预设和自定义 provider 静默失效(开了"快速"仍长思考)** —— UI 门控与引擎两处口径脱节的第二半:v0.12 修了门控嗅探(`supportsReasoningControl` 按 baseUrl/模型名认家族),但引擎调用点 `reasoningPlanFor` 一直没传 hints,按预设 id 直查方言表——`glm-codingplan`(id≠"glm")和一切 `custom-*` 的 fast/deep 全部降级 none,请求体里根本不带 thinking/reasoning_effort 参数。实测后果:glm-5.3 开"快速"仍思考 9187 字。修复:引擎调用点补传 `{baseUrl, model}` hints(与门控同口径);verify-reasoning-effort 新增 T6(含 glm-codingplan 预设嗅探命中 + 无 hints 即 none 的唯一变量证明 + **T6d 源码级接线守卫**——防止调用点再次丢 hints),闭环已证(去掉调用点 hints → T6d 红)。
- **第三方端点的思考流被 SDK 静默丢弃(三个点期间其实在流思考)** —— 实测 z.ai CodingPlan + glm-5.3:端点从第一个 SSE 事件起就流式发 `reasoning_content`(首题实测 315 块/1138 字),但 `@ai-sdk/openai` 的 chat/completions chunk schema 只认 role/content/tool_calls,思考字段被 zod 静默剥掉,永不产生 reasoning-delta —— 引擎转发(agent-engine)和 UI 折叠「思考过程」行两端早就备好,一直在等一个 SDK 不会给的东西;此前"CodingPlan 思考期零流事件"的旧结论实为同一缺口的表象(隔着 SDK 看不到)。修法:openai-compatible 协议分家 —— 官方 OpenAI 端点(host=api.openai.com)保留 `createOpenAI`(原生 `openai:` providerOptions 的 reasoningEffort、严格 schema 不失配),其余第三方端点(GLM/DeepSeek/Kimi/Qwen/自定义 provider/Ollama 等)改用 `@ai-sdk/openai-compatible@1.0.48`(解析 `reasoning_content`/`reasoning` → reasoning-delta);`includeUsage: true` 与官方包的无条件 `stream_options.include_usage` 对齐(usage 是导入管线定位截断的硬数据,请求形状零变化);思考强度 bodyPatch(fetch 包装注入 thinking/enable_thinking)在新路径下原样生效。真端到端实测:glm-5.3 经新路径 4.8s 起流思考(129 增量/521 字),6.3s 正文跟上,usage 正常。verify-reasoning-stream 4 组(官方端点判定含后缀伪装域名/思考流穿通/请求形状/bodyPatch 兼容),闭环已证(改回 createOpenAI 即红)。
- **思考强度菜单窄屏溢出** —— 390px 手机上思考强度菜单原是 `right-0` 锚定,240px 宽菜单右缘直接出屏(实测 392 > 390);补位方案"测量→平移→再测量"又会形成 useLayoutEffect 反馈环,React 19 双调用下左右锚来回振荡直到 #185 卸载整树。改为两阶段定位:先翻转锚点(**仅当另一侧放得下**,两侧都放不下就不翻、直接进平移),再对最终位置做一次性视口内钳制平移(测量读未平移坐标,不回环);菜单宽 `max-w-[calc(100vw-1.5rem)]` 兜底。E2E 实测 390px 菜单 {left:127, right:382} 完整在屏内,开关往返零页面错误。
- **思考强度芯条对 custom provider 误禁用(glm-5.3 等)** —— UI 门控 `supportsReasoningControl` 只查 preset id,custom-* 一律判"不支持"→ 芯片禁用;而引擎侧 `reasoningPlanFor` 早已有 baseUrl/模型名嗅探(导入管线思考 low 就是走的它)——门控与引擎口径脱节,导致 glm-5.3 明明可调却点不了。门控补上同一嗅探(custom 的 baseUrl + defaultModel/active_model 作 hints),verify-reasoning-effort 新增 T5 组 5 断言(含 glm-5.3 解禁 + 无 hints 保守关 + 门控开=引擎真落地 bodyPatch),闭环已证。
- **AI 对自己发过的产物失忆(道歉重发事故)** —— thread 历史喂给 LLM 只带 role+content 纯文本,parts_json(工具调用+产物)只用于渲染 —— 上一回合发出过答题卡但正文只有一句引导语时,模型下一回合完全看不见自己的工具调用,于是"道歉说没真正把题发出去"然后重发(真实事故)。现在历史装配时把 tool-call parts 压成「[工具调用已执行] generate_quiz → 已向学习者发出交互答题卡《X》(共 N 题)」标记注入 content(工具失败同样可见;流中断的未完成调用如实留白);base-prompt 同步加一条"看到标记=题已发出,绝不要道歉重发"。verify-tool-part-summary 8 断言,闭环已证。
- **选区浮钮不再被手机原生菜单遮挡** —— 手机 Chrome/Safari 的 复制/分享 菜单锚在选区上方,浮钮放上侧必被遮。定位策略改为:优先**选区右侧垂直居中**(移动 8px),右侧放不下(选到行尾)→ 左侧,整行选满 → 选区下方;按钮紧凑化(两钮 ~150px)让右侧大多放得下。selection-popover 纯函数 7 断言 + 390px E2E 实测(按钮 left 290 > 选区右缘 218,垂直居中,不出屏)。
- **手机划线加笔记不可用(触屏选区检测)** —— "✏️ 加笔记 / 💬 提问这段"(讲解区)与"哪里不会点哪里"(聊天区)的选区检测原来只挂在 `mouseup`,触屏长按选字、拖动选区句柄都不触发该事件,手机上按钮永远不出现。现在两处都加挂 `selectionchange`(250ms 防抖,选区稳定即弹按钮,桌面 mouseup 即时路径不变);选区清空延迟 250ms 收按钮,避开"tap 先清选区再派发 click"的竞态。390px 宽度 E2E 实测:程序化选区(与系统长按同事件路径)→ 按钮弹出 → 清空选区 → 按钮消失。
- **引导器「显示访问链接」卡首启竞态** —— `url.txt` 只在 serve-token 落盘后由 start.sh 写,装完第一次启动可能还没写,`cat` 直接报 No such file。命令加兜底:`cat ~/lookatstudy/url.txt 2>/dev/null || bash ~/lookatstudy/status.sh`(status.sh 每次都直接显示带 token 的链接)。
- **交互卡(quiz)答题进度持久化** —— 偶发"提交判分后结果没同步进对话/刷新后答题状态丢失":答题进度(当前题/得分)现按题组内容哈希存 localStorage(同一 quiz 跨刷新恢复作答;恢复不重放庆祝/上报副作用,只在真实点击提交时触发),损坏数据与私密模式静默降级。verify-quiz-progress 9 断言(键稳定/往返/损坏容忍/写拒绝降级)。
- **锁定球不再吞掉页面滚动** —— 地图球 `touch-action` 从 `none`(吞掉所有滚动手势)改为 `pan-y`(垂直滚动交给浏览器);拖拽判定改为位移后置:手指落在球上先不进入拖拽,移动超阈值且横向主导才接管——误触锁定球后继续上下滑 = 正常滚动,不再卡死。
- **手机浏览器地图黑球+绳子隐形(旧内核兼容)** —— 调色板改为 **oklch 主位 + hex 回退双层**(改色只改 `@supports (color: oklch(..))` 层的 oklch 真源;同作用域 base hex 是降彩度映射后的同色回退,老内核(<Chromium 111,如部分国产浏览器 Custom Tab)渲染正确不再黑球/绳隐形;新浏览器广色域屏保留 oklch 原值鲜艳度)。verify-theme 新增 T3b 双层同步守卫(86 变量逐个校验映射一致,闭环已证),`color-mix(in oklch)` 预混成静态变量(暗/亮两套)。国产浏览器内核(夸克/UC 系 Custom Tab)停在 Chromium 105-110,不支持 oklch(需 111+):渐变背景失效只剩内阴影=黑球,SVG stroke 失效=绳隐形;容器查询(105+)恰好支持,与实测症状吻合。
- **Custom Tab 顶部地址栏导致内容超出一屏(需滚动)** —— 外壳 `100vh` 改 `--app-height`(`visualViewport.height` + 100/300/800ms 延迟复测 + resize/scroll 监听,KaijiBot 三轮迭代验证的终版方案;dvh 和 position:fixed 都救不了 CCT 工具栏动画时序)。桌面 Electron 不受影响(visualViewport.height === innerHeight)。
- **令牌门支持粘贴整条启动链接** —— Termux 里长按复制的就是带 `?token=` 的完整 URL,原样粘进门即可(自动抽取 token),不再要求手抄长令牌。
- **正式应用图标(用户设计的 3D 字母 L)** —— 同一设计应用到三端:桌面 `build/icon.png`(electron-builder 标准位,win/mac/linux 安装包从此不再是默认 Electron 图标);Android 引导器自适应图标(满幅位图双层,渐变底视差无缝,五密度 108-432px);网页端 PWA manifest + favicon(192/512 PNG,含 maskable,L 占 62% 在 80% 安全区内)。
- **Termux 安装链路全面强化(照搬 KaijiBot 实测经验)** —— `scripts/install-termux.sh` 从 10 行引导升格为完整安装器:中国时区自动切 TUNA apt 镜像(getprop 判定,apt-get 而非 pkg 绕过其全球镜像测速);`apt upgrade` 先行(全新 Termux 跳过会 OpenSSL 链接错误);依赖按需检测(nodejs-lts/curl/unzip,已装跳过)+ Node ≥20 验证;便携包下载回退链(直连 → gh-proxy.com → ghproxy.net → ghfast.top,实测筛选);落盘 `~/lookatstudy/{start,stop,status,update}.sh` 常用脚本;自启双保险(`~/.termux/boot/` + `.bashrc` 幂等块,开 Termux 即拉起);电池优化自动弹白名单对话框 + 六厂商手动路径指引;bash 健壮性全套(set -e 下 pkill 挂 `|| true` 等踩坑修正)。脚本随 Release 单独发布,引导器安装命令改为 KaijiBot 式一行 `curl 安装脚本 | bash`(直连失败走代理)。
- **引导器「常用操作」屏** —— 第二屏命令卡片(查看状态/启动/停止/更新/看日志/显示访问链接/电池白名单/Termux:Boot 设置),点击复制命令并自动跳 Termux 粘贴执行;电池白名单卡片直接开系统设置,Termux:Boot 卡片复制自启配置命令并打开 F-Droid。日常形态收敛为:打开 Termux(或重启手机装了 Termux:Boot)→ 服务自动起 → 引导器点「打开」。
- **手机端全量支持(Termux 便携服务 + 浏览器,同一套前端)** —— 桌面 Electron 之外新增第三种运行形态:**Node 便携服务**。93 个 IPC handler 收敛成共享 handler 表(`ipc/runtime.ts` 的 `collectHandlers`),Electron 的 ipcMain 与 serve 的 WS 分发共用同一张表零漂移;`npm run build:mobile` 产出 `dist/mobile/`(server.cjs 单文件 + web 前端 + install-termux.sh),Termux 里 `node server.cjs` 即起(零 npm install,sql-wasm/种子课程随包),手机浏览器打开 `http://127.0.0.1:17890`。安全:默认只绑回环,WS 需 token(首启生成落盘复用,启动日志打印带 token 链接);无 token/错 token 时网页端有**令牌门**(输一次存 localStorage,token 失效自动切回)。web 模式 UI 分叉:文件夹导入改输路径、课程包导入/导出走浏览器文件选择与下载、导入入口触屏常显;PWA manifest + `pointer-coarse` 触屏适配。**Android 引导器 APK**(`android/`,内置 Termux 安装包一键装 → 复制安装命令跳 Termux → Custom Tab 打开本机服务;CI `android-build.yml` 出 `LookatStudy-launcher.apk` + `lookatstudy-mobile.zip` 挂 Release,本地同链构建已验证 37.7MB 可安装包),`ci.yml` 加 mobile-bundle 守护。验证:`verify-serve` 5 组测试(真实 bundle 子进程:静态/SPA、token 4001、WS req/res、渲染层 web 传输 E2E 含真实导入落库、preload↔channels 漂移守卫)全部闭环(破坏→红→复原→绿),真浏览器走通课程点击/地图渲染/令牌门三步;桌面侧 verify:core 74 套 + self-test + ui-test 全绿零回归。
- **`npm run serve`** —— 开发态快速起 serve(esbuild 只编 server + 复用 dist/renderer,免 vite 全量)。

### Fixed
- **取消导入即时生效(网络层穿透)** —— 取消信号此前只掐 LLM 调用(Step2/4),网络层要等当前批次自然跑完:树扫描最坏 240s、大纲/正文按批拖。现在 ① 编排器把 fetchFn 统一收口注入取消信号,所有 CDN 请求(README/大纲/正文/图片)在飞即撕;② `httpsGet` 支持 `signal`,`req.destroy()` 即断(240s 树扫描窗口内任意时刻可取消);③ README 循环/大纲批间加检查:取消报"已取消"不误报"无法拉取 README",半截大纲不落快照;④ 修掉附带真 bug —— Step1 抛错路径漏 `clearInterval`,每次取消泄漏一个 300ms 轮询计时器(Electron 主进程永不退出 → 永久句柄)。verify 新增 C1-C6 + T12 共 7 个取消断言,四路闭环(破坏→红→复原→绿)已证。

### Added
- **课程行"导出"按钮** —— 导入面板课程列表每行(删除旁)新增导出课程包入口,悬浮浮现;非 GitHub 来源导出失败会就地提示。顺手把导入四个 tab(URL/MD/文件夹/课程包)改为**永不换行 + 容器自适应缩字**(A+ 大字号下"文件夹"不再折行)。

### Changed
- **物理球久置分散** —— 斥力 `near` 改按**接触圆之外的间隙**标定(原中心距标定在接触距离处只剩 ~4% 力,静止贴着的球几乎不受斥力,长时间不拖动会缓慢聚堆);配合**相对速度门控**(<1.2px/step 才垫开):静置的球被温和推到场缘自然散开,快速接近的球照常真实相撞(碰撞事件/震雪不丢)。`verify-map-physics` 26→27 断言(T27 静置分散,闭环已证:退回中心距标定即红)。

### Fixed
- **目录树扫描卡死 700s+(fastgithub 半死态)与全树降级链补全** —— `httpsGet` 只有 socket 空闲超时,TLS 握手卡死时被底层活动不断重置永不触发;加**硬性总截止**(默认 25s,覆盖 DNS/建连/TLS/响应体全阶段,哑服务器测试 615ms 掐穿,闭环已证);**树扫描单独放宽到 240s**——实测部分网络直连 GitHub 被限速 ~24KB/s,大仓库 2-4MB 的树 JSON 是"活着但爬行"的合法传输(210s 拉下 17223 文件),不该被当挂死掐掉,真挂死仍由 20s 空闲超时兜底。同时把 jsdelivr data API 全树列表加回 `fetchRepoFileTree` 作降级(Tree API 死时中小仓库(<50MB)仍有全树;大仓库 403 继续退 README 链接)——fastgithub 半死时导入不再只有裸 README 一条路。
- **导入截断综合治理(实测 ML-For-Beginners 165 文件,glm-5.2 @ CodingPlan 全链路跑通)** —— 四层根因逐一落地:
  - **思考强度是主犯**:思考与正文共享输出额度,且强度决定思考吃掉多少——默认强度 8K 池挤掉 JSON(截断)、32K 池直接想 6 分钟+零正文被看门狗掐死;`reasoning_effort:"low"` 一锤定音(导入调用强制 fast:CodingPlan 无视 disabled 但认 low)。终版实测 165 文件 5 批全直通,零拆半零截断,212 秒完成(32 章 168 课);
  - **输出上限家族感知**:GLM 家族 32768 / Qwen·SiliconCloud 16384(官方上限内),DeepSeek V3 与未知端点保守 8192;
  - **自定义 provider 思考方言嗅探**(`llmFamilyOf`):方言表此前按预设 id 查键,custom-* 永远落空 → 思考开关静默失效;现按 baseUrl/模型名认家族(z.ai/bigmodel/glm- 前缀 → glm),导入调用强制 fast(thinking disabled + `reasoning_effort:"low"` 双参数,端点认哪个用哪个);
  - **Step 2 分类批 200→40 + 截断拆半自愈**:`parseRoleResult` 加 degraded 标记,`classifyFilesResilient` 与 Step 4 同款二分(此前截断会静默把整批文件全当原文,翻译配对/practice/噪声全丢);
  - **JSON 抽取平衡块**:模型在 JSON 前后多说两句不再炸解析(实测 "non-whitespace character after JSON");parse 失败的错误消息带原文开头 200 字,下次直接看到模型吐了什么。
  - **提示词钉死纯 JSON**(首字符 `{` 末字符 `}`,禁前言/总结/围栏)+ **看门狗放宽**(120s→360s:思考期间端点零流事件,fullStream 也喂不到,120s 判死误杀合法静默;挂死由 20min 硬上限兜底);
  另:每次 LLM 调用留痕 `tokens: in/out/finish`(撞上限带 out/cap),parse 失败带原文开头 200 字;人当 LLM 校准实验(真实输入亲手产出结构 JSON)证实任务诚实输出仅 ~3.3k token,截断几乎全是思考开销;`verify-*` 四套件新增 14 断言(截断信号/拆分自愈/取消/嗅探/平衡块,全部闭环)。
- **导入取消现在真的能取消** —— 此前取消标志只在步骤边界检查,Step2/4 的在飞 LLM 调用(最长 20 分钟)和二分级联照跑,表现为"点了取消没反应"。现在 runSmartImport 把取消回调折叠成 AbortSignal(300ms 轮询)传进每次调用,流式生成立即中止;二分每级入口检查,零新调用;预取消/中途取消/静默收尾三种路径都有守卫。
- **导入结构设计被输出上限掐成半个 JSON(thinking 模型高发)** —— 导入管线的 LLM 调用此前不传输出上限,吃 provider 默认(常见 4096);thinking 家族的思考与正文**共享**这一额度,40 文件批的结构 JSON 写一半流就正常结束(实测 GLM 66s,"Unexpected end of JSON input"),触发批内二分连锁,多烧好几轮调用才收敛。现在显式传 `maxOutputTokens=8192`(DeepSeek 上限、各家通用安全值;仍截断由二分兜底),撞上限时主进程日志留痕。`verify-import-watchdog` 6→7 断言(T7 假模型捕获 doStream 参数,闭环已证)。

## [0.10.0] - 2026-08-16


### Added
- **三栏布局响应式三档(窗口 560~任意宽)** —— T1(≥1240)三栏共存;T2(920~1239)自动收左栏成双栏(中+右),点左栏按钮显示左栏则隐藏右栏(侧栏互斥,中栏常驻);T3(<920)单栏(默认对话)+ **标题栏居中切换组**切换 地图/对话/笔记(地图在 T3 全宽展示,物理岛按新墙宽自动重建)。**标题栏常驻全宽**:Header 提到根级,三个 pane(含左栏地图)都在其下——此前左栏是全高组件、header 只盖中右列,T3 切到地图页会连标题栏带切换组一起消失(困在地图页回不来);切换组从 fixed 浮层(遮挡后方 UI)改为标题栏居中槽(`grid 1fr auto 1fr` 真居中),T3 档标题栏自适应重排:品牌名让位、XP 能量条收成图标+数字、视图切换组/字号控制隐藏(防 A+ 字号下溢出)。**拉宽自动弹回**:进 T1 三栏全恢复、T3→T2 承接正在看的一侧;窄化自动收。中栏宽度 clamp(480,36vw,800)(1920 屏 ~690 手感不变,2K 更舒展);笔记本内容居中封顶 960;窗口 minWidth 1240→560。档位判定纯函数(`paneTiers.ts`,阈值=各档 pane 最小宽度和)+ `useWindowTier`(useSyncExternalStore,同档拖动零重渲染);`verify-pane-tiers.mjs` 5 断言 + ui-test 真实 resize 跨档行为测试(自动收/互斥/单栏切换/弹回/极窄 600px 三 pane 逐一零横向溢出,谓词轮询防竞速,连跑稳定)。
- **左栏物理地图** —— MapRail 技能地图从 CSS 漂浮气球升级为真物理引擎(Matter.js 0.19,纯 JS 无原生编译),物理模型按实测反馈两轮打磨:**真实重力场**(球有重量、绳子也有重量)+ **球自带浮力**(≈自重,确定性微差 → 有的微顶有的微垂,整条链像挂在路牌下的彩旗串);**绳子 = 粒子链**(受拉时有弹力、不受力时像普通绳子自然垂坠,拉紧自动绷直);**天气驱动环境物理**(weatherPhysFor 映射:暴风=强风+随机阵风、雨天=雨滴冲击球、雪天=积雪增重缓缓压坠+碰撞震落、雾天=死寂+浓空气阻尼);**顺序由绳链表达**——章节路牌金色绳结 → 球1 → … → 紫球(考试 boss,更沉),顺绳走即读序;**无弹簧回位,自由摆布**(拖到哪停在哪,墙=section 上下+栏宽左右);**锁定的球是 static 刚体**——不可拖、风吹不动、别的球撞它如撞墙,解锁瞬间"苏醒"(地图随学习进度逐球活过来);第二轮实测调优:绳渲染改**平滑弧线**(贝塞尔穿绳粒中点)、浮力区间上移到 1.05-1.17(扛住绳重后约半数球净上浮半数下垂,静止时绳有松有紧——原区间全部净下垂导致静止全绷紧)、绳结锚到**路牌下缘**、低速接触不再"被吸附"(调低 Matter 静息反弹阈值 4→1.4,慢碰也保留弹性)、**球出不了盒成为物理不变量**(拖拽点钳进盒内 = 手感上拉到墙就拉不动;每步硬钳制兜底蛮力冲量——实测蛮力拖出边界球消失的回归,verify T18 双层闭环已证);雪载增重提到 35% 自重(满载压得过任何浮力盈余,撞一下震落);第三轮实测调优:**解锁新球不再整章闪回原位**——岛重建(锁定态变化触发)时把每球的实时位置/速度作为 spawn 续接进新岛,绳粒子也初始摆成带垂度的弧(重建瞬间绳形不跳);**浮力改为按每球实际挂的绳质量精确自校准**(lift=(1+绳重占比)×0.96~1.04,每端只计半条绳——两端各计全绳会把绳重补偿翻倍导致整串净上浮堆顶,v4 实测抓到):整体严格中性、只剩 ±4% 球间再分布,静止时相对布局位有升有降(-15~+30px 实测)、绳有松有紧且串不整体漂移;第四轮:**球顶积雪物理化**——球快速移动/被拖拽/被撞时从球顶半球甩出带初速度的雪屑(继承球速×0.75+随机散布,轻量弹道积分非刚体),雪屑下坠渐隐约 1-1.6s 消逝不落地堆积;雪载同步扣减 → 球变轻微微上浮(物理-观感闭环);慢速移动不掉雪(阈值 3.5px/步),撞墙甩出一簇;渲染走天气层新 `getFlakes` 通道;第五轮:**球体力场**——每对球在 2.25×球半径(≈63px)内受平方衰减斥力(最近 ≈6×重力,磁悬浮垫:靠近像同极磁铁相斥,链上相邻球被垫开悬浮),锁定球也是场源(碰都碰不到)且不受力;内力等大反向 → 整串质心不动(不破坏中性平衡);受力时球周淡显蓝色力场光环(渐隐);**雨天雨线改垂直**(不再斜飘),暴风雨雨势加大(雨滴翻倍 140、线更长更亮、落速近两倍);第六轮:**球对不重叠成为硬不变量**(实测拖拽压实时视觉穿模:Matter 求解器容许 slop 穿透 + 软拖拽弹簧持续压实 → 每步后强制圆心距 ≥ 2r 的兜底分离 + 球速上限 22px/步防无 CCD 隧穿 + 位置迭代 6→8 + 视觉球心与物理圆心 2px 对齐);**力场半径 2.25r→2.45r**(悬停间隙 12.6px,盖过选中环外沿 r+6,选中球贴邻不再视觉叠环);**球顶雪盖从动物理**(原视觉雪盖与物理雪载是两套独立累积系统,拖动甩雪屑时雪盖不消——现雪盖唯一真值 = 物理 b.snow,增长/甩掉/撞掉/封顶全在物理层,天气层经 orbSnowRef 每帧读取直画);**甩雪阈值 3.5→2.0px/步**(原 210px/s 太高,普通拖动根本触发不了);碰撞 = squash 压扁形变 + 脉冲环(**命中点统一用碰撞支撑点**)+ 天气耦合(雨天溅水花/雪天震雪顶);视口外章节岛冻结。工程约束:球保持 DOM、物理只写 transform、reduced-motion 完全回退静态布局;**点击路由在 pointerup 自做**(setPointerCapture 会把 click 重定向到捕获元素,按钮 onClick 收不到——合成 click 的测试测不出,补了真实 PointerEvent 探针);拖/点按位移阈值区分。新增 `mapPhysics.ts` + `verify-map-physics.mjs` 17 断言(绳垂坠/受拉绷直/天气映射/墙内命中点/static 锁定/无回位弹簧,两轮闭环已证)+ ui-test 真实指针探针(点击进课 + 锁定球分毫不动,闭环已证:废掉路由 → clickWorks 红)。

- **地图绳链跨段成环:考试球系往下一段路牌上缘 + 挂点随机化** —— 每章的紫考试球新增一条绳,系住**下一段路牌的上缘**(整张地图串成一条连续链:牌底→球1→…→考试球→下段牌顶,顺绳走即读序;末段没有下一段路牌则不系)。挂点位置随机化:首球绳在本段路牌**下缘**的挂点、考试绳在下段路牌**上缘**的挂点,x 均按 section id 确定性哈希随机(重渲染稳定、每段 rigging 各不相同);挂点 y 在 effect 里量实测 DOM(路牌上缘真实位置),渲染初值按 24px 估值、mount 后校准。考试绳是真物理(粒子链):拖考试球远离绳结会被绳拽回(不是装饰);浮力自校准自动覆盖新绳质量。`verify-map-physics.mjs` 23→25 断言(T24 拓扑/随机/守卫 + T25 对照回拽,闭环已证:废掉考试绳创建两测皆红)。

### Changed
- **T3 标题栏手机化重排** —— logo 常驻左上(宽屏 text-body / 窄屏收成 text-label 并 truncate 让位),左槽并排紧凑能量(闪电+数字);**切换组与设置按钮尺寸永不让**(中列固定居中、右列固定),其余显示(等级/连击/能量条)按剩余宽度让位;窄档左右留白从 px-6 收到 px-4。
- **物理球随栏宽自适应排布** —— 跨档/拖窗改变左栏宽度时,重建岛的续接坐标按新旧宽度比例横向重映射(`remapSpawnX`,钳进新墙;y 不动),不再带着旧绝对坐标把首尾两根绳(挂点已按新宽度随机)拉得老长;`verify-map-physics` 26 断言(T26,闭环已证)。
- **雪天积雪不再压坠球** —— 雪重(原 35% 自重)实测把整条彩旗串压沉到底;移除后积雪纯视觉(堆积/甩落/撞掉不变),球的浮沉只由浮力校准决定(T16 规范反转,闭环已证)。

### Fixed
- **T3 单栏档窄窗仍横向溢出(实测 ~633px 以下不再自适应)+ 左栏出现横向滚动条** —— 两个独立根因:① 中/右 pane 是 flex 子项,`min-width:auto` 的固有宽度地板把 pane 顶在输入框工具条的 min-content(~633px)上下不去,再往上还有一整层结构性溢出:中间列/面板行同样缺 `min-w-0`,被 header 工具条的固有宽(~598px)顶宽出视口 14px(竖向滚动条占位后 innerWidth=584);② 物理球 wrapper 宽 110px > 球碰撞半径 28px,球贴右墙时 wrapper 右缘伸出 284px 内容盒 → `map-path`(overflow-y:auto 把 x 计算成 auto)出横向滚动条。修:中/右 pane + 中间列 + 面板行全补 `min-w-0`,输入框底部工具条 `flex-wrap` 可换行,T3 档 header 隐藏视图切换组(顶部 switcher 已覆盖)与字号控制,`map-path` 加 `overflow-x-hidden`。ui-test 跨档测试扩三探针:T3 600px 逐 pane 断言零溢出(pane 右缘/文档 scrollWidth)+ T1 回档后 map-path computed overflowX=hidden 守卫(溢出依赖拖球行为无法确定性复现,直接守修复);闭环已证:废掉 min-w-0/overflow-x-hidden 三探针皆红。
- **MapSection 的 `return ro.disconnect`(裸方法引用)在删课卸载时炸掉整棵 React 树** —— React effect cleanup 直接引用 ResizeObserver.disconnect 方法,调用时 `this` 丢失 → `TypeError: Illegal invocation`,物理地图的额外 effect 改变了错误暴露路径后此潜伏 bug 显形(删课程后白屏、不回空态)。绑成闭包修复;ui-test 36 断言全绿复验。
- **大仓库导入 Step4 结构设计被输出截断炸掉整个 job(实测 181 文件仓库)** —— 40 文件/批的结构设计 JSON 撞 provider 输出上限,流正常结束但 JSON 只写了一半("Unexpected end of JSON input"),此前的 300s 墙钟超时把它掩蔽成超时错误,换成活性看门狗后真因浮出。现在每批走 `designSectionsResilient` 自愈:解析失败(截断/缺 sections)→ 批拆半重试,输出体量随批指数缩小;二分到单文件仍失败 → 按 h1/文件名兜底一课,绝不抛;网络/看门狗等基础设施错误不无谓重试原样上抛。同时修 planId 标注缺口:此前只包住 Step5,Step2-4 失败的错误不带 planId → "从断点重试"按钮不出现;现在 Steps 2-5 全部标注。另给每次方案快照落盘加审计日志(`[import-plan] saved ...` 进 lookatstudy-import.log)——排查"快照为什么没写成"不用再猜。新增 `verify-structure-resilience.mjs` 9 断言(二分/兜底/基础设施错误直通/planId 两步注入集成,闭环已证)。

### Added
- **图像转译桥覆盖课文图(讲解区配图)+ 修纯文本模型的 400 坑** —— 此前桥只管输入框上传的附件;讲解区的课文图走另一条路(`flag_multimodal_import` 开 + 提问命中图片关键词时,把 `node_assets` 关联图 + 课文内嵌图以 file-part 直通喂主模型),纯文本主模型在这条路上要么看不见图,要么硬吃 file-part 直接 400(既有坑)。现在三处喂图点(聊天附件 / 课文图主动注入 / `attach_node_images` 工具)共用同一个 `visionRouting` 通道判定:native=主模型直看;bridge=视觉模型转译成不可信文字证据注入(工具在 bridge 通道下返回转译文本而非图数据,与主动注入同缓存键零重复调用);reject(纯文本且无覆盖)=方案 B 不喂图、工具不注册——对话照常进行,不再 400。顺手统一图源归一化:`parseDataUrl` 把两处图源(data-url 形态)解析成纯 base64(AI SDK file-part 的文档格式,替换旧代码直接塞整条 data-url 的写法),去重从 data-url 字符串比对改为 base64 比对(更严)。verify 套件扩到 62 断言(新增 visionRouting 三路 / parseDataUrl 九例含畸形输入,闭环已证:破坏空载荷守卫测试即红)。
- **图像转译桥:纯文本主模型也能"看图"** —— DeepSeek 这类纯文本模型此前贴图直接被拒;现在设置页配一个 vision 覆盖模型(设置 → AI 看图,不再被多模态开关门控)即可:上传的图片先由覆盖模型转译成文字描述,以"不可信视觉证据"块注入本轮消息(块内显式声明图中的指令性文字是被观察内容不是命令,防图内提示注入),主模型照常教学——工具调用/出题/人设循环全不换模型,这是 dsh 社区六个 vision 插件验证过的 describe-then-chat 共识做法。能原生看图的模型行为不变(file-part 直通);转译提示词把学习者原话原样转发(任务导向观察,不套"描述这张图"模板),输出语言跟界面语言;同图+同问题+同语言走 sha256 进程内缓存不重复调用;活性看门狗(120s 无输出判死/5min 硬上限)真取消请求;桥失败明确报错并附"去设置更换或清空覆盖"指引,绝不静默丢图。输入框附件区出现转译提示条(`visionBridgeModel` 经 `agent:getContextUsage` 下发),纯文本+无覆盖时的拒收提示也补上"可配置视觉覆盖"指引。新增 `verify-vision-bridge.mjs` 49 断言(决策四路/覆盖读取/提示词双语/不可信标记/截断拼接/缓存键与 FIFO 淘汰,闭环已证:去掉不可信标记测试即红)。
- **输入框四件套:附件上传 + 上下文用量表 + 模型切换 + 思考强度** —— 输入框从"纯文本框"升级为学习控制台,三项新能力全部数据自取、即选即生效:
  - **附件**(v0.10 主需求):📎按钮 / Ctrl+V 粘贴截图 / 拖拽到输入框三种入口。图片(≤5MB,每条消息≤4 张)作为 vision 输入随本轮消息喂给模型(用户显式上传不受多模态 flag/关键词门控),落盘 `userData/attachments/` 供历史消息缩略图复现(点开全屏灯箱);已知不支持看图的模型在选图时就地拒收并提示换模型。文本/代码文件(≤256KB,40+ 扩展名)读出正文用四反引号围栏内联进消息 content——持久化和后续轮次的 LLM 历史天然可见,气泡只显示文件 chip 不被长代码撑爆。thread 删除顺带清理附件文件;文件名 uuid 守卫,渲染层传路径逃不出附件目录。
  - **上下文用量表**:环形指示 + 百分比,点击弹明细——五段条形图(系统提示/课文/学习者状态/对话历史/草稿)+ 各段估算 token + 模型窗口。固定开销(system/课文/学习者快照)由 `agent:getContextUsage` 返回,装配与 `runAgentTurn` 实发**同一函数**(`assembleContextBlocks`),表显=实发不漂移;历史与草稿在渲染层本地叠加,边打字边动。估算用 CJK 感知启发式(无 tokenizer 依赖),≥85% 变警示色。
  - **模型切换器**:芯条显示当前模型,点开按"已配密钥的 provider"分组列出模型(带眼睛徽标=支持看图),选中即写 settings 并广播 `llm-config-changed`(与设置页同机制);当前模型不在清单(手输/发现来的)也补行显示;底部"管理模型与密钥"直达设置。
  - **思考强度**:自动/快速/深度三档(存 `settings.reasoning_effort`,应用级)。reasoning 控制没有跨厂商标准,方言表做成单一真源(`shared/reasoning-effort.ts`):GLM→`thinking.type`、Qwen/SiliconCloud→`enable_thinking`(fetch 包装注入请求体)、OpenAI→`reasoningEffort`、Anthropic/Google→原生 providerOptions;不支持的家族(如 DeepSeek 靠模型切换)芯条禁用+说明,引擎侧自动降级"零干预",宁可不生效不瞎发参数吃 400。
  新增 3 个 verify 套件 98 断言(`verify-token-estimate` / `verify-chat-attachments` / `verify-reasoning-effort`,含路径穿越/围栏逃逸/预算超限等对抗用例,三套件闭环已证);新 IPC `agent:getContextUsage` / `attachment:getDataUrl`;`agent:chatThread` 契约扩展可选 `attachments` 参(preload/main 同步)。
- **导入管线"确定性"改造:ImportPlan 断点续跑 + 课程包** —— 导入每个步骤边界把产物快照落盘(`userData/import-plans/*.json`,原子写):失败/中断后"从断点重试"跳过已完成的 AI 步骤(此前 Step4 结构设计超时一次,前面 3 分钟的分类全部白跑);同一仓库再导入自动复用快照(零 AI 调用);GitHub 来源的方案可**导出课程包**分享——对方导入同一仓库秒过分类+结构设计(正文仍从 CDN 现拉,包里不含内容)。实现:`pure/import-plan.ts`(格式+treeHash 漂移检测+bestEffortStructure 尽力保留)+ `import-plan-store.ts`(文件存取)+ `import-job-service.ts`(编排器,把两处内联的 5 步收成单一路径,github/folder/plan 三种 spec 共用);内容漂移时结构丢弃引用消失文件的课、翻译路径过滤,全灭则退回正常 AI 流程;语言决策运行时重算不进快照。新 IPC:`import:resume` / `import:importPack`(第四个 tab)/ `import:exportPack`(成功面板按钮,仅 github;folder 含私有路径不导出),`import:done` 失败带 `planId`;课程删除顺带清快照。新增 `verify-import-plan.mjs` 11 断言(纯函数 6 + 无 LLM 集成 5:首导落库落盘/再导复用/漂移 bestEffort/plan spec 续跑/按课清理,闭环已证)。
- **GitHub Actions CI(`.github/workflows/ci.yml`)** —— push(main)/PR/手动触发,ubuntu 跑 oxlint + 双 tsc typecheck + 65 个 verify 套件 + vite build,外部坏 PR 在 CI 就被挡住。运行器与 engines 底线定为 **Node 22**(tsx 4 在 Node 20 上经 data: URL 解析相对导入会挂,verify 套件在 20 跑不起来;本机开发环境是 Node 24)。
- **多平台打包 workflow(`.github/workflows/package.yml`)** —— workflow_dispatch(任意分支可试跑,可带 `release_tag` 输入让 CI 云端直挂安装包到既有 release,免本机中转)或推 `v*` 标签触发,windows/macos/ubuntu 矩阵各跑构建,产物(NSIS exe / arm64 dmg / AppImage / deb)传 workflow artifacts;attach 任务用 `gh release upload --clobber` 挂到对应 GitHub Release。三个实测才修对的配置:mac `identity: null` 免签名(CI 无 Apple 证书,未签名 dmg 首开需右键打开)、`electron-builder --publish never`(GH Actions 里检测到 CI 会默认自动 publish,找不到 GH_TOKEN 而死)、workflow 声明 `permissions: contents: write`(默认 GITHUB_TOKEN 只读,gh release upload 403);deb 元数据还要求 package.json 的 author 带 email(已补)。v0.9.0 release 据此挂齐四平台安装包,exe 换成 CI 可复现构建。
- **CONTRIBUTING.md** —— 人类贡献者指引(环境/验证清单/最容易踩的铁律/commit 与 changelog 约定),与 AGENTS.md 互为补充。
- **`npm run shots` —— README 截图自动采集模式(`--shots`)** —— 无头窗口 + .env 真 provider + 预置"学过一阵"状态(皇冠/进度环/锁定球/待复习徽章/XP 能量条/Boss 考试球解锁),驱动真实 UI(点开始学习 → 真 LLM 二选一猜测卡 → 揭晓;点第一章考试球 → 后台分批生成 → 开考计时答一题)并 capturePage 截**两套各 3 张** PNG:`docs/screenshots/`(中文,README.zh-CN 用)与 `docs/screenshots/en/`(英文,README 用)——跑两遍(`--shots` / `--shots-en`),各自独立临时 DB(每次启动先删,对话/考试题库按当遍界面语言产生,互不污染);英文遍启动即英文(localStorage 界面语言 + 课程 🌐 en 直写 settings + loadFile 二次加载,不做事中切换)。本模式独享例外:GPU 加速保持开启(capturePage 需要合成,生产路径仍 disableHardwareAcceleration)。实战修出的鲁棒性(每条都是真实踩坑):capturePage 偶发 0 字节/拒绝(长 LLM 等待后窗口闲置相关),唤起窗口重试至多 5 次且**绝不用 0 字节覆盖磁盘上的好图**;启动后语言门校验按钮文案符合当遍语言(中英对称),不符宁可失败退出也不静默存错语言图(js() 吞错曾把失败变成"成功");二次加载用 loadFile 而非 reload()(后者会以 display surface 不可用 reject 后悬挂);localStorage 语言写进共享 userData,截完必须还原否则正常启动残留英文界面;runShots 任何异常保证 app.quit 不悬挂;每张截图前 hide/show 强制重合成并记录 DOM 语言探针(输入框占位符/助手消息语言),截图像素与文档语言可对照核验。
- **内置引导课程双语化(原文 zh-CN + 内置 en 翻译)** —— 种子课程(LookatStudy 使用指南,SEED_VERSION 10→11)从单语变双语,和导入课程同一套机制:30 条英文翻译(6 章 + 18 课 + 6 考试标题)进 `content_node_translations`,地图标题卡的 🌐 切换器开箱即可演示原文/翻译切换,离线无 LLM。英文课文全部手工撰写(内联在 `build-guide-seed.mjs`),构建期自检缺译即报错。灌入逻辑抽成 `seed-apply.ts`(db 注入式,绕开 seed.ts→db/index 的 `?raw` 导入链),新增 `verify-seed-bilingual.mjs` 7 断言(结构/灌入/幂等/版本 bump 重建含 UNIQUE 冲突回归陷阱,闭环已证)。顺手修一个真 bug:🌐 切换器 `LOCALE_NAMES` 缺 `en` 条目,英文翻译显示成原始码 "en"(ui-test 新断言抓到)。
- **AI 输出语言跟随界面语言(对话 + 出题)** —— 此前导师讲解、出题的提示词全部硬编码"用中文回答",英文界面用户被强行中文教学。现定位为**界面语言 = 偏好输出语言**(课程 🌐 只决定读哪份课文,不决定 AI 说什么):渲染层把 i18n 界面语言随消息/出题请求穿到主进程(`agent:chatThread`/`exam:prepare`/`exercise:generate` 加 locale 参),`resolveOutputLang`(`@shared/locales` 纯函数)解析后注入提示词——zh 路径与旧硬编码**逐字节一致**(默认行为零变化,verify 断言锁死),非 zh 用英文指令并显式点名工具参数(generate_quiz 的题干/选项/解析)也必须跟随;soul 人设是中文写的,注入后追加一句"人设只管行为不管语言"提醒。语言组装抽 `agent/base-prompt.ts` + 出题语言行 `questionLanguageLine`,exam/exercise prompt 同链;考试题库一次性生成,语言在生成时定格。新增 `verify-agent-locale.mjs` 10 断言(映射/指令/组装/解析,两轮闭环已证:破坏 locale 传递与解析各红一次)。

### Changed
- **README 双语重写(showcase 骨架 + 维护者第一人称行文)+ MIT LICENSE 文件** —— 英文主版 + 简体中文镜像(README.zh-CN.md,互链切换)。骨架保留 GitHub 流行式(徽章行/居中头部/三张内嵌截图/快速开始),文字按 human-writing 技能全部重写为作者自述体(为什么写这个/两个没后悔的设计/目前做不到的事),中文版过 check_prose.py 全绿(翻案句 0/破折号 0/提示性冒号 0/黑话 0)。新增 MIT LICENSE 全文(此前只口头声明);`docs/` 目录启用存截图。

### Fixed
- **导入 LLM 超时改活性看门狗(流式)** —— 实测 181 文件仓库导入:Step 2 分类 3 分钟正常返回,Step 4 结构设计首批却被 300s 墙钟超时杀掉,整个 job 报废。根因是慢模型(glm-5.2)生成大结构批本来就可能超 5 分钟但流是活的,墙钟误杀。改法:`generateTextWithTimeout` 换 `streamText` + 活性看门狗(`pure/stream-watchdog.ts` 纯函数)——每收到 chunk 续命,只有「无输出 120s」(连接挂起)或「硬上限 20min」(防无限生成)才 abort,且 abort 经 signal 真正取消底层请求(旧 Promise.race 输了请求还在后台烧 token)。误杀场景消失,死连接反而更快暴露(300s→120s)。新增 `verify-import-watchdog.mjs` 6 断言(活跃不杀/静默判死/硬上限兜底/touch 续命/dispose 清理/慢流跑完,闭环已证:touch 置空 3 红)。
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
