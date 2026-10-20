import { DRIVER_META } from "../data/schema";
import { heatCss } from "../model/heatColor";
import { contributions, fmtDelta, fmtScore, type ScoredZone } from "../model/score";
import type { Weights } from "../data/schema";
import { TrendGlyph } from "./TrendGlyph";

type Props = {
  zones: readonly ScoredZone[];
  weights: Weights;
  scenarioActive: boolean;
  reason: string;
  onPick: (id: string) => void;
};

/** Same data, no WebGL: ranked table with top contributing drivers. */
export function FallbackTable({ zones, weights, scenarioActive, reason, onPick }: Props) {
  const ranked = [...zones].filter((s) => s.view > 0).sort((a, b) => b.view - a.view);
  return (
    <div className="fallback">
      <p className="fallback-note mono">3D view unavailable ({reason}). Showing the ranked table of the same data.</p>
      <div className="fallback-scroll">
        <table className="ftable">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Zone</th>
              <th>Region</th>
              <th>Top drivers (pts)</th>
              <th>Trend</th>
              <th className="num">Score</th>
              {scenarioActive && <th className="num">Δ</th>}
            </tr>
          </thead>
          <tbody>
            {ranked.map((s, i) => (
              <tr key={s.zone.id} onClick={() => onPick(s.zone.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onPick(s.zone.id)}>
                <td className="mono num muted">{i + 1}</td>
                <td>{s.zone.name}</td>
                <td className="muted">{s.zone.region}</td>
                <td className="mono muted">
                  {contributions(s.intensities, weights)
                    .slice(0, 3)
                    .map((c) => `${DRIVER_META[c.driver].short} ${c.points.toFixed(1)}`)
                    .join(" · ")}
                </td>
                <td>
                  <TrendGlyph trend={s.trend} label />
                </td>
                <td className="mono num" style={{ color: heatCss(Math.max(s.view, 30)) }}>
                  {fmtScore(s.view)}
                </td>
                {scenarioActive && <td className="mono num">{s.adjustment ? fmtDelta(s.delta) : ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
