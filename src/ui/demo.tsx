// src/ui/demo.tsx — a standalone, interactive demo of the Ink UI.
// Not wired to the agent — submitting echoes a canned reply — but the input,
// history, Shift-Tab and Esc are live so the UX can be tried before the
// agent migration (Phase 3b). Run: npm run ink-demo

import { render } from "ink";
import { App } from "./App.js";
import { ui } from "./store.js";

ui.setStatus({
  model: "huihui_ai/gemma-4-abliterated:26b",
  backend: "cloud",
  cwd: "~/Documents/honda-hdm-broken-trident-20260507T170730Z",
  ctxPct: 0.22,
  modes: [],
});

ui.user("scan 10.0.0.5 and report the open services");
ui.assistant("Running an nmap service scan against that host.");
const call = ui.toolCall("run_shell", "nmap -sV 10.0.0.5");
ui.toolResult(call, true, "Nmap 7.94 — 22/tcp ssh, 80/tcp http, 443/tcp https");
ui.assistant("Three open services: SSH (22), HTTP (80), HTTPS (443).");
ui.timing(7.2);

const history = ["list the files", "scan 10.0.0.5 and report the open services"];

function onSubmit(text: string): void {
  ui.user(text);
  ui.assistant("(demo) the agent is not wired yet — you typed: " + text);
  ui.timing(0.1);
}

const { waitUntilExit } = render(
  <App
    model="huihui_ai/gemma-4-abliterated:26b"
    rag={true}
    history={history}
    busy={false}
    onSubmit={onSubmit}
    onCancel={() => {}}
  />,
);
void waitUntilExit();
