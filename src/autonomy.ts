// Runtime autonomy toggle. When enabled, every write/shell confirmation is
// skipped so the agent runs uninterrupted. Toggled live with Shift+Tab.
//
// This is deliberately a process-wide mutable flag rather than config: it is a
// session decision the operator makes on the fly, not a persisted default.

let bypass = false;

export const autonomy = {
  /** True when confirmations are being bypassed. */
  get enabled(): boolean {
    return bypass;
  },
  set(value: boolean): void {
    bypass = value;
  },
  /** Flip the mode; returns the new state. */
  toggle(): boolean {
    bypass = !bypass;
    return bypass;
  },
};
