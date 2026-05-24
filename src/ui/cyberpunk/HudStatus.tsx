import { Box, Text } from "ink";
import { theme } from "../theme/tokens.js";
import { Badge } from "./Badge.js";
import { useSyncExternalStore } from "react";
import { ui } from "../store.js";

const COL = theme.color;
const G = theme.glyph.frame;

/**
 * Pinned bottom HUD strip — bracketed-tag shortcuts. Highlights the live
 * state on the left (idle / busy / awaiting-confirm).
 */
export function HudStatus() {
  useSyncExternalStore(ui.subscribe, ui.getVersion, ui.getVersion);

  let state: { label: string; color: string };
  if (ui.pendingConfirm) state = { label: "approve", color: COL.status.warn };
  else if (ui.busy) state = { label: ui.note || "working", color: COL.accent.secondary };
  else state = { label: "idle", color: COL.text.dim };

  return (
    <Box>
      <Text color={COL.surface.frame}>{G.bl}</Text>
      <Text color={COL.surface.frame}>{G.h} </Text>
      <Badge label={state.label} color={state.color} active={state.label !== "idle"} />
      <Text color={COL.text.faint}> {G.h} </Text>
      <Badge label="↑↓ hist" color={COL.text.dim} />
      <Text color={COL.text.faint}> </Text>
      <Badge label="tab cmpl" color={COL.text.dim} />
      <Text color={COL.text.faint}> </Text>
      <Badge label="shift-tab auto" color={COL.text.dim} />
      <Text color={COL.text.faint}> </Text>
      <Badge label="esc stop" color={COL.text.dim} />
      <Text color={COL.text.faint}> </Text>
      <Badge label="/help" color={COL.text.dim} />
      <Text color={COL.surface.frame}> {G.h}</Text>
      <Text color={COL.surface.frame}>{G.br}</Text>
    </Box>
  );
}
