// src/ui/components/Banner.tsx — the startup banner: a rounded box with the
// pretzel logo on the left and a getting-started panel on the right.

import { Box, Text } from "ink";

const PRETZEL = [
  " .'  `'._.'`  '.",
  "|  .--;   ;--.  |",
  "|  (  /   \\  )  |",
  " \\  ;` /^\\ `;  /",
  "  :` .'._.'. `;",
  "  '-`'.___.'`-'",
];

const COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["/help", "list every command"],
  ["/init", "create a PRETZEL.md briefing"],
  ["Shift-Tab", "toggle autonomous mode"],
  ["@path", "attach a file to a turn"],
  ["/export", "save the session as a report"],
  ["/exit", "quit"],
];

interface BannerProps {
  version: string;
  model: string;
  rag: boolean;
  sandbox: string;
}

export function Banner({ version, model, rag, sandbox }: BannerProps) {
  const shownSandbox = sandbox.length > 46 ? "…" + sandbox.slice(-45) : sandbox;
  return (
    // alignSelf flex-start — hug the content instead of stretching full-width.
    <Box flexDirection="column" borderStyle="round" paddingX={1} alignSelf="flex-start">
      <Text>
        <Text bold color="yellow">
          Pretzel Porter
        </Text>
        <Text dimColor>{"  v" + version}</Text>
      </Text>

      <Box flexDirection="row" marginTop={1}>
        {/* Left column — the logo */}
        <Box flexDirection="column" marginRight={3}>
          {PRETZEL.map((line, i) => (
            <Text key={i} color="yellow">
              {line}
            </Text>
          ))}
          <Text> </Text>
          <Text dimColor>private · local</Text>
        </Box>

        {/* Right column — getting started */}
        <Box flexDirection="column">
          <Text bold>Getting started</Text>
          <Text> </Text>
          {COMMANDS.map(([key, desc]) => (
            <Box key={key} flexDirection="row">
              <Box width={12}>
                <Text color="cyan">{key}</Text>
              </Box>
              <Text dimColor>{desc}</Text>
            </Box>
          ))}
          <Text> </Text>
          <Text>
            <Text dimColor>model </Text>
            {model}
          </Text>
          <Text>
            <Text dimColor>rag </Text>
            {rag ? <Text color="green">enabled</Text> : <Text dimColor>disabled</Text>}
          </Text>
          <Text>
            <Text dimColor>sandbox </Text>
            {shownSandbox}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
