import type { Trend } from "../data/schema";

const GLYPH: Record<Trend, string> = { rising: "▲", stable: "■", falling: "▼" };

export function TrendGlyph({ trend, label = false }: { trend: Trend; label?: boolean }) {
  return (
    <span className={`trend-glyph ${trend}`} title={trend} aria-label={label ? undefined : trend}>
      {GLYPH[trend]}
      {label && <span className="trend-label">{trend}</span>}
    </span>
  );
}
