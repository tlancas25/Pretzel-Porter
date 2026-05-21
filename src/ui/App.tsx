// src/ui/App.tsx — the Ink root. Completed items (and the banner) go in
// <Static> so they scroll into terminal history; the streaming region, status
// bar, and input are the live, re-rendered area.

import { Box, Static, Text, useStdin } from "ink";
import { useState, useSyncExternalStore } from "react";
import { ui, type ConvItem } from "./store.js";
import { VERSION } from "../version.js";
import { Banner } from "./components/Banner.js";
import { ItemView, LiveStream } from "./components/Conversation.js";
import { StatusBar } from "./components/StatusBar.js";
import { Input } from "./components/Input.js";

type StaticEntry = ConvItem | { id: number; kind: "banner" };

interface AppProps {
  model: string;
  rag: boolean;
  history: string[];
  busy: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function App({ model, rag, history, busy, onSubmit, onCancel }: AppProps) {
  // Re-render whenever the store changes.
  useSyncExternalStore(ui.subscribe, ui.getVersion, ui.getVersion);
  const [autonomous, setAutonomous] = useState(false);
  // Key-by-key input needs a real terminal — mount <Input> only then.
  const { isRawModeSupported } = useStdin();

  const toggleAutonomous = (): void => {
    const next = !autonomous;
    setAutonomous(next);
    ui.setStatus({ ...ui.status, modes: next ? ["⚡ autonomous"] : [] });
  };

  const staticItems: StaticEntry[] = [{ id: 0, kind: "banner" }, ...ui.items];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Static items={staticItems}>
        {(item) =>
          item.kind === "banner" ? (
            <Banner
              key="banner"
              version={VERSION}
              model={model}
              rag={rag}
              sandbox={ui.status.cwd}
            />
          ) : (
            <ItemView key={item.id} item={item} />
          )
        }
      </Static>
      <LiveStream />
      <Box marginTop={1}>
        <StatusBar status={ui.status} />
      </Box>
      {isRawModeSupported ? (
        <Input
          onSubmit={onSubmit}
          history={history}
          busy={busy}
          onToggleAutonomous={toggleAutonomous}
          onCancel={onCancel}
        />
      ) : (
        <Text dimColor>❯ (input needs an interactive terminal)</Text>
      )}
      <Text dimColor>Shift-Tab autonomous · Esc stop · ↑↓ history · /help</Text>
    </Box>
  );
}
