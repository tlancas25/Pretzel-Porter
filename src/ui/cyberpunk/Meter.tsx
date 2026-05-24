import { Text } from "ink";
import { theme } from "../theme/tokens.js";
import { barString } from "./util.js";

/** Horizontal bar meter with neon fill and dim track. */
export function Meter({
  value,
  width = 12,
  fillColor,
  emptyColor,
}: {
  value: number; // 0..1
  width?: number;
  fillColor?: string;
  emptyColor?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const fillCols = Math.ceil(clamped * width);
  const s = barString(clamped, width);
  // Split into filled and empty portions to colour them independently.
  const fillStr = s.slice(0, fillCols);
  const emptyStr = s.slice(fillCols);
  return (
    <Text>
      <Text color={fillColor ?? theme.color.data.meterFill}>{fillStr}</Text>
      <Text color={emptyColor ?? theme.color.data.meterEmpty}>{emptyStr}</Text>
    </Text>
  );
}
