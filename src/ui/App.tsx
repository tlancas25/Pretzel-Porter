// src/ui/App.tsx — the Ink root. Completed items (and the banner) go in
// <Static> so they scroll into terminal history; the streaming region, status
// bar, and the input (or confirm dialog) are the live, re-rendered area.

import { Box, Static, Text, useStdin, useStdout } from "ink";
import { useSyncExternalStore } from "react";
import { ui, type ConvItem } from "./store.js";
import { VERSION } from "../version.js";
import { Banner } from "./components/Banner.js";
import { ItemView, LiveStream } from "./components/Conversation.js";
import { StatusBar } from "./components/StatusBar.js";
import { Input } from "./components/Input.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";

type StaticEntry = ConvItem | { id: number; kind: "banner" };

interface AppProps {
  model: string;
  rag: boolean;
  history: string[];
  onSubmit: (text: string) => void;
  onToggleAutonomous: () => void;
  onCancel: () => void;
}

export function App({ model, rag, history, onSubmit, onToggleAutonomous, onCancel }: AppProps) {
  // Re-render whenever the store changes.
  useSyncExternalStore(ui.subscribe, ui.getVersion, ui.getVersion);
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  // Inset well below the terminal width: a line that fills the row exactly
  // triggers a phantom wrap that desyncs Ink's render frame. -6 keeps slack;
  // reading stdout.columns each render means it tracks window resizes.
  const dividerWidth = Math.max(8, (stdout?.columns ?? 80) - 6);

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

      {ui.note ? (
        <Box marginTop={1}>
          <Text color="yellow">⠿ </Text>
          <Text dimColor>{ui.note}…</Text>
        </Box>
      ) : null}

      {/* A rule separating the conversation above from the input zone below. */}
      <Box marginTop={1}>
        <Text dimColor>{"─".repeat(dividerWidth)}</Text>
      </Box>
      <StatusBar status={ui.status} />

      {ui.pendingConfirm ? (
        <ConfirmDialog question={ui.pendingConfirm.question} />
      ) : isRawModeSupported ? (
        <Input
          onSubmit={onSubmit}
          history={history}
          busy={ui.busy}
          onToggleAutonomous={onToggleAutonomous}
          onCancel={onCancel}
        />
      ) : (
        <Text dimColor>❯ (input needs an interactive terminal)</Text>
      )}

      <Text dimColor>Shift-Tab autonomous · Esc stop · ↑↓ history · /help</Text>
    </Box>
  );
}
