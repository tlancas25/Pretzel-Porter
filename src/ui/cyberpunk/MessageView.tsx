// Conversation item renderers. Each item type maps to its own visual block:
// user prompts get a › prefix in cyan; assistant gets a ● in mint; thinking
// gets a magenta ◆ header + dim italic body; tool calls render as a
// connected ╭─◉ / │ / ╰─◉ block; diffs get a [HUNK] tag and coloured gutter.

import { Box, Text } from "ink";
import { theme } from "../theme/tokens.js";
import type { ConvItem } from "../store.js";

const COL = theme.color;
const SEM = COL.semantic;
const GB = theme.glyph.block;

// Strip ANSI escape sequences so colour codes baked into preview strings
// don't appear as literal `\x1b[…m` runs inside Ink Text components.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

export function MessageView({ item }: { item: ConvItem }) {
  switch (item.kind) {
    case "user":
      return <UserBlock text={item.text} />;
    case "assistant":
      return <AssistantBlock text={item.text} />;
    case "thinking":
      return <ThinkingBlock text={item.text} />;
    case "info":
      return <InfoBlock text={item.text} />;
    case "error":
      return <ErrorBlock text={item.text} />;
    case "timing":
      return (
        <Box>
          <Text color={COL.text.faint}>  ⌛ {item.text}</Text>
        </Box>
      );
    case "diff":
      return <DiffBlock text={item.text} />;
    case "tool":
      return (
        <ToolBlock
          name={item.name}
          summary={item.summary}
          ok={item.ok}
          preview={item.preview}
        />
      );
    default:
      return (
        <Box>
          <Text>{(item as { text?: string }).text ?? ""}</Text>
        </Box>
      );
  }
}

function UserBlock({ text }: { text: string }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {text.split("\n").map((ln, i) => (
        <Box key={i}>
          <Text color={SEM.user} bold>
            {i === 0 ? theme.glyph.prompt + " " : "  "}
          </Text>
          <Text color={COL.text.normal}>{ln}</Text>
        </Box>
      ))}
    </Box>
  );
}

function AssistantBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.map((ln, i) => (
        <Box key={i}>
          <Text color={SEM.assistant} bold>
            {i === 0 ? theme.glyph.assistant + " " : "  "}
          </Text>
          <Text color={COL.text.normal}>{ln}</Text>
        </Box>
      ))}
    </Box>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={SEM.thinking} bold>
          {theme.glyph.thinking + " thinking"}
        </Text>
      </Box>
      {text.split("\n").map((ln, i) => (
        <Box key={i}>
          <Text color={COL.text.dim} italic>
            {"  " + ln}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function InfoBlock({ text }: { text: string }) {
  return (
    <Box flexDirection="column">
      {text.split("\n").map((ln, i) => (
        <Box key={i}>
          <Text color={COL.text.dim}>{ln}</Text>
        </Box>
      ))}
    </Box>
  );
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <Box>
      <Text color={COL.status.err} bold>
        {theme.glyph.fail} {text}
      </Text>
    </Box>
  );
}

function DiffBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={SEM.diffHunk}>[ DIFF ]</Text>
      </Box>
      {lines.map((ln, i) => {
        let color: string = COL.text.dim;
        let gutter = "  ";
        if (ln.startsWith("+")) {
          color = SEM.diffAdd;
          gutter = "+ ";
        } else if (ln.startsWith("-")) {
          color = SEM.diffDel;
          gutter = "- ";
        } else if (ln.startsWith("@@")) {
          color = SEM.diffHunk;
          gutter = "@ ";
        }
        return (
          <Box key={i}>
            <Text color={color}>
              {gutter}
              {ln.replace(/^[+\-@]+\s?/, "")}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function ToolBlock({
  name,
  summary,
  ok,
  preview,
}: {
  name: string;
  summary: string;
  ok: boolean | null;
  preview: string;
}) {
  const statusColor = ok === null ? SEM.tool : ok ? SEM.toolOk : SEM.toolErr;
  const statusGlyph = ok === null ? "…" : ok ? theme.glyph.ok : theme.glyph.fail;
  const cleanPreview = preview ? stripAnsi(preview).split("\n")[0]?.slice(0, 120) ?? "" : "";
  const hasMore = preview && stripAnsi(preview).includes("\n");
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={SEM.tool}>
          {GB.tl}
          {GB.h}
          {GB.branch}{" "}
        </Text>
        <Text color={SEM.tool} bold>
          {name}
        </Text>
        <Text color={COL.text.dim}> · {summary}</Text>
      </Box>
      {cleanPreview && (
        <Box>
          <Text color={SEM.tool}>{GB.v}  </Text>
          <Text color={COL.text.dim}>
            ⟶ {cleanPreview}
            {hasMore ? " …" : ""}
          </Text>
        </Box>
      )}
      <Box>
        <Text color={statusColor}>
          {GB.bl}
          {GB.h}
          {GB.branch} {statusGlyph}
        </Text>
        <Text color={COL.text.faint}> {ok === null ? "running" : ok ? "ok" : "failed"}</Text>
      </Box>
    </Box>
  );
}
