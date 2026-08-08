# LookatStudy — Product Definition

## What
Local-first AI learning platform. Turns any GitHub documentation repository into a Duolingo-style course you can actually finish: gated skill-tree map, AI tutor with mastery tracking, spaced repetition, streaks. Electron desktop app, BYO LLM key, all data local.

## Who
Self-directed learners studying from open-source learning repos (e.g. Microsoft AI-For-Beginners, system-design-primer). People who find raw documentation hard to follow and want guided, interactive learning with progress tracking — and who stay motivated by game-like feedback (stars, crowns, streaks) without crossing into gambling-style dark patterns.

## Register
**Playful Product** — design serves the task of learning AND the emotion of wanting to learn. Familiarity is a feature; so is delight. Earned trust, earned joy.

This is a hybrid register. It inherits Product's discipline (state semantics, consistency, no decorative noise that obscures function) and adds the game-like layer that turns "I should study" into "I want to do one more lesson":

- **From Product**: consistent component vocabulary, full state coverage (hover/focus/active/disabled/loading/error), 150-250ms state-conveying motion, density when users need it, accuracy over surprise.
- **From Game**: 3D depth on the skill-tree nodes, stars and crowns as earned achievement, a restrained pulse on the "your turn" node, color-coded mastery, immediate feedback on answers.

The line we hold: **game-like feedback serves learning motivation, not engagement extraction.** No gems shop, no loot-box animations, no loss-aversion streaks, no leaderboards that punish. Streaks use free monthly freezes, not virtual currency. Stars reflect real mastery (BKT-driven), not grinding.

## Color strategy
**Full palette** — five named roles, each used deliberately. Duolingo-inspired on dark surfaces.

| Role | Color | Token | Used for | Never for |
|------|-------|-------|----------|-----------|
| **Progress** | `#58cc02` | `brand` | advancing / correct / primary action / current selection / "your turn" pulse | decoration, links, warnings |
| **Interact** | `#1cb0f6` | `accent` | clickable text, secondary actions, links, in-progress state | progress, mastery, errors |
| **Mastery** | `#ffc800` | `gold` | crowns, mastered nodes, achieved daily goal, stars filled | progress, interaction |
| **Review** | `#ff4b4b` → `#ff7a00` | `warning`/`orange` | overdue SRS items, wrong answers, destructive actions | progress, mastery |
| **Neutral** | neutral-50 → 950 | `neutral` | surfaces, text, borders, disabled, locked | semantic emphasis |

Dark-only (neutral-950 base). Light mode is not supported in v0.5 — it will be added as a dedicated milestone with systematic theme pairing (not ad-hoc fixes). Every text/background pair must hit ≥4.5:1 contrast (≥3:1 for large/bold).

## Typography
Single sans family (system-ui stack). Fixed rem scale. Tight hierarchy: lesson titles 1.25rem, body 0.875rem, labels 0.75rem. No display fonts — this is a tool, not a magazine. **User-adjustable** body size in the chat panel (A- / A+ small/medium/large), persisted to localStorage.

## Iconography
**Unified system: `lucide-react` line icons.** No emoji as primary functional icon — emoji may appear decoratively in AI-generated content and empty-state illustrations only. This is the single biggest source of visual inconsistency to fix; the codebase already depends on lucide-react but underuses it.

| Surface | Icon treatment |
|---------|---------------|
| Nav / actions | lucide line icons, 16-20px, currentColor |
| Skill-tree node states | keep emoji (👑 ⭐ 🔒 📘) — these are game-like achievement glyphs, deliberate |
| Status badges | lucide (flame for streak, target for mastery, book for review) |
| Empty states | emoji decorative (📓 🧩 📖), large + low opacity |

## Motion
150-250ms transitions for state changes. Exponential ease-out curves. Reduced-motion respected globally.

**Allowed (state-conveying)**: lesson-bubble hover scale, msg-enter, tab slide, typing-dot (AI working), node-active-pulse on the "your turn" node only (restrained, 2.4s cycle).

**Banned (decorative)**: page-load choreography, ornament loops, infinite ambient pulses on multiple elements simultaneously.

**Future hooks (reserved, not implemented)**: particle burst on correct answer, short sfx on unlock/streak, virtual teacher expressions. These are placeholders in `ParticleFx.tsx` — fill in a dedicated design pass, do not block v0.4.

## Key surfaces
1. **Skill-tree map** (left rail, collapsible) — Duolingo-style vertical winding path of 3D circular lesson nodes with locked/available/in-progress/mastered states, 0-3 stars, crown for mastered. Winding SVG path connects nodes. Course mastery % + streak at top. This IS the dashboard — no separate dashboard page.
2. **Thread tabs** (chat panel header) — Chrome-style horizontal tabs, one per conversation thread. Current tab highlighted, gear menu (rename/archive/delete) on hover, + to create. Auto-named from first user message.
3. **AI agent panel** (chat, center) — streaming chat with parts-based rendering (text / reasoning-foldable / tool-call / proposal-apply). Markdown with GFM tables, code blocks with copy button. Font-size control. Starter prompts row. Cmd+K command palette.
4. **Notebook** (right, persistent) — three tabs: 讲解 (current node content) / 笔记 (this node's AI artifacts, auto-persisted, pinnable, deletable) / 全部 (cross-node timeline). This is the "chalkboard" — everything AI generates is saved here, reviewable anytime.
5. **Review drawer** (overlay from map badge) — four-quadrant SRS panel (overdue / short-term / long-term / inactive), session capped at 10, self-rating on review.
6. **Settings drawer** (overlay from header gear) — BYOK provider config, custom providers, daily goal, theme, language.
7. **Import view** (full main area when toggled) — GitHub URL or markdown paste.

## What this is not
- Not a chat app. The AI tutor serves learning, not general conversation. Off-curriculum questions get a gentle "this isn't in the current material" redirect.
- Not a gamification casino. No virtual currency, no leaderboards that punish, no loss-aversion mechanics. Game-like feedback exists to motivate learning, full stop.
- Not a content authoring tool. Users learn from imported repos; they don't write courses (custom skills are system-prompt fragments, not authoring).

## Design system authority
This file is the authority. `src/renderer/index.css` (CSS tokens, 3D button/bubble classes, animations) and `tailwind.config.ts` (color tokens, typography plugin config) are the implementation. When they conflict, this file wins — fix the code.
