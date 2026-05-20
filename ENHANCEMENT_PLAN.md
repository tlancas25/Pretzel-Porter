# Pretzel Porter — Enhancement Plan

Roadmap toward Claude Code-comparable capability, running on local Ollama LLMs.
_Draft for review — 2026-05-20._

---

## Guiding principles

1. **Not distributed.** Personal tool. No telemetry, no licensing, no
   multi-tenant concerns — we optimise purely for the operator's power.
2. **Local models are weaker than Claude.** The Gemma-class local model and
   the WhiteRabbitNeo cloud model are smaller and less reliable at tool-calling
   than frontier models. **The highest-value features are the ones that make a
   weak model behave well** — structured edits, repo maps, token budgeting,
   plan mode. These come before flashy features.
3. **Privacy-first.** Built for finances/portfolio. Everything stays local;
   add an explicit air-gap mode and an audit trail.
4. **Two backends.** Fast local (full tools) + cloud over SSH (currently
   chat-only). The plan should exploit both — e.g. plan on the cloud model,
   execute on local.
5. **Build clean.** The leaked `claude-code` repo is used only as a feature
   checklist. No code is copied from it.

---

## Current state — Pretzel Porter v1.0.0

**Have:**
- Agent loop with native thinking display
- 7 tools: `read_file`, `write_file`, `edit_file`, `list_dir`, `grep`,
  `run_shell`, `search_docs` (RAG)
- Permission sandbox (path containment, symlink-safe) + 3-tier confirmations
  (read / write / shell) with `autoApprove`
- Commands: `/help`, `/reset`, `/paths`, `/model`, `/models`, `/exit`
- Directory-trust prompt; multi-model picker; local/cloud backend picker
- SSH tunnel to a self-hosted Ollama (`direct` and `gcloud` modes)
- Layered config system; cross-session state (`~/.pretzel-porter`)
- Per-model capability detection (`tools` / `thinking`); per-request timeout
- System-wide installer + `pport` launcher

**Architecture:** Node + TypeScript, no runtime deps, `OllamaProvider` behind a
swappable `Provider` interface, non-streaming.

---

## Gap analysis vs Claude Code

| Area | Claude Code | Pretzel Porter today | Priority |
|---|---|---|---|
| Streaming output | token-by-token | none (wait for full response) | **P1** |
| Context management | `/compact`, context meter, budgeting | none — overflow silently drops history | **P1** |
| Edit safety | exact-match edits + diff review | `edit_file` exact-match, no diff preview | **P1** |
| Undo | `/rewind`, worktree | none | **P1** |
| TUI input | Vim mode, history, autocomplete, status line | plain readline | **P1** |
| Project memory | `CLAUDE.md` hierarchy | none | **P2** |
| Repo awareness | repo context, LSP | `grep`/`list_dir` only | **P2** |
| File mentions | `@file`, `/add-dir`, `/files` | none | **P2** |
| Persistent memory | memory dir, auto-insights | none | **P2** |
| Tool count | ~40 | 7 | **P3** |
| MCP | client + server | none | **P3** |
| Custom commands | prompt/local/JSX commands | fixed set | **P3** |
| Hooks | 27 lifecycle events | none | **P3** |
| Subagents | Agent/Task tools, teams | none | **P4** |
| Plan mode | `EnterPlanMode`, `plan` perm mode | none | **P4** |
| Git integration | `/commit`, `/diff`, `/pr` | via `run_shell` only | **P4** |
| Sessions | `/resume`, transcripts, export | none (state = trust + last model) | **P5** |
| Permission rules | wildcard allow/ask/deny allowlists | coarse 3-tier `autoApprove` | **P5** |
| Image/multimodal | images, PDFs, notebooks | none (Gemma supports vision!) | **P5** |
| Skills/plugins | skills, plugin marketplace | none | **P5** |
| Diagnostics | `/doctor`, `/status`, `/cost` | none | **P5** |

---

## Roadmap

Effort key: **S** ≈ hours · **M** ≈ a day · **L** ≈ multi-day.

### Phase 1 — Reliability & UX foundations
_Make every session pleasant and every edit safe. Do this first._

1. **Streaming responses** — **M.** Switch `OllamaProvider` to `stream: true`,
   parse the NDJSON, render tokens live (and the thinking trace live). Biggest
   single UX win — slow local models currently feel dead until done.
2. **Cancellable generation** — **S.** Ctrl-C aborts the in-flight request
   (the `AbortController` is already wired for the timeout) and returns to the
   prompt instead of killing the app.
3. **Conversation compaction + context meter** — **M.** Track token estimate
   vs `numCtx`; show a meter in the status line; `/compact` summarises old
   turns via the model; auto-compact at ~80%. Critical — local context is the
   binding constraint and history is currently dropped silently.
4. **Diff preview before writes** — **M.** `write_file`/`edit_file` show a
   coloured unified diff in the confirmation prompt, so the operator sees
   exactly what changes before approving.
5. **`/undo` + `/redo`** — **M.** Snapshot files before each write tool;
   `/undo` restores. Cheap reversibility makes a less-predictable local model
   low-risk. (Snapshot store under `~/.pretzel-porter/undo/`.)
6. **Richer input** — **M.** Multiline input, persistent prompt history
   (Up / Ctrl-R), Tab autocomplete for commands and file paths, a status line
   (model · backend · context % · cwd).

### Phase 2 — Context & codebase intelligence
_Help a weak model understand the project without burning the window._

7. **Project memory file (`PRETZEL.md`)** — **S.** Auto-load `PRETZEL.md` from
   the working dir (and `~/.pretzel-porter/PRETZEL.md` for global prefs) into
   the system prompt. `/init` generates a starter one.
8. **`@file` mentions & `/add-dir` / `/files`** — **S.** Inline `@path` expands
   to file content in the prompt; commands manage which files/dirs are pinned
   into context.
9. **Read-only reference files** — **S.** Pin docs/config the model can read
   but the sandbox forbids editing.
10. **Repo map** — **L.** Tree-sitter-derived ranked symbol/signature outline
    of the project, token-budgeted into context. Aider's signature feature —
    the single biggest lever for repo awareness on a small model.
11. **Persistent memory tool** — **M.** A `remember`/`recall` tool + a
    `memory/` dir so the agent accumulates durable notes across sessions
    (e.g. learned facts about the user's finances structure).

### Phase 3 — Tooling & extensibility

12. **MCP client** — **L.** Connect to Model Context Protocol servers
    (stdio/HTTP/SSE); their tools join the registry. Unlocks a whole ecosystem
    without forking — and MCP servers can themselves run locally.
13. **More built-in tools** — **M.** `todo_write` (in-session task list),
    `multi_edit` (batched edits), `web_fetch` + `web_search` (both gated by the
    air-gap toggle), `apply_patch`.
14. **Custom slash commands** — **M.** User-defined commands as markdown/YAML
    files in `~/.pretzel-porter/commands/` — a prompt template + optional tool
    preset, à la goose Recipes.
15. **Hooks** — **M.** A lifecycle hook system (start with `PreToolUse`,
    `PostToolUse`, `UserPromptSubmit`, `Stop`) running shell commands — enables
    auto-format, auto-test, guardrails.

### Phase 4 — Agentic power

16. **Plan mode** — **M.** A read-only mode: the agent investigates and writes
    a plan, no mutations until the operator approves. Pairs with a `/plan`
    command and a Tab toggle.
17. **Planner/executor model split** — **M.** Optionally plan with the cloud
    model and execute with the fast local one (or vice versa) — directly
    exploits the two-backend setup.
18. **Subagents** — **L.** A `task` tool that spawns a scoped sub-agent with
    its own context for research/review, keeping the main window clean.
19. **First-class git integration** — **M.** `/diff`, `/commit` (model-written
    message), optional auto-commit per AI change with attribution — turns git
    into the audit trail and safety net.
20. **Background tasks** — **M.** Long-running shell jobs that don't block the
    REPL; check status and pull output later.

### Phase 5 — Sessions, safety, polish

21. **SQLite session persistence + `/resume`** — **M.** Durable local history;
    resume by name/id; doubles as the audit log. Fully offline.
22. **Permission rule allowlist** — **M.** Wildcard rules
    (`run_shell(git *)`, `edit_file(/src/*)`) with allow/ask/deny, learned and
    persisted — replaces the coarse 3-tier `autoApprove`, cuts prompt fatigue.
23. **Air-gap / offline mode** — **S.** A hard switch that disables every
    network-capable tool and any non-Ollama call — a guarantee for sensitive
    sessions.
24. **Audit log** — **S.** Append-only (optionally encrypted) log of every
    tool action on sensitive paths — important for the finances use case.
25. **Image input** — **M.** The local Gemma model supports **vision** — let
    the operator pass an image (e.g. a screenshot of a portfolio chart) and
    have the model read it.
26. **Diagnostics** — **S.** `/doctor` (checks Ollama, models, RAG, SSH, disk),
    `/status`, `/context`.
27. **Themes & output styles** — **S.** Configurable colour theme and
    verbosity/output style.

---

## Borrowed ideas from other OSS agents

- **Aider** — repo map; auto-commit + `/undo`; structured edit formats;
  `/tokens` meter; `/read-only` files; architect (planner/editor) split.
- **goose** — Recipes (portable YAML workflows); separate planner model;
  parallel subagents; layered permission modes; session resume.
- **Cline** — Plan/Act modes; category-based auto-approve; MCP marketplace;
  diff preview on every edit.
- **OpenCode / Crush** — polished keyboard-driven TUI; mid-session `/model`
  swap preserving context (Pretzel Porter already has this); LSP context;
  SQLite sessions; air-gap option.
- **Continue** — learned permission allowlist persisted to disk.
- **`llm` (Simon Willison)** — fragments (`@file`/URL context); tools as
  plain functions; SQLite logging of every exchange.

---

## Explicitly out of scope (for now)

- IDE bridges / VS Code & JetBrains extensions — Pretzel Porter is terminal-only
  by design.
- MCP **server** mode (exposing Pretzel Porter to other clients) — possible
  later; not needed for personal use.
- Multi-agent "teams"/coordinator — overkill for one operator.
- Cloud sync, accounts, telemetry, cost tracking — local models are free and
  private; none of this applies.
- Voice mode, payment protocols, Chrome integration.

---

## Suggested build order

Phase 1 in full first — it makes everything after it more pleasant to build and
use. Then Phase 2 (context intelligence pays off on every later phase). Phases
3–5 can be reordered to taste; **MCP (#12)** is the highest-leverage single item
in Phase 3+ because it absorbs many would-be tools for free.

**Recommended first sprint:** #1 streaming, #2 cancel, #3 compaction+meter,
#4 diff preview — these four turn day-to-day use from rough to solid.

---

## Status

**Complete — all five phases shipped (v1.2.0, 2026-05-20).** Plan drafted from:
(a) the Claude Code feature taxonomy, (b) a survey of Aider, Cline, OpenHands,
goose, Continue, `llm`, OpenCode, Crush.

Implementation notes / deviations:
- **#10 Repo map** uses dependency-free regex heuristics across eight
  languages, not tree-sitter — tree-sitter is a native dependency and the
  project ships with zero runtime deps.
- **#12 MCP client** implements the stdio transport only (HTTP/SSE skipped) —
  stdio servers are local processes, which suits the privacy-first design.
- **#17 Planner/executor split** is a model-tag split on one backend
  (`plannerModel`); a cross-backend (local + cloud) split is not yet wired.
- **#21 Session persistence** uses JSON files rather than SQLite — avoids the
  experimental `node:sqlite` builtin and keeps the store inspectable.
