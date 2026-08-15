# Contributing to LookatStudy

Thanks for considering a contribution. The project is small but has a few hard rules that keep it buildable and testable. Read this file top to bottom before opening a PR; it's shorter than the bug you'd otherwise find.

## Dev setup

Node.js 22 or newer, then:

```bash
git clone https://github.com/Kaiji-Z/LookatStudy.git
cd LookatStudy
npm install
npm run dev:electron
```

The app opens with a built-in offline guide course, so no API key is needed to click around.

## The verification you're expected to run

CI runs all of this on your PR, and it should pass locally before you push:

```bash
npm run lint                                              # oxlint
npx tsc --noEmit                                          # typecheck renderer
npx tsc -p tsconfig.electron.json --noEmit                # typecheck main + preload
npm run verify:core                                       # 63 deterministic logic suites
npm run build                                             # vite renderer build
```

For changes that touch the Electron main process or the DB layer, also run:

```bash
npm run self-test    # headless DB-layer self-check
npm run ui-test      # headless real-GUI assertions (34 DOM checks)
```

Tests import the real TypeScript source, never inline copies. If you add a feature, add its test suite under `scripts/verify-*.mjs` and wire it into `verify:core` in `package.json`. Prove the test catches regressions by temporarily breaking your source and watching it go red.

## The rules that bite hardest

- **The renderer never touches the database, the filesystem, or API keys.** Everything crosses the IPC bridge in `shared/types.ts` (`ApiExpose`). If you edit that interface, you must update both the preload wrapper and the main-process handlers in the same PR.
- **No native modules.** Dependencies must be pure JS/WASM (that's why the DB is sql.js and not better-sqlite3). If a package needs node-gyp, it's the wrong package.
- **Schema changes start in `src/main/db/schema.sql`.** Sync `schema.ts` from it, make migrations idempotent (`CREATE TABLE IF NOT EXISTS`, `addColumnIfMissing`), and if you add a table, update the table list in `AGENTS.md`.
- **The main process outputs CJS.** Use the global `__dirname`, never `import.meta.url`, in `src/main/`.
- **All user-facing strings go through i18n.** `translate("key")` or the `useLang()` hook, with both zh-CN and en entries in `src/renderer/lib/i18n.ts`.
- **Design system rules live in `PRODUCT.md`.** The short version: use the semantic font tiers (never `text-xs` or arbitrary pixel sizes), use the `btn-3d-*` button classes, use lucide-react icons (no emoji in chrome), and use ink/surface color tokens instead of raw `neutral-X dark:neutral-Y` pairs.

## Commit and changelog conventions

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, with an encouraged scope like `fix(chatstream): ...`. Lowercase, imperative, no trailing period.
- Every user- or developer-visible change gets one bullet under `[Unreleased]` in `CHANGELOG.md` in the same PR, grouped under `Added` / `Changed` / `Removed` / `Fixed` / `Security`.

## Where to look next

`AGENTS.md` is the full engineering guide (architecture boundaries, service map, build gotchas, verification discipline). It's written for AI coding agents but applies to humans exactly the same. `dev-docs/` is gitignored local material, so don't be surprised that your clone doesn't have it.

## Reporting bugs

Open an issue with your OS, the app version, and what you did before things went wrong. If the console shows an error, paste it. The app is local-first, so there's no telemetry to pull from.
