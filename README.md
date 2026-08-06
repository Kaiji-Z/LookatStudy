# LookatStudy

> Open-source, local-first, AI-driven desktop learning platform. Turn any GitHub Markdown repo into a Duolingo-style course you can actually finish.

LookatStudy takes any documentation/roadmap repository and turns it into a structured, gated learning path: a skill tree you unlock node by node, an AI tutor that adapts to what you've mastered, spaced repetition so knowledge sticks, and streaks so you keep coming back. Everything runs locally — your data never leaves your machine, and you bring your own LLM API key.

## Why

Most "read the docs" learning fails because docs aren't a course: no structure, no progress, no feedback, no retention. LookatStudy adds the four things that make a course work:

- **🗺️ Gated skill tree** — a repo becomes a path of sections → lessons, each unlocking the next, so you always know what to do today.
- **🧠 AI tutor with mastery tracking** — a Bayesian Knowledge Tracing (BKT) model tracks how well you know each concept; the tutor asks questions and targets your weak spots.
- **🔁 Spaced repetition + streaks** — SM-2 scheduling + Duolingo-style streaks with freezes keep you coming back.
- **🔁 Propose → Apply** — the AI drafts every state change (mastery updates, "mark mastered") as a *proposal* you approve, so the AI never silently mutates your learning record.

## Features

- **Course Generator** — paste a markdown file or point at a GitHub repo; the README is parsed into a section/lesson tree and auto-tagged with a LabType (`doc` / `code` / `notebook`).
- **4 built-in learning modes** (skills, swappable):
  - `socratic-mode` (default) — guides with questions, never just hands over the answer
  - `exam-prep-mode` — timed, no hints, exam-pressure simulation
  - `project-mode` — hands-on tasks, learn by doing
  - `review-mode` — only surfaces spaced-repetition items due today
- **Dashboard** — per-section mastery heatmap, today's due reviews, current streak.
- **Lightweight RAG + memory** — the tutor searches across all lesson content to answer "where was this covered", and keeps a rolling summary so it remembers your past sessions.
- **Multi-provider LLM** — works with 智谱 GLM, OpenAI, DeepSeek (any OpenAI-compatible endpoint). Keys stay in the main process.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (React 19 + Vite + Tailwind, dark-first)      │
│  - Duolingo-style skill tree                             │
│  - Dashboard (mastery heatmap)                           │
│  - Learning-mode picker                                  │
│  - Talks to main only via window.api.* (contextBridge)   │
└───────────────────────┬─────────────────────────────────┘
                        │ IPC (domain:action channels)
┌───────────────────────▼─────────────────────────────────┐
│  Main process (Electron 33, CJS / Node.js)              │
│  - Agent engine (Vercel AI SDK v5 streamText + tools)   │
│  - Skill system (frontmatter → system prompt injection) │
│  - BKT mastery model                                     │
│  - Propose→Apply pipeline (AI drafts, human approves)   │
│  - Course Generator (markdown → course tree)            │
│  - RAG (LIKE search) + memory + SM-2 SRS + streaks      │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
   sql.js (SQLite WASM)            LLM API (BYO key)
   local .db file                  (key never leaves main)
```

**Key boundary:** the renderer never touches the DB, filesystem, or API keys. Every cross-process call is a typed IPC method in `shared/types.ts` (`ApiExpose`).

## Project structure

```
lookatstudy/
├── src/
│   ├── main/                      # Electron main process (CJS)
│   │   ├── index.ts               # entry + --self-test / --ui-test modes
│   │   ├── ipc/index.ts           # all IPC handlers (domain:action)
│   │   ├── db/
│   │   │   ├── schema.sql         # ★ single source of truth for schema
│   │   │   ├── schema.ts          # drizzle definitions (derived)
│   │   │   └── index.ts           # sql.js connect + migrations + persistence
│   │   └── services/
│   │       ├── pure/              # zero-dependency testable cores
│   │       │   ├── sm2.ts                 # SM-2 spaced repetition
│   │       │   ├── streak-transition.ts   # streak/freeze state machine
│   │       │   ├── bkt.ts                 # Bayesian Knowledge Tracing
│   │       │   ├── skill-frontmatter.ts   # YAML frontmatter parser
│   │       │   ├── markdown-course.ts     # MD → course tree + LabType
│   │       │   └── flag-defaults.ts       # feature flags (default off)
│   │       ├── skills/            # M1 skill system
│   │       ├── agent/             # M2 agent engine + LLM provider
│   │       ├── proposal-service.ts        # Propose→Apply
│   │       ├── progress-service.ts        # DB-injected progress logic
│   │       ├── search-service.ts          # RAG + memory
│   │       ├── dashboard-service.ts       # heatmap metrics
│   │       ├── course-generator.ts        # MD → DB
│   │       ├── srs.ts / streak.ts / flags.ts / seed.ts
│   ├── preload/index.ts           # contextBridge → window.api
│   └── renderer/                  # React frontend
│       ├── App.tsx                # skill tree + dashboard tabs
│       ├── lib/api.ts             # typed window.api wrapper
│       └── index.html / index.css # CSP-locked, Tailwind base
├── shared/types.ts                # ★ IPC contract (ApiExpose interface)
├── scripts/verify-*.mjs           # 13 logic test scripts (run via tsx)
├── docs/                          # ARCHITECTURE / ROADMAP / BUILD-NOTES
├── electron-builder.yml           # packaging config
├── vite.config.ts / tsconfig*.json / tailwind.config.ts
└── package.json
```

## Quick start

### Prerequisites

- Node.js ≥ 20
- An LLM API key (GLM / OpenAI / DeepSeek) — optional for exploring the UI, required for the AI tutor

### Install & run

```bash
npm install
npm run dev:electron      # opens the app with the built-in FDE seed course
```

The app ships with a seed course (the Awesome-FDE-Roadmap) so you can explore the skill tree immediately without an API key.

### Configure your AI tutor

Open Settings in the app (or set via the settings IPC) and add:
- `glm_api_key` / `openai_api_key` / `deepseek_api_key` — your provider key
- `active_provider` — `glm` (default) / `openai` / `deepseek`
- `active_model` — optional override (defaults: `glm-4-flash` / `gpt-4o-mini` / `deepseek-chat`)

Keys are stored locally and never leave the main process; the renderer only sees whether a key is configured.

### Turn any repo into a course

- Point at a repo: call `window.api.importCourseFromRepo("https://github.com/owner/repo")` — the README is fetched and parsed.
- Or paste markdown: `window.api.generateCourseFromMarkdown(markdown, "my-course")` — no network needed.

The generator detects H2 → section, H3 → lesson, infers LabType from code blocks / notebook keywords, and sets the first lesson as `available` (rest `locked`).

## Testing

LookatStudy uses a test-first discipline. Logic tests run under `tsx` against **real source** (never inline copies), and every milestone ships closed-loop proof (break the source → the test fails → restore → green).

```bash
npm run verify:core       # 13 scripts / 115+ assertions — pure logic (DB/SRS/streak/BKT/proposals/RAG/skills/dashboard/course-gen)
npm run self-test         # headless Electron DB-layer check → .self-test-result.json
npm run ui-test           # headless real-GUI check (real preload + IPC + React render) → .ui-test-result.json
```

Standard triad after any change:
```bash
npm run verify:core && npx vite build && npm run self-test
```

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | Single language across main + renderer |
| Renderer | React 19 + Vite 6 + Tailwind v3 | |
| Desktop | Electron 33 (CJS output) | Cross-platform desktop; see `docs/BUILD-NOTES.md` for the CJS reasoning |
| AI | Vercel AI SDK v5 + @ai-sdk/openai | Provider-agnostic; GLM/DeepSeek via OpenAI-compatible baseURL |
| Tool schemas | zod v3 | Required by AI SDK v5 |
| DB | sql.js (SQLite → WASM) + Drizzle ORM | Zero native compilation (better-sqlite3 was a Windows build trap) |
| State | Zustand + TanStack Query | |
| Tests | tsx + node:assert | Tests import real TS source; headless-runnable |

## Status

M1–M4 (v0.1 core learning loop) are complete and verified: **course generation → skill tree UI → AI agent with BKT + Propose/Apply → RAG + memory + dashboard**. See `docs/ROADMAP.md` for the full milestone plan and v0.2 direction (IRT, full-vector RAG, CodeLab).

## License

MIT.
