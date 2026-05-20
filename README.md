# Pretzel Porter

```
      _~~_   _~~_
     (    \_/    )
      \   / \   /
       \ ( X ) /
        \ \_/ /
        /     \
       (       )
        \_____/
```

**Pretzel Porter** — a small, **fully local** terminal agent — like Claude
Code, but it runs on any local LLM you have in Ollama and never sends anything
off your machine. Built for working with sensitive files (portfolio, finances,
personal docs) where privacy is the whole point. _v1.0.0_

It can **think**, **reason**, and **use tools** to read, search, edit, write,
and run shell commands — all confined to a directory sandbox you control. With
RAG enabled it can also do **semantic search** over an indexed knowledge base.

## Requirements

- **Node.js 20+**
- **[Ollama](https://ollama.com)** running locally with a tool-capable model.
  This project is configured for:

  ```
  ollama pull huihui_ai/gemma-4-abliterated:e4b
  ```

  Any Ollama model with the `tools` and `thinking` capabilities will work —
  just change `model` in the config.

## Install

One line — clones the repo and installs system-wide:

```bash
git clone https://github.com/tlancas25/Pretzel-Porter.git && cd Pretzel-Porter && ./install.sh
```

`install.sh` builds the project, installs it to `/opt/pretzel-porter`, and
adds a launcher at `/usr/local/bin/pport`. Then, from any directory:

```bash
pport          # work in the current directory
sudo pport     # run as root, to reach root-owned files
```

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
| `temperature`  | Lower = more reliable tool use. `0.4` is a good default. |
| `numCtx`       | Context window in tokens to request from Ollama. |
| `think`        | Enable the model's native reasoning trace. |
| `allowedPaths` | **The sandbox.** List of directories the agent may touch. Relative paths resolve from the project root. |
| `autoApprove`  | Per-risk-tier auto-approval: `read` / `write` / `shell`. |
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
| `/reset` | clear the conversation history |
| `/paths` | show the sandboxed root directories |
| `/exit` | quit (Ctrl-C also works) |

## Architecture

```
src/
  index.ts        REPL entry point
  config.ts       loads + validates agent.config.json
  provider.ts     OllamaProvider — swappable backend (see below)
  agent.ts        the think → call tools → observe loop
  permissions.ts  the directory sandbox
  state.ts        persistent trust list + last model (~/.pretzel-porter)
  ssh.ts          SSH tunnel manager for a remote Ollama
  ui.ts           terminal rendering, banner, spinner, prompts, menu
  tools/          read_file, write_file, edit_file, list_dir, grep,
                  run_shell, search_docs (RAG)
```

The `Provider` interface (`src/types.ts`) is backend-agnostic. Today only
`OllamaProvider` exists. When the GCP-hosted larger-Gemma box (served via
vLLM) is ready, add an OpenAI-compatible provider implementing the same
`chat()` / `healthCheck()` methods and select it with `config.provider` — no
other code changes.

## Status

v1.0.0 — file tools, RAG search, native thinking, sandbox + confirmations,
non-streaming. Planned: streamed responses, a cloud `vllm` provider,
conversation summarisation for very long sessions.
