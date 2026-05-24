import { Text } from "ink";
import { theme } from "../theme/tokens.js";

/** `[ LABEL ]` tag in the brutalist-datapunk style. */
export function Badge({
  label,
  color,
  active = false,
}: {
  label: string;
  color?: string;
  active?: boolean;
}) {
  const accent = color ?? theme.color.accent.secondary;
  if (active) {
    return (
      <Text>
        <Text color={accent}>[</Text>
        <Text color={theme.color.text.inverse} backgroundColor={accent} bold>
          {" " + label.toUpperCase() + " "}
        </Text>
        <Text color={accent}>]</Text>
      </Text>
    );
  }
  return (
    <Text color={accent}>
      [ <Text color={theme.color.text.dim}>{label.toUpperCase()}</Text> ]
    </Text>
  );
}
