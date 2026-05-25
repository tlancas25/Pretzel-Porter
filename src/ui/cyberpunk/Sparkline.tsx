import { Text } from "ink";
import { theme } from "../theme/tokens.js";
import { sparkGlyph } from "./util.js";

/**
 * Block-element sparkline. Auto-scales: max value of the series maps to the
 * tallest glyph; minimum maps to the shortest. If all values are equal the
 * line renders at mid-height.
 */
export function Sparkline({
  data,
  width,
  color,
  hotColor,
}: {
  data: number[];
  width: number;
  color?: string;
  hotColor?: string;
}) {
  if (data.length === 0) {
    return <Text color={theme.color.text.faint}>{"·".repeat(width)}</Text>;
  }
  const slice = data.slice(-width);
  const padded = slice.length < width ? Array(width - slice.length).fill(NaN).concat(slice) : slice;
  const real = padded.filter((v) => !Number.isNaN(v));
  const min = Math.min(...real);
  const max = Math.max(...real);
  const range = max - min || 1;
  const peakThreshold = max - range * 0.2; // top 20% of values render in hotColor

  const c = color ?? theme.color.data.sparkline;
  const hc = hotColor ?? theme.color.data.sparklineHot;

  return (
    <Text>
      {padded.map((v, i) => {
        if (Number.isNaN(v)) {
          return (
            <Text key={i} color={theme.color.text.faint}>
              {" "}
            </Text>
          );
        }
        const norm = (v - min) / range;
        const isHot = v >= peakThreshold && range > 0;
        return (
          <Text key={i} color={isHot ? hc : c}>
            {sparkGlyph(norm)}
          </Text>
        );
      })}
    </Text>
  );
}
