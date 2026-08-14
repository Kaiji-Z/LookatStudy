# LookatStudy

**English | [简体中文](README.zh-CN.md)**

> Open-source, local-first, AI-driven desktop learning platform. Turn any learning repository into a Duolingo-style course you can actually finish.

LookatStudy takes any documentation/roadmap/course repository and turns it into a structured, gated learning path: a skill tree you unlock node by node, an AI tutor that adapts to what you've mastered, spaced repetition so knowledge sticks, and streaks so you keep coming back. Everything runs locally — your data never leaves your machine, and you bring your own LLM API key.

## Why

Most "read the docs" learning fails because docs aren't a course: no structure, no progress, no feedback, no retention. LookatStudy adds the four things that make a course work:

- **🗺️ Gated skill tree** — a repo becomes a path of sections → lessons, each unlocking the next, so you always know what to do today.
- **🧠 AI tutor with mastery tracking** — a Bayesian Knowledge Tracing (BKT) model tracks how well you know each concept; the tutor asks questions and targets your weak spots.
- **🔁 Spaced repetition + streaks** — SM-2 scheduling + Duolingo-style streaks with freezes keep you coming back.
- **🔁 Propose → Apply** — the AI drafts every state change (mastery updates, "mark mastered") as a *proposal* you approve, so the AI never silently mutates your learning record.

## Features

- **Course Generator** — supports **10 document formats + 30+ code file types**: Markdown, Jupyter Notebook (`.ipynb`), reStructuredText (`.rst`), R Markdown (`.Rmd`), Org-mode (`.org`), AsciiDoc (`.adoc`), PDF, PowerPoint (`.pptx`), HTML, plain text, plus source code files (`.py`/`.js`/`.ts`/`.go`/`.rs`/`.java`/`.c`/`.cpp`/`.rb`/`.sh` and many more — code is teaching material too). Import from a GitHub repo URL, a local folder, or paste markdown directly. Each format has a dedicated parser that converts to a unified internal markdown representation.
- **Multimodal image support** — course images (`.png`/`.jpg`/`.gif`/`.webp`/`.svg`) are collected during import, including Markdown `![](img)`, HTML `<img>` tags, Jupyter notebook output images, and PDF embedded images. Images are stored locally and displayed inline in the notebook panel. The AI can view images (via multimodal LLM) when you ask about diagrams or figures.
- **Native right-click menu** — copy selected text, copy/save images (system save dialog), and standard edit operations in text fields. Interact with content like a web page.
- **3 built-in teaching personas (souls, swappable)** — a pill in the chat composer switches how the tutor teaches (`null` = off, base prompt only):
  - `direct` 精讲 — explains clearly first, full worked examples, no guesswork
  - `guide` 引导 — asks guiding questions and lets you take the next step yourself
  - `practice` 实战 — hands-on, learn by doing around real problems
- **AI-generated exercises** — the tutor generates MCQ / fill-blank / true-false quizzes in chat ("考考我") that land in the notebook's practice zone with your answer history; chapter exam nodes generate timed, knowledge-point-based exams in the background. Answers are graded automatically and feed back into per-concept BKT mastery and SM-2 scheduling.
- **Three-pane workspace** — left: Duolingo-style skill map (gated lesson nodes + searchable course outline); middle: AI tutor chat (streaming, tool calls, Generative UI artifacts, thread sessions); right: Cornell-style notebook (lesson content with inline images, user highlights with source tracing, AI-generated concept maps/quizzes/diagrams).
- **Review drawer + mastery dashboard** — today's due reviews (SM-2), per-section mastery heatmap with weak-spot hints, and mixed (interleaved) review; streak and daily XP show in the header.
- **Lightweight RAG + memory** — the tutor searches across all lesson content to answer "where was this covered", and keeps a rolling summary so it remembers your past sessions.
- **BYOK with custom providers** — 19 preset providers (GLM standard/CodingPlan, DeepSeek, Kimi, Qwen, SiliconCloud, OpenRouter, OpenAI, Anthropic, Google, Groq, Together, Mistral, xAI, Volcano Engine, Baidu ERNIE, MiniMax, Baichuan, StepFun) plus unlimited user-defined custom providers. Optional vision model override for multimodal AI. Settings page with provider/model picker, test-connection button, and appearance/language options. Keys stay in the main process.

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
│  - Soul system (teaching persona → system prompt injection) │
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
│   │       │   ├── frontmatter.ts          # YAML frontmatter parser (souls)
│   │       │   ├── markdown-course.ts     # MD → course tree + LabType
│   │       │   ├── notebook-parser.ts     # .ipynb → markdown + images
│   │       │   ├── rst-parser.ts          # .rst → markdown
│   │       │   ├── rmd-parser.ts          # .Rmd → markdown
│   │       │   ├── org-parser.ts          # .org → markdown
│   │       │   ├── adoc-parser.ts         # .adoc → markdown
│   │       │   ├── code-parser.ts         # .py/.js/.go → markdown (code-as-content)
│   │       │   ├── translation-layout.ts  # auto-detect translation convention
│   │       │   ├── local-folder-scanner.ts # folder scanner (10 doc + 30+ code formats)
│   │       │   ├── repo-fetcher.ts        # GitHub repo → course files
│   │       │   └── flag-defaults.ts       # feature flags (default off)
│   │       ├── souls/             # teaching personas (soul system)
│   │       ├── agent/             # M2 agent engine + LLM provider
│   │       ├── proposal-service.ts        # Propose→Apply
│   │       ├── progress-service.ts        # DB-injected progress logic
│   │       ├── search-service.ts          # RAG + memory
│   │       ├── dashboard-service.ts       # heatmap metrics
│   │       ├── course-generator.ts        # MD → DB
│   │       ├── srs.ts / streak.ts / flags.ts / seed.ts
│   ├── preload/index.ts           # contextBridge → window.api
│   └── renderer/                  # React frontend
│       ├── App.tsx                # three-pane shell (map · chat · notebook)
│       ├── lib/api.ts             # typed window.api wrapper
│       └── index.html / index.css # CSP-locked, Tailwind base
├── shared/types.ts                # ★ IPC contract (ApiExpose interface)
├── scripts/verify-*.mjs           # 63 logic test scripts (run via tsx)
├── dev-docs/                      # dev-process docs (ARCHITECTURE / ROADMAP / BUILD-NOTES — gitignored, local only)
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
npm run dev:electron      # opens the app (a built-in guide course ships offline)
```

The app ships with an offline seed course — the **LookatStudy 使用指南** (user guide, 6 chapters / 18 lessons / 6 chapter exams) — so you can explore the skill tree without an API key. No course is pre-selected on startup: pick the guide course from the course list in the left rail.

### Configure your AI tutor

Open settings via the gear icon in the top bar:
1. Pick a provider (GLM recommended for China; DeepSeek for reasoning; OpenAI/Anthropic/Google need overseas network)
2. Pick a model from the dropdown (e.g. `glm-4-flash`, `deepseek-v4-flash`, `gpt-4o-mini`, `claude-3-5-haiku-latest`, `gemini-1.5-flash`)
3. Paste your API key (get one from the linked provider console)
4. Click **测试连接** to verify the key + network work before saving
5. Click **保存设置**

Keys are stored locally and never leave the main process; the renderer only sees whether a key is configured (masked display like `sk-1…abcd`).

Alternatively, configure via IPC: `window.api.setSetting("glm_api_key", "sk-...")` + `window.api.setSetting("active_provider", "glm")`.

### Turn any repo into a course

Click the **导入课程** tab in the left rail:
- **GitHub URL** — paste `https://github.com/owner/repo`; the README is fetched (trying `README.md`/`readme.md`/`README.rst`/`README.adoc`/`index.md`/`home.md`/`SUMMARY.md` across `main`/`master`/`develop`/`gh-pages` branches), the file tree is discovered via the GitHub Tree API (falling back to README-link discovery), and all course files are pulled and parsed. Import runs as a background job with live progress — you can keep browsing other courses while it works.
- **本地文件夹** — select a local folder (e.g. a downloaded Coursera package or cloned repo); files are recursively scanned (documents + code + images + translations) and parsed.
- **粘贴 Markdown** — paste raw markdown directly (for private repos, network-restricted environments, or local notes).

Supported file formats: `.md` / `.markdown`, `.ipynb` (Jupyter Notebook), `.rst` (reStructuredText), `.Rmd` (R Markdown), `.org` (Org-mode), `.adoc` / `.asciidoc` (AsciiDoc), `.pdf`, `.pptx` (PowerPoint), `.html` / `.htm`, `.txt`, plus **30+ code file types** (`.py` / `.js` / `.ts` / `.go` / `.rs` / `.java` / `.c` / `.cpp` / `.rb` / `.sh` / `.lua` / `.sql` / `.r` / `.jl` / `.dart` / `.scala` / `.kt` / `.swift` / `.php` / `.cs` / `.hs` / `.clj` / `.ex` / `.erl` / `.ml` / `.fs` / `.pl` / `.elm` and more — code is teaching material, module docstrings are extracted as prose). Images (`.png`/`.jpg`/`.gif`/`.webp`/`.svg`/`.avif`/`.ico`/`.tiff`) are always collected during import (image download is permanently on); AI vision over images is a separate optional toggle.

Pasted markdown is structured deterministically (H2 → section, H3 → lesson, LabType inferred from code blocks / notebook keywords). GitHub and folder imports run a 5-step pipeline where the LLM classifies every file's role and designs the course tree (local imports without an LLM key fall back to pure rules). The first lesson is set `available` (rest `locked`), and practice-type content lands in the free-exploration 实操 world. You can manage multiple courses (switch / delete) from the same tab.

## Testing

LookatStudy uses a test-first discipline. Logic tests run under `tsx` against **real source** (never inline copies), and every milestone ships closed-loop proof (break the source → the test fails → restore → green).

```bash
npm run verify:core       # 63 suites / 200+ assertions — pure logic (DB/SRS/streak/BKT/KC-BKT/proposals/RAG/souls/dashboard/course-gen/exercises/llm-presets/import/notebook/rst/rmd/org/adoc/pdf/pptx/exam/memory)
npm run self-test         # headless Electron DB-layer check → .self-test-result.json
npm run ui-test           # headless real-GUI check (34 DOM assertions: three-pane layout, course gating, skill map, settings, import, review drawer, course search, a11y + reactive i18n) → .ui-test-result.json
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
| AI | Vercel AI SDK v5 + @ai-sdk/openai/anthropic/google | 3 protocols (OpenAI-compatible / Anthropic / Google) covering 19 preset providers + custom |
| Tool schemas | zod v3 | Required by AI SDK v5 |
| DB | sql.js (SQLite → WASM) + Drizzle ORM | Zero native compilation (better-sqlite3 was a Windows build trap) |
| State | Zustand + TanStack Query | |
| Tests | tsx + node:assert | Tests import real TS source; headless-runnable |

## Status

The core learning loop is complete and verified: **course generation (10 doc formats + 30+ code types) → skill map UI → AI agent with BKT + Propose/Apply → RAG + memory + dashboard**. Current features include a three-pane layout (skill map · chat · notebook), thread sessions, Generative UI (concept maps / quizzes / Mermaid diagrams / compare tables / code walkthroughs), Duolingo-style map art, a Cornell-style notebook (understand / notes / practice zones with highlight-and-source-trace), multimodal image import + AI vision, native right-click copy/save, light/dark theme, and custom provider support. See `CHANGELOG.md` for the full version history (Chinese).

## License

MIT.
