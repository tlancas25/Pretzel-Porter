# Cyberpunk TUI — Plan & Architecture

A working document for the `cyberpunk-tui` branch. Lives in the repo so it
survives session boundaries; both the user and Claude edit it as decisions
land and phases ship. Branch is **local only — do not push**.

---

## Vision

Push pport beyond a "polite REPL" and into something that *feels* like the
machine is alive. Hyper-stack data density, live meters, glitch-where-it-helps
animation. Cinematic enough to enjoy looking at; restrained enough to not get
in the way of work.

Long-term, this may seed a separate "better terminal" project. For now: make
pport on macOS feel like the best TUI experience the user owns.

---

## Decisions locked

| Axis | Choice | Why |
|---|---|---|
| Terminal target | **Ghostty** (Terminal.app as degrade) | GPU-fast, sync output, Kitty image protocol unlocks Phase 6 stretch |
| Aesthetic | **Hyper-stack** | Multi-pane, sparklines, bracketed tags, dense info — picked from 4 mock options |
| Motion | **Subtle + streaming flair** | Boot, spinner, pulse, typewriter, CRT cursor, glitch on errors |
| Layout | **Full-screen alt-screen mode** | Pinned HUD top + pinned status bar bottom + scrollable viewport between |
| Compatibility | **Target Ghostty first, degrade later** | Sharper v1; we don't constrain the design to the lowest common denominator |
| Plan doc | **CYBERPUNK_TUI_PLAN.md on branch** | This file. Editable by user, kept in sync as phases ship |
| Build order | **Foundation first** | Theme tokens / capabilities / viewport / animation hook done right before any pixel polish |

---

## The token-cost budget

Every terminal cell falls into one of two buckets:

- **Chrome** — borders, header, status bar, widgets, sparklines, animations, banners. **Token-free.** Drawn by Ink; never enters the agent's message history. Spend freely.
- **Conversation** — user prompts, model responses, tool call summaries, diffs. **Every character costs context.** Spend with restraint.

Design rule: aesthetics go in the chrome lane; the conversation lane stays
lean. A sparkline showing tokens/sec is free; quoting a 200-line file back in
the assistant output is not.

---

## What Ghostty unlocks

| Capability | We use it for |
|---|---|
| 24-bit truecolor | Neon palette (hot pink / cyan / amber / mint) |
| Synchronized output (mode 2026) | Flicker-free sparkline + pulse animations |
| Kitty image protocol | **Phase 6 stretch:** real pretzel logo, possibly inline diff images |
| OSC 8 hyperlinks | Clickable file paths in tool output |
| Alt screen buffer | Full-screen mode without nuking the user's previous terminal contents |
| GPU rendering | 10fps redraws feel instant, no CPU spike |

Terminal.app fallback: same Unicode + truecolor, but no sync output (animations
will flicker), no images, no clickable links. Acceptable degrade — pport still
*works*; it just doesn't shimmer.

---

## Architecture

### Full-screen lifecycle

```
launch
  ↓
boot sequence (typed cadence, normal terminal output)
  ↓
enter alt screen   →  \x1b[?1049h
  ↓
mount Ink <App>    →  pinned HUD + viewport + status bar
  ↓
[ session runs ]
  ↓
unmount Ink
  ↓
exit alt screen    →  \x1b[?1049l
  ↓
user's previous terminal contents return
```

### Layout (Ink)

```
┌──────────── terminal window ────────────┐
│ ╔═ PRETZEL.PORTER ═╦═ live meters ═══╗ │ ← HUD (5 rows, pinned)
│ ║ model gemma-26b  ║ ctx 42% ████░░░░║ │
│ ║ backend cloud ●  ║ lat ▁▃▅▇▅▃tok 1k║ │
│ ╠══════════════════╩═══════════════════╣ │
│ ║ › fix the search bar bug             ║ │ ← Viewport (flexGrow=1)
│ ║ ◆ thinking                           ║ │   message buffer scrolls
│ ║ the user wants the search bar to ... ║ │   inside this region
│ ║                                      ║ │
│ ║ ● fix lives in src/components/Sear…  ║ │
│ ╚══════════════════════════════════════╝ │
│ [ idle ] [↑↓ hist] [tab cmpl] [auto] ... │ ← Status bar (1-2 rows, pinned)
└──────────────────────────────────────────┘
```

### Module map (added in Phase 1)

```
src/ui/
  theme/
    tokens.ts          ← named color/glyph/spacing roles (one palette = one file)
  capabilities.ts      ← runtime detection: truecolor, sync, OSC 8, image proto
  viewport/
    buffer.ts          ← framework-free message buffer + scroll math
  useAnimationFrame.ts ← capped-rate React hook for pulse / sparkline scrolls
```

### Module map (added in Phase 2+)

```
src/ui/
  components/
    HudHeader.tsx      ← top pinned panel
    HudStatus.tsx      ← bottom pinned bar
    ViewportLog.tsx    ← renders visible slice of buffer
    Sparkline.tsx      ← braille / block-element series
    Meter.tsx          ← horizontal bar with neon fill
    Badge.tsx          ← [ TAG ] style label
    ToolCallBlock.tsx  ← ╭─◉ / │ / ╰─◉ connected block
    ThinkingBlock.tsx  ← dim italic block with header
```

---

## Phases

### Phase 1 — Foundation *(✅ shipped — 9ab39e1)*

- ✅ `theme/tokens.ts` — color / glyph / spacing tokens exposed by role
- ✅ `capabilities.ts` — runtime detection (Ghostty / iTerm2 / WezTerm / Kitty profiles; Terminal.app degrade)
- ✅ `viewport/buffer.ts` — buffer + scroll offset + `newSinceScroll` + `computeVisibleSlice()` helper
- ✅ `useAnimationFrame.ts` — 10fps capped redraw hook (ref-stable callback)
- ✅ `altscreen.ts` — enter / exit + restore-on-crash exit hook (not wired yet; Phase 2 calls it)
- ✅ Typecheck passes; current UI unchanged because nothing's wired in

### Phase 2 — Hyper-stack frame *(✅ shipped behind PP_CYBERPUNK gate)*

- ✅ `HudHeader` — 2-column layout, model/backend on left, CTX meter +
  latency sparkline + tok/s sparkline on right
- ✅ `HudStatus` — bracketed-tag shortcuts, live state badge (idle / working / approve)
- ✅ `Sparkline` — auto-scaled block-element series with hot-color top 20%
- ✅ `Meter` — neon fill + dim track, sub-cell precision via partial blocks
- ✅ `Badge` — `[ TAG ]` label, active variant uses inverted text
- ⏸ `ViewportLog` — deferred. Current build uses `<Static>` like the default
  App so terminal scrollback still works. Fully-pinned HUD with internal
  viewport requires alt-screen mode + manual clipping; tracked for Phase 6.
- ✅ `CyberpunkApp` — new root that subscribes to the same `ui` store as
  the default App. Drop-in replacement at the `render()` call site.

### Phase 3 — Conversation styling *(✅ shipped)*

- ✅ `ToolBlock` with `╭─◉ / │ / ╰─◉` connectors and pending/ok/failed states
- ✅ `ThinkingBlock` — magenta `◆ thinking` header + dim italic body
- ✅ `DiffBlock` — `[ DIFF ]` tag + coloured gutter (`+ ` / `- ` / `@ `)
- ✅ User prompts: `›` prefix in accent.secondary (cyan)
- ✅ Streaming output flows through the same store; `LiveStream` renders
  in-progress thinking + content with a blinking CRT cursor at the tail

### Phase 4 — Boot sequence + streaming flair *(✅ shipped, partial)*

- ✅ Pre-Ink typed-cadence boot sequence with block-letter PPORT banner
- ✅ Blinking CRT cursor on streaming content (500ms blink interval)
- ⏸ Real per-step timings in boot lines — current lines are static strings
- ⏸ Glitch character flash on error lines — basic ✗ + red text only for now

### Phase 5 — Polish + theme switching *(partial)*

- ✅ Resize-handling — `HudHeader` listens to `stdout.resize` and re-layouts
- ⏸ `/theme` command — token system is in place, command not wired
- ⏸ Optional bell on confirm — not wired
- ⏸ Autonomous-mode pulse animation — `useAnimationFrame` exists, not wired
  into `HudHeader` modes badges yet

### Phase 6 — Stretch *(only if 1-5 land well)*

- Real pretzel logo via Kitty graphics protocol (Ghostty-only; degrades to a
  block-art version on Terminal.app)
- OSC 8 hyperlinks on tool-output file paths
- `/matrix` easter egg
- Possibly: optional split-pane mode for live tool output

---

## Out of scope for v1

- Mouse interaction
- Multi-pane splits (except as a Phase 6 stretch)
- Sound on by default
- Other terminals beyond Ghostty + Terminal.app fallback (iTerm2/WezTerm/Kitty
  will *probably* mostly work via fallback paths, but not tested in v1)

---

## Open questions / parking lot

- Default theme name when `/theme` lands?
- Should `/export` strip the styling (markdown-friendly) or preserve it (ANSI)?
- Boot sequence: skip if `--quick` flag? Skip if launched in <1s mode?
- "↓ N new" indicator: just a count, or animated arrow?
- Should there be a "compact" HUD variant for narrow terminals (<80 cols)?

---

## Notes for future-Claude

- This branch is **local only**. Do not `git push`.
- Origin `main` is at `v1.4.0` — the merge target if/when this lands.
- The current `src/ui/App.tsx` uses `<Static>` (scroll-along). The new layout
  is incompatible with that — Phase 2 rewrites it around viewport rendering.
- The user is on Ghostty. Effects gated behind `capabilities.syncOutput` etc.
  must be feature-detected, not hard-coded.
- Don't add Nerd Font glyphs without confirming font config — Ghostty's
  default ships without them.
