# Pretzel Porter

```

                     .'  `'._.'`  '.
                    |  .--;   ;--.  |
                    |  (  /   \  )  |
                     \  ;` /^\ `;  /
                      :` .'._.'. `;
                      '-`'.___.'`-'

```

**Pretzel Porter** — a small, **fully local** terminal agent — like Claude
Code, but it runs on any local LLM you have in Ollama and never sends anything
off your machine. Built for working with sensitive files (portfolio, finances,
personal docs) where privacy is the whole point. _v1.3.0_

It can **think**, **reason**, and **use tools** to read, search, edit, write,
and run shell commands — all confined to a directory sandbox you control. With
RAG enabled it can also do **semantic search** over an indexed knowledge base.

Responses **stream** token-by-token, every file change shows a **coloured diff**
before you approve it, `/undo` reverts mistakes, the conversation **auto-compacts**
when the context window fills, and **Shift-Tab** flips on an autonomous mode that
runs without stopping to ask.

## Requirements

- **Node.js 20+**
- **[Ollama](https://ollama.com)** with a tool-capable model. The local
  backup model this project is configured for:

  ```
  ollama pull huihui_ai/gemma-4-abliterated:e2b
  ```

  Any Ollama model with the `tools` and `thinking` capabilities will work —
  just change `model` in the config. The day-to-day backend is a self-hosted
  cloud Ollama reached over SSH (see [Remote LLM over SSH](#remote-llm-over-ssh));
  the local `e2b` model is the offline backup.

## Install

One line — clones the repo and installs system-wide:

```bash
git clone https://github.com/tlancas25/Pretzel-Porter.git && cd Pretzel-Porter && ./install.sh
```

`install.sh` builds the project, installs it to `/opt/pretzel-porter`, and
adds a launcher at `/usr/local/bin/pport`. Then, from any directory:

```bash
pport            # work in the current directory
sudo pport       # run as root, to reach root-owned files
pport --version  # print the installed version
```

## Updating

From the directory you cloned into, one command pulls the latest and
rebuilds + reinstalls over the old copy:

```bash
cd Pretzel-Porter
./install.sh --update
```

`--update` runs `git pull` first, then the normal build + install. Re-running
`./install.sh` with no flag also reinstalls (handy after your own local
changes). Either way, your per-user settings in `~/.pretzel-porter/` —
including `agent.config.local.json` — are never touched; only the system copy
in `/opt/pretzel-porter` is replaced. Check your version any time with
`pport --version`.

## Development

```bash
npm install
npm start      # run the TypeScript directly via tsx
npm run build  # compile to dist/
```

## Configuration

Edit `agent.config.json` (committed defaults). For machine-specific or
sensitive settings, create `agent.config.local.json` — it overrides the
defaults and is gitignored.

| Key            | Meaning |
|----------------|---------|
| `baseUrl`      | Ollama endpoint. Default `http://localhost:11434`. |
| `model`        | Ollama model tag. |
| `plannerModel` | Optional second model used while in plan mode. |
| `autoCommit`   | Commit every successful AI file change to git automatically. |
| `temperature`  | Sampling temperature. `0.7` balances focus against repetition. |
| `sampling`     | `topP`/`topK`/`minP`/`repeatPenalty`/`repeatLastN` — `repeatPenalty` (~1.3) suppresses degenerate loops. |
| `numCtx`       | Context window in tokens to request from Ollama. |
| `think`        | Enable the model's native reasoning trace. |
| `hideThinking` | Hide the reasoning trace from the display (it still runs). |
| `theme`        | `default`, or `plain` for no colour. |
| `auditLog`     | Append every write/shell action to `~/.pretzel-porter/audit.log`. |
| `permissionRules` | Wildcard allow/ask/deny rules — see [Permission rules](#permission-rules). |
| `allowedPaths` | **The sandbox.** List of directories the agent may touch. Relative paths resolve from the project root. |
| `readOnlyPaths`| Reference directories the agent may **read** but never modify. |
| `autoApprove`  | Per-risk-tier auto-approval: `read` / `write` / `shell`. |
| `airgap`       | When `true`, disables every network tool (`web_fetch`, `web_search`). |
| `mcpServers`   | MCP servers to launch over stdio; their tools join the registry. |
| `hooks`        | Shell commands run at lifecycle points — see [Extensibility](#extensibility). |
| `maxSteps`     | Safety cap on tool-call iterations per request. |
| `rag`          | `enabled` / `command` / `defaultK` — semantic search over a RAG store via the `rag` CLI. Set `enabled: false` to hide the `search_docs` tool. |
| `ssh`          | Tunnel to a self-hosted Ollama — see [Remote LLM over SSH](#remote-llm-over-ssh). |

To let the agent work on your finances folder, add it:

```json
{
  "allowedPaths": ["/home/you/Documents/finances"],
  "autoApprove": { "read": true, "write": false, "shell": false }
}
```

## Security model

- **Path sandbox** — every file path is resolved (including `..` and symlinks)
  and rejected if it falls outside `allowedPaths`. See `src/permissions.ts`.
- **Confirmation prompts** — `write_file`, `edit_file`, and `run_shell` ask for
  approval before each call unless you opt in via `autoApprove`. Reads never
  mutate anything and run freely.
- **Local only** — the sole network call is to your own Ollama instance.

Keep `autoApprove.write` and `autoApprove.shell` set to `false` when working
with data you care about.

## First run

The first time you launch Pretzel Porter from a directory, it asks you to
**trust** it before reading or modifying anything there. Trusted directories
are remembered in `~/.pretzel-porter/state.json`, so it only asks once per
directory. The trusted launch directory becomes the sandbox root; anything in
`allowedPaths` is added on top.

If more than one model is installed in Ollama, it shows a **model picker** at
startup (embedding-only models are filtered out). Your last choice is
remembered and pre-selected next time.

## Remote LLM over SSH

To run against a self-hosted Ollama on another machine, enable the `ssh`
block. Put real host/project details in `agent.config.local.json`
(gitignored) — never the committed config. Two modes:

**`gcloud`** — a Google Compute Engine VM. Resolves the instance by name, so
a preemptible VM's changing external IP does not matter, and manages keys:

```json
"ssh": {
  "enabled": true,
  "mode": "gcloud",
  "gcloud": { "instance": "my-vm", "zone": "us-central1-a", "project": "my-project", "iap": false },
  "remotePort": 11434,
  "localPort": 11435
}
```

**`direct`** — plain SSH to a fixed host:

```json
"ssh": {
  "enabled": true,
  "mode": "direct",
  "host": "my-server",
  "user": "me",
  "identityFile": "~/.ssh/id_ed25519",
  "remotePort": 11434,
  "localPort": 11435
}
```

With `enabled: true`, Pretzel Porter shows a **backend picker** at startup —
choose **Local** or **Cloud**. Picking Cloud opens the SSH tunnel and routes
Ollama through it; the remote port is never exposed publicly. The tunnel
closes on exit. (`enabled: false` skips the picker — local only.)

## Commands

Inside the REPL:

| Command | Action |
|---|---|
| `/help` | show command help |
| `/model [name]` | switch model — interactive picker, or pass a name/substring |
| `/models` | list installed Ollama models |
| `/compact` | summarise older turns to reclaim context space |
| `/context` | show context-window usage as a meter |
| `/undo` / `/redo` | revert / re-apply the last file change |
| `/map` | print a structural map of the project |
| `/files` | list pinned context files (`/files clear` to empty) |
| `/add <path>` / `/add-dir <path>` | pin a file or directory into every prompt |
| `/drop <path>` | unpin a file or directory |
| `/memory` | list long-term memory (`/memory forget <id>`) |
| `/todos` | show the agent's current task list |
| `/plan` | toggle plan mode — read-only investigation, no changes |
| `/diff` | show the git working-tree diff |
| `/commit [msg]` | commit changes (the model writes the message if omitted) |
| `/jobs` | list background jobs (`/jobs <id>` for its output) |
| `/resume [id]` | resume a saved session (interactive picker if no id) |
| `/sessions` | list saved sessions |
| `/rules` | list permission rules (`/rules clear` resets learned) |
| `/airgap` | toggle air-gap mode — disable all network tools |
| `/doctor` | run diagnostics (Ollama, model, RAG, git) |
| `/status` | show the current session status |
| `/init` | create a starter `PRETZEL.md` project-memory file |
| `/reload` | reload `PRETZEL.md` into context |
| `/reset` | clear the conversation history |
| `/paths` | show the sandboxed root directories |
| `/exit` | quit (Ctrl-C also works) |

## Keys & input

| Key | Action |
|---|---|
| `Shift-Tab` | toggle **autonomous mode** — auto-approves every write/shell action so the agent runs uninterrupted |
| `Ctrl-C` | cancel the in-flight response; at an empty prompt, quit |
| `Tab` | complete a slash-command or a file path |
| trailing `\` | continue the message on the next line |
| `↑` / `↓` | walk prompt history (persisted across sessions) |

A status line above each prompt shows the model, backend, context-window
usage, and working directory — plus a `⚡ autonomous` marker when that mode
is on.

**Autonomous mode** bypasses *all* confirmation prompts. Use it when you trust
the task and want the agent to keep going; press `Shift-Tab` again to restore
confirmations. The path sandbox still applies — autonomous mode never lets the
agent touch files outside `allowedPaths`.

The conversation **auto-compacts** at ~80% of `numCtx`: older turns are
summarised by the model so a long session never silently drops history. Run
`/compact` to do it on demand.

## Project context

Pretzel Porter helps a small local model understand a project without burning
the context window:

- **`PRETZEL.md`** — a short briefing file loaded into the system prompt every
  session. `/init` writes a starter; keep one in a project directory, and/or a
  global one at `~/.pretzel-porter/PRETZEL.md` for cross-project preferences.
- **`@file` mentions** — write `@path/to/file` in a message and that file is
  attached to the prompt for that turn.
- **Pinned files** — `/add` a file or directory to attach it to *every* turn;
  `/files` lists them, `/drop` removes one.
- **Repo map** — `/map` (or the `repo_map` tool) prints a ranked outline of
  every source file's functions, classes, and types — dependency-free, so it
  works on any project.
- **Long-term memory** — the `remember` / `recall` tools let the agent keep
  durable notes in `~/.pretzel-porter/memory/` across sessions; `/memory`
  inspects them.
- **Read-only reference paths** — list directories under `readOnlyPaths` in the
  config and the agent can read them but never modify them.

## Extensibility

- **MCP servers** — connect to [Model Context Protocol](https://modelcontextprotocol.io)
  servers over stdio; their tools join the registry automatically. Configure
  them under `mcpServers`:

  ```json
  "mcpServers": {
    "fetch": { "command": "uvx", "args": ["mcp-server-fetch"] }
  }
  ```

- **Context Cooler** — the recommended MCP pairing. A local model has a small
  context window, and reading many files or large logs into it directly is
  what makes a task overflow. [Context Cooler](https://github.com/tlancas25/context-cooler)
  inverts that: instead of pulling raw data into the model, the agent runs code
  *against* the data in a sandbox and reads back only a compact summary, with
  the full output indexed for later search. It ships a `pretzel-porter` install
  adapter, so wiring it in is one command:

  ```bash
  python3 install.py --platform=pretzel-porter   # from a Context Cooler checkout
  ```

  That registers it in `~/.pretzel-porter/agent.config.local.json`; its
  `ctx_execute` / `ctx_search` / `ctx_index` tools then join the registry.

- **Custom slash commands** — drop a Markdown file in
  `~/.pretzel-porter/commands/`; `review.md` becomes `/review`. The file body
  is a prompt template — `$ARGS` is replaced with whatever you type after the
  command. An optional `<!-- description -->` on the first line shows in `/help`.

- **Hooks** — run shell commands at lifecycle points. Each hook receives a JSON
  payload on stdin; a non-zero exit from a `UserPromptSubmit` or `PreToolUse`
  hook cancels the action.

  ```json
  "hooks": {
    "PostToolUse": [{ "matcher": "write_file|edit_file", "command": "prettier --write ." }],
    "PreToolUse":  [{ "matcher": "run_shell", "command": "./guardrail.sh" }]
  }
  ```

  Events: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`. The `matcher`
  is a regex tested against the tool name (tool events only).

- **Air-gap mode** — set `airgap: true` to drop every network-capable tool, a
  hard guarantee for a fully offline session.

## Agentic features

- **Plan mode** — `/plan` puts the session in a read-only mode: every write and
  shell tool is refused, so the agent investigates and produces a step-by-step
  plan. Review it, `/plan` off, and let the agent execute. If `plannerModel` is
  set, planning runs on that model.
- **Sub-agents** — the `task` tool delegates a self-contained job to a fresh
  sub-agent with its own clean context; only its final answer comes back.
- **Git integration** — `/diff` shows the working-tree diff; `/commit` commits
  (the model writes the message from the diff if you do not supply one); set
  `autoCommit: true` to commit each AI change automatically — git becomes the
  audit trail and the safety net.
- **Background jobs** — the `run_background` tool starts a long-running shell
  command without blocking the REPL; `job_status` (and `/jobs`) checks on it.

## Built-in tools

`read_file`, `write_file`, `edit_file`, `multi_edit`, `apply_patch`,
`list_dir`, `grep`, `repo_map`, `run_shell`, `run_background`, `job_status`,
`todo_write`, `task`, `remember`, `recall`, `search_docs` (RAG), and — unless
air-gapped — `web_fetch` and `web_search`. Plus any tools exposed by configured
MCP servers.

## Sessions & safety

- **Sessions** — every conversation is saved to `~/.pretzel-porter/sessions/`
  after each turn. `/sessions` lists them; `/resume` (with an id, or an
  interactive picker) reloads one. Plain JSON, fully offline.
- **Permission rules** — wildcard allow/ask/deny rules evaluated before the
  coarse `autoApprove` tiers. Configure them, or let them be *learned*: answer
  `a` (always) at a confirm prompt and a rule is recorded to
  `~/.pretzel-porter/rules.json` so that tool stops asking. `/rules` inspects
  them, `/rules clear` resets the learned ones.

  ```json
  "permissionRules": [
    { "tool": "run_shell", "pattern": "run: git *", "action": "allow" },
    { "tool": "run_shell", "pattern": "run: rm *",  "action": "deny" }
  ]
  ```

  The `pattern` is a glob tested against the call summary; `action` is
  `allow`, `ask`, or `deny`.
- **Audit log** — set `auditLog: true` to append every write/shell action to
  `~/.pretzel-porter/audit.log` as timestamped JSON.
- **Image input** — mention an image file inline (`@chart.png`) and, on a
  vision-capable model like Gemma, it is attached to the turn for the model to
  read.
- **Diagnostics** — `/doctor` checks Ollama, the model, the RAG CLI, and git;
  `/status` summarises the session.

## Architecture

```
src/
  index.ts        REPL entry point
  config.ts       loads + validates agent.config.json
  provider.ts     OllamaProvider — streaming, swappable backend (see below)
  agent.ts        the think → call tools → observe loop; compaction
  permissions.ts  the directory sandbox (read/write + read-only roots)
  autonomy.ts     the Shift-Tab autonomous-mode toggle
  diff.ts         dependency-free unified diff for write previews
  undo.ts         in-session file snapshots for /undo and /redo
  context.ts      pinned files + @mention expansion
  projectMemory.ts  PRETZEL.md loading + /init
  repomap.ts      dependency-free project symbol outline
  memory.ts       persistent long-term notes store
  todos.ts        in-session task list
  hooks.ts        lifecycle hook runner
  commands.ts     custom slash-command loader
  mcp.ts          Model Context Protocol stdio client
  planmode.ts     the read-only plan-mode toggle
  git.ts          git helpers for /diff, /commit, auto-commit
  jobs.ts         background-job manager
  airgap.ts       the air-gap mode toggle
  audit.ts        append-only audit log
  session.ts      JSON session persistence + /resume
  rules.ts        wildcard permission-rule engine
  validate.ts     tool-call argument validation against the schema
  state.ts        persistent trust list + last model (~/.pretzel-porter)
  ssh.ts          SSH tunnel manager for a remote Ollama
  ui.ts           terminal rendering, streaming, prompts, history, completion
  tools/          read/write/edit/multi_edit/apply_patch, list_dir, grep,
                  run_shell, search_docs, repo_map, remember, recall,
                  todo_write, web_fetch, web_search
```

The `Provider` interface (`src/types.ts`) is backend-agnostic. Today only
`OllamaProvider` exists. When the GCP-hosted larger-Gemma box (served via
vLLM) is ready, add an OpenAI-compatible provider implementing the same
`chat()` / `healthCheck()` methods and select it with `config.provider` — no
other code changes.

## Status

v1.2.0 — the full enhancement roadmap is implemented:

- **Reliability & UX** — streamed responses, cancellable generation,
  compaction + context meter, diff previews, `/undo` + `/redo`, rich input.
- **Context intelligence** — `PRETZEL.md` project memory, `@file` mentions,
  pinned files, a dependency-free repo map, persistent long-term memory.
- **Extensibility** — an MCP client, custom slash commands, lifecycle hooks,
  and the extra tools (`multi_edit`, `apply_patch`, `web_fetch`, …).
- **Agentic power** — plan mode, a planner/executor model split, sub-agents,
  git integration, background jobs.
- **Sessions & safety** — JSON session persistence with `/resume`, a learned
  permission-rule engine, air-gap mode, an audit log, image input,
  diagnostics, and themes.

The project remains Node + TypeScript with zero runtime dependencies.
