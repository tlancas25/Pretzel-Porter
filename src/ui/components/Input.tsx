// src/ui/components/Input.tsx — the prompt input. Text editing, cursor, prompt
// history (up/down), Shift-Tab to toggle autonomous, Esc to clear or cancel.
// Replaces the readline-based input from the old UI.

import { Box, Text, useInput } from "ink";
import { useState } from "react";

interface InputProps {
  /** Called when the operator submits a non-empty line. */
  onSubmit: (text: string) => void;
  /** Prompt history, oldest-first. */
  history: string[];
  /** True while the agent is generating — typing is disabled, Esc cancels. */
  busy: boolean;
  /** Shift-Tab handler — toggles autonomous mode. */
  onToggleAutonomous: () => void;
  /** Esc-while-busy handler — cancels the in-flight response. */
  onCancel: () => void;
}

export function Input({ onSubmit, history, busy, onToggleAutonomous, onCancel }: InputProps) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [histIdx, setHistIdx] = useState(-1); // -1 = the live line

  useInput((input, key) => {
    if (key.tab && key.shift) {
      onToggleAutonomous();
      return;
    }
    if (key.escape) {
      if (busy) onCancel();
      else {
        setValue("");
        setCursor(0);
        setHistIdx(-1);
      }
      return;
    }
    if (busy) return; // mid-generation: only Shift-Tab / Esc are live

    if (key.return) {
      const text = value.trim();
      setValue("");
      setCursor(0);
      setHistIdx(-1);
      if (text) onSubmit(text);
      return;
    }
    if (key.upArrow) {
      if (history.length === 0) return;
      const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      const line = history[idx] ?? "";
      setHistIdx(idx);
      setValue(line);
      setCursor(line.length);
      return;
    }
    if (key.downArrow) {
      if (histIdx === -1) return;
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(-1);
        setValue("");
        setCursor(0);
      } else {
        const line = history[idx] ?? "";
        setHistIdx(idx);
        setValue(line);
        setCursor(line.length);
      }
      return;
    }
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(value.length, c + 1));
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
      }
      return;
    }
    if (input) {
      // A typed character, or a pasted chunk (Ink delivers paste as one input).
      setValue(value.slice(0, cursor) + input + value.slice(cursor));
      setCursor(cursor + input.length);
    }
  });

  if (busy) {
    return (
      <Box>
        <Text color="yellow">⚡ </Text>
        <Text dimColor>working — Esc to stop</Text>
      </Box>
    );
  }

  const before = value.slice(0, cursor);
  const at = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);
  return (
    <Box>
      <Text color="cyan">❯ </Text>
      <Text>
        {before}
        <Text inverse>{at}</Text>
        {after}
      </Text>
    </Box>
  );
}
