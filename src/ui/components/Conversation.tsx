// src/ui/components/Conversation.tsx — renders one conversation item, and the
// live streaming region for an in-progress response.

import { Box, Text } from "ink";
import { ui, type ConvItem } from "../store.js";

function firstLine(s: string): string {
  const line = s.split("\n")[0] ?? "";
  return line.length > 110 ? line.slice(0, 110) + "…" : line;
}

/** Render a single completed conversation item. */
export function ItemView({ item }: { item: ConvItem }) {
  switch (item.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="cyan">❯ </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={1}>
          <Text color="green">● </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "thinking":
      return (
        <Box marginTop={1} flexDirection="column">
          <Text color="magenta">◆ thinking</Text>
          <Text dimColor italic>
            {item.text}
          </Text>
        </Box>
      );
    case "info":
      return (
        <Box marginTop={1}>
          <Text dimColor>{item.text}</Text>
        </Box>
      );
    case "error":
      return (
        <Box marginTop={1}>
          <Text color="red">✗ error: </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "timing":
      return (
        <Box marginTop={1}>
          <Text dimColor>✻ {item.text}</Text>
        </Box>
      );
    case "diff":
      return (
        <Box marginTop={1} flexDirection="column">
          {item.text.split("\n").map((l, i) => (
            <Text
              key={i}
              color={
                l.startsWith("@@")
                  ? "cyan"
                  : l.startsWith("+")
                    ? "green"
                    : l.startsWith("-")
                      ? "red"
                      : undefined
              }
              dimColor={!/^[+\-@]/.test(l)}
            >
              {l}
            </Text>
          ))}
        </Box>
      );
    case "tool":
      return (
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color="yellow">⚙ </Text>
            <Text bold>{item.name}</Text>
            <Text dimColor>{"  " + item.summary}</Text>
          </Text>
          {item.ok !== null ? (
            <Text>
              <Text color={item.ok ? "green" : "red"}>{item.ok ? "✓ " : "✗ "}</Text>
              <Text dimColor>{firstLine(item.preview)}</Text>
            </Text>
          ) : null}
        </Box>
      );
  }
}

/** The in-progress response — thinking trace and/or streaming answer. */
export function LiveStream() {
  if (!ui.streamThinking && !ui.streamContent) return null;
  return (
    <Box marginTop={1} flexDirection="column">
      {ui.streamThinking ? <Text color="magenta">◆ thinking</Text> : null}
      {ui.streamThinking ? (
        <Text dimColor italic>
          {ui.streamThinking}
        </Text>
      ) : null}
      {ui.streamContent ? (
        <Text>
          <Text color="green">● </Text>
          <Text>{ui.streamContent}</Text>
        </Text>
      ) : null}
    </Box>
  );
}
