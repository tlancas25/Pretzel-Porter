import { Box, Text } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { theme } from "../theme/tokens.js";
import { ui } from "../store.js";

const COL = theme.color;
const SEM = COL.semantic;

/**
 * Live mid-stream rendering — thinking text appears in dim italic under a
 * magenta header, assistant content streams with a trailing CRT cursor that
 * blinks while still generating. Once the stream commits the content moves
 * into the conversation log and this component goes back to empty.
 */
export function LiveStream() {
  useSyncExternalStore(ui.subscribe, ui.getVersion, ui.getVersion);
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    const handle = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(handle);
  }, []);

  if (!ui.streamThinking && !ui.streamContent) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      {ui.streamThinking && (
        <Box flexDirection="column">
          <Box>
            <Text color={SEM.thinking} bold>
              {theme.glyph.thinking + " thinking"}
            </Text>
          </Box>
          {ui.streamThinking.split("\n").map((ln, i) => (
            <Box key={i}>
              <Text color={COL.text.dim} italic>
                {"  " + ln}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      {ui.streamContent && (
        <Box flexDirection="column">
          {ui.streamContent.split("\n").map((ln, i, all) => (
            <Box key={i}>
              <Text color={SEM.assistant} bold>
                {i === 0 ? theme.glyph.assistant + " " : "  "}
              </Text>
              <Text color={COL.text.normal}>
                {ln}
                {i === all.length - 1 && (
                  <Text color={SEM.assistant}>{blink ? theme.glyph.cursor : " "}</Text>
                )}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
