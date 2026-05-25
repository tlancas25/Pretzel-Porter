# Changelog

All notable changes to Pretzel Porter. Format loosely follows
[Keep a Changelog](https://keepachangelog.com); versions match
`src/version.ts` and `package.json`.

## [1.5.1] — 2026-05-24

### Added
- **Extended Ollama sampling**: `numPredict`, `numBatch`, `numGpu`,
  `mirostat` (+ `mirostatTau` / `mirostatEta`) are now supported in
  `agent.config.json` and passed through to Ollama's `options`. All
  optional — only sent when set, so behaviour is unchanged if you don't
  opt in.
- `install.sh --reset-config` flag for explicit restore of the repo
  default config.

### Changed
- **`repeatLastN` default bumped 256 → 1024.** Long agentic turns
  routinely exceeded the old 256-token window, letting the model loop
  on phrases like "I'll check X… I'll check X…" without triggering the
  repeat penalty. This is the loop fix.
- **`install.sh` now PRESERVES** `/opt/pretzel-porter/agent.config.json`
  on upgrade instead of overwriting it. SSH/cloud settings, custom
  models, and learned permission rules survive `sudo ./install.sh`.
  Use `--reset-config` to force-restore defaults.
- **Boot banner now spells out "PRETZEL" + "PORTER"** in the same
  chunky ANSI-shadow font (stacked on two lines) — the v1.5.0 plain
  text was a regression from the earlier block-letter PPORT banner.

### Reverted before release
- `numPredict: -1` and `numBatch: 1024` had been set as defaults in
  an interim build but caused the cloud Ollama backend to either
  reload the model (long first-response latency for a 26B) or run
  past natural stopping points on short prompts. Both options remain
  available in the schema; you opt in explicitly in
  `agent.config.json` if you want to tune them.

### Why this version exists
User reported the 26B abliterated model (on the cloud SSH backend)
hitting repetition loops mid-task. `repeat_last_n` was too short to
catch them; `install.sh` was also clobbering runtime config on each
upgrade. Both fixed.

## [1.5.0] — 2026-05-24

### Added
- **Cyberpunk hyper-stack TUI** — new default. Bordered HUD with model /
  backend / sandbox on the left and live CTX meter + latency / tok-rate
  sparklines on the right. Status bar with bracketed-tag shortcuts.
- **Typed-cadence boot sequence** — plain-text "Pretzel Porter" banner
  in neon, then a few diagnostic lines (`> terminal: …`, `> truecolor: ok`).
- **Big pulsing confirm dialog** — bordered card, hot-pink ↔ amber border
  glow at 2fps, inverse-video Y/N/A chips, one terminal-bell ring on mount
  so the user gets pulled back even from another window.
- **Conversation styling**: `›` user prompts, `● ` assistant, `◆ thinking`
  with dim italic body, `╭─◉ / │ / ╰─◉` tool-call blocks with pending /
  ok / failed states, `[ DIFF ]` header on diffs.
- **Streaming output** with a blinking `▎` CRT cursor at the tail.
- **Theme tokens**: `src/ui/theme/tokens.ts` is the one source of truth
  for colour / glyph / spacing roles. Future themes drop in here.
- **Capability detection**: `src/ui/capabilities.ts` profiles Ghostty,
  iTerm2, WezTerm, Kitty, Terminal.app — features gate cleanly.
- **Latency telemetry**: every completed turn pushes ms into a 40-sample
  ring so the HUD sparkline always has fresh data.

### Changed
- Default UI is now the cyberpunk hyper-stack. `PP_LEGACY=1` reverts to
  the v1.4.0 chrome — an escape hatch if anything regresses.
- Banner is plain text ("Pretzel Porter") — no ASCII mascot.

### Architecture
- `src/ui/cyberpunk/` — new component folder; subscribes to the same
  `ui` store as the legacy App so `agent.ts` and command handlers are
  unchanged.
- `src/ui/viewport/buffer.ts` + `src/ui/altscreen.ts` + `src/ui/use\
AnimationFrame.ts` — foundation in place for the deferred fully-pinned
  viewport mode (see `CYBERPUNK_TUI_PLAN.md`).

### Deferred
- Fully-pinned-top HUD (needs alt-screen + manual viewport clipping)
- `/theme` command for swapping palette flavors
- Real per-step timings in boot lines
- Autonomous-mode pulse animation
- Kitty image protocol for a real pretzel logo (Phase 6 stretch)

## [1.4.0] — 2026-05-23

### Added
- Full Ink rewrite of the TUI (merged from `ink-ui` branch).
- Headless mode, glob tool, pentest awareness, workspace awareness.
- `/export` writes the session to a Markdown engagement report.
- `install.sh --update` (git pull → build → install), `pport --version`.
- Tool-call schema validation; loop-breaker; portmem.md working memory.
- Autonomous mode actually continues (was only auto-approving).

### Fixed
- Dead-input bug after launch (four separate iterations, finally fixed
  by releasing readline from startup before Ink takes over).
- Broken layout from the scroll-region pinned bar — replaced with an
  inline status line.

## [1.3.0] and earlier

See `git log` for full history. Highlights:
- **1.3.0** — pretzel logo redesign, Aider-style summary banner.
- **1.2.0** — full enhancement roadmap (Phases 1-5) shipped: streaming,
  cancel, compaction, diff preview, undo, autonomous mode, MCP client,
  custom commands, hooks, plan mode, subagents, git, background jobs,
  sessions, permission rules, air-gap, audit, images.
- **1.1.0** — model capability detection, request timeout, backend
  picker, e2b/e4b model defaults.
- **1.0.0** — initial release.
