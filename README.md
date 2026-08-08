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

- **Course Generator** — paste a markdown file or point at a GitHub repo; the README is parsed into a section/lesson tree and auto-tagged with a LabType (`doc` / `code` / `notebook`). Built-in UI for both import paths + course management (switch/delete).
- **4 built-in learning modes** (skills, swappable):
  - `socratic-mode` (default) — guides with questions, never just hands over the answer
  - `exam-prep-mode` — timed, no hints, exam-pressure simulation
  - `project-mode` — hands-on tasks, learn by doing
  - `review-mode` — only surfaces spaced-repetition items due today
- **AI-generated exercises** — switch the left panel to "练习" mode and the AI generates MCQ / fill-blank / true-false questions from the current lesson. Answers are graded automatically and feed back into BKT mastery.
- **Dual-pane workspace** — left: AI tutor chat (streaming, tool calls, proposal cards); right: skill tree / dashboard / import / settings. Draggable divider, collapsible sidebar.
- **Dashboard** — per-section mastery heatmap, today's due reviews, current streak.
- **Lightweight RAG + memory** — the tutor searches across all lesson content to answer "where was this covered", and keeps a rolling summary so it remembers your past sessions.
- **5-provider BYOK** — 智谱 GLM, DeepSeek, OpenAI (OpenAI-compatible), Anthropic Claude (native SDK), Google Gemini (native SDK). Settings page with provider/model picker, test-connection button, and daily-goal config. Keys stay in the main process.

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
- An LLM API key (GLM / DeepSeek / OpenAI / Anthropic / Google) — optional for exploring the UI, required for the AI tutor and exercises

### Install & run

```bash
npm install
npm run dev:electron      # opens the app with the built-in FDE seed course
```

The app ships with a seed course (the Awesome-FDE-Roadmap) so you can explore the skill tree immediately without an API key.

### Configure your AI tutor

Click the **⚙️ 设置** tab in the app:
1. Pick a provider (GLM recommended for China; DeepSeek for reasoning; OpenAI/Anthropic/Google need overseas network)
2. Pick a model from the dropdown (e.g. `glm-4-flash`, `deepseek-chat`, `gpt-4o-mini`, `claude-3-5-haiku`, `gemini-1.5-flash`)
3. Paste your API key (get one from the linked provider console)
4. Click **测试连接** to verify the key + network work before saving
5. Click **保存设置**

Keys are stored locally and never leave the main process; the renderer only sees whether a key is configured (masked display like `sk-1…abcd`).

Alternatively, configure via IPC: `window.api.setSetting("glm_api_key", "sk-...")` + `window.api.setSetting("active_provider", "glm")`.

### Turn any repo into a course

Click the **📚 导入课程** tab:
- **GitHub URL** — paste `https://github.com/owner/repo`; the README is fetched and parsed into a course tree.
- **粘贴 Markdown** — paste raw markdown directly (for private repos, network-restricted environments, or local notes).

The generator detects H2 → section, H3 → lesson, infers LabType from code blocks / notebook keywords, and sets the first lesson as `available` (rest `locked`). You can manage multiple courses (switch / delete) from the same tab.

## Testing

LookatStudy uses a test-first discipline. Logic tests run under `tsx` against **real source** (never inline copies), and every milestone ships closed-loop proof (break the source → the test fails → restore → green).

```bash
npm run verify:core       # 14 scripts / 130+ assertions — pure logic (DB/SRS/streak/BKT/proposals/RAG/skills/dashboard/course-gen/exercises/llm-presets)
npm run self-test         # headless Electron DB-layer check → .self-test-result.json
npm run ui-test           # headless real-GUI check (16 DOM assertions: skill tree, dashboard, settings, import, dual-pane) → .ui-test-result.json
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
| Desktop | Electron 33 (CJS output) | Cross-platform desktop (CJS main process — avoids vite-plugin-electron ESM edge cases) |
| AI | Vercel AI SDK v5 + @ai-sdk/openai/anthropic/google | 5 providers: GLM/DeepSeek/OpenAI (OpenAI-compatible), Claude (native), Gemini (native) |
| Tool schemas | zod v3 | Required by AI SDK v5 |
| DB | sql.js (SQLite → WASM) + Drizzle ORM | Zero native compilation (better-sqlite3 was a Windows build trap) |
| State | Zustand + TanStack Query | |
| Tests | tsx + node:assert | Tests import real TS source; headless-runnable |

## Status

M1–M4 (v0.1 core learning loop) are complete and verified: **course generation → skill map UI → AI agent with BKT + Propose/Apply → RAG + memory + dashboard**. The v0.5 release added a three-pane layout (skill map · chat · notebook), thread sessions, Generative UI, and Duolingo-style map art. See `CHANGELOG.md` for the full version history.

## License

MIT.
