# AGENTS.md — LookatStudy

Guidance for AI coding agents working in this repo. Read this + `README.md` +
`PRODUCT.md` + `CHANGELOG.md` + `VERIFICATION.md` first, then `dev-docs/` for
architecture / build pitfalls / historical design plans.

## Mandatory protocol

Before developing any feature or changing any code, read and follow `VERIFICATION.md`.
Output that violates a red line in VERIFICATION.md §7 is void.

## What this is

Open-source, local-first, AI-driven desktop learning platform. Turns any GitHub
learning repository into a Duolingo-style course (gated skill map, AI tutor with
BKT mastery tracking, SM-2 spaced repetition, XP/streak/crown retention).
Supports 12 document formats (.md/.ipynb/.rst/.Rmd/.org/.adoc/.pdf/.pptx/.html/.txt/.epub/.docx) +
30+ code file types (.py/.js/.ts/.go/.rs/.java/.c/.cpp/.rb/.sh/etc) +
multimodal image import + AI vision + video import (B站直连音轨; YouTube/抖音等经 yt-dlp,字幕优先零转写).
Local voice (v0.12): sherpa-onnx TTS read-aloud + streaming ASR dictation,
models downloaded on demand (ModelScope mirror primary), fully offline inference.
Electron app, local SQLite (sql.js), BYO LLM API key. Light/dark theme.

## Tech stack (locked — do not change)

- **TypeScript** full-stack · **React 19 + Vite 6 + Tailwind v3** (renderer)
- **Electron 33** main process — **CJS output, not ESM** (see gotchas)
- **Vercel AI SDK v5** (`ai` + `@ai-sdk/openai` + `@ai-sdk/openai-compatible` + `@ai-sdk/anthropic` + `@ai-sdk/google`) · **zod v3** for tool schemas
- **sql.js** (SQLite compiled to WASM, pure JS) + **Drizzle ORM** — *not* better-sqlite3
- **pdfjs-dist** (PDF rendering, pure WASM/JS) — for PDF text + image extraction, no canvas dependency
- **sherpa-onnx-node** (native sherpa-onnx) — local TTS (Kokoro fp32) + offline ASR (Whisper turbo/small int8, v0.13 质量优先取代 zipformer 流式).
  CRITICAL: every native→JS Float32Array transfer MUST pass `enableExternalBuffer: false`
  (Electron 21+ bans external array buffers in ALL process forms — M0 spike proved it;
  the flag is read by the native side, centralised in `speech-engine.ts` `synthesize()`).
- **tsx** runs `scripts/verify-*.mjs` deterministic tests · `scripts/live-test/*.mjs` for LLM behavior tests

## Architecture boundaries (critical)

```
Renderer (React) ──IPC──→ Main (Node.js) ──→ SQLite / LLM API / CDN
```

- **Renderer never touches DB, files, or API keys directly.** All cross-process calls go through `window.api.*` (contextBridge isolation in `src/preload/index.ts`).
- **IPC contract is `shared/types.ts` → `ApiExpose` interface.** Editing it = editing the protocol; both ends (preload + main handlers) must sync.
- **Channel naming: `domain:action`** (e.g. `course:list`, `soul:setActive`, `proposal:apply`, `thread:create`, `canvas:save`, `xp:getStatus`, `asset:listByNode`, `asset:getDataUrl`). Handlers in `src/main/ipc/index.ts`, grouped by domain.
- **Native context menu** (`src/main/context-menu.ts`): right-click copy text / copy+save images / editable roles. Registered in `index.ts` via `setupContextMenu(mainWindow)`.
- **LLM calls and API keys stay in main process.** CSP in `src/renderer/index.html` forbids renderer-side LLM endpoints; renderer only sees booleans for key presence (`agent:isReady`).
- **AI persistent-state mutations go through Proposal (Propose→Apply).** AI drafts state changes, human applies/rejects — never let AI write learner state directly (see `proposal-service.ts`).
- **Custom providers** (`custom_providers` table) bypass preset key settings — their API key is stored in the table row, resolved by `resolveLlm()` when `active_provider` starts with `custom-`.
- **Third runtime: serve (mobile/web).** `src/main/serve/server.ts` runs the SAME 106-handler table (`ipc/runtime.ts` `collectHandlers(deps)`) behind a WebSocket dispatcher — Electron's `ipcMain` and serve share one registry, zero drift. Protocol in `shared/ws-protocol.ts`; channel names ARE the IPC `domain:action` names. Renderer web mode: `src/renderer/lib/api-web.ts` (`installWebApi`) builds `window.api` from `shared/api-channels.ts` when preload is absent (`main.tsx` boot fork + token gate). Token auth (`dataDir/serve-token`, persisted), WS rejects with close 4001. Portable bundle via `scripts/build-mobile.mjs` (esbuild CJS, electron + pdf-inspector external, companion wasm/seed beside server.cjs).
- **Streaming is parts-based.** Main emits `chat:part` events with a `ChatStreamPart` discriminated union (text / reasoning / tool-start / tool-result / tool-error). Renderer accumulates them via a **pure** `accumulatePart` (no mutation — React 19 StrictMode double-invokes updaters).

## Three-pane layout (v0.5)

```
┌─────────────┬──────────────────────────┬──────────────────┐
│ MapRail     │ ThreadSwitcher (tabs)     │ NotebookPanel    │
│ (skill map, │ ───────────────────────   │ (康奈尔笔记本:    │
│  nodes =    │ ChatStream (AI parts)     │  讲解 / 笔记)     │
│  session    │ ───────────────────────   │ persisted canvas │
│  groups)    │ ChatComposer + commands   │ + user 画线笔记   │
└─────────────┴──────────────────────────┴──────────────────┘
```

- **Left (MapRail)**: Duolingo-style skill map. A node is a *session group*: clicking it filters the middle pane's threads by `focus_node_id`. Node states: locked / available / in_progress / mastered. Collapsible (`Ctrl+B`).
- **Middle (chat)**: `ThreadSwitcher` (Chrome-style horizontal tabs, one thread per tab) + `ChatStream` (parts rendering) + `ChatComposer` (input + 教学人设 soul 药丸 + starter prompts + 附件📎/粘贴/拖拽 + 底部工具栏:思考强度 · 上下文用量表 · 模型切换). `Ctrl+K` opens the command palette; `Ctrl+Tab` cycles threads.
- **Right (NotebookPanel)**: 康奈尔笔记法三区(讲解/笔记)+ **黑板 tab**(v0.12:对话最新重产物 concept_map/diagram/compare_table/code_walkthrough 的大画布,流式中出现新重产物自动切到该 tab,App `canvasArtifact`+`forceTab` 联动;画布=CanvasStage 纯 transform pan/zoom,contain 适屏自适应容器,缩放锚定手势中点,双击适屏↔100%,四产物 canvas 裸内容变体经 ArtifactRenderer variant 透传,放大弹窗同引擎)。讲解 tab 显示节点 markdown + 支持选区画线(`✏️ 加笔记`)+ 标题旁 🔊 整课朗读按钮(v0.13,切节点自动停)。笔记 tab 三区:🗺️理解区(AI 产物:概念图/对比表/流程图/代码讲解)、✏️笔记区(用户画线 user_note,带溯源跳转)、📝练习区(quiz + last_result 答题记录)。画线用 `highlightText.ts` 的文本搜索方案(不依赖 DOM offset 稳定性)。
- **Responsive tiers (v0.11, `lib/paneTiers.ts` + `useWindowTier`)**: T1 ≥1240 三栏共存;T2 920~1239 双栏(中栏+一侧,侧栏互斥——显示左则隐右,默认右侧);T3 <920 单栏(默认对话,对话流卡片模式:每 AI 回合一卡+scroll-snap 邻近吸附「一幕一屏」)+ 单行窄标题栏(51px:左 XP 紧凑数字 / 中居中分段切换器 课程/导师/黑板 / 右设置;三栏名即教室隐喻 i18n `pane.*`)+ 内容区水平滑屏切换(纯函数 swipeTarget,横向>60px 主导;data-noswipe 区域豁免)+ 左栏选球自动切到对话栏。拉宽自动弹回(进 T1 三栏全恢复,T3→T2 承接当前侧);窄化自动收。中栏宽 clamp(480,36vw,800);笔记本内容居中封顶 960;T3 地图全宽(物理岛按新墙宽自动重建);窗口 minWidth 560。
- **Focus lock**: while the AI is streaming, node/thread switching is blocked so the learner stays in one context. Do not remove this without an explicit off switch the user controls.
- **HMR rule**: renderer-only changes (CSS/TSX) auto-hot-reload via Vite — no restart needed. Main process or preload changes require `taskkill electron + npm run dev:electron`.

## Common commands

```bash
npm run dev:electron      # dev: vite dev server + electron window
npm run dev               # vite only (renderer debugging, HMR)
npm run build             # production build
npm run start             # build + launch electron
npm run dist              # build + electron-builder (produces .exe/.dmg/.AppImage)
npm run serve             # dev serve: esbuild server bundle only + serve dist/renderer (web 模式调试)
npm run build:mobile      # 便携包 dist/mobile/: server.cjs 单文件 + web 前端 + install-termux.sh(Termux 手机端)
node scripts/build-termux-voice.mjs  # Termux 语音引擎包(NDK 交叉编译,~12MB;CI termux-voice.yml 同源)

npm run verify:core       # 98 pure-Node/tsx logic test suites (incl. verify-serve: real bundle child process)


npm run self-test         # electron main DB-layer self-check → .self-test-result.json (headless)
npm run ui-test           # real-GUI verification (headless Electron, 41 DOM assertions incl. a11y + reactive i18n + cold-start gating + empty-start course gating (no auto-select, manual pick, delete→empty-state) + course search (tree nav + title filter + jump) + start-learning action-label bubble (no prompt leak) + seed bilingual 🌐 switcher + post-reveal choices + competence badges + due/interleave/dashboard + start-here cue + exam answering integrity (option display order matches grading, click correct text → 3/3, long prompt stays in viewport) + voice tiers (mic click→voice mode→hold→release→review/error panel→back to keyboard, 设置页语音按钮组(朗读 Edge/本地/自定义,听写 本地/自定义)+ whisper 模型下拉 + 讲解 🔊))
npm run lint              # oxlint
npm run shots             # capture README screenshots → docs/screenshots/ (headless window, temp DB, real .env LLM; GPU stays ON for capturePage)
npx tsc --noEmit                       # typecheck renderer
npx tsc -p tsconfig.electron.json --noEmit  # typecheck main/preload
npx tsx scripts/live-test/live-test-teaching.mjs    # LLM teaching behavior test (needs API key)
npx tsx scripts/live-test/live-test-exercise.mjs    # LLM exercise quality test
npx tsx scripts/live-test/live-test-summary.mjs     # LLM summary + Ollama test
npx tsx scripts/live-test/live-test-hook-opener.mjs # LLM "开始学习" hook 起手式形状测试(动机层:钩子+二选一猜测+不计分)
npx tsx scripts/live-test/live-test-import-pipeline.mjs  # full import → structure pipeline
```

Standard verification triad after code changes:
```bash
npm run verify:core && npx vite build && npm run self-test
```

## Release process

1. Fold `[Unreleased]` in `CHANGELOG.md` into a versioned section and bump `version` in `package.json` (one commit, `chore(release): vX.Y.Z`).
2. Push tag `vX.Y.Z` — `package.yml` (3-OS matrix) and `android-build.yml` both auto-trigger on `v*`. **Neither creates the Release**: their attach steps (`gh release upload`) fail with `release not found` until the Release object exists. So right after pushing the tag, run `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <file>` (notes drafted per human-writing + check_prose, English first). If the attach jobs already failed, `gh run rerun <id> --failed` after creating the release — builds are cached, only attach re-runs.
3. To backfill or rebuild installers on an **existing** release, dispatch `gh workflow run package.yml --ref main -f release_tag=vX.Y.Z` — the attach happens from CI. Don't download/upload big artifacts locally; the network path to GitHub is unreliable.
4. Release notes are bilingual (English first, then 简体中文), edited via `gh release edit vX.Y.Z --notes-file <file>`.
5. `ci.yml` runs oxlint + both typechecks + 98 verify suites + vite build + mobile bundle on every PR and push to main — never merge a red PR. `android-build.yml` (tag `v*` or dispatch with `release_tag`) builds `LookatStudy-launcher.apk` + `lookatstudy-mobile.zip` and attaches them to the Release.

Config already wired into the workflows (don't undo these): `electron-builder --publish never` (it auto-publishes inside GH Actions and dies hunting GH_TOKEN), `permissions: contents: write` (default GITHUB_TOKEN is read-only → 403 on release upload), mac `identity: null` (unsigned, arm64 only — first open needs right-click → Open), `author.email` in package.json (deb metadata requires it). Runners are Node 22; tsx breaks on Node 20, so the engines floor is 22.

## Path aliases

- `@shared/*` → `shared/*` (IPC types shared between main + renderer)
- `@renderer/*` → `src/renderer/*`

## Schema rules (single source of truth)

1. Edit **only** `src/main/db/schema.sql` (the truth).
2. Sync `src/main/db/schema.ts` (drizzle definitions, derived from sql).
3. `runMigrations()` in `src/main/db/index.ts` auto-reads schema.sql via `?raw` import — for new tables/columns use `CREATE TABLE IF NOT EXISTS` and the idempotent `addColumnIfMissing` helper.
4. Run `npm run verify:core` to confirm consistency.
5. When you add a table, **bump this list** below (don't make agents recount).

20 tables: `courses`, `content_nodes`, `exercises`, `progress`, `srs_items`,
`streaks`, `chat_sessions`, `settings`, `souls`, `proposals`, `friction_log`,
`memory`, `custom_providers`, `canvas_items`, `threads`, `chat_messages`,
`node_assets`, `content_node_translations`, `knowledge_component_mastery`,
`exam_attempts`.

## Key services

| Service | File | What it does |
|---------|------|-------------|
| Agent engine | `services/agent/agent-engine.ts` | `handleAgentChatThread` — thread-based context assembly, 6 display tools (`show_concept_map` / `generate_quiz` / `compare_table` / `draw_diagram` / `show_code_walkthrough` / `pose_guess`), `chat:part` emission, mastery-based teaching strategy; 注入近期 friction 卡点(`pure/friction-context.ts` buildFrictionContext)让 AI 看见学习者挣扎点;**AI 输出语言 = 界面语言**(i18n,非课程 🌐):渲染层穿 locale → `resolveOutputLang`(`@shared/locales`,纯函数)→ `agent/base-prompt.ts` 组装提示词(zh 默认逐字节不变,非 zh 英文指令点名工具参数也跟随);exercise/exam 出题同一链 |
| Soul (教学人设) | `services/souls/soul-service.ts` + `prompt-builder.ts` | 教学人设/persona CRUD + 激活;`buildSystemPrompt(db, BASE)` 把激活 soul 的 body 拼到 base prompt 后面注入 `streamText({system})`。3 内置 soul:精讲(direct)/引导(guide)/实战(practice)。**注:soul=persona,非过程性 playbook**;真 skill(多步任务固化)是未来独立模块。`active_soul=null` 时返回 base(等价关闭,无 flag 门控) |
| LLM client | `services/agent/llm-client.ts` | `resolveLlm` (3 protocols), `testLlmConnection` (主模型/视觉覆盖双路), `classifyLlmError` (auth/rate-limit/network), `fetchOpenRouterModels`, `fetchProviderModels`。openai-compatible 协议分家:官方 OpenAI 端点 `createOpenAI`(原生 providerOptions),第三方端点 `@ai-sdk/openai-compatible`(chat/completions 解析 `reasoning_content` → reasoning-delta,思考流进 UI;includeUsage 与官方包对齐) |
| LLM presets | `services/agent/llm-presets.ts` | 19 provider presets (GLM standard/CodingPlan, DeepSeek, Kimi, Qwen, SiliconCloud, OpenRouter, OpenAI, Anthropic, Google, Groq, Together, Mistral, xAI, Volcano, Baidu, MiniMax, Baichuan, StepFun) |
| Vision bridge | `services/agent/vision-bridge.ts` | 图像转译桥(v0.11,describe-then-chat):`visionRouting`(native/bridge/reject)是**三处喂图点共用的通道路由**——① 聊天附件注入 ② 课文图主动注入(方案 B,`flag_multimodal_import` + `isImageRelatedQuery` 门控)③ `attach_node_images` 工具。native=主模型直看 file-part;bridge=纯文本主模型 + 配了 `vision_provider_override`/`vision_model_override` → 视觉模型(`resolveVisionLlm`)转译成**不可信视觉证据**文字注入(工具则返回转译文本;reject 通道下工具不注册、方案 B 不喂图,修掉纯文本模型硬吃 file-part 的 400 坑);主模型永远是唯一大脑。学习者原话原样转发(任务导向转译);sha256(图+问题+语言) 进程内缓存(FIFO 200);watchdog 120s/5min;失败带指引报错绝不静默丢图;`parseDataUrl` 统一图源归一化(纯 base64)。`agent:getContextUsage` 的 `visionCapable` 桥感知 + `visionBridgeModel` 驱动输入框转译提示;设置页视觉覆盖不被 `flag_multimodal_import` 门控 |
| npm 分发(Termux 双包) | `build-termux-voice.mjs` 产 `lookatstudy-termux-voice` + `android-build.yml` 产 `lookatstudy-mobile`,**trusted publishing(OIDC 零 token**;需 npmjs.com 一次性配 pending publisher,npm≥11.5.1)发 npm,npmmirror 自动同步;`install-termux.sh` npm 镜像主源 + GitHub 链兜底 |
| Termux 语音引擎 | `scripts/build-termux-voice.mjs` + `.github/workflows/termux-voice.yml` + `install-termux.sh` 语音段(默认装,零交互) | 路 3 交付:NDK 交叉编译上游 C-API NAPI 绑定(链接 k2-fsa 官方 android 预编译 .so,零核心编译)→ `lookatstudy-termux-voice.tar.gz` 挂 Release;用户零编译,解压到 node_modules + 启动点 LD_LIBRARY_PATH 注入。关键配方:上游 src/*.cc 是指向 harmony-os 的软链(tar 解包要还原)、NDK 默认 --no-undefined 拦 NAPI 符号要 `-Wl,-z,undefs`、RUNPATH 打 $ORIGIN |
| Speech models | `services/speech/speech-model-manifest.ts` + `speech-model-service.ts` + `pure/speech-plan.ts` | 语音模型清单(单源事实:URL 实测)与下载器:ModelScope 逐文件主源(断点续跑=逐文件粒度)+ GitHub 归档代理链兜底(unbzip2-stream+tar-stream 流式解压);`.part`→rename 原子落盘;纯函数层(计划/路径安全/变体挑选/进度聚合)verify 直测。v0.13 条目:tts-kokoro(430MB)/ asr-whisper-turbo int8(1GB,推荐桌面)/ asr-whisper-small int8(360MB,轻量;fp32 兜底);旧 asr-zipformer 退役(盘上文件不删、清单不再列) |
| Speech engine | `services/speech/speech-engine.ts` | sherpa-onnx 懒加载持有者(进程内,无子进程)+ 纯配置构建器 + `synthesize()`(**enableExternalBuffer:false 唯一收口**,Electron 红线)。kokoro fp32 TTS(24kHz,句级缓存见 tts-cache)+ Whisper 离线 ASR(`OfflineRecognizer.decodeAsync` 非阻塞,按 模型目录+语言 缓存;turbo/small 前缀布局,int8 偏好) |
| TTS 朗读 | `services/speech/tts-service.ts` + `tts-tiers.ts` + `edge-tts-client.ts` + `azure-tts-client.ts` + `tts-cache.ts` | v0.15 档位:**edge 在线(默认,免费无 key,node-edge-tts→mp3;Windows 需 ipv4first DNS 调谐)** / local kokoro / custom-<id>(OpenAI 兼容 /audio/speech,`openai-tts-client.ts`,音色=tts_custom_voice 可空,测试=真实合成一句);azure 为旧库遗留仍解析(UI 无入口);edge 句级预取(深度 2)+ **失败自动落 local**(fellBackTo 回执),azure 失败即报错不静默降级;缓存键=sha256(engine\|voice\|speed\|sentence)(custom 档 engine=provider id、voice 段含模型)按容器分 .wav/.mp3;首次 edge 用回执 firstUse 驱动一次性在线披露;事件载荷加 mime。讲解 tab 标题旁 🔊 整课朗读(`NotebookPanel` useSpeech 实例 id=content-{nodeId},切节点即停,markdown 净化复用 normalizeSpeechText) |
| ASR 听写 | `services/speech/asr-service.ts` + `asr-tiers.ts` + `cloud-asr-client.ts` + `renderer/lib/useAsrInput.ts` + `silence-detector.ts` + `audio-trim.ts` + `shared/speech-wav.ts` + `components/VoicePanel.tsx` | v0.13 质量优先管线(流式退役):渲染层录完整段(全量缓冲+RMS 音量条)→ **无入声守卫(detector.hadSpeech()==false 不喂模型 → no-speech)** / 静音自动停(可关)/ 松开大按钮 → **首尾静音裁剪(audio-trim,治 Whisper 静音幻觉)** → 客户端 WAV 编码(shared/speech-wav,16kHz 单声道)→ 一次 `speech:asrTranscribe` 换全文。路由:**local=Whisper 离线(asr_local_model 指定 turbo/small,所选未就绪回退 turbo 优先;自带标点,decodeAsync 串行化防 CPU 互拖;zh 输出经 opencc-js 繁→简归一)** / custom-<id>(OpenAI 兼容 /audio/transcriptions,`openaiTranscribe` 通用化,groq=其固定参特例)/ groq、azure 为旧库遗留仍解析(UI 无入口)。v0.14 交互(飞书式):工具栏 🎤 点击切语音模式,整卡换「按住说话」大按钮(beginHold/endHold 立即起录,无 400ms 判定),录音/转录/复查浮层(VoicePanel 四视图)锚卡片上方;识别全文进**可编辑复查浮层**改完再发送(自成一条消息,不并草稿),「切回键盘」返回打字;auto-send 设置已废 |
| Threads | `services/thread-service.ts` | CRUD for `threads` + `chat_messages`; `findRecentThreadByNode`; thread is node-bound (`focus_node_id`)。`chat_messages.display_text`:按钮触发的消息气泡只显示短动作标签(完整提示词在 `content`,只给 LLM;手打输入 `display_text=null` 原样展示) |
| Canvas | `services/canvas-service.ts` | 康奈尔笔记本:AI 产物 + user_note 画线 + quiz 答题记录 (`canvas_items`);byZone 三区筛选(understand/note/practice);溯源字段(source_type/source_anchor) |
| Highlight | `lib/highlightText.ts` | 画线定位:getTextModel + 文本搜索(applyPersistentMarksByText)+ 跨节点包裹(wrapRangeWithMark)+ 闪烁(flashMark)。**不依赖 DOM offset**(ReactMarkdown 重渲染不稳定),用 indexOf 在纯文本上定位 |
| Course search | `components/CourseSearchPanel.tsx` + `lib/course-tree-filter.ts` | 课程搜索面板(MapRail 全栏 overlay):空查询=章节→课时树状导航(锁定行与地图球同规则 disabled),关键词=标题多词 AND 过滤 + 全文内容匹配(`search:content` 只留本课节点,防抖 250ms)。跳转=切 world + onJumpNode + 滚动定位到球。过滤/锁定计算是纯函数(verify-course-search.mjs) |
| Custom providers | `services/custom-provider-service.ts` | BYO user-defined provider rows; bypass preset settings, resolved by `custom-` prefix。v0.15 `kind` 分区(llm/vision/tts/asr,老行默认 llm):主模型区/主模型快切(ModelPicker)只列 llm,看图/语音各区只列自己的;`tts_engine`/`asr_engine` 取值可为 `custom-<id>`(active_provider 式) |
| Serve runtime | `src/main/serve/server.ts` + `serve/index.ts` | 手机/浏览器模式:同一 handler 表的 WS 分发 + 静态前端 + token 鉴权(4001 拒连);启动序与 Electron 主进程对齐(initDb→seed→souls→prefLang),CLI `--port/--data/--web` |
| Handler registry | `src/main/ipc/runtime.ts` + `ipc/index.ts` + `electron-wiring.ts` | `collectHandlers(deps)` 单表双接线(RuntimeDeps:emitter/dialog/dataDir/ui);Electron 走 ipcMain,serve 走 WS——改 handler 只动一处 |
| Web transport | `src/renderer/lib/api-web.ts` + `shared/api-channels.ts` + `ws-protocol.ts` | 浏览器版 window.api(WS req/res + event 帧,断线重连,4001 不重连);106 方法↔channel 映射自 preload 生成,verify-serve T5 守漂移 |
| Mobile bundle | `scripts/build-mobile.mjs` + `scripts/lib/build-server.mjs` + `scripts/install-termux.sh` | `dist/mobile/` 便携包:vite 前端 + esbuild server.cjs(外置 electron/pdf-inspector,companion sql-wasm.wasm/seed-course.json);install-termux.sh 是完整安装器(CN 时区 TUNA 镜像/apt-get、依赖按需检测、ghproxy 下载回退链、boot+bashrc 双自启、电池白名单+OEM 指引、~/lookatstudy 四常用脚本),随 Release 单独发布 |
| Context usage | `services/agent/context-usage.ts` + `shared/token-estimate.ts` | 输入框上下文表(v0.10):`agent:getContextUsage` 返回固定开销(系统提示/课文/学习者快照的启发式 token 估算)——装配抽 `agent-engine.assembleContextBlocks` 与实发同源不漂移;渲染层本地叠加对话历史+草稿(`estimateTokens` CJK 感知纯函数,窗口 = `resolveModelContextWindow` 统一解析:预设表 → 自定义 provider modelsJson 条目(设置页可编辑,OpenRouter 发现自动带回 context_length,其余家 /models 不含窗口需手填)→ null 诚实未知) |
| Chat attachments | `services/attachment-store.ts` + `pure/attachment-files.ts` + `shared/attachment-intake.ts` | 聊天附件(v0.10):image(≤5MB,≤4/条)落盘 `userData/attachments/` + 本轮 vision file-part 注入(engine 不受 multimodal flag/关键词门控);text(≤256KB)正文内联进 content(持久化+LLM 历史天然可见);文件名 uuid 守卫防穿越;thread 删除顺带清盘。渲染层 📎/粘贴/拖拽三入口,消息 parts 用 `attachment` part 渲染缩略图+灯箱 |
| Reasoning effort | `shared/reasoning-effort.ts` | 思考强度方言表(v0.10,存 `settings.reasoning_effort`:""自动/fast/deep):GLM→body.thinking.type、Qwen/SiliconCloud→enable_thinking(经 `llm-client.buildLanguageModel` 的 fetch 覆盖注入)、OpenAI→reasoningEffort、Anthropic/Google→providerOptions;不支持的家族(如 DeepSeek)芯片禁用+引擎降级 none,宁可不生效不瞎发参数。**家族嗅探必须传 hints**:UI 门控(supportsReasoningControl)与引擎调用点(reasoningPlanFor)都按 baseUrl/模型名嗅探 glm-codingplan 预设与 custom-*(2026-08-18 修:引擎调用点曾漏传 hints,fast 对它们静默失效——开了快速仍思考 9187 字);verify T6d 是源码级接线守卫 |
| Course generator | `services/course-generator.ts` | `generateCourseFromMarkdown` + `generateCourseFromRepoFiles` |
| Course structure | `services/course-structure-service.ts` | LLM-based course restructuring (two-phase: classify uncertain → group sections) + `generateLessonSummaries`(批量) + `generateLessonSummary`(单课懒生成:首点节点球一次调用同时落 summary+summary_en+knowledge_points——双语摘要+KC,新管线课程的 KC 唯一自动来源,字段齐备前可重试补齐) + `generateLessonSummaryEn`(历史节点英文摘要补齐,不动已有 KC)。**LLM 调用纪律与导入同源**:8 处调用全部走 `buildImportModel`+`generateTextWithTimeout`(fast 思考档+家族感知上限+活性看门狗)+ `extractJsonBlock(Any)` 解析硬化,禁止裸 `generateText`(verify-lesson-summary-kc T14 静态守卫) |
| Repo fetcher | `services/pure/repo-fetcher.ts` | CDN fetch + `detectRepoPattern` (course/well-organized/single-file/docs-rich/unsupported + awesome-list 检测) + `fetchRepoInventory` (Step1: 多入口 README + 多分支 + tree + file list) + `fetchFileOutlines` (Step3: H1/H2/H3 + chars + `bodyPreview` 正文前~300字摘录) + `extractOutlineWithCharCounts` + `extractBodyPreview`(纯函数:跳标题/围栏/符号行,链接留文字图片丢弃——Step4 语义分组依据) |
| Import plan | `services/import-job-service.ts` + `pure/import-plan.ts` + `import-plan-store.ts` | 导入编排器(**五种 spec** 共用一条 5 步路径:github/folder/url(智能链接,github 域名内部分流)/text(粘贴,epub 同构)/epub + plan 断点续跑):每步产物快照落盘断点续跑、同源再导自动复用(零 LLM)、漂移检测——github/folder 看路径集合(treeHash),url/text/epub 这些"改内容不改路径"的源看**内容哈希**(`computeContentHash`,epub 重打包不换身份、正文更新重走 AI,不走 bestEffort);虚拟文档源正文随快照落盘(`docCache`)——URL 失效/文件丢失也能续跑;课程包=github 快照文件直接分享(`import:resume`/`import:importPack`/`import:exportPack`,新 kind 不 packable);planId 标注包住 Steps 2-5;**全链路取消穿透**:fetchFn 收口注入 signal + httpsGet signal + 各网络循环取消检查,外层 try/finally 保证轮询清理;savePlan 落盘审计日志(写 lookatstudy-import.log) |
| Import pipeline | `services/import-pipeline.ts` | `executeImport` (Step5): **两阶段**——拉正文+图片内联(可取消 `shouldAbort`,零写库) → 落库(无 await 同步段一次写完,无半成品窗口,意外失败清理残留) → 翻译落库(显式配对优先,多布局 pathResolver 兜底) → 验证。后台 job 模型: `import:localFolder`/`import:github` 即返 jobId, `import:done`/`import:cancel` 事件。通过 `ContentSource` 抽象不关心来源 |
| Import LLM | `services/import-llm-service.ts` | `classifyFileRoles` (Step2: LLM 文件角色 original/practice/**translation**(lang+translates 显式配对) + sourceLang + 翻译布局检测 + `excludeSuffixTranslations` 规则分流) + `generateTextWithTimeout`(streamText 活性看门狗:无输出 120s 判死/硬上限 20min,流在动不杀,abort 真取消请求;`pure/stream-watchdog.ts`) + `designCourseStructure` (Step4: section/lesson/world + 长文件拆分 + attachImages 关联,prompt 每文件带 bodyPreview 摘录;`designSectionsResilient` 截断二分自愈——输出撞 provider 上限被截半个 JSON 时批拆半重试,单文件仍败按 h1/文件名兜底一课,一批失败不炸整个 job;网络/看门狗错误不重试原样上抛) + `extractJsonBlock`/`extractJsonBlockAny`(字符串感知平衡块抽取,对象/数组泛化,JSON 前后带废话救回——懒生成层同款复用) |
| Content source | `services/content-source.ts` | `ContentSource` 接口 + `GithubContentSource` (CDN) + `LocalContentSource` (磁盘) + `MemoryContentSource` (url/文本/epub 的内存虚拟文件;图片 null——绝对 URL 在 inlineImages 已透传) — 统一 executeImport 的文件/图片获取 |
| URL import | `services/url-import-service.ts` + `pure/url-route.ts` + `pure/html-article.ts` + `pure/text-chunk.ts` | 智能链接导入:`routeImportUrl` 四分流(github/arXiv(新式+旧式 ID)/article/video(B站 BV/av/分P/b23.tv 短链 → bilibili 源;youtube/youtu.be → ytdlp 源,导入 job 内二次分流));`extractArticle` = linkedom DOM + @mozilla/readability 正文抽取 + turndown 转 markdown(纯 JS 零原生;标题保留、img 相对地址绝对化、非文章页诚实返回 null);`fetchArxivMarkdown` = abs 页尽力取标题 + PDF 下载(`downloadToBuffer`)走 `parsePdfText`(扫描版报错不硬吃);`text-chunk.ts` = 无标题长文的句子边界预分段(粘贴/arXiv/(M3)转写共用,`prepareSingleDoc`:≥3 个 H2 或 ≤8000 字整体单文件,否则分段) |
| Video import | `services/video-import-service.ts` + `pure/bilibili-wbi.ts` + `pure/subtitle-parse.ts` | 视频链接导入(虚拟源 kind=video,身份=归一化URL):**B站直连** = wbi 签名(`bilibili-wbi.ts`:nav 取 img/sub_key + MIXIN_KEY_ENC_TAB 重排 + MD5 w_rid,免登录)+ view 取 cid/标题/分P + playurl DASH 最低码率音轨下载;**YouTube/抖音/千站** = yt-dlp 检测已装(PATH 探测)+**字幕优先**(`--write-auto-subs` → vtt/srt 经 `subtitle-parse.ts` 剥时间轴/滚动去重成文本,零转写零模型),无字幕才 `-f bestaudio` 下载;未装 yt-dlp 给平台安装指引文案。音频解码走 audio-file-decode(fMP4 兜底见下行);docCache 随快照落盘断点续跑。live-test 真实B站全链(Rick Astley MV: 拉流→fMP4→ADTS→解码 212s) |
| Audio import | `services/speech/audio-file-decode.ts` + `speech/asr-service.ts#transcribePcmChunked` + `speech/pure/audio-segments.ts` + `pure/fmp4-to-adts.ts` | 本地音频/视频转写成课:audio-decode(纯 JS/WASM,mp3/m4a/flac/aac/ogg/opus;wav 走自家 decodeWavPcm16)→ 16k 单声道 PCM → `transcribePcmChunked` 分段转录(60s/段,单段入 runLocal 队列与听写公平交错,段间响应取消,进度回调);缺模型由导入层 ensureSpeechModel 自动下载;转写稿走 text-chunk 分段,多文件=多集;身份=各文件字节哈希聚合(verify-audio-import 注入 transcribeAudioFile 桩测编排,本地引擎不进 verify)。视频容器 mp4/m4v/mov 借 AAC 路径取音轨;**fragmented MP4(B站 DASH m4s 等)audio-decode 解不了 → `fmp4-to-adts.ts` 纯函数转封装**(esds 全局扫 ASC + tfhd/trun 按 ISO 14496-12 fullbox 解样本表,逐帧包 7 字节 ADTS 头喂裸 AAC 流,直解失败自动回退);mkv/webm 诚实报错指引转 mp4 |
| EPUB parser | `lib/epub-parser.ts` | fflate 手解 zip + container.xml→OPF→manifest/spine/toc(EPUB3 nav 与 EPUB2 ncx 都认)+ `htmlToMarkdown` 每章转 markdown;每章一虚拟文件(`chapters/nn-标题.md`,`# 标题` 开头);officeparser 的 epub AST 丢章节边界(spike 实测)故不用;`parseEpubFlat` 供文件夹路径压平 |
| Code parser | `services/pure/code-parser.ts` | 代码文件(.py/.js/.go 等 30+ 语言) → markdown: docstring/注释块提取为正文 + 代码体围栏包裹。纯函数 |
| Translation layout | `services/pure/translation-layout.ts` | `detectTranslationLayout`(tree) — 自动检测翻译约定: microsoft(translations/{lang}/) / parallel({lang}/) / suffix({file}.{lang}.md|.txt|.html)。返回 pathResolver；`excludeSuffixTranslations`(规则分流成对双语,孤儿保守留原文) + `resolveSuffixTranslationPath`(剥原文自带语言后缀,与落库共用单一实现) |
| Local scanner | `services/pure/local-folder-scanner.ts` | `scanFolder` (递归扫文档格式含 .epub(`parseEpubFlat` 压平,章标题降 H2 给 Step4 拆课) + 30+ 代码格式; `dedupByLang` **同语言内部去重,双语配对保留**——分流交分类层,不再"中文优先"吞英文原稿) + `buildLocalInventory` (本地清点: docs + images + translations + README + fullTree + standaloneImages) |
| File classifier | `services/pure/file-classifier.ts` | Rule-based `classifyFile` — high-confidence noise filter (translations/notebook/lab/example/section-intro/meta) + uncertain flag for LLM |
| Exercise | `services/exercise-service.ts` | AI exercise generation (mcq/fill_blank/true_false) + grading |
| Exam | `services/exam-service.ts` + `exam-generation-store.ts` | 章节考试 v2:KC 分批后台出题(真实进度,`exam:status` 事件)+ `regenerateExam` 重新出题(删旧题/在飞 no-op/悬挂判死/历史星数保留;判分快照 prompt/options 让历史回顾自包含)+ attempt 档案(`exam_attempts`,逐题增量持久化/悬挂自动判死/terminated 未答=错);`shared/exam-logic.ts` 纯函数(题量 clamp(ceil(KC×1.5),5,15)/每题限时 60/90s/attemptId 种子重排题序+选项序);不回写 BKT |
| Dashboard | `services/dashboard-service.ts` | `getDashboard` — section mastery, metrics |
| Progress | `services/progress-service.ts` | DB-injected progress read/write (headless-testable) |
| Per-KC BKT | `services/kc-service.ts` | Per-Knowledge-Component BKT: `getKnowledgePoints`/`ensureKcRows`/`updateKcMastery`/`computeAggregateMastery`(min)/`floorAllKcMastery`。课级 mastery=min(各 KC)；防假毕业 |
| Memory | `services/memory-service.ts` | 学习者模型(定性层,补 BKT 定量 + friction 原始事件之缺)。`remember(db,input,merge,courseId)` agent 实时手动记(注入式 merge,生产 `defaultLlmMerge`);`consolidate(db,window,fn)` **记忆固化**——系统级兜底,从原始数据(对话/friction/答题)一次 LLM 提炼+合并进全三类(注入式 `defaultLlmConsolidate`,测试 stub),不靠 agent 自觉;`gatherConsolidationWindow(db,{courseId})` 采集窗口;`getLearnerMemory(db,nodeId,courseId)` 拼块注入。按 `(category,nodeId,courseId)` 槽位 upsert。**课程隔离**:friction_pattern 带 course_id、global 跨课程、node 靠 node_id。flag `memory_system` 门控(默认 off)。**触发**:里程碑(节点**首次** mastered=拿皇冠,quiz:recordAnswer + proposal:apply 两处都做过渡检测 `!wasMastered`,一节点只触发一次)fire-and-forget + on-demand `consolidate:run` IPC。**watermark 增量**:`getConsolidationWatermark/setConsolidationWatermark`(settings),gather 传 `since` 只采上次水位之后的新数据(不重复处理历史) |
| Learner model | `services/learner-model-service.ts` | **读投影**(CQRS):`buildLearnerSnapshot(db,nodeId,{includeMemory,courseId})` 把散落的三处学习者状态注入(掌握度+教学策略 in 原 nodeContext + buildFrictionContext + memory)收成一个"【学习者当前状态】"块。`getTeachingStrategy(mastery)`(4 档,从 agent-engine 移入)。**不合并底层 store**(BKT/friction/memory 是不同数据类型,合并降正交)——只在读侧投影;`includeMemory` 显式传入(解耦 flag 机制) |
| Search | `services/search-service.ts` | RAG `LIKE`-fallback search |
| XP | `services/xp-service.ts` | Daily XP tracking (correct+10/wrong+1/mastered+50) |
| SRS | `services/srs.ts` | SM-2 spaced repetition; `recordReviewDb`(pure/srs-db.ts, db 注入)与 BKT 闭环——答题/复习双向同步(答对推迟、答错近期重练) |
| Streak | `services/streak.ts` | Streak + freeze transitions |
| Export | `services/export-service.ts` | JSON + Markdown learning report export |
| Starter prompts | `services/starter-prompts-service.ts` | 4 巩固选择(深入/举个例子/考考我/我没太懂),hook 揭晓后、对话开始后才出现(语境前零决策税);原 ? 卡点表单折进「我没太懂」(发消息+记 friction);`frictionCategory` 字段标记;每个带稳定 `key`，渲染层按界面语言查 `starter.{key}.*` 字典覆盖 label/hint/message |
| Multimodal assets | `services/asset-service.ts` | `node_assets` CRUD — 图片/PDF 渲染图元数据(二进制存 `userData/assets/{courseId}/`,不入 DB blob);`listAssetsByNode` / `getAssetDataUrl` (base64) |
| PDF text | `lib/pdf-text.ts` | `parsePdfText(buf)` — PDF **文本**提取路由:优先 `@firecrawl/pdf-inspector`(预编译 napi-rs, layout-aware markdown — 标题层级 + 多栏阅读顺序), 失败/平台不支持(Intel Mac/WinARM 无预编译)回退 `pdf-parse`;`LOOKATSTUDY_NO_PDF_INSPECTOR=1` 强制回退。**已知局限:不解码数学公式**(文本层赛道本质局限, STEM 留给未来 vision 路径) |
| PDF renderer | `lib/pdf-renderer.ts` | pdfjs-dist 封装:**内嵌图片提取**(纯 JS PNG 编码,无 canvas 依赖);`classifyPdfPageByTextRatio` 判断纯文字/纯图片/混合。文字提取已移至 `lib/pdf-text.ts`,本文件现仅图片 |
| PPTX parser | `lib/pptx-parser.ts` | officeparser AST → `{markdown, images}`;每 slide 一个 `##`(讲者备注非标题随 slide), 现有导入管线自动每 slide 一节课。内嵌图片复用 pdf_page source(避 schema CHECK 迁移)。仅 `.pptx` |
| Notebook parser | `services/pure/notebook-parser.ts` | Jupyter `.ipynb` JSON 解析:markdown cell 原文 + code cell → ```代码块 + output 图片提取(base64);`inferLanguage` 从 kernelspec 推断语言 |
| RST parser | `services/pure/rst-parser.ts` | reStructuredText → markdown:标题下划线/code-block/image/note admonition/行内角色 |
| RMD parser | `services/pure/rmd-parser.ts` | R Markdown → markdown:剥 YAML front matter + ```{r} chunk 归一化 |
| Org parser | `services/pure/org-parser.ts` | Org-mode → markdown:标题/SRC 块/链接/粗体斜体/元数据剥除 |
| AsciiDoc parser | `services/pure/adoc-parser.ts` | AsciiDoc → markdown:标题/source 块/image/link/粗体斜体 |
| Translation | `services/translation-service.ts` | `content_node_translations` CRUD — persist/read per-locale title/content; `getCourseLanguages`; `getCourseTitleTranslations` |
| Language pref | `services/lang-pref.ts` | `pref_lang` setting read/write + system locale detection + `resolveImportLang` (pref + sourceLang → import language) |
| i18n | `src/renderer/lib/i18n.ts` | zh-CN / en dictionary + reactive `useLang()` (useSyncExternalStore, no reload on switch) + `translate()` for non-component contexts |
| Celebration bus | `src/renderer/lib/celebration.ts` + `components/CelebrationLayer.tsx` | `celebrate(kind)` event bus + 根级 canvas 粒子层;7 高光时刻统一渲染(correct/wrong/unlock/mastery/streak/energy-full/exam-pass);reduced-motion a11y 双轨(默认粒子爆发,reduced 静态图标淡入) |
| State emitter | `src/main/lib/state-emitter.ts` | main→renderer `state:changed` 推送(xp/streak/mastery 变化);修能量条运行时不动 bug;service 内 fire-and-forget,测试时 noop(同 markDirty 模式) |
| Concept map layout | `src/renderer/lib/conceptmap-layout.ts` + `components/artifacts/ConceptMapArtifact.tsx` | 概念图径向布局纯函数(v0.12,替代 dagre):最高度节点居中 hub(accent 两级视觉)+ BFS 扇区角度分配 + 逐环弦长约束(同环等距零重叠)+ 贝塞尔边框缘起止 + 边标签胶囊 CJK 感知估宽;`wrapLabel` 两行包裹防截断;孤儿节点兜底挂根;verify-conceptmap-layout 守重叠/居中/确定性 |
| Mermaid theming | `src/renderer/lib/lazy-mermaid.ts` | mermaid `theme:"base"` + `themeVariables` 实时读 CSS 设计 token(暗/亮自适应);theme-changed 清初始化缓存,MermaidArtifact 监听同事件重渲染在场图卡 |
| Map physics | `src/renderer/lib/mapPhysics.ts` | 左栏物理地图(Matter.js 0.19):真实重力场+球浮力(彩旗串悬垂链);绳=粒子链(受拉弹力/松弛垂坠);天气驱动环境(风/阵风/雨滴冲击/雪载增重/雾阻尼,weatherPhysFor);顺序=绳链(路牌绳结→球→…→紫考试球,更沉;考试球另系一条绳到下段路牌上缘,整图成连续链,挂点 x 按 section id 确定性随机);无弹簧回位自由摆布;锁定球=static 刚体(不可拖,解锁重建岛"苏醒");碰撞=squash+脉冲环(命中点用碰撞支撑点)+天气耦合;视口外岛冻结;reduced-motion 回退静态 |
| Motion infra | `src/renderer/lib/motion-presets.ts` + `usePrefersReducedMotion.ts` | `motion` 弹簧/stagger/enter-exit 预设 + a11y reduced-motion 响应式 hook(useSyncExternalStore on matchMedia) |

Key renderer hooks: `useChatStream` (parts-based chat, pure `accumulatePart`),
`useThreads` (node-bound thread CRUD + soft-delete undo), `useCanvas` (canvas
item CRUD), `useFontSize` (3-tier A-/A+), `useLang` (reactive i18n subscription),
`useFocusTrap` (drawer/modal focus-trap + restore for a11y),
`usePrefersReducedMotion` (a11y 双轨:响应式检测系统减少动效偏好,所有动效分支入口)。

## Verification discipline

- **Tests live in `scripts/verify-*.mjs`** (97 suites) — run via `tsx`, import real TS source.
- **Live tests in `scripts/live-test/`** — call real LLM, need API key, gate with `Z_AI_API_KEY` env or opencode config. `readApiKey` is unified in `_load-env.mjs`; `verify-live-test-smoke.mjs` does static checks (no key needed) to catch path/import rot.
- **Closed-loop required:** after writing a feature + its test, prove the test catches regressions by temporarily breaking the source.
- **Adversarial testing:** test edge cases (empty/NaN/huge/special-char inputs) — see `verify-xp.mjs` and `verify-export.mjs` for patterns.
- **Tests that import `schema.sql?raw`**: tsx can't resolve `?raw` — services that transitively import schema via `srs.ts` must use static imports in production, but the import chain must not reach `schema.ts` from verify scripts that don't use the DB.
- **React 19 StrictMode double-invokes state updaters.** Any accumulator over a stream must be a pure function (return new arrays/objects, never `x += y` mutation). `verify-stream-parts.mjs` has the T1b regression test — keep it.

## Design system

- **impeccable skill** is the design system authority. `PRODUCT.md` defines the register (**Playful Product**), color strategy (**Full Palette**: brand=progress / accent=interact / gold=mastery / warning=review / neutral), and key surfaces.
- **CSS tokens** in `src/renderer/index.css`: `btn-3d-*` (3D push-down buttons), `lesson-bubble-*` (4-state 3D bubbles), `surface-card`, elevation tokens (`shadow-elevated/card/pop` + `shadow-accent-soft/brand-soft`), animations (`bubble-pulse`, `streak-flame`, `typing-dot`, `msg-enter`, `toast-enter/exit`, `confirm-enter`).
- **Pane separation = surface depth tiers, no dividers** (v0.6). `bg-surface-rail` (left, deepest) / `bg-surface-0` (modals) / `bg-surface-1` (chat) / `bg-surface-2` (notebook, brightest). L step 0.04+ (Weber-Fechner: smaller is invisible on dark). Never add `border-r`/`border-l` between panes — adjust the L values instead. See PRODUCT.md "Pane separation".
- **6-tier semantic font scale** (v0.7): `text-caption/label/body/lead/title/hero`, all rem. Driven by `useFontSize` (html font-size 16/17/18px, A-/A+ in header). **Banned: `text-[10px]`, `text-[11px]`, `text-xs`** (0 remaining). Pick the semantic tier by role. See PRODUCT.md "6-tier semantic font scale".
- **Component primitives**: `ConfirmCard` (inline confirm, replaces ALL `confirm()` — never use native), `Toast` with `severity` prop (success/error/warning/info), `GlobalTooltip` (any `data-tooltip` element; desktop hover follows cursor, touch = long-press 500ms per Material spec; both viewport-clamped).
- **Button vocabulary**: `btn-3d-brand` = primary action everywhere (`btn-3d-blue` removed as orphan). `btn-3d-neutral` = secondary. `btn-icon-3d-brand`/`-warning` = circular 3D icon buttons (send/stop). Don't reintroduce raw `bg-brand`/`bg-neutral-200` buttons.
- **Brand colors** (Tailwind config): brand `#58cc02` (green), accent `#1cb0f6` (blue), gold `#ffc800`, warning `#ff4b4b` → orange `#ff7a00`.
- **Iconography**: unified on `lucide-react`. Emoji is reserved for skill-tree nodes and empty-state CTA cards only — do not reintroduce emoji in chrome, buttons, or copy. Tool-call status uses lucide `Wrench`/`XCircle`.
- **Theme**: **dual** (auto/light/dark) via `useTheme`. Dark default. Left rail (MapRail) locks dark via `map-rail-scope` (gamified scene, doesn't switch); middle/right panes + modals switch. Use ink/surface tokens for text/bg (not raw `neutral-X dark:neutral-Y` dual-writes).
- **i18n**: all user-facing strings use `translate("key")` from `lib/i18n.ts`.

## Gotchas (details in `dev-docs/BUILD-NOTES.md`)

1. **Main process is CJS.** Use the global `__dirname` directly — do **not** use `fileURLToPath(import.meta.url)` (breaks under vite-plugin-electron). Root `package.json` intentionally has no `"type": "module"`.
2. **vite-plugin-electron outDir must be absolute.** `vite.config.ts` sets `root: "src/renderer"`, so relative outDir resolves wrong. Always use `resolve(__dirname, "...")`.
3. **vite root must be absolute** (`resolve(__dirname, "src/renderer")`) — relative path causes `Failed to load /main.tsx` on Windows dual-drive mapping.
4. **GPU black screen on Windows.** `app.disableHardwareAcceleration()` in `src/main/index.ts` — required, not optional.
5. **vite must bind all interfaces on Windows.** `server: { host: true }` in `vite.config.ts` — otherwise vite binds `[::1]` and `wait-on` polling `127.0.0.1` never succeeds.
6. **sql.js is in-memory.** Mutations must call `markDirty()` (debounced 500ms save); `flushDb()` runs on `before-quit`. `sql.js` / `drizzle-orm/sql-js` / `electron` are rollup `external`.
7. **sql.js WASM lacks fts5 module.** RAG uses `LIKE` fallback, not FTS5.
8. **No native module compilation.** If a dep fails to build, switch to pure-JS.
9. **Electron stderr unreliable in headless.** Use `--self-test` / `--ui-test` and read JSON result files.
10. **HMR**: renderer changes (CSS/TSX) auto-reload. Main/preload changes need full restart.
11. **Seed versioning**: `SEED_VERSION` in `seed.ts` — bump to trigger seed course rebuild. 种子课程是 **LookatStudy 使用指南**(6 章 18 课，**中英双语**——原文 zh-CN + 内置 30 条 en 翻译，🌐 切换器开箱即可演示；内置为静态 `src/main/assets/seed-course.json`，离线、无网络、无 LLM，启动瞬时加载)。内容源码在 `scripts/build-guide-seed.mjs`(课程定义内联在脚本里)。要刷新:跑 `npx tsx scripts/build-guide-seed.mjs` 再 bump `SEED_VERSION`。灌入核心在 `seed-apply.ts`(db 注入式，verify-seed-bilingual.mjs 直测——seed.ts 引 db/index 的 `?raw` 链 tsx 进不去)。Never delete the DB to re-seed; it wipes custom providers.

## Docs to read before sensitive changes

**User-facing docs (tracked, at root):**
- `README.md` — project intro, install, quickstart
- `CHANGELOG.md` — what shipped when; the source of truth for "is feature X in?"
- `PRODUCT.md` — design system definition (register, color strategy, surfaces)
- `VERIFICATION.md` — red lines + supervisor-judge protocol

**Dev-process docs (gitignored, in `dev-docs/` — kept locally only):**
- `dev-docs/ARCHITECTURE.md` — design (Agent engine + Soul system + Propose/Apply + BKT + RAG)
- `dev-docs/ROADMAP.md` — milestone roadmap
- `dev-docs/BUILD-NOTES.md` — known environment/build pitfalls
- `dev-docs/DESIGN-PLAN-v0.2.md` / `v0.3.md` / `v0.4-threads.md` — historical design plans. Read for intent, not current code state; the code has moved on.

## Project rules (repo hygiene)

These are the conventions every contributor (human or agent) follows. Treat
them as load-bearing, not optional.

### Directory layout

```
/                       user-facing docs only: README, AGENTS, PRODUCT, CHANGELOG, VERIFICATION,
                        LICENSE, CONTRIBUTING
/.github/workflows/     CI (ci.yml: lint+typecheck+verify:core+vite build+mobile bundle) + packaging
                        (package.yml: win/mac/linux matrix, android-build.yml: launcher APK + mobile zip,
                         workflow_dispatch or v* tag → Release)
/docs/                  user-facing assets (screenshots/ embedded by the READMEs; regenerate via npm run shots)
/dev-docs/              ★ gitignored ★ dev-process docs: ARCHITECTURE, BUILD-NOTES, ROADMAP,
                        DESIGN-PLAN-*.md — kept locally, NOT committed
/scripts/verify-*.mjs   deterministic test suites (tsx + node:assert)
/scripts/live-test/     LLM behavior tests (need API key)
/src/main/              Electron main process (CJS) — DB, services, IPC handlers
/src/preload/           contextBridge — the only renderer↔main path
/src/renderer/          React UI — never touches DB/files/keys directly
/shared/                types + shared channel/WS protocol shared across main + renderer
/android/               LookatStudy 手机引导器 APK(Termux 安装 + 一键一行安装 + 常用操作命令卡片
                        + Custom Tab;gradle 工程,termux.apk 构建时 fetch 不入库;见 android/README.md)
```

**The rule, stated once:** `docs/` (when it exists) and the root `.md` files are
the public face — what a user reads on GitHub. Everything about *how this is
built* (architecture decisions, build pitfalls, milestone planning, historical
design plans) lives in `dev-docs/` and is gitignored. If a doc would embarrass
you in a public release notes draft, it belongs in `dev-docs/`.

### CHANGELOG discipline

- **`CHANGELOG.md` is the source of truth for "what shipped when".** AGENTS.md
  describes the *current* system; CHANGELOG describes *history*. Update both
  when the system changes.
- Every user- or developer-visible change goes under `[Unreleased]` *before* the
  PR/commit lands, grouped under `Added` / `Changed` / `Removed` / `Fixed` /
  `Security`. Move it to a versioned section at release time.
- One bullet = one change. Fold pure-refactor / build-glue commits into a single
  internal line; do not pollute the log with them.
- Reference design docs when they exist: `(see dev-docs/DESIGN-PLAN-v0.2.md)`.

### Git hygiene

- **Commit messages** follow Conventional Commits (`feat:`, `fix:`, `chore:`,
  `docs:`, `polish:`, `test:`). Scope is encouraged: `fix(chatstream): …`.
  Imperative mood, lowercase first letter after the type, no trailing period.
- **Don't commit generated artifacts.** `.self-test-result.json`,
  `.ui-test-result.json`, `ui-screenshot.png`, `dist/`, `dist-electron/` are
  gitignored — leave them ignored.
- **Don't commit local-only files.** `.zcode/` (agent working state),
  `.zcode-reference/` (research notes referencing external projects),
  `dev-docs/` (architecture/build/roadmap/historical design plans), and
  `memory/` (per-developer agent memory) are gitignored. They are not project
  content and must never appear in a public release.
- **Open a worktree (not just a branch) before coding on any iteration.** The
  maintainer iterates on **multiple features in parallel sessions**. A bare
  `git checkout -b` is *not* enough isolation: all sessions share one working
  directory, so when session B checks out its branch it silently carries session
  A's uncommitted changes along — they drift onto the wrong branch. (This
  actually happened: soul-rename work done on `feat/soul-rename` got carried onto
  another session's `feature/ui-polish-token-a11y` when the branch was switched
  mid-session.) A **worktree** gives each branch its own working directory, so
  concurrent sessions never trample each other's tree. So: at the **start** of
  each iteration — `git worktree add -b feat/xxx ../LookatStudy-xxx` (sibling dir
  convention), `npm install` in it (a worktree has its own `node_modules`),
  *then* code. Trivial one-line fixes can go straight to `main`. If work already
  happened on `main` (you forgot), don't retroactively branch — commit to `main`
  and worktree-first next time.
- **`main` is merge-only — never iterate a feature on it.** The primary worktree
  (the repo dir itself) sits on `main`; it's where you merge feature branches in
  (`--no-ff`), not where you code them. Doing feature work directly on `main`
  defeats the whole point of the worktree rule (and `git worktree add`-ing a
  second tree for `main` is rejected by git anyway — `main` is already checked
  out in the primary worktree). Each iteration = one fresh branch + one worktree;
  don't pile features onto one branch or reuse an already-merged branch. Trivial
  one-line fixes are the sole exception — those may land on `main` directly.
- **Features ship on a branch and merge to `main` with `--no-ff`.** The merge
  commit summarizes the feature; the branch holds the granular history.
- **Never rewrite public history.** `main` is shared; if a commit is wrong,
  forward-fix it (`fix: …`) rather than force-pushing.

### Docs hygiene

- **Two tiers, strictly separated.**
  - **User-facing (tracked):** root `README/AGENTS/PRODUCT/CHANGELOG/VERIFICATION`
    + (optionally) `docs/` for anything a user reads. These ship in the public repo.
  - **Dev-process (gitignored, `dev-docs/`):** architecture decisions, build
    pitfalls, milestone roadmaps, historical design plans. Local only.
- **Root stays small.** Only README, AGENTS, PRODUCT, CHANGELOG, VERIFICATION,
  LICENSE, CONTRIBUTING, and build-config files live at root. Dev-process material goes in `dev-docs/`.
- **Historical plans stay historical.** When a design plan stops describing
  current code, leave it as-is in `dev-docs/` — don't quietly update it to match,
  that erases the decision trail.
- **AGENTS.md stays in sync with reality.** If you add a table, a service, a
  component, or a test suite, update the corresponding count/list here in the
  same PR. Stale AGENTS.md misleads the next agent that reads it.
