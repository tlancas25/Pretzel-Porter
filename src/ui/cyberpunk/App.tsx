// Cyberpunk App — the hyper-stack root for PP_CYBERPUNK=1 mode.
//
// Subscribes to the same `ui` store as the default App so the agent loop and
// command handlers don't change. Replaces the visual layer: HUD top, styled
// conversation log, live stream renderer, status bar bottom, plus reuses the
// existing Input + ConfirmDialog.

import { Box, Static, Text, useStdin } from "ink";
import { useSyncExternalStore } from "react";
import { ui, type ConvItem } from "../store.js";
import { VERSION } from "../../version.js";
import { theme } from "../theme/tokens.js";
import { HudHeader } from "./HudHeader.js";
import { HudStatus } from "./HudStatus.js";
import { MessageView } from "./MessageView.js";
import { LiveStream } from "./LiveStream.js";
import { Input } from "../components/Input.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";

type StaticEntry = ConvItem | { id: number; kind: "hud-header" };

interface AppProps {
  model: string;
  rag: boolean;
  history: string[];
  onSubmit: (text: string) => void;
  onToggleAutonomous: () => void;
  onCancel: () => void;
}

export function CyberpunkApp({
  history,
  onSubmit,
  onToggleAutonomous,
  onCancel,
}: AppProps) {
  useSyncExternalStore(ui.subscribe, ui.getVersion, ui.getVersion);
  const { isRawModeSupported } = useStdin();

  // HUD goes into Static so it's drawn once at the top of the session and
  // scrolls naturally. Fully-pinned-top mode requires alt screen + manual
  // viewport clipping; that's deferred (see CYBERPUNK_TUI_PLAN.md Phase 6).
  const staticItems: StaticEntry[] = [{ id: 0, kind: "hud-header" }, ...ui.items];

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>
        {(entry) =>
          entry.kind === "hud-header" ? (
            <HudHeader key="hud-header" version={VERSION} />
          ) : (
            <MessageView key={entry.id} item={entry as ConvItem} />
          )
        }
      </Static>

      <LiveStream />

      {ui.note && !ui.busy ? (
        <Box marginTop={1}>
          <Text color={theme.color.accent.tertiary}>⠿ </Text>
          <Text color={theme.color.text.dim}>{ui.note}…</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <HudStatus />
      </Box>

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
        <Text color={theme.color.text.dim}>❯ (input needs an interactive terminal)</Text>
      )}
    </Box>
  );
}
