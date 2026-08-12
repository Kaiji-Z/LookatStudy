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
**Full palette** — six named roles, each used deliberately. Duolingo-inspired on dark surfaces.

| Role | Color | Token | Used for | Never for |
|------|-------|-------|----------|-----------|
| **Progress** | `#58cc02` | `brand` | advancing / correct / primary action / current selection / "your turn" pulse | decoration, links, warnings |
| **Interact** | `#1cb0f6` | `accent` | clickable text, secondary actions, links, in-progress state | progress, mastery, errors |
| **Mastery** | `#ffc800` | `gold` | crowns, mastered nodes, achieved daily goal, stars filled | progress, interaction |
| **Error** | `#ff4b4b` | `warning` | wrong answers, destructive actions, errors | progress, mastery, streak |
| **Review** | `#ff7a1a` | `review` | overdue SRS items, streak flame, "due" badges (warm, non-error) | errors, progress |
| **Exam** | `#a855f7` | `exam` | chapter-exam boss nodes (6th role) | normal lessons, progress |
| **Neutral** | neutral-50 → 950 | `neutral` | surfaces, text, borders, disabled, locked | semantic emphasis |
| **Surface tiers** | `--surface-rail/0/1/2/3` | `surface` | pane backgrounds by depth (see below) | semantic emphasis |

The single source of truth is `:root` in `src/renderer/index.css` (OKLCH variables). Tailwind colors reference them via `rgb(var(--xxx-rgb) / <alpha-value>)`. To change a color, edit only the `:root` variable — all utilities (`text-brand`, `bg-exam`, `border-review`) and component classes update automatically. `scripts/verify-color-semantics.mjs` enforces the semantic rules (no raw `red`/`orange`/`green`/`purple` in classNames).

Dark-only (neutral-950 base). Light mode is not supported in v0.5 — it will be added as a dedicated milestone with systematic theme pairing (not ad-hoc fixes). Every text/background pair must hit ≥4.5:1 contrast (≥3:1 for large/bold).

### Pane separation = depth-tiered surfaces, no dividers (v0.6)

Panes are separated by **background lightness contrast**, never by 1px border lines. The flat-neutral-800-divider-everywhere look is banned (SaaS-dashboard default, reads as "土"). Four surface tiers, L 0.14 → 0.32 in OKLCH:

| Tier | L | Tailwind | Used for |
|------|---|----------|----------|
| `surface-rail` | 0.14 | `bg-surface-rail` | Left MapRail — deepest, sky canvas + balloons pop |
| `surface-0` | 0.16 | `bg-surface-0` | Modals / drawers (overlay floats) |
| `surface-1` | 0.18 | `bg-surface-1` | Middle chat pane |
| `surface-2` | 0.22 | `bg-surface-2` | Right notebook pane — brightest reading area |
| `surface-3` | 0.32 | `bg-surface-3` | Hover / elevated elements |

L step is **0.04+**, not 0.02. Weber-Fechner: at low luminance, perceived brightness compresses, so an RGB delta of ~9 (L step 0.02) is invisible. 0.04+ (RGB delta 12-14) is the实测 threshold for visible separation on dark backgrounds. When in doubt, compute the RGB delta via the OKLCH→sRGB pipeline, don't trust the L number alone.

## Typography
Single sans family (system-ui stack). No display fonts — this is a tool, not a magazine.

### 6-tier semantic font scale (v0.7)

All text uses rem-based semantic classes (defined in `index.css`), never hardcoded `text-[Npx]`. The whole app follows one html `font-size` base, controlled by **A-/A+ in the header** (global, not per-pane). Three bases: small(16px) / medium(17px, default) / large(18px). 16px floor ensures the smallest tier stays readable (12px @small).

| Tier | rem | @small(16) | @medium(17) | @large(18) | Used for |
|------|-----|-----------|-------------|-----------|----------|
| `text-caption` | 0.75 | 12.0px | 12.8px | 13.5px | badge / count / logo (readability floor) |
| `text-label` | 0.825 | 13.2px | 14.0px | 14.8px | form label / timestamp / subtitle |
| `text-body` | 0.875 | 14.0px | 14.9px | 15.8px | buttons / inputs / chat / tooltip (main interactive text) |
| `text-lead` | 1.0 | 16.0px | 17.0px | 18.0px | body prose (explanations / notes) |
| `text-title` | 1.125 | 18.0px | 19.1px | 20.3px | card titles |
| `text-hero` | 1.5 | 24.0px | 25.5px | 27.0px | large titles / empty states |

Banned: `text-[10px]`, `text-[11px]`, `text-xs` (all eliminated). When adding text, pick the semantic tier by role, not by eyeballing the size. Persisted to localStorage.

## Iconography
**Unified system: `lucide-react` line icons.** No emoji as primary functional icon — emoji may appear decoratively in AI-generated content and empty-state illustrations only. This is the single biggest source of visual inconsistency to fix; the codebase already depends on lucide-react but underuses it.

| Surface | Icon treatment |
|---------|---------------|
| Nav / actions | lucide line icons, 16-20px, currentColor |
| Skill-tree node states | keep emoji (👑 ⭐ 🔒 📘) — these are game-like achievement glyphs, deliberate |
| Status badges | lucide (flame for streak, target for mastery, book for review) |
| Empty states | emoji decorative (📓 🧩 📖), large + low opacity |

## Motion
游戏感 + 沉浸是 Playful Product register 的 "Game" 一半 —— 动效服务"想再学一课"的动机,而非成瘾。`motion` 库做编排(入场/退场/弹簧/stagger),CSS 做微交互,canvas 做粒子爆发。指数 ease-out 曲线(`--ease-*` 变量)。

**中央庆祝总线(v0.9)**:`celebrate(kind)` event bus(`lib/celebration.ts`)+ `<CelebrationLayer>` 根级 canvas 粒子层。7 个高光时刻统一接入(correct/wrong/unlock/mastery/streak/energy-full/exam-pass),触发与渲染解耦 —— 新增反馈点 = 一行 `celebrate()`。renderer 订阅 main 的 `state:changed` 推送(xp/streak/mastery 变化)自动重拉 + 触发庆祝。

**Allowed**: 状态指示器氛围动效(单 hero 呼吸:`energy-breathe`/`flame-flicker`/`crown-sparkle`)、庆祝高光(300-1200ms 粒子爆发)、msg-enter/tab-slide/typing-dot/bubble-active-pulse、mastered 皇冠展示氛围。

**a11y 双轨(红线,非审美)**:`prefers-reduced-motion` 是 WCAG 底线。默认丝滑游戏感;系统选"减少动效"时,`usePrefersReducedMotion`(`useSyncExternalStore`)+ 全局 CSS guard + skyCanvas 单帧降级 —— 所有动效降为淡入/瞬时,粒子层降级为静态图标淡入。这条任何升级都不能破。

**engagement-extraction 禁令(红线)**:无 loot-box/损失厌恶/赌博式反馈。游戏感服务学习动机,不服务成瘾。

**`ParticleFx.tsx` 已 deprecated**:被 `<CelebrationLayer>` + `celebrate()` 总线取代。保留文件作历史,新代码用 `celebrate()`。

## Key surfaces
1. **Skill-tree map + import** (left rail, full-height, `surface-rail`) — Duolingo-style vertical winding path of 3D circular lesson nodes (locked/available/in-progress/mastered/exam states) with scroll-driven scrollytelling sky + seasonal×weather presets. Floating glass tab bar switches between 课程地图 / 导入课程 (sliding panels, shared sky background). Course mastery % + review-due badge as floating glass header. Full-height: panes are separated by surface depth, not borders. Left pane toggle via Ctrl+B or header button.
2. **Thread tabs** (chat panel, top, ultra-thin row) — low-contrast text labels, active marked only by a 1px brand dot + semibold, no fill/border. Whole row opacity-70, hover → 100%. Gear menu (rename/archive/delete) on hover per tab. Auto-named from first message; truncated tabs show full name via GlobalTooltip on hover.
3. **AI agent panel** (chat, middle, `surface-1`, minimal-reading-flow / claude.ai style) — content is the only protagonist, toolbars recede. Streaming chat with parts-based rendering (text / reasoning-foldable / tool-call with lucide Wrench/XCircle / proposal-apply). User messages: right-aligned faint tint, no bubble. AI messages: left-aligned, no bubble. Markdown with GFM, 80ch prose cap. Starter prompts as faint pills above input. **Skill-mode pills inside the input box** (`模式: 🧭苏格拉底 ✅考试冲刺 🔨项目实战 🔄复习`), each with icon + tooltip explaining when to use. Cmd+K command palette.
4. **Notebook** (right, persistent, `surface-2`) — two tabs in **segmented control** (讲解 / 笔记, deliberately different vocabulary from thread tabs which are pill-row): 讲解 = current node markdown content with persistent highlight + quote-to-chat; 笔记 = Cornell three-zone (理解/记录/练习). Tab vocabulary matches MapRail tabs (equal-flex capsule + brand/20 active).
5. **Header** (over middle+right panes only, glass-fade) — transparent + backdrop-blur + bottom mask gradient (melts into content, no hard line). Left: layout toggles (PanelLeft/PanelRight) + logo. Right: global font A-/A+ → XP bar → settings gear → streak flame.
6. **Review drawer** (overlay from map badge, `surface-0`) — four-quadrant SRS panel (overdue / short-term / long-term / inactive), session capped at 10, self-rating on review.
7. **Settings drawer** (overlay from header gear, `surface-0`) — BYOK provider config, custom providers, daily goal, language.

### Component primitives (v0.6)
- **`btn-3d-brand`** = primary action everywhere (no `btn-3d-blue`, removed as orphan).
- **`ConfirmCard`** — inline confirmation popover (portal to body), replaces ALL native `confirm()`. Danger actions get warning-red left stripe.
- **`Toast`** with `severity` prop (success/error/warning/info/default), each with semantic left-stripe + lucide icon, exit animation.
- **`GlobalTooltip`** — portal-based, follows mouse, left-bottom anchor. Any element with `data-tooltip` attribute gets hover tooltip. Use this for truncated titles, mode explanations, node names.

## What this is not
- Not a chat app. The AI tutor serves learning, not general conversation. Off-curriculum questions get a gentle "this isn't in the current material" redirect.
- Not a gamification casino. No virtual currency, no leaderboards that punish, no loss-aversion mechanics. Game-like feedback exists to motivate learning, full stop.
- Not a content authoring tool. Users learn from imported repos; they don't write courses (custom skills are system-prompt fragments, not authoring).

## Design system authority
This file is the authority. `src/renderer/index.css` (CSS tokens, 3D button/bubble classes, animations) and `tailwind.config.ts` (color tokens, typography plugin config) are the implementation. When they conflict, this file wins — fix the code.
