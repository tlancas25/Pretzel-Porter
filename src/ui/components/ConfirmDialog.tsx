// src/ui/components/ConfirmDialog.tsx — a tool-approval prompt. Shown in place
// of the input while the agent waits on `ui.askConfirm`; the answer resolves
// the promise the agent is awaiting.

import { Box, Text, useInput } from "ink";
import { ui } from "../store.js";

export function ConfirmDialog({ question }: { question: string }) {
  useInput((input, key) => {
    const k = input.toLowerCase();
    if (k === "y" || key.return) ui.answerConfirm("yes");
    else if (k === "n" || key.escape) ui.answerConfirm("no");
    else if (k === "a") ui.answerConfirm("always");
  });
  return (
    <Box flexDirection="column">
      <Text color="yellow">{question.trim()}</Text>
      <Text>
        <Text color="green">[y]</Text>
        <Text dimColor> yes </Text>
        <Text color="red">[n]</Text>
        <Text dimColor> no </Text>
        <Text color="cyan">[a]</Text>
        <Text dimColor> always allow this tool</Text>
      </Text>
    </Box>
  );
}
