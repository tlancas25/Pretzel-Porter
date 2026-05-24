// Runtime detection of terminal-emulator features.
//
// Detection runs once at startup and is cached. Components and effects gate
// on specific capabilities (`caps.syncOutput`, `caps.imageProtocol === "kitty"`)
// so we lean into Ghostty when it's the host and fall back cleanly when it's
// Terminal.app or anything else.
//
// We never try to *query* the terminal (DA1, DECRQM) — that's slow, racy, and
// some terminals lie. Program detection via `TERM_PROGRAM` is enough for our
// design budget; users can override with environment variables when wrong.

export interface Capabilities {
  /** 24-bit RGB colour escapes are honoured (not down-mixed to 256). */
  truecolor: boolean;
  /** Mode 2026 — atomic frame swaps, no flicker on rapid redraws. */
  syncOutput: boolean;
  /** OSC 8 clickable hyperlinks. */
  osc8Hyperlinks: boolean;
  /** Inline image protocol available, or null for none. */
  imageProtocol: "kitty" | "iterm2" | "sixel" | null;
  /** Alt screen buffer (CSI ?1049h/l). Universal among TUI hosts; here for completeness. */
  altScreen: boolean;
  /** Whether the user's font likely has Nerd Font glyphs (cannot be detected from env). */
  fontHasNerd: boolean | "unknown";
  /** Raw value of TERM_PROGRAM for diagnostics. */
  termProgram: string;
  /** Convenience flags. */
  isGhostty: boolean;
  isTerminalApp: boolean;
  isIterm: boolean;
  isWezterm: boolean;
  isKitty: boolean;
}

let cached: Capabilities | null = null;

export function detectCapabilities(): Capabilities {
  if (cached) return cached;
  const env = process.env;
  const termProgram = env.TERM_PROGRAM ?? "";
  const term = env.TERM ?? "";
  const colorterm = env.COLORTERM ?? "";

  // Program-level identification. Ghostty also exports GHOSTTY_RESOURCES_DIR
  // — keep that as a backup in case TERM_PROGRAM is overridden by a wrapper.
  const isGhostty = termProgram === "ghostty" || !!env.GHOSTTY_RESOURCES_DIR;
  const isTerminalApp = termProgram === "Apple_Terminal";
  const isIterm = termProgram === "iTerm.app" || env.LC_TERMINAL === "iTerm2";
  const isWezterm = termProgram === "WezTerm" || term.includes("wezterm");
  const isKitty = term === "xterm-kitty" || termProgram === "kitty";

  // Truecolor: explicit COLORTERM beats everything; otherwise infer from the
  // emulator. Terminal.app added truecolor in Big Sur (TERM_PROGRAM_VERSION
  // ≥ 421 corresponds to macOS 11+).
  const truecolor =
    colorterm === "truecolor" ||
    colorterm === "24bit" ||
    isGhostty ||
    isIterm ||
    isWezterm ||
    isKitty ||
    (isTerminalApp && Number.parseInt(env.TERM_PROGRAM_VERSION?.split(".")[0] ?? "0", 10) >= 421);

  // Synchronized output (mode 2026). Supported by every modern TUI host;
  // Terminal.app does not implement it as of macOS 15.
  const syncOutput = isGhostty || isIterm || isWezterm || isKitty;

  // OSC 8 hyperlinks — same support set as sync output, give or take.
  const osc8Hyperlinks = isGhostty || isIterm || isWezterm || isKitty;

  // Image protocols. Ghostty implements the Kitty graphics protocol.
  let imageProtocol: "kitty" | "iterm2" | "sixel" | null = null;
  if (isGhostty || isKitty) imageProtocol = "kitty";
  else if (isIterm) imageProtocol = "iterm2";
  else if (isWezterm) imageProtocol = "kitty"; // wezterm prefers kitty when both are available

  // Nerd Font: undetectable from environment. PP_NERDFONT=1 opts in; =0 opts
  // out; default "unknown" means components avoid private-use-area glyphs.
  const fontHasNerd: boolean | "unknown" =
    env.PP_NERDFONT === "1" ? true : env.PP_NERDFONT === "0" ? false : "unknown";

  cached = {
    truecolor,
    syncOutput,
    osc8Hyperlinks,
    imageProtocol,
    altScreen: true, // Universal among the terminals we target; documented for clarity.
    fontHasNerd,
    termProgram,
    isGhostty,
    isTerminalApp,
    isIterm,
    isWezterm,
    isKitty,
  };
  return cached;
}

/** Reset the detection cache. Used by tests; otherwise capabilities are stable. */
export function resetCapabilitiesCache(): void {
  cached = null;
}
