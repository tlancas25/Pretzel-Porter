// Capped-rate redraw hook for live UI elements.
//
// Used by sparklines, pulse animations, and the streaming cursor. 10fps is
// plenty for the motion vocabulary in v1 (pulses, sparkline drift, blink) and
// keeps CPU off the floor — burning 60fps for terminal UI is wasteful and on
// hosts without synchronized output (Terminal.app) also flickers more.
//
// The callback is held in a ref so consumers can use inline arrow functions
// without re-creating the interval every render.

import { useEffect, useRef } from "react";

export function useAnimationFrame(cb: (frame: number) => void, fps = 10): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    let frame = 0;
    const handle = setInterval(() => {
      cbRef.current(frame++);
    }, 1000 / fps);
    return () => clearInterval(handle);
  }, [fps]);
}
