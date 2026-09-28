# DESIGN.md — LookatStudy web surfaces

Recorded from the built world by the finish pass (2026-09-28). The app's own design
authority is `PRODUCT.md` + `src/renderer/index.css`; this file records the **GitHub
Pages landing site** (`site/`), which inherits the app's identity.

## Surface: landing page (`site/`)

**Visitor mode:** Persuade. Success = a first-time visitor knows what LookatStudy is,
believes the tutor actually tracks weak spots, and clicks Download, within seconds.

**Thesis:** the app's night-sky skill map *is* the landing page. The first viewport is a
live, looping gated-path demo (a node studies → masters → unlocks the next), not a
screenshot with feature cards. Every mechanism below the fold is proven by an in-page
recreation, not claimed in prose.

### The hero rail is the real thing (v2)

The hero demo window is no longer a replica built from scratch — it runs the **app's own
modules**, bundled for the static page by `scripts/build-rail-demo.mjs` (esbuild →
`site/rail-demo.js`, IIFE on `window.RailDemo`; source bridge: `site-src/rail-entry.ts`):

- **Physics**: `src/renderer/lib/mapPhysics.ts` verbatim — Matter.js island, gravity,
  buoyant balls, rope particle chains, soft-grab drag (`beginDrag/moveDrag/endDrag`),
  collisions, squash. Balls are draggable and throwable, exactly like the app.
- **Sky**: `src/renderer/lib/skyCanvas.ts` verbatim — `attachSky` (season/weather preset
  picked deterministically from the seed course id, same as the app) + `attachOrbWeather`
  (rain/snow/splash anchored to the live ball positions).
- **Layout**: `src/renderer/lib/mapLayout.ts` — `computeBalloonLayout` deterministic
  balloon scatter from the seed course id.
- **Bot**: the default companion form (Ember) rendered from the real component
  (`companion/forms/ember.tsx`) via `scripts/export-ember-svg.mjs` (react-dom/server →
  `site/ember.svg`, with internal thruster/antenna-glow animation). Not a redrawn lookalike.
  Behaviors on the page: perches on the current ball and follows its physics sway, can be
  dragged, thrown (ballistic + bounce inside the panel), and pokes on click.
- Narrative loop kept minimal: ring fills → ball masters (crown + confetti) → rope turns
  green → next ball unlocks (⭐ + gold next-cue ring) → bot flies over. Course content
  (titles, section names) comes from `src/main/assets/seed-course.json`.

Build entries: `node scripts/build-rail-demo.mjs` and `npx tsx
scripts/export-ember-svg.mjs` — re-run both after pulling changes to the app modules.
No tabs/course-header chrome in the window (dropped deliberately): sky, physics, balls,
ropes and the bot fill the frame.

### Color

Deep-night ground, the app's MapRail world (the gamified dark scene that never switches
light). Six semantic roles carried over unchanged from the app:

| Role | Value | Used for |
|---|---|---|
| brand / progress | `#58cc02` (edge `#46a302`) | primary CTA, mastered node, mastery bar (high), links hover |
| accent / interact | `#1cb0f6` | in-progress ring, language/ghost buttons, read-aloud highlight & bars, focus rings |
| gold / mastery | `#ffc800` | crowns, stars, proposal card border (AI drafts) |
| exam | `#a855f7` | boss-exam node & exam panel accents |
| warning | `#ff4b4b` | reserved (none on the page) |
| review | `#ff7a1a` | confetti only |

Ground scale: `--night-0 #0b0f1a` (page), `--night-1 #101828` (why band), `--panel
#131c2e` / `--panel-2 #0f1626` (demo chrome), hairlines `--line #232d42`. Text: `#e8edf6`
/ `#96a3ba` / `#6f7e97`. The page is dark-anchored on purpose; no light theme.

### Type

System sans stack (matches the app; CJK-safe via PingFang/YaHei). Display = weight 900,
tracking −0.025em, `clamp(2.3rem→3.4rem)`; h2 800; card headings 800 at 1.08rem; body
16px/1.65. No display face, no gradient text. Numerals in the timer/mastery readouts are
tabular (`font-variant-numeric`).

### Components

- **3D push-down buttons** (`.btn`): solid fill + 4px darker bottom edge; `:active`
  translates 2px and thins the edge — the app's `btn-3d` vocabulary, kept on purpose.
- **Demo panels** (`.panel`): 18px radius, 1px hairline, offset+blur shadow. Panels are
  materially different inside (chat flow, karaoke text, quiz, pipeline) — never a grid of
  icon+heading+text cards.
- **Bot mark**: one shared SVG symbol (`#bot-face`): red body, dark visor, two teal bar
  eyes (the app's vertical-bar eyes). Used in nav, footer, map demo, read demo, pipe hub.
- **Map demo geometry**: fixed 300×470 coordinate world (`.map-world` aspect-ratio);
  nodes positioned in %, path as one SVG. Progress ring = SVG stroke-dashoffset.

### Motion

One authored focal loop: the hero skill-map demo (~10s cycle: ring fills → check pop +
confetti burst → next node unlocks with pulse → path segment draws → bot flies to the new
node). Supporting demos each run one purposeful cycle (typewriter reply → proposal glow →
toast → mastery counts up; karaoke sentence sweep; exam countdown → pick → star pop;
import chips fly into the hub, lessons pop out). Format strip is a linear marquee.

Rules held: loops pause when offscreen (IntersectionObserver) and under
`prefers-reduced-motion` the page renders static mid-story frames with everything visible;
entrance animation is deliberately absent; layout properties are never animated (width
→ `scaleX`, bar height → `scaleY`); no-JS keeps all content visible (hidden states are
gated behind a `js` class).

### Anti-goals (checked at finish)

No kicker/eyebrow labels; no icon-card grids; no gradient text; no colored side-borders;
no glass decoration (nav blur is the app header's glass-fade pattern); browser chrome
themed (selection, scrollbar, focus ring, caret).

## Surface: full-screen course world (hero, `site/` + `site-src/rail-entry.ts`)

The hero **is** the app's left rail, rebuilt from the real modules — not a lookalike.
`scripts/build-rail-demo.mjs` bundles `site-src/rail-entry.ts` (esbuild, IIFE →
`window.RailDemo`) importing the app's actual `mapPhysics.ts` (Matter.js islands:
gravity, buoyant balls, rope particle chains, soft-grab drag `DRAG_STIFFNESS 0.09`,
locked balls = static bodies, FIELD_RANGE repulsion), `mapLayout.ts`
(`computeBalloonLayout` deterministic scatter), and `skyCanvas.ts` (`attachSky`
scrollytelling: scroll progress drives dawn-to-night interpolation, moon/sun arcs,
clouds, rain/snow/fog/lightning; `attachOrbWeather` ball-anchored decoration).
The bot is the app's real Ember form exported to `site/ember.svg`.

Six authored chapters (24 nodes) form a complete course route the visitor can play
with: drag balloons (rope physics answers — same elasticity as the app), grab/throw/
poke the Ember bot (ballistic fall + bounce + perch return), and scroll to watch the
sky turn. An opening performance (~3.7s) fills the current node's ring, awards the
crown, and unlocks the next node with a next-cue ring and the bot hopping over.

Bridge semantics worth keeping:
- **Sections freeze offscreen** (±220px pad) — same CPU discipline as the app.
- **Weather dock** = `setWeather`: rebuild islands (environment params pinned,
  unlocked set preserved — app semantics), re-attach sky. Narrative green ropes
  are bridge-external state, restored via the `onRebuild` callback.
- **Viewport resize** rebuilds islands (120ms debounce) — the app MapRail's
  ResizeObserver-rebuild behavior; without it balls keep desktop px coords and
  the bot perches off-screen.
- **reduced-motion**: bridge skips its rAF entirely (`buildAll` already places
  balls/ropes at physical layout positions; `attachSky` has its own reduced
  single-frame + scroll-coalesced redraw; orb layer no-ops). The bot places once
  and never animates. Opening performance is skipped.
- Labels/stars/bot use **fixed positioning fed viewport px** — `railBallPoint`
  composites `handle.ballPos` (island coords) with the world's viewport rect.
- The world starts unconditionally in `boot()`, NOT behind the IntersectionObserver
  demo gate — it *is* the first screen.

### v3 physics alignment + scripted demo loop (2026-09-28)

- **Rope rendering = particle chains**, same as MapRail's rAF: per link,
  `[attachOf(from), ...link.particles, attachOf(to)]` through `ropeChainPathD`
  (attach = ball bottom, `r × ROPE_ATTACH`). The earlier two-point straight line
  read as a rigid rod — ropes now sag, swing and reel the ball back like the app.
- **`decaySquash` per frame** (renderer-side duty in the app too): collision
  squash used to stick forever.
- **Impact pulse rings**: per-section pool of 8 SVG circles (PULSE_MS 520,
  radius/opacity by impact speed). `drainImpacts` has a single consumer in the
  bridge frame; the orb layer reads a pending-impacts cache (no double drain).
- **Field halos**: one blue circle per ball driven by `b.field`.
- **Orb weather layer draws on `#railOrbs`** (z-20 over the balls), not the sky
  canvas — snow caps, wet gloss and splashes were invisible before.
- **Weather presets**: only 12 season×weather combos exist; `setWeather` falls
  back to the nearest season that has the requested weather (snow→winter,
  storm→summer) so the dock never fakes a switch.
- **Preset demo loop** (main.js `runScript`): five scenes — opening mastery,
  quiz celebrate + exam unlock, exam stars, cascade into chapter 2, weather
  theater — then a fade-out soft reset that replays from the initial world.
  Scenes wait on a pausable clock: user pointerdown silences the script for 8s
  and scroll-out of the hero freezes it; reduced-motion never enters.
- Staging server (`preview-pages.mjs`) now serves `cache-control: no-cache`.

### Hero copy card (impeccable audit fix, 2026-09-28)

The sticky hero copy now lives on a **constant-dark card** (`.world-copy`:
165deg night gradient .94→.80, hairline border, radius 20, offset+blur shadow,
6px functional backdrop blur — same self-darkening language as the signpost
cards/pills/hint). Reason: the card used to ride the sticky range to sky
progress ≈0.33-0.40 (brightest morning band, rgb(172,145,122) mid + a ~170px
sun halo sweeping the column) where white text measured 2.4:1 and the green
em 1.9:1 — below the 3:1/4.5:1 floors, on every randomized season palette.
On the card: h1 ≈13:1, em ≈5.8:1, sub ≈5.4:1 at every scroll position.

Also fixed by the audit: the h1 clamp (2.3→3.4rem) was written against
`.hero-copy h1`, a class this page never uses — the title rendered at the UA
default 32px; it now targets `.world-copy h1` with `text-wrap: balance`.
`.start` gained a `--night-0` background (the fixed sky canvas showed through).
The old text-shadow compensation is gone — superseded by the card.

### Scroll-Driven split screens (2026-09-28, v4)

The page is now a sequence of scroll-driven screens. Each `.screen` is a tall
scroll budget (world 360vh, demos 300vh) with a `sticky` 100vh `.stage` —
scrolling advances that screen's demo timeline; scrolling back rewinds it
(every mapping is an idempotent function of screen progress p∈[0,1], driven by
one global rAF in `driveAll`). Wheel jumps at screen boundaries: near a screen
end one more scroll smoothly jumps to the next screen top (`initWheelJump`,
never intercepts in-screen scrolling). CSS scroll-snap was removed — proximity
snap hijacked programmatic scrolling.

- **Screen 1 (world)**: copy card left ~1/3, skill map right ~2/3. Demo course
  reduced to 3 chapters × 4 balls (12 nodes, host-computed layout
  `demoPositions`, ball 88px CSS / physics radius 44 via `ballRadius`).
  `applyWorld(p)` keyframes: ring fills → mastery crown → unlock → exam target
  ball → three stars → cascade into chapters 2-3; bot/label perch follows the
  active chapter; bursts fire on forward threshold crossings only.
- **Screens 2-5**: chat / read / exam / import demos, each on its own screen;
  the old time-looped `makeDemo` cycles are retired — typing, sentence
  highlight, countdown and pipeline chips are now all pure p→state mappings.
- Sky keeps the whole-page dawn→night cycle (attachSky untouched).
- Screen headings + hero copy live on constant-dark chips/cards (same
  self-darkening language), so white text stays readable at every sky phase.
- `.world-hint` must be absolutely positioned inside the flex-row stage — as a
  flex child it got stretched into a full-column dark slab.
- reduced-motion: static finished state (applyWorld(1), demo p=1), no wheel
  hijack, bridge rAF skipped.

### Four content screens (2026-09-28, v5)

Screen order now follows the product story, per user direction:
1. **Skill map** — hero copy + an import strip inside the copy card (7 source
   chips → bot hub → lesson chips, `applyImport` on the world-screen timeline)
   + the playable physics map. "Everything becomes a simple skill map."
2. **AI tutor** — full "start to mastery" loop on one screen: user asks → tutor
   types → **quiz-mini** (3 options, correct one lights, "Correct — mastery
   updated") → proposal ("Mark mastered + schedule the quiz") → apply →
   mastery bar 41→78%.
3. **Notebook** — read-aloud karaoke + a highlighted sentence turning into a
   note chip + a blackboard **concept map** (SVG nodes pop, edges stroke-draw
   by progress; `style.strokeDashoffset` — CSS class values outrank SVG
   attributes).
4. **Companion** — large Ember hero (drop-in by progress; `height:auto` or the
   global `.bot{height:32px}` squashes the SVG) + three cards (preset forms /
   custom puppet / Shimeji), staggered in.

Legacy exam/import demo screens retired (quiz-mini + import strip absorb
them). New i18n keys (`tutor.*`, `nb.*`, `cm.t`, `s4.*`) in both dictionaries.
Screens after #4 (formats/shots/why/start/footer) stay normal-flow.

### v6: five screens, import gets its own stage, all balloons light up (2026-09-28)

- **Screen order**: import (full-screen pipeline) → skill map → tutor →
  notebook → companion. The import strip left the world card and became its
  own screen: big source chips → 130px bot hub → a **course card** (course
  name + 4×3 level-dot grid + live %; dots light as chips land).
- **Skill map timeline extended**: all 12 balls light up by p=1.0 (chapter 1
  detailed, chapter 2 medium, chapter 3 fast; every rope turns green; bot
  perches through 10 stops). Verified: 9 mastered + 3 exam-passed at p=1.
- **Every demo screen is now left-copy / right-demo**: `.side-copy` (constant-
  dark card, one heading + one sentence) + `.demo-area`. Panel-internal h3/sub
  removed — the side copy IS the copy. Selector convention:
  `[data-screen="…"]` (`.screen-import` was an id, not a class).
- Copy cut to one line per screen; `hero.sub` reduced to a single sentence.

### v7: audit round — screen order fixed to spec, arrival states, mobile fit (2026-09-28)

Impeccable audit found and fixed:
- **P0 screen order**: DOM had map first; spec (and the jump table) wanted
  import first. Import now opens the page carrying the hero h1/CTA/pills in
  its side-copy; the map screen got a lean card (map.head/map.sub). This also
  fixed the wheel-jump sequence, which had been skipping import (array order
  vs DOM order mismatch).
- **Arrival states**: `.quiz-mini`/`.proposal` had no hidden base (orphan quiz
  visible at chat p=0); added `.js` hidden-until-`.in` rules. Wheel jump now
  lands 8.5% into a screen (chat 39%) so arrivals show a living frame, not p=0.
- **Bot/label leakage**: the fixed rail bot/label/stars are gated by strict
  world-section viewport intersection — no half-cut bot on the landing, no
  duplicate bot on demo screens. Bot, weather dock and rail label are hidden
  on <860px; import pipeline compacts to fit 844px (course card fully visible).
- **Import chips**: idle opacity .55→.85 plus a quiet `.done` border after the
  chip is consumed, so the end state no longer reads as disabled.
- Detector findings on `.btn` (4px bottom border + width transition) verified
  as the intentional 3D push-down signature — documented, not "fixed".

### v8: five screens rebuilt to user storyboards (2026-09-28)

- **Screen 1 · import-as-charge**: source chips became icon chips (inline
  lucide-style SVGs); on scroll each icon physically flies into the bot
  (scroll-driven transform with cached fly vectors), and the right card is now
  a **charge bar** ("仓库解析中" pulsing dot → "解析完成 ✓" at 100%, green
  glow). "课程已生成" suffix only fades in when done.
- **Screen 2 · one section, four balls, big facts**: the 3-chapter map became
  a single centered zigzag column (4 balls, 3 lessons + exam) with a
  `map-facts` column on the right; each lit ball pops a big dark fact card
  (micro-lessons / AI mastery / pinball / mini boss fight — fact.1..4).
  Ropes are now reversible (ropeSet), timeline TRACK/BOT_STOPS rebuilt.
- **Screens 3–4 · one story, 神经网络基础**: tutor demo = "开始学习" → weighted
  sum + activation intuition → activation quiz → mastery proposal (kc.nn/
  kc.bp bars). Notebook demo = same lesson with real formulas (sub/sup
  markup), a chalk-style `.cm-formula` plate on the blackboard, and concept
  nodes 神经元/加权求和/激活/决策边界.
- **Screen 5 · living companion**: ember.svg inlined (vector, animatable
  groups); eyes track the cursor (lerp + head tilt), random blinks, mouth
  flap while the speech bubble types compLines, click = hop/spin/wave +
  surprised eyes. IO-gated per screen; REDUCED shows a static line.
- **Typeset pass**: Nunito (700/800/900) via Google Fonts with system CJK
  fallback; zh body line-height 1.75; negative tracking only on :lang(en)
  headings; tabular numerals for %, timer, sign numbers; h2 900 + balance.

### v9: the real app Mascot on screen 5 (2026-09-28)

Replaced the hand-rolled site bot with the actual app component:
`src/renderer/components/companion/Mascot.tsx` bundled via
`scripts/build-comp-demo.mjs` (esbuild → site/comp-demo.js, IIFE
`window.CompDemoMount`, jsx automatic, @shared alias; ~289KB min with React
+ all seven form arts — custom/shimeji stores only touch window.api inside
functions and never mount for ember, so the static site is safe).

- `site/companion.css` is the verbatim cp-* block lifted from
  `src/renderer/index.css` (self-contained: only --cp-* custom props).
- `site-src/comp-entry.tsx` mounts a prop-driven driver (set/tapKey/onPoke) —
  same control surface the app's Creature uses.
- Screen 5 choreography: enter = wave pose → float; speech bubble types with
  real viseme+openScale mouth flap and expression "talking"; rest = base
  expression (the app's gaze-tracking state — happy face is intentionally
  fixed-art); click through Mascot's own onPoke = surprised + hop.
- Screen 1 dead-scroll removed: first icon starts flying at p≈0.03.

### v10: display-type line breaks + hero card polish (2026-09-28)

- zh display headings now carry manual `<br>` breaks at word boundaries
  (browsers break CJK per-character — 东/西, 导/师, 笔/记 were all split);
  lede reworded to drop the "——" that orphaned at line starts.
- Hero card: h1/h2 line-height 1.24/1.32 (CJK punctuation needs air),
  padding 30/32, inset top hairline (glass edge), side-sub line-height 1.75.
- Pills: 3 tidy pills + a muted `.platform-line` caption for the OS list
  instead of a ragged fourth pill.

### v11: copy cards grow app anatomy — companion bubble card (2026-09-29)

The copy cards stopped being generic dark boxes and committed to the
product's own grammar (skill doctrine: a local extension inherits the world;
"near-black + glow" is exactly the AI-default look to refuse):

- **Card = the companion speaking**: a bot coin (ember badge, 58px circle)
  overlaps the top-left corner, a diamond tail points to it — every copy card
  on all five screens is now the buddy saying that screen's line.
- **3D plate bottom edge** (6px darker border, btn-3d language) matches the
  press-down buttons already on the card.
- `world-copy` deduped into the shared `.side-copy, .world-copy` box rule;
  its old standalone box styles removed.

### v11.1: bubble-card craft pass (2026-09-29)

- Coin: 62px, gradient fill, bot at 92% with feet cropped into the ring
  (sits in the badge, not pasted on); brighter ring #354263.
- Tail: back to the card's own translucent navy (solid #101826 read as a
  patch over bright skies), 13px, hugging the coin's edge.
- Tail REMOVED (user call): the coin alone anchors the card — cleaner.
- Plate: bottom edge 7px #0c1322 + a 1px lip line inset above it — the edge
  reads as thickness, not a flat strip.
- Entrance: non-landing copy cards fade/slide in from their screen's scroll
  progress (`.seen`, reversible); the landing hero card is always visible.
