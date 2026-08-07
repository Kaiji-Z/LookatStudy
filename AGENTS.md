# AGENTS.md — LookatStudy

Guidance for AI coding agents working in this repo. Read this + `README.md` + `PRODUCT.md` + `VERIFICATION.md` + `docs/` first.

## Mandatory protocol

Before developing any feature or changing any code, read and follow `VERIFICATION.md`.
Output that violates a red line in VERIFICATION.md §7 is void.

## What this is

Open-source, local-first, AI-driven desktop learning platform. Turns any GitHub learning repository into a Duolingo-style course (gated skill tree, AI tutor with BKT mastery tracking, SM-2 spaced repetition, XP/streak/crown retention). Electron app, local SQLite (sql.js), BYO LLM API key.

## Tech stack (locked — do not change)

- **TypeScript** full-stack · **React 19 + Vite 6 + Tailwind v3** (renderer)
- **Electron 33** main process — **CJS output, not ESM** (see gotchas)
- **Vercel AI SDK v5** (`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/google`) · **zod v3** for tool schemas
- **sql.js** (SQLite compiled to WASM, pure JS) + **Drizzle ORM** — *not* better-sqlite3
- **tsx** runs `scripts/verify-*.mjs` deterministic tests · `scripts/live-test/*.mjs` for LLM behavior tests

## Architecture boundaries (critical)

```
Renderer (React) ──IPC──→ Main (Node.js) ──→ SQLite / LLM API / CDN
```

- **Renderer never touches DB, files, or API keys directly.** All cross-process calls go through `window.api.*` (contextBridge isolation in `src/preload/index.ts`).
- **IPC contract is `shared/types.ts` → `ApiExpose` interface.** Editing it = editing the protocol; both ends (preload + main handlers) must sync.
- **Channel naming: `domain:action`** (e.g. `course:list`, `skill:setActive`, `proposal:apply`, `xp:getStatus`). Handlers in `src/main/ipc/index.ts`, grouped by domain.
- **LLM calls and API keys stay in main process.** CSP in `src/renderer/index.html` forbids renderer-side LLM endpoints; renderer only sees booleans for key presence (`agent:isReady`).
- **AI persistent-state mutations go through Proposal (Propose→Apply).** AI drafts state changes, human applies/rejects — never let AI write learner state directly (see `proposal-service.ts`).
- **Custom providers** (`custom_providers` table) bypass preset key settings — their API key is stored in the table row, resolved by `resolveLlm()` when `active_provider` starts with `custom-`.

## Dual-pane layout

- **Left pane (AI agent)**: ChatPanel (💬对话 / 📝练习 / ⚙️设置 mode tabs) + starter prompts + skill picker. All AI-facing controls live here.
- **Right pane (display)**: Skill tree / Dashboard / Import. Pure display + click interactions, no AI config.
- Divider is draggable; left pane collapsible.
- **HMR rule**: renderer-only changes (CSS/TSX) auto-hot-reload via Vite — no restart needed. Main process or preload changes require `taskkill electron + npm run dev:electron`.

## Common commands

```bash
npm run dev:electron      # dev: vite dev server + electron window
npm run dev               # vite only (renderer debugging, HMR)
npm run build             # production build
npm run start             # build + launch electron
npm run dist              # build + electron-builder (produces .exe/.dmg/.AppImage)
npm run verify:core       # 18 pure-Node/tsx logic test suites (140+ assertions)
npm run self-test         # electron main DB-layer self-check → .self-test-result.json (headless)
npm run ui-test           # real-GUI verification (headless Electron, 16 DOM assertions)
npm run lint              # oxlint
npx tsc --noEmit                       # typecheck renderer
npx tsc -p tsconfig.electron.json --noEmit  # typecheck main/preload
npx tsx scripts/live-test/live-test-teaching.mjs    # LLM teaching behavior test (needs API key)
npx tsx scripts/live-test/live-test-exercise.mjs    # LLM exercise quality test
npx tsx scripts/live-test/live-test-summary.mjs     # LLM summary + Ollama test
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

14 tables: courses, content_nodes, exercises, progress, srs_items, streaks, chat_sessions, settings, skills, proposals, friction_log, memory, custom_providers.

## Key services

| Service | File | What it does |
|---------|------|-------------|
| Agent engine | `services/agent/agent-engine.ts` | streamText + tools (get_node_info/record_answer/mark_mastered), course-level context injection, mastery-based teaching strategy |
| LLM client | `services/agent/llm-client.ts` | resolveLlm (3 protocols), testLlmConnection, classifyLlmError (auth/rate-limit/network), fetchOpenRouterModels, fetchProviderModels |
| LLM presets | `services/agent/llm-presets.ts` | 10 provider presets (GLM standard/CodingPlan, DeepSeek, Kimi, Qwen, SiliconCloud, OpenRouter, OpenAI, Anthropic, Google) |
| Course generator | `services/course-generator.ts` | generateCourseFromMarkdown + generateCourseFromRepoFiles |
| Course structure | `services/course-structure-service.ts` | LLM-based course restructuring + lesson summary generation |
| Repo fetcher | `services/pure/repo-fetcher.ts` | CDN fetch + pattern detection (course/single-file/unsupported) |
| Exercise | `services/exercise-service.ts` | AI exercise generation (mcq/fill_blank/true_false) + grading |
| XP | `services/xp-service.ts` | Daily XP tracking (correct+10/wrong+1/mastered+50) |
| SRS | `services/srs.ts` | SM-2 spaced repetition |
| Export | `services/export-service.ts` | JSON + Markdown learning report export |
| Starter prompts | `services/starter-prompts-service.ts` | Mastery-based prompt suggestions |
| i18n | `src/renderer/lib/i18n.ts` | zh-CN / en dictionary + translate() |

## Verification discipline

- **Tests live in `scripts/verify-*.mjs`** (18 suites) — run via `tsx`, import real TS source.
- **Live tests in `scripts/live-test/`** — call real LLM, need API key, gate with `Z_AI_API_KEY` env or opencode config.
- **Closed-loop required:** after writing a feature + its test, prove the test catches regressions by temporarily breaking the source.
- **Adversarial testing:** test edge cases (empty/NaN/huge/special-char inputs) — see verify-xp.mjs and verify-export.mjs for patterns.
- **Tests that import `schema.sql?raw`**: tsx can't resolve `?raw` — services that transitively import schema via srs.ts must use static imports in production but the import chain must not reach schema.ts from verify scripts that don't use the DB.

## Design system

- **impeccable skill** is the design system authority. `PRODUCT.md` defines the register (product), color strategy (committed), and key surfaces.
- **CSS tokens** in `src/renderer/index.css`: `btn-3d-*` (3D push-down buttons), `lesson-bubble-*` (4-state 3D bubbles), `surface-card`, animations (`bubble-pulse`, `streak-flame`, `typing-dot`, `msg-enter`).
- **Brand colors** (Tailwind config): brand `#58cc02` (green), accent `#1cb0f6` (blue), gold `#ffc800`, warning `#ff4b4b`.
- **Theme**: dark-first with light mode support (`html.dark` class toggle, localStorage persisted, `prefers-color-scheme` auto-detect).
- **i18n**: all user-facing strings use `translate("key")` from `lib/i18n.ts`.

## Gotchas (details in `docs/BUILD-NOTES.md`)

1. **Main process is CJS.** Use the global `__dirname` directly — do **not** use `fileURLToPath(import.meta.url)` (breaks under vite-plugin-electron). Root `package.json` intentionally has no `"type": "module"`.
2. **vite-plugin-electron outDir must be absolute.** `vite.config.ts` sets `root: "src/renderer"`, so relative outDir resolves wrong. Always use `resolve(__dirname, "...")`.
3. **vite root must be absolute** (`resolve(__dirname, "src/renderer")`) — relative path causes `Failed to load /main.tsx` on Windows dual-drive mapping.
4. **GPU black screen on Windows.** `app.disableHardwareAcceleration()` in `src/main/index.ts` — required, not optional.
5. **sql.js is in-memory.** Mutations must call `markDirty()` (debounced 500ms save); `flushDb()` runs on `before-quit`. `sql.js` / `drizzle-orm/sql-js` / `electron` are rollup `external`.
6. **sql.js WASM lacks fts5 module.** RAG uses `LIKE` fallback, not FTS5.
7. **No native module compilation.** If a dep fails to build, switch to pure-JS.
8. **Electron stderr unreliable in headless.** Use `--self-test` / `--ui-test` and read JSON result files.
9. **HMR**: renderer changes (CSS/TSX) auto-reload. Main/preload changes need full restart.
10. **Seed versioning**: `SEED_VERSION` in `seed.ts` — bump to trigger seed course rebuild without deleting user data.

## Docs to read before sensitive changes

- `PRODUCT.md` — design system definition (register, color strategy, surfaces)
- `docs/ARCHITECTURE.md` — design (Agent engine + Skill system + Propose/Apply + BKT + RAG)
- `docs/ROADMAP.md` — milestone roadmap
- `docs/BUILD-NOTES.md` — known environment/build pitfalls
