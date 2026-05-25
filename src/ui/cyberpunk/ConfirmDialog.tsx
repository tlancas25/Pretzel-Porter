// Tool-approval prompt. Big, framed, and pulses between hot-pink and amber
// so it actively grabs the eye — the v1.4.0 version was tiny enough that
// users would miss it and wait, thinking the agent was still busy.
//
// Rings the terminal bell exactly once on mount. Modern macOS terminals
// surface that as a dock-icon bounce / sound, which is exactly the
// "hey, I need you" affordance we want.

import { Box, Text, useInput, useStdout } from "ink";
import { useEffect, useState } from "react";
import { theme } from "../theme/tokens.js";
import { ui } from "../store.js";
import { useAnimationFrame } from "../useAnimationFrame.js";

const COL = theme.color;
const G = theme.glyph.frame;

export function ConfirmDialog({ question }: { question: string }) {
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout.columns ?? 80);
  const [frame, setFrame] = useState(0);

  // 2fps border pulse — slow enough that it reads as a glow, not a strobe.
  useAnimationFrame((f) => setFrame(f), 2);

  // Track terminal resizes so the card stays full-width.
  useEffect(() => {
    const on = () => setCols(stdout.columns ?? 80);
    stdout.on("resize", on);
    return () => {
      stdout.off("resize", on);
    };
  }, [stdout]);

  // Ring the bell exactly once on mount. We can't use useEffect's deps to
  // restrict to first render because the dialog component instance is fresh
  // per confirm — a mount IS the first time.
  useEffect(() => {
    if (process.stdout.isTTY) process.stdout.write("\x07");
  }, []);

  // Pulse colour: alternates primary ↔ tertiary every frame.
  const borderColor = frame % 2 === 0 ? COL.accent.primary : COL.accent.tertiary;
  const titleColor = COL.status.warn;

  useInput((input, key) => {
    const k = input.toLowerCase();
    if (k === "y" || key.return) ui.answerConfirm("yes");
    else if (k === "n" || key.escape) ui.answerConfirm("no");
    else if (k === "a") ui.answerConfirm("always");
  });

  const innerWidth = Math.max(40, Math.min(96, cols - 4));
  const title = "  ⚠  APPROVAL REQUIRED  ⚠  ";
  const titleFill = Math.max(0, innerWidth - title.length);
  const lp = Math.floor(titleFill / 2);
  const rp = titleFill - lp;

  // Wrap the question (already stripped to a single line typically) for the
  // body. Keep lines short so the card stays scannable at a glance.
  const wrapAt = innerWidth - 4;
  const wrapped = wrapText(question.trim(), wrapAt);

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Top border with centred warning title */}
      <Text>
        <Text color={borderColor}>{G.tl}</Text>
        <Text color={borderColor}>{G.h.repeat(lp)}</Text>
        <Text color={titleColor} bold>
          {title}
        </Text>
        <Text color={borderColor}>{G.h.repeat(rp)}</Text>
        <Text color={borderColor}>{G.tr}</Text>
      </Text>

      {/* Top padding row */}
      <FrameRow borderColor={borderColor} width={innerWidth} content="" />

      {/* Question body */}
      {wrapped.map((line, i) => (
        <FrameRow
          key={i}
          borderColor={borderColor}
          width={innerWidth}
          content={"  " + line}
          contentColor={COL.text.normal}
        />
      ))}

      {/* Spacer between question and buttons */}
      <FrameRow borderColor={borderColor} width={innerWidth} content="" />

      {/* Y / N / A buttons row — each key is a real inverse-video chip so
          it reads as a button, not a label. Widths kept stable so the right
          frame border stays aligned regardless of question content. */}
      <Text>
        <Text color={borderColor}>{G.v}</Text>
        <Text>  </Text>
        <Text color={COL.text.inverse} backgroundColor={COL.status.ok} bold>
          {" Y "}
        </Text>
        <Text color={COL.text.normal}>  approve     </Text>
        <Text color={COL.text.inverse} backgroundColor={COL.status.err} bold>
          {" N "}
        </Text>
        <Text color={COL.text.normal}>  deny     </Text>
        <Text color={COL.text.inverse} backgroundColor={COL.status.warn} bold>
          {" A "}
        </Text>
        <Text color={COL.text.normal}>  always allow  </Text>
        {/* The chip + label widths sum to 60; fill the rest so the right
            border lands at innerWidth + 1. */}
        <Text>{" ".repeat(Math.max(0, innerWidth - 60))}</Text>
        <Text color={borderColor}>{G.v}</Text>
      </Text>

      {/* Bottom padding row */}
      <FrameRow borderColor={borderColor} width={innerWidth} content="" />

      {/* Bottom border */}
      <Text>
        <Text color={borderColor}>{G.bl}</Text>
        <Text color={borderColor}>{G.h.repeat(innerWidth)}</Text>
        <Text color={borderColor}>{G.br}</Text>
      </Text>
    </Box>
  );
}

function FrameRow({
  borderColor,
  width,
  content,
  contentColor,
}: {
  borderColor: string;
  width: number;
  content: string;
  contentColor?: string;
}) {
  return (
    <Text>
      <Text color={borderColor}>{G.v}</Text>
      <Text color={contentColor ?? COL.text.normal}>{padTo(content, width)}</Text>
      <Text color={borderColor}>{G.v}</Text>
    </Text>
  );
}

function padTo(s: string, w: number): string {
  // Visual length, ignoring potential ANSI escapes (we don't bake any in here).
  if (s.length >= w) return s.slice(0, w);
  return s + " ".repeat(w - s.length);
}

function wrapText(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const out: string[] = [];
  const words = text.split(/\s+/);
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      out.push(line);
      line = w;
    } else {
      line = line ? line + " " + w : w;
    }
  }
  if (line) out.push(line);
  return out;
}
