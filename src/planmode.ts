// Plan mode: a read-only investigation mode. While it is on, every write and
// shell tool is refused — the agent can only read, search, and map — so it
// produces a plan instead of making changes. The operator reviews the plan,
// turns plan mode off, and lets the agent execute. Toggled with /plan.

let active = false;

export const planMode = {
  /** True while the session is in read-only planning mode. */
  get active(): boolean {
    return active;
  },
  set(value: boolean): void {
    active = value;
  },
  /** Flip the mode; returns the new state. */
  toggle(): boolean {
    active = !active;
    return active;
  },
};
