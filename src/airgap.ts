// Air-gap mode: a hard switch that disables every network-capable tool
// (web_fetch, web_search). Initialised from config at startup and toggleable
// live with /airgap — a guarantee for a fully offline, sensitive session.

let enabled = false;

export const airgap = {
  /** True when network tools are disabled. */
  get enabled(): boolean {
    return enabled;
  },
  set(value: boolean): void {
    enabled = value;
  },
  toggle(): boolean {
    enabled = !enabled;
    return enabled;
  },
};
