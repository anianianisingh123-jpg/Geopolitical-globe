/**
 * Heat ramp: cool gray (0) → amber → deep red → white-hot core (100).
 * Precomputed into a 101-entry lookup so globe accessors never interpolate.
 */
export type Rgb = readonly [number, number, number];

const STOPS: ReadonlyArray<readonly [number, Rgb]> = [
  [0, [52, 58, 70]],
  [18, [104, 88, 62]],
  [32, [201, 138, 43]],
  [48, [214, 96, 34]],
  [62, [168, 26, 30]],
  [74, [132, 12, 20]],
  [86, [232, 66, 48]],
  [94, [255, 170, 120]],
  [100, [255, 246, 236]],
];

function interpolate(v: number): Rgb {
  for (let i = 1; i < STOPS.length; i++) {
    const hi = STOPS[i];
    const lo = STOPS[i - 1];
    if (!hi || !lo) break;
    if (v <= hi[0]) {
      const t = (v - lo[0]) / (hi[0] - lo[0]);
      return [
        Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t),
        Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t),
        Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t),
      ];
    }
  }
  return [255, 246, 236];
}

const LUT: Rgb[] = Array.from({ length: 101 }, (_, i) => interpolate(i));

export function heatRgb(score: number): Rgb {
  const i = Math.max(0, Math.min(100, Math.round(score)));
  return LUT[i] ?? LUT[0]!;
}

export function heatCss(score: number, alpha = 1): string {
  const [r, g, b] = heatRgb(score);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/** CSS gradient of the full ramp, for legends. */
export const HEAT_GRADIENT = `linear-gradient(90deg, ${STOPS.map(([s]) => `${heatCss(s)} ${s}%`).join(", ")})`;
