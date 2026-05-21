// src/ui/components/StatusBar.tsx — the live status line shown above the
// prompt: model · backend · context meter · workspace · modes. Rendered as a
// single truncating line so it never wraps and garbles.

import { Box, Text } from "ink";
import type { StatusInfo } from "../store.js";

function meter(fraction: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return "▕" + "█".repeat(filled) + "░".repeat(width - filled) + "▏";
}

export function StatusBar({ status }: { status: StatusInfo }) {
  const pct = Math.min(999, Math.round(status.ctxPct * 100));
  const ctxColor = pct >= 95 ? "red" : pct >= 80 ? "yellow" : "green";
  const model = status.model.length > 30 ? status.model.slice(0, 29) + "…" : status.model;
  const sep = <Text dimColor>{"  ·  "}</Text>;
  return (
    <Box>
      <Text wrap="truncate-end">
        <Text color="cyan">▸ </Text>
        <Text bold>{model}</Text>
        {sep}
        <Text dimColor>{status.backend}</Text>
        {sep}
        <Text color={ctxColor}>{meter(status.ctxPct) + " " + pct + "%"}</Text>
        {sep}
        <Text dimColor>{status.cwd}</Text>
        {status.modes.length > 0 ? sep : null}
        {status.modes.length > 0 ? <Text color="yellow">{status.modes.join("  ")}</Text> : null}
      </Text>
    </Box>
  );
}
