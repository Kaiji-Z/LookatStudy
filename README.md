<div align="center">

# LookatStudy

**Turn any repo into a course you'll actually finish.**

A Duolingo-style skill tree and an AI tutor that tracks what you *really* master —
built from your own learning material, running 100% locally with your own LLM key.

[![License: MIT](https://img.shields.io/badge/license-MIT-58cc02.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Kaiji-Z/LookatStudy?color=1cb0f6&label=release)](https://github.com/Kaiji-Z/LookatStudy/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-ffc800)](#quick-start)

<img src="docs/screenshots/01-overview.png" alt="LookatStudy — skill map, AI tutor chat, and Cornell notebook in one window" width="880">

**English** | [简体中文](README.zh-CN.md)

</div>

---

## You've starred 47 tutorials. You've finished none.

It's not a discipline problem. **Docs were never a course.**

| A course gives you | A repo of docs gives you |
| --- | --- |
| A path — what to do *today* | 300 files, no order |
| Feedback — am I getting this right? | Silence |
| Retention — review before you forget | Read once, gone by Friday |
| A reason to come back tomorrow | Another tab you'll never reopen |

LookatStudy bolts the missing four onto material you already have — a GitHub repo, a local folder, or pasted markdown — and turns it into a gated, adaptive, sticky course.

## 🧠 An AI tutor that knows which concept you're weak on

<img src="docs/screenshots/02-ai-tutor.png" alt="AI tutor opening a lesson with a guess-first hook" width="880">

Not a chatbot bolted onto a document reader. Every quiz answer updates a **per-knowledge-component BKT (Bayesian Knowledge Tracing)** model — the tutor knows you nail recursion but fumble closures, so it drills the gap instead of re-teaching the chapter. Chapter boss exams generate timed questions in the background, covering every knowledge point in the section.

The AI never edits your learning record directly: mastery updates arrive as **proposals you approve** (Propose → Apply). Three swappable teaching personas — 精讲 *direct*, 引导 *socratic*, 实战 *hands-on* — change how it teaches, not what you learn.

## 🗺️ A skill tree with real gating — plus search that jumps

<img src="docs/screenshots/03-course-search.png" alt="Course search: full outline tree with jump navigation" width="880">

Sections unlock sections. Boss exams gate chapters. A lesson isn't "done" until you've mastered **every knowledge point inside it** (minimum across concepts — not a completion checkbox). Search matches titles and full lesson content, and the outline tree jumps anywhere; locked nodes stay locked, so no spoilers.

## 📥 Import (almost) anything

- **GitHub URL** — README discovery + file-tree crawl; an LLM classifies every file's role and designs the course tree
- **Local folder** — the same pipeline on disk (downloaded course packages, cloned repos, your own notes)
- **Pasted markdown** — for private repos and quick captures
- **10 document formats** — `.md` `.ipynb` `.rst` `.Rmd` `.org` `.adoc` `.pdf` `.pptx` `.html` `.txt`
- **30+ code file types** — `.py` `.ts` `.go` `.rs` `.java` `.c` `.cpp` `.rb` `.sh` … code is teaching material too; docstrings become prose
- **Images travel with the content** — notebook outputs, PDF embeds, `<img>` tags; optional AI vision over them
- **Bilingual repos** — translation layouts (`translations/{lang}/`, parallel folders, `file.zh.md` suffix pairs) are detected and paired automatically

## 🔁 Retention engineering

Answer a quiz → **SM-2** reschedules it right before you'd forget. Daily XP, streaks with freezes, a review drawer with interleaved practice. The same loop that brings you back to Duolingo every day — except here it's attached to content *you* chose.

## 🔒 Local-first. BYOK. No telemetry.

SQLite on your disk. No account, no cloud sync, no analytics. Bring your own LLM key — **19 preset providers** (GLM, DeepSeek, Kimi, Qwen, SiliconCloud, OpenRouter, OpenAI, Anthropic, Google, Groq, Mistral, xAI, …) or any custom OpenAI-compatible endpoint. Keys live in the main process only; the renderer can't even see them.

## Quick start

**Windows** — grab the installer from [Releases](https://github.com/Kaiji-Z/LookatStudy/releases) (v0.9.0+).

**Any platform, from source** (Node.js ≥ 20):

```bash
git clone https://github.com/Kaiji-Z/LookatStudy.git
cd LookatStudy
npm install
npm run dev:electron
```

The app boots with a built-in offline guide course (6 chapters / 18 lessons / 6 chapter exams) — you can explore the whole loop without an API key. To wake the AI tutor: open **Settings** (gear icon) → pick a provider → paste your key → **Test Connection** → save.

## Under the hood

Electron 33 (CJS main) · React 19 + Vite 6 + Tailwind v3 · **sql.js** (SQLite → WASM, zero native builds) + Drizzle · Vercel AI SDK v5 + zod v3.

The renderer never touches the DB, filesystem, or API keys — everything crosses a typed IPC bridge defined once in `shared/types.ts`. Guarded by **63 deterministic test suites** (`npm run verify:core`) plus headless real-GUI assertions (`npm run ui-test`).

## Status

v0.9.0 — the core learning loop is complete: import (10 doc formats + 30+ code types) → gated skill map → AI tutor with per-KC BKT + Propose→Apply → spaced repetition, streaks and chapter exams → Cornell notebook with source-traced highlights. Full history in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Kaiji-Z

---

<div align="center">

If LookatStudy helps you finish something you've been putting off — a ⭐ is appreciated.

</div>
