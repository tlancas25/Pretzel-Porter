// src/ui/demo.tsx — a standalone visual demo of the Ink UI with sample data.
// Not wired to the agent — it exists so the layout can be seen and reviewed
// before the agent is migrated onto it. Run: node dist/ui/demo.js

import { render } from "ink";
import { App } from "./App.js";
import { ui } from "./store.js";

ui.setStatus({
  model: "huihui_ai/gemma-4-abliterated:26b",
  backend: "cloud",
  cwd: "~/Documents/honda-hdm-broken-trident-20260507T170730Z",
  ctxPct: 0.22,
  modes: ["⚡ autonomous"],
});

ui.user("scan 10.0.0.5 and report the open services");
ui.commitStream(); // (nothing buffered — keeps ordering simple)
ui.items.push({ id: -1, kind: "assistant", text: "Running an nmap service scan against that host." });
const call = ui.toolCall("run_shell", "nmap -sV 10.0.0.5");
ui.toolResult(call, true, "Nmap 7.94 — 22/tcp ssh, 80/tcp http, 443/tcp https");
ui.items.push({
  id: -2,
  kind: "assistant",
  text: "Three open services: SSH (22), HTTP (80), HTTPS (443).",
});
ui.timing(7.2);

const { waitUntilExit } = render(<App model="huihui_ai/gemma-4-abliterated:26b" rag={true} />);
void waitUntilExit();
