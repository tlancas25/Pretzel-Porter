import { Box, Text, useStdout } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { theme } from "../theme/tokens.js";
import { ui } from "../store.js";
import { series } from "./series.js";
import { Meter } from "./Meter.js";
import { Sparkline } from "./Sparkline.js";
import { Badge } from "./Badge.js";

const G = theme.glyph.frame;
const COL = theme.color;

function useCols(): number {
  const { stdout } = useStdout();
  const [w, setW] = useState(stdout.columns ?? 80);
  useEffect(() => {
    const on = (): void => setW(stdout.columns ?? 80);
    stdout.on("resize", on);
    return () => {
      stdout.off("resize", on);
    };
  }, [stdout]);
  return w;
}

/**
 * Pinned top HUD — 5 rows: title bar + two data rows + divider. Left column
 * carries identity (model, backend, sandbox); right column carries live
 * telemetry (context meter, latency sparkline, token-rate sparkline).
 */
export function HudHeader({ version }: { version: string }) {
  useSyncExternalStore(ui.subscribe, ui.getVersion, ui.getVersion);
  useSyncExternalStore(series.subscribe, series.getVersion, series.getVersion);

  const cols = useCols();
  const innerCols = Math.max(40, cols) - 2; // minus the two frame columns
  const leftCol = Math.min(38, Math.floor(innerCols * 0.55));
  const rightCol = innerCols - leftCol - 1; // minus the column divider

  const title = ` PRETZEL.PORTER  ${version} `;
  const titleFill = Math.max(0, leftCol - title.length);
  const ctxLabel = " ▼ CTX ";
  const ctxPctText = ` ${ui.status.ctxPct.toString().padStart(3)}% `;
  const meterWidth = Math.max(6, rightCol - ctxLabel.length - ctxPctText.length - 1);

  const lat = series.lastLatency();
  const tok = series.lastTokRate();
  const latLabel = `lat ${lat == null ? "  --ms" : `${Math.min(9999, Math.round(lat)).toString().padStart(3)}ms`}`;
  const tokLabel = `tok ${tok == null ? "  -- /s" : `${tok.toFixed(1).padStart(4)}/s`}`;
  const sparkCols = Math.max(8, rightCol - 14);

  return (
    <Box flexDirection="column">
      {/* Top frame: title bar */}
      <Text>
        <Text color={COL.surface.frame}>{G.tl}</Text>
        <Text color={COL.accent.primary} bold>
          {title}
        </Text>
        <Text color={COL.surface.frame}>{G.h.repeat(titleFill)}</Text>
        <Text color={COL.surface.frame}>{G.hTop}</Text>
        <Text color={COL.surface.frame}>{G.h}</Text>
        <Text color={COL.accent.tertiary} bold>
          {ctxLabel}
        </Text>
        <Meter value={ui.status.ctxPct / 100} width={meterWidth} />
        <Text color={COL.accent.tertiary}>{ctxPctText}</Text>
        <Text color={COL.surface.frame}>{G.tr}</Text>
      </Text>

      {/* Data row 1: model + latency sparkline */}
      <Text>
        <Text color={COL.surface.frame}>{G.v} </Text>
        <Text color={COL.text.dim}>model   </Text>
        <Text color={COL.accent.secondary}>{padRight(ui.status.model || "—", leftCol - 11)}</Text>
        <Text color={COL.surface.frame}>{G.v} </Text>
        <Text color={COL.text.dim}>{padRight(latLabel, 12)}</Text>
        <Sparkline data={series.latencyMs.values()} width={sparkCols} />
        <Text color={COL.surface.frame}>{G.v}</Text>
      </Text>

      {/* Data row 2: backend + tok/s sparkline */}
      <Text>
        <Text color={COL.surface.frame}>{G.v} </Text>
        <Text color={COL.text.dim}>backend </Text>
        <Text color={COL.accent.secondary}>{ui.status.backend}</Text>
        <Text color={COL.status.ok}> ●</Text>
        <Text>{" ".repeat(Math.max(0, leftCol - 11 - ui.status.backend.length - 2))}</Text>
        <Text color={COL.surface.frame}>{G.v} </Text>
        <Text color={COL.text.dim}>{padRight(tokLabel, 12)}</Text>
        <Sparkline
          data={series.tokPerSec.values()}
          width={sparkCols}
          color={COL.accent.tertiary}
          hotColor={COL.accent.primary}
        />
        <Text color={COL.surface.frame}>{G.v}</Text>
      </Text>

      {/* Divider between HUD and viewport */}
      <Text>
        <Text color={COL.surface.frame}>{G.vLeft}</Text>
        <Text color={COL.surface.frame}>{G.h.repeat(leftCol)}</Text>
        <Text color={COL.surface.frame}>{G.hBot}</Text>
        <Text color={COL.surface.frame}>{G.h.repeat(rightCol)}</Text>
        <Text color={COL.surface.frame}>{G.vRight}</Text>
      </Text>

      {/* Modes badges (autonomous, plan, airgap) — only show when active */}
      {ui.status.modes.length > 0 && (
        <Box>
          <Text color={COL.surface.frame}>{G.v} </Text>
          {ui.status.modes.map((m, i) => (
            <Box key={i} marginRight={1}>
              <Badge label={m} color={COL.accent.tertiary} active />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function padRight(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w);
  return s + " ".repeat(w - s.length);
}
