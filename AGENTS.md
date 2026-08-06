# AGENTS.md — LookatStudy

Guidance for AI coding agents working in this repo. Read this + `README.md` + `docs/` first.

## What this is

Open-source, local-first, AI-driven desktop learning platform. Turns any GitHub Markdown repo into a Duolingo-style course (gated skill tree, AI tutor with BKT mastery tracking, SM-2 spaced repetition, streak/crown retention). Electron app, local SQLite (sql.js), BYO LLM API key.

## Tech stack (locked — do not change)

- **TypeScript** full-stack · **React 19 + Vite 6 + Tailwind v3** (renderer)
- **Electron 33** main process — **CJS output, not ESM** (see gotchas)
- **Vercel AI SDK v5** (`ai` + `@ai-sdk/openai`) · **zod v3** for tool schemas
- **sql.js** (SQLite compiled to WASM, pure JS) + **Drizzle ORM** — *not* better-sqlite3
- **Zustand** + **TanStack Query** (state) · **tsx** runs `scripts/verify-*.mjs` tests

## Architecture boundaries (critical)

```
Renderer (React) ──IPC──→ Main (Node.js) ──→ SQLite / LLM API
```

- **Renderer never touches DB, files, or API keys directly.** All cross-process calls go through `window.api.*` (contextBridge isolation in `src/preload/index.ts`).
- **IPC contract is `shared/types.ts` → `ApiExpose` interface.** Editing it = editing the protocol; both ends (preload + main handlers) must sync.
- **Channel naming: `domain:action`** (e.g. `course:list`, `skill:setActive`, `proposal:apply`). Handlers in `src/main/ipc/index.ts`, grouped by domain.
- **LLM calls and API keys stay in main process.** CSP in `src/renderer/index.html` forbids renderer-side LLM endpoints; renderer only sees booleans for key presence (`agent:isReady`).
- **AI persistent-state mutations go through Proposal (Propose→Apply).** AI drafts state changes, human applies/rejects — never let AI write learner state directly (see `proposal-service.ts`).

## Common commands

```bash
npm run dev:electron      # dev: vite dev server + electron window
npm run dev               # vite only (renderer debugging)
npm run build             # production build
npm start                 # build + launch electron
npm run verify:core       # 13 pure-Node/tsx logic tests — run after every change
npm run self-test         # electron main DB-layer self-check → .self-test-result.json (headless)
npm run ui-test           # real-GUI verification (headless Electron, DOM assertions)
npm run lint              # oxlint
npx tsc --noEmit                       # typecheck renderer
npx tsc -p tsconfig.electron.json --noEmit  # typecheck main/preload
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

Tables: courses, content_nodes, exercises, progress, srs_items, streaks, chat_sessions, settings, skills, proposals, friction_log, memory.

## Verification discipline (follow for every change)

- **Tests live in `scripts/verify-*.mjs`** and run via `tsx` (they import real TS source, not copies). Every milestone must ship automated tests.
- **Closed-loop required:** after writing a feature + its test, prove the test catches regressions by temporarily breaking the source and confirming the test fails, then restoring.
- **No guess-filling [must-ask] items** (VERIFICATION.md §7.7). If a decision is needed, ask.
- **Never `npm install` a new eval/test dependency on your own** (§7.9) — recommend it; the human decides.

## Gotchas (details in `docs/BUILD-NOTES.md`)

1. **Main process is CJS.** Use the global `__dirname` directly — do **not** use `fileURLToPath(import.meta.url)` (breaks under vite-plugin-electron). Root `package.json` intentionally has no `"type": "module"`.
2. **vite-plugin-electron outDir must be absolute.** `vite.config.ts` sets `root: "src/renderer"`, so relative outDir resolves wrong. Always use `resolve(__dirname, "...")`.
3. **sql.js is in-memory.** Mutations must call `markDirty()` (debounced 500ms save); `flushDb()` runs on `before-quit`. `sql.js` / `drizzle-orm/sql-js` / `electron` are rollup `external` — don't bundle them.
4. **sql.js WASM build lacks the fts5 module.** RAG uses `LIKE` fallback, not FTS5 (see `search-service.ts`). Upgrading to a fts5-enabled SQLite build is a v0.2 task.
5. **No native module compilation.** If a dep fails to build, switch to a pure-JS alternative (the better-sqlite3 → sql.js swap was intentional).
6. **Electron stderr is unreliable in headless terminals.** Use `--self-test` / `--ui-test` and read the result JSON files instead of console output.
7. **Renderer is dark-first** (`class="dark"` on `<html>`); Tailwind darkMode is `"class"`. Brand palette is Duolingo-style (green `#58cc02`, blue `#1cb0f6`).

## Docs to read before sensitive changes

- `docs/ARCHITECTURE.md` — design (Agent engine + Skill system + Propose/Apply + BKT + RAG)
- `docs/ROADMAP.md` — milestone roadmap
- `docs/BUILD-NOTES.md` — known environment/build pitfalls
