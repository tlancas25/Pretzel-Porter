// Live metric series for the HUD sparklines. Populated by the agent loop
// (via bridge.ts) every time a turn completes; consumed by HudHeader.

import { RingSeries } from "./util.js";

class Series {
  latencyMs = new RingSeries(40);
  tokPerSec = new RingSeries(40);
  private listeners = new Set<() => void>();
  version = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = (): number => this.version;
  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  pushLatency(ms: number): void {
    this.latencyMs.push(ms);
    this.bump();
  }
  pushTokRate(tps: number): void {
    this.tokPerSec.push(tps);
    this.bump();
  }

  lastLatency(): number | null {
    const v = this.latencyMs.values();
    return v.length === 0 ? null : v[v.length - 1]!;
  }
  lastTokRate(): number | null {
    const v = this.tokPerSec.values();
    return v.length === 0 ? null : v[v.length - 1]!;
  }
}

export const series = new Series();
