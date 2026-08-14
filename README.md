<div align="center">

# LookatStudy

Turn any repo into a course you actually finish

I star a lot of tutorials and finish almost none of them, so I built this for myself. A repo comes in, a gated course comes out, and an AI tutor keeps track of what you've really learned. Everything runs on your machine, with your own API key.

[![License MIT](https://img.shields.io/badge/license-MIT-58cc02.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Kaiji-Z/LookatStudy?color=1cb0f6&label=release)](https://github.com/Kaiji-Z/LookatStudy/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-ffc800)](#getting-started)

<img src="docs/screenshots/01-overview.png" alt="LookatStudy with the skill map on the left, tutor chat in the middle, notebook on the right" width="880">

**English** | [简体中文](README.zh-CN.md)

</div>

---

## Why I built this

Every few weeks I'd star another roadmap, clone a tutorial repo, read the intro, and quietly never come back. This kept happening, and blaming willpower never fixed it. A pile of docs is missing things every course has.

Pick up a course and you know what to study today. Three hundred files in a repo give you no such answer. Finish a lesson and a quiz tells you whether it landed. Finish a doc and you're left guessing. A course brings material back before you forget it, and it gives you a reason to open it again tomorrow. A browser tab does neither.

Duolingo solved these problems thoroughly, but only for its own content. I wanted the same mechanics on material I chose. Give LookatStudy a GitHub repo, a local folder, or pasted markdown, and it builds a gated course with exams and a review schedule.

## The repo becomes a skill map

Sections and lessons turn into nodes on a path. Finish one and the next unlocks. Every chapter ends with a boss exam, generated in the background with timed questions. Finishing a lesson takes more than reading it. Each lesson breaks into knowledge points, and your mastery of the lesson is the lowest of them. Leave one point vague and the crown stays locked.

## The AI tutor knows which concept you're weak on

<img src="docs/screenshots/02-ai-tutor.png" alt="The tutor opening a lesson with a guess-first question" width="880">

This is the part I care most about. Every answer you give updates a BKT mastery model on the specific knowledge point behind the question. The tutor sees far more than "chapter 3, 70 percent". You're solid on recursion and shaky on closures, so it keeps asking about closures. When you click "I don't get this" in a chat, the stumble gets logged, and later explanations spend more time where you actually fell and less where you're already bored.

Two design decisions I made on day one and haven't regretted.

The AI cannot touch your learning record on its own. It drafts a proposal card, and nothing changes until you approve it.

Teaching style is a pill next to the input box, switchable anytime. Explain it to me straight, ask me guiding questions, or make me do it myself.

## Search doubles as an outline

<img src="docs/screenshots/03-course-search.png" alt="The course search panel with a tree of the whole course" width="880">

Imports get big. One repo I test with comes out at 124 lessons, and scrolling a map that long gets old. That's what the search panel in the left rail is for. It searches titles and full text, shows the whole course as a clickable tree when the query is empty, and jumps to whatever row you click. Locked lessons stay locked in the list, so no spoilers.

## What you can import

- Three ways in. A GitHub URL, a local folder, or markdown you paste in.
- Ten document formats. `.md` `.ipynb` `.rst` `.Rmd` `.org` `.adoc` `.pdf` `.pptx` `.html` `.txt`.
- Thirty-odd code file types. `.py` `.ts` `.go` `.rs` `.java` `.c` `.cpp` `.sh` all count as teaching material, and docstrings become the prose.
- Images ride along with the content, notebook outputs and PDF embeds included. With a vision model, the tutor actually looks at the figure when you ask about it.
- Bilingual repos pair up automatically. A `translations/{lang}/` folder, parallel folders, or `file.zh.md` suffixes all get recognized.

## The part that makes you come back

Answer a quiz and SM-2 schedules a review right before you'd forget it. Daily XP fills a bar in the header. Streaks can be frozen, so one broken day doesn't zero you out. The review drawer mixes chapters instead of drilling one. I know how this sounds on a project page. I was skeptical too, but it genuinely works, and the difference is that here it hangs on content you picked yourself.

## Your data stays on your machine

The whole app is one SQLite file on your disk. No account, no cloud sync, and nothing you do here ever leaves that drive. The LLM key is your own, with nineteen preset providers (GLM, DeepSeek, Kimi, Qwen, OpenAI, Anthropic, Google, and more) plus any OpenAI-compatible endpoint. The key lives in the main process. The renderer can't read it even if it wanted to.

## Getting started

On Windows, grab the installer from the [Releases](https://github.com/Kaiji-Z/LookatStudy/releases) page.

From source, any platform, Node 20 or newer.

```bash
git clone https://github.com/Kaiji-Z/LookatStudy.git
cd LookatStudy
npm install
npm run dev:electron
```

A guide course ships built in, six chapters, eighteen lessons, six exams, so you can click through the whole loop without a key. To bring the AI in, open Settings, pick a provider, paste your key, hit Test Connection, save.

## What it can't do yet

- Only Windows has a packaged installer. The project has zero native modules, so macOS and Linux should build fine. I just haven't shipped those packages yet.
- PDF text extraction can't decode math formulas. That's a hard limit of reading the text layer, and a formula-heavy math PDF comes through mangled. The planned fix is rendering pages to images and letting a vision model read them.
- The smart part of importing, classifying files and designing the course tree, calls the LLM. Without a key, local imports fall back to pure rules. It works, just blunter.

## Under the hood

Electron 33, React 19. The database is sql.js, SQLite compiled to WASM, so there's nothing native to build and `npm install` doesn't blow up on Windows. The renderer can't reach the database, the filesystem, or your key. Every cross-process call goes through one typed IPC bridge. Sixty-three deterministic test suites and a headless real-GUI test watch the whole thing, all runnable with `npm run verify:core`.

## Status

v0.9.0. The main loop, importing, learning with the tutor, reviewing, taking exams, is complete, and I use it daily. Full history in [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).

---

<div align="center">

If LookatStudy helps you finish something you've been putting off, a star would make my day.

</div>
