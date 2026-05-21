# Pretzel Porter — Phase 6: Polish & UX ("the canvas")

A focused roadmap to turn the terminal UI from raw scrolling output into a
designed surface — defined margins, a header, and a pinned bottom bar.
_Draft for review — 2026-05-21._

---

## Guiding principles

1. **Still zero runtime dependencies.** No Ink, no React. Everything is ANSI
   escape codes and Node builtins — the audit-readable, no-deps identity holds.
2. **The canvas.** pport's output should feel like a *framed surface*, not a
   raw stdout dump: a margin on every side, a header band at the top, a pinned
   information bar at the bottom, content scrolling cleanly between them.
3. **Degrade gracefully.** A non-TTY (piped) run or a dumb terminal falls back
   to plain, unframed output — the canvas is a TTY enhancement, never a
   requirement.
4. **Never break input.** The hard constraint is readline interop: the bottom
   bar must not fight the prompt, and a resize must not corrupt the screen.

---

## Current state — the UI today

pport prints to stdout linearly. There is no chrome:

- No margins — text runs edge to edge of the terminal.
- No header — the banner scrolls away the moment output begins.
- The status line is reprinted before each prompt and then scrolls off; it is
  not visible while the model is working.
- Tool calls, diffs, thinking, and answers are styled but not laid out — they
  share one flat left edge.

The operator asked for: a separation line at the top on open, a hard-coded
hint + info bar pinned at the bottom, a small margin on each side, and a
better overall canvas layout — correctly noting that **defining a margin is
the foundation that fixes several of these at once.**

---

## The roadmap

Effort key: **S** ≈ hours · **M** ≈ a day · **L** ≈ multi-day.

### 6.1 — Render layer & side margins — **M.** *(foundational — do first)*

A single output path. Every line pport prints goes through one renderer that:

- applies a left **gutter** (e.g. 2 columns) and reserves a symmetric right
  margin, so content width = `terminalCols − leftMargin − rightMargin`;
- **word-wraps** to that content width — no mid-word breaks, nothing spilling
  past the right margin;
- is ANSI-aware — wrapping counts visible characters, not escape codes.

Everything else in Phase 6 builds on this. It is the margin the operator
asked for, and it is what makes a "canvas" possible at all.

### 6.2 — Top header band — **S.**

On launch, and persistently thereafter: the Pretzel mark / title, then a
**horizontal separation rule** dividing chrome from content. Optionally a
slim second header line carrying the working directory / session id. This is
the "separation line at the top" request.

### 6.3 — Pinned bottom information bar — **M–L.**

A fixed bar on the last one or two rows, held in place with an ANSI
scroll-region (`DECSTBM`):

- **row A** — live status: model · backend · context meter · active modes;
- **row B** — hard-coded hint text: `Shift-Tab autonomous · Esc stop · Tab
  complete · /help`.

It survives scrolling (content scrolls only in the region above it) and
redraws on a short timer so the context meter updates live while the model
works. This is the "hard-coded text and info bar at the bottom" request, and
it finally makes the status visible *during* generation.

### 6.4 — Resize handling — **S–M.**

Listen for `SIGWINCH`; on resize, recompute columns/rows, re-derive the
content width, and redraw the header, scroll region, and bottom bar. Restore
the terminal cleanly (`\x1b[r`, cursor, scroll region) on exit and on crash.

### 6.5 — Content rendering within the canvas — **M.**

Streamed thinking and answers, tool-call and tool-result blocks, and coloured
diffs all respect the gutter and content width, with a consistent visual
language — icon column, indent depth, dim/bright hierarchy — so the canvas
reads as one designed surface rather than styled fragments.

### 6.6 — Input line within the canvas — **S–M.**

The `you ▸` prompt and multi-line continuation lines sit inside the gutter and
align. Bracketed paste (already implemented, never tested on a live TTY) is
verified here.

### 6.7 — Themes & plain mode — **S.**

Expand the `theme` config beyond `default`/`plain`: one or two accent
palettes. Guarantee `theme: "plain"` (and dumb terminals) drop *all* colour
**and** box-drawing — pure ASCII, no canvas chrome.

### 6.8 — ripgrep-backed `grep` — **S.** *(carried-over feature win)*

`grep` shells out to system `rg` when present (fast, `.gitignore`-aware) and
falls back to the current JS directory walk otherwise. Zero-dep; not strictly
UX, but a long-standing rough edge worth closing in this pass.

### 6.9 — Command-output & `/help` formatting pass — **S.**

Every slash-command's output rendered consistently within the canvas — aligned
tables, consistent spacing, the `/help` screen laid out as a proper panel.

---

## Build order

**6.1 first — nothing else works without the render layer and margins.** Then
the canvas frame: **6.2** header, **6.3** bottom bar, **6.4** resize (these
three are one coherent push). Then **6.5 / 6.6** — content and input living
inside the frame. Then the lighter polish: **6.7 / 6.8 / 6.9** in any order.

Suggested first sprint: **6.1 + 6.2** — the margin layer and the header land
the "framed" feel immediately and are low-risk; **6.3** follows once those are
solid.

---

## Risks & testing note

The bottom bar and scroll-region work (6.3, 6.4) is the fiddly part, and it
**cannot be verified from the build environment** — it needs a real
interactive terminal. These items must be built in tight iteration with the
operator testing each step live, exactly as bracketed paste should have been.
Everything else (6.1, 6.2, 6.5, 6.7–6.9) is verifiable from piped runs.

---

## Status

Drafted at the operator's request after the v1.2.0 enhancement roadmap
completed. Awaiting review before implementation begins.
