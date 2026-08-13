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
Supports 10 document formats (.md/.ipynb/.rst/.Rmd/.org/.adoc/.pdf/.pptx/.html/.txt) +
30+ code file types (.py/.js/.ts/.go/.rs/.java/.c/.cpp/.rb/.sh/etc) +
multimodal image import + AI vision.
Electron app, local SQLite (sql.js), BYO LLM API key. Light/dark theme.

## Tech stack (locked — do not change)

- **TypeScript** full-stack · **React 19 + Vite 6 + Tailwind v3** (renderer)
- **Electron 33** main process — **CJS output, not ESM** (see gotchas)
- **Vercel AI SDK v5** (`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/google`) · **zod v3** for tool schemas
- **sql.js** (SQLite compiled to WASM, pure JS) + **Drizzle ORM** — *not* better-sqlite3
- **pdfjs-dist** (PDF rendering, pure WASM/JS) — for PDF text + image extraction, no canvas dependency
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
- **Middle (chat)**: `ThreadSwitcher` (Chrome-style horizontal tabs, one thread per tab) + `ChatStream` (parts rendering) + `ChatComposer` (input + font size + 教学人设 soul 药丸 + starter prompts). `Ctrl+K` opens the command palette; `Ctrl+Tab` cycles threads.
- **Right (NotebookPanel)**: 康奈尔笔记法三区(讲解/笔记)。讲解 tab 显示节点 markdown + 支持选区画线(`✏️ 加笔记`)。笔记 tab 三区:🗺️理解区(AI 产物:概念图/对比表/流程图/代码讲解)、✏️笔记区(用户画线 user_note,带溯源跳转)、📝练习区(quiz + last_result 答题记录)。画线用 `highlightText.ts` 的文本搜索方案(不依赖 DOM offset 稳定性)。
- **Focus lock**: while the AI is streaming, node/thread switching is blocked so the learner stays in one context. Do not remove this without an explicit off switch the user controls.
- **HMR rule**: renderer-only changes (CSS/TSX) auto-hot-reload via Vite — no restart needed. Main process or preload changes require `taskkill electron + npm run dev:electron`.

## Common commands

```bash
npm run dev:electron      # dev: vite dev server + electron window
npm run dev               # vite only (renderer debugging, HMR)
npm run build             # production build
npm run start             # build + launch electron
npm run dist              # build + electron-builder (produces .exe/.dmg/.AppImage)
npm run verify:core       # 52 pure-Node/tsx logic test suites
npm run self-test         # electron main DB-layer self-check → .self-test-result.json (headless)
npm run ui-test           # real-GUI verification (headless Electron, 29 DOM assertions incl. a11y + reactive i18n + cold-start gating + post-reveal choices + competence badges + due/interleave/dashboard + start-here cue)
npm run lint              # oxlint
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

## Path aliases

- `@shared/*` → `shared/*` (IPC types shared between main + renderer)
- `@renderer/*` → `src/renderer/*`

## Schema rules (single source of truth)

1. Edit **only** `src/main/db/schema.sql` (the truth).
2. Sync `src/main/db/schema.ts` (drizzle definitions, derived from sql).
3. `runMigrations()` in `src/main/db/index.ts` auto-reads schema.sql via `?raw` import — for new tables/columns use `CREATE TABLE IF NOT EXISTS` and the idempotent `addColumnIfMissing` helper.
4. Run `npm run verify:core` to confirm consistency.
5. When you add a table, **bump this list** below (don't make agents recount).

18 tables: `courses`, `content_nodes`, `exercises`, `progress`, `srs_items`,
`streaks`, `chat_sessions`, `settings`, `souls`, `proposals`, `friction_log`,
`memory`, `custom_providers`, `canvas_items`, `threads`, `chat_messages`,
`node_assets`, `content_node_translations`.

## Key services

| Service | File | What it does |
|---------|------|-------------|
| Agent engine | `services/agent/agent-engine.ts` | `handleAgentChatThread` — thread-based context assembly, 6 display tools (`show_concept_map` / `generate_quiz` / `compare_table` / `draw_diagram` / `show_code_walkthrough` / `pose_guess`), `chat:part` emission, mastery-based teaching strategy; 注入近期 friction 卡点(`pure/friction-context.ts` buildFrictionContext)让 AI 看见学习者挣扎点 |
| Soul (教学人设) | `services/souls/soul-service.ts` + `prompt-builder.ts` | 教学人设/persona CRUD + 激活;`buildSystemPrompt(db, BASE)` 把激活 soul 的 body 拼到 base prompt 后面注入 `streamText({system})`。3 内置 soul:精讲(direct)/引导(guide)/实战(practice)。**注:soul=persona,非过程性 playbook**;真 skill(多步任务固化)是未来独立模块。`active_soul=null` 时返回 base(等价关闭,无 flag 门控) |
| LLM client | `services/agent/llm-client.ts` | `resolveLlm` (3 protocols), `testLlmConnection`, `classifyLlmError` (auth/rate-limit/network), `fetchOpenRouterModels`, `fetchProviderModels` |
| LLM presets | `services/agent/llm-presets.ts` | 10 provider presets (GLM standard/CodingPlan, DeepSeek, Kimi, Qwen, SiliconCloud, OpenRouter, OpenAI, Anthropic, Google) |
| Threads | `services/thread-service.ts` | CRUD for `threads` + `chat_messages`; `findRecentThreadByNode`; thread is node-bound (`focus_node_id`) |
| Canvas | `services/canvas-service.ts` | 康奈尔笔记本:AI 产物 + user_note 画线 + quiz 答题记录 (`canvas_items`);byZone 三区筛选(understand/note/practice);溯源字段(source_type/source_anchor) |
| Highlight | `lib/highlightText.ts` | 画线定位:getTextModel + 文本搜索(applyPersistentMarksByText)+ 跨节点包裹(wrapRangeWithMark)+ 闪烁(flashMark)。**不依赖 DOM offset**(ReactMarkdown 重渲染不稳定),用 indexOf 在纯文本上定位 |
| Custom providers | `services/custom-provider-service.ts` | BYO user-defined provider rows; bypass preset settings, resolved by `custom-` prefix |
| Course generator | `services/course-generator.ts` | `generateCourseFromMarkdown` + `generateCourseFromRepoFiles` |
| Course structure | `services/course-structure-service.ts` | LLM-based course restructuring (two-phase: classify uncertain → group sections) + `generateLessonSummaries` |
| Repo fetcher | `services/pure/repo-fetcher.ts` | CDN fetch + `detectRepoPattern` (course/well-organized/single-file/docs-rich/unsupported + awesome-list 检测) + `fetchRepoInventory` (Step1: 多入口 README + 多分支 + tree + file list) + `fetchFileOutlines` (Step3: H1/H2/H3 + chars) + `extractOutlineWithCharCounts` |
| Import pipeline | `services/import-pipeline.ts` | `executeImport` (Step5): 拉正文 → 图片 base64 内联 → attachImages → 翻译落库(多布局 pathResolver) → 验证。通过 `ContentSource` 抽象不关心来源 |
| Import LLM | `services/import-llm-service.ts` | `classifyFileRoles` (Step2: LLM 文件角色 + sourceLang + 翻译布局检测) + `designCourseStructure` (Step4: section/lesson/world + 长文件拆分 + attachImages 关联) |
| Content source | `services/content-source.ts` | `ContentSource` 接口 + `GithubContentSource` (CDN) + `LocalContentSource` (磁盘) — 统一 executeImport 的文件/图片获取 |
| Code parser | `services/pure/code-parser.ts` | 代码文件(.py/.js/.go 等 30+ 语言) → markdown: docstring/注释块提取为正文 + 代码体围栏包裹。纯函数 |
| Translation layout | `services/pure/translation-layout.ts` | `detectTranslationLayout`(tree) — 自动检测翻译约定: microsoft(translations/{lang}/) / parallel({lang}/) / suffix({file}.{lang}.md)。返回 pathResolver |
| Local scanner | `services/pure/local-folder-scanner.ts` | `scanFolder` (递归扫 9 种文档格式 + 30+ 代码格式) + `buildLocalInventory` (本地清点: docs + images + translations + README + fullTree + standaloneImages) |
| File classifier | `services/pure/file-classifier.ts` | Rule-based `classifyFile` — high-confidence noise filter (translations/notebook/lab/example/section-intro/meta) + uncertain flag for LLM |
| Exercise | `services/exercise-service.ts` | AI exercise generation (mcq/fill_blank/true_false) + grading |
| Dashboard | `services/dashboard-service.ts` | `getDashboard` — section mastery, metrics |
| Progress | `services/progress-service.ts` | DB-injected progress read/write (headless-testable) |
| Memory | `services/memory-service.ts` | 学习者模型(定性层,补 BKT 定量 + friction 原始事件之缺)。`remember(db,input,merge)` 注入式 merge(生产 `defaultLlmMerge(llm)` 写时 LLM 合并去重,测试确定性 stub);`getLearnerMemory(db,nodeId)` 拼块注入 agent 上下文;按 `(category,nodeId)` 槽位 upsert(global/node/friction_pattern)。flag `memory_system` 门控(默认 off,off=baseline) |
| Search | `services/search-service.ts` | RAG `LIKE`-fallback search |
| XP | `services/xp-service.ts` | Daily XP tracking (correct+10/wrong+1/mastered+50) |
| SRS | `services/srs.ts` | SM-2 spaced repetition; `recordReviewDb`(pure/srs-db.ts, db 注入)与 BKT 闭环——答题/复习双向同步(答对推迟、答错近期重练) |
| Streak | `services/streak.ts` | Streak + freeze transitions |
| Export | `services/export-service.ts` | JSON + Markdown learning report export |
| Starter prompts | `services/starter-prompts-service.ts` | 4 巩固选择(深入/举个例子/考考我/我没太懂),hook 揭晓后、对话开始后才出现(语境前零决策税);原 ? 卡点表单折进「我没太懂」(发消息+记 friction);`frictionCategory` 字段标记 |
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
| Motion infra | `src/renderer/lib/motion-presets.ts` + `usePrefersReducedMotion.ts` | `motion` 弹簧/stagger/enter-exit 预设 + a11y reduced-motion 响应式 hook(useSyncExternalStore on matchMedia) |

Key renderer hooks: `useChatStream` (parts-based chat, pure `accumulatePart`),
`useThreads` (node-bound thread CRUD + soft-delete undo), `useCanvas` (canvas
item CRUD), `useFontSize` (3-tier A-/A+), `useLang` (reactive i18n subscription),
`useFocusTrap` (drawer/modal focus-trap + restore for a11y),
`usePrefersReducedMotion` (a11y 双轨:响应式检测系统减少动效偏好,所有动效分支入口)。

## Verification discipline

- **Tests live in `scripts/verify-*.mjs`** (42 suites) — run via `tsx`, import real TS source.
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
- **Component primitives**: `ConfirmCard` (inline confirm, replaces ALL `confirm()` — never use native), `Toast` with `severity` prop (success/error/warning/info), `GlobalTooltip` (any `data-tooltip` element gets hover tooltip).
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
11. **Seed versioning**: `SEED_VERSION` in `seed.ts` — bump to trigger seed course rebuild. 种子课程是 **LookatStudy 使用指南**(6 章 18 课，内置为静态 `src/main/assets/seed-course.json`，离线、无网络、无 LLM，启动瞬时加载)。内容源码在 `scripts/build-guide-seed.mjs`(课程定义内联在脚本里)。要刷新:跑 `npx tsx scripts/build-guide-seed.mjs` 再 bump `SEED_VERSION`。Never delete the DB to re-seed; it wipes custom providers.

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
/                       user-facing docs only: README, AGENTS, PRODUCT, CHANGELOG, VERIFICATION
/docs/                  (reserved for future user-facing docs — currently empty)
/dev-docs/              ★ gitignored ★ dev-process docs: ARCHITECTURE, BUILD-NOTES, ROADMAP,
                        DESIGN-PLAN-*.md — kept locally, NOT committed
/scripts/verify-*.mjs   deterministic test suites (tsx + node:assert)
/scripts/live-test/     LLM behavior tests (need API key)
/src/main/              Electron main process (CJS) — DB, services, IPC handlers
/src/preload/           contextBridge — the only renderer↔main path
/src/renderer/          React UI — never touches DB/files/keys directly
/shared/                types shared across main + renderer (the IPC contract)
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
  and build-config files live at root. Dev-process material goes in `dev-docs/`.
- **Historical plans stay historical.** When a design plan stops describing
  current code, leave it as-is in `dev-docs/` — don't quietly update it to match,
  that erases the decision trail.
- **AGENTS.md stays in sync with reality.** If you add a table, a service, a
  component, or a test suite, update the corresponding count/list here in the
  same PR. Stale AGENTS.md misleads the next agent that reads it.
