// Alt-screen lifecycle utilities.
//
// Not wired into the existing app yet — kept as bare functions that the
// Phase 2 App rewrite will call. Wiring them now would break the current
// `<Static>`-based App because alt-screen clears the visible area on entry
// and `<Static>` items written before entry would vanish.
//
// The functions guard against being called twice, restore state on exit even
// after a SIGINT, and no-op cleanly when stdout isn't a TTY.

let entered = false;
let exitHooked = false;

/** Enter the alternate screen buffer. Safe to call only on a TTY. */
export function enterAltScreen(): void {
  if (entered || !process.stdout.isTTY) return;
  process.stdout.write("\x1b[?1049h"); // CSI ? 1049 h
  process.stdout.write("\x1b[?25l"); // hide cursor while Ink owns it
  entered = true;
  ensureExitHook();
}

/** Exit the alt screen and restore the cursor. Safe to call when not entered. */
export function exitAltScreen(): void {
  if (!entered) return;
  process.stdout.write("\x1b[?25h"); // show cursor
  process.stdout.write("\x1b[?1049l"); // CSI ? 1049 l
  entered = false;
}

/**
 * Make sure we always restore the terminal even if the process exits abruptly.
 * Without this a crash mid-session leaves the user looking at a dark, cursor-
 * less terminal and they have to `reset` it manually.
 */
function ensureExitHook(): void {
  if (exitHooked) return;
  exitHooked = true;
  const restore = (): void => {
    if (entered) exitAltScreen();
  };
  process.on("exit", restore);
  // SIGINT / SIGTERM fire before exit on Ctrl-C and parent kills respectively.
  process.on("SIGINT", restore);
  process.on("SIGTERM", restore);
  // Uncaught error: restore THEN re-throw so the user sees the trace.
  process.on("uncaughtException", (err) => {
    restore();
    throw err;
  });
}
