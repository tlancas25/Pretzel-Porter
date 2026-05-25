// Hyper-stack theme — the v1 cyberpunk palette.
//
// All colour, glyph, and spacing decisions live here. Components import
// `theme` and reach for named *roles* (accent.primary, status.ok) rather than
// hex literals — that way swapping the entire palette is one file. Future
// themes (neon-noir, brutalist, phosphor-CRT) implement the same shape so
// `/theme <name>` can swap them at runtime without changing components.
//
// Hex values target truecolor terminals. Ink renders through chalk, which
// auto-degrades to 256-colour and 16-colour based on the terminal report,
// so we don't maintain a fallback table here.

export const theme = {
  name: "hyper-stack",

  color: {
    // Three voices: primary draws the eye (frame, focus), secondary highlights
    // data (meters, links), tertiary warns / accents secondary data.
    accent: {
      primary: "#ff007f", // hot pink — frame, focus rings, user prompt prefix
      secondary: "#00f2ff", // cyan — meters, sparklines, code refs
      tertiary: "#ffb000", // amber — warnings, secondary data labels
    },

    text: {
      normal: "#e8e8ff", // off-white with a violet bias — body text
      dim: "#8a8aa5", // labels, metadata, ghost-input placeholder
      faint: "#4a4a60", // separators, inactive state
      inverse: "#0a0a14", // text on top of an accent fill (badges, selection)
    },

    surface: {
      frame: "#ff007f", // HUD border colour
      divider: "#3a3a55", // sub-dividers inside panels
      panel: "#0a0a14", // intended background where we paint (rare; bg stays default)
    },

    status: {
      ok: "#00ff99", // mint
      warn: "#ffb000", // amber
      err: "#ff3355", // red-pink
      info: "#00f2ff", // cyan
    },

    // Data-oriented colours — kept separate so a future "high-contrast" theme
    // can darken these without touching the accent palette.
    data: {
      meterFill: "#ff007f",
      meterEmpty: "#3a3a55",
      sparkline: "#00f2ff",
      sparklineHot: "#ffb000", // peaks of the sparkline (top 1-2 bars)
    },

    // Semantic roles — what specific conversation elements look like.
    semantic: {
      user: "#00f2ff", // user prompt prefix / their text
      assistant: "#00ff99", // assistant bullet + body
      thinking: "#d300ff", // magenta — interior-monologue distinction
      tool: "#ffb000", // tool calls (gear glyph, block headers)
      toolOk: "#00ff99",
      toolErr: "#ff3355",
      diffAdd: "#00ff99",
      diffDel: "#ff3355",
      diffHunk: "#00f2ff",
    },
  },

  glyph: {
    // Double-line box for the HUD frame, single-line for inner sub-dividers.
    frame: {
      tl: "╔",
      tr: "╗",
      bl: "╚",
      br: "╝",
      h: "═",
      v: "║",
      hTop: "╦",
      hBot: "╩",
      vLeft: "╠",
      vRight: "╣",
      cross: "╬",
      // Sub-divider (single-line) for use inside panels.
      sTl: "┌",
      sTr: "┐",
      sBl: "└",
      sBr: "┘",
      sH: "─",
      sV: "│",
    },

    // Meter glyphs. `partial` indexes 0..7 for sub-cell precision when a
    // meter's fill doesn't land on a cell boundary.
    bar: {
      full: "█",
      empty: "░",
      partial: ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"] as const,
    },

    // Block elements for sparklines — 8 levels of vertical fill per cell.
    spark: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const,

    indicator: {
      online: "●",
      offline: "○",
      busy: "◐",
      pulse: ["◐", "◓", "◑", "◒"] as const, // for autonomous-mode pulse animation
    },

    cursor: "▎", // narrow vertical block for the CRT cursor

    arrow: {
      up: "▲",
      down: "▼",
      left: "◀",
      right: "▶",
    },

    bracket: {
      l: "[",
      r: "]",
      lAngle: "‹",
      rAngle: "›",
    },

    // Conversation glyphs.
    prompt: "›",
    assistant: "●",
    thinking: "◆",
    tool: "⚙",
    ok: "✓",
    fail: "✗",
    warn: "⚠",

    // Tool-call block connectors.
    block: {
      tl: "╭",
      v: "│",
      bl: "╰",
      h: "─",
      branch: "◉",
    },
  },

  spacing: {
    pad: 1, // 1-cell internal padding from frame
    gutter: 2, // gap between columns in 2-col layouts
  },
} as const;

export type Theme = typeof theme;
