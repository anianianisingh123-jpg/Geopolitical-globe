import { DRIVER_META, DRIVERS, type Driver, type Weights } from "../data/schema";
import { heatCss } from "../model/heatColor";
import type { Intensities, ScoredZone } from "../model/score";

type Props = {
  scored: ScoredZone;
  base: Intensities;
  weights: Weights;
  activeLayers: readonly Driver[] | null;
};

/**
 * One row per driver the zone carries: intensity bar (0–100), the global
 * weight, and the points it contributes to the composite. Scenario deltas
 * render as a hatched extension with the signed delta beside it.
 */
export function DriverBars({ scored, base, weights, activeLayers }: Props) {
  const notes = new Map(scored.zone.drivers_detail.map((d) => [d.driver, d.note]));
  const rows = DRIVERS.filter((d) => scored.intensities[d] > 0 || base[d] > 0)
    .map((d) => ({ d, now: scored.intensities[d], was: base[d], pts: weights[d] * scored.intensities[d] }))
    .sort((a, b) => b.pts - a.pts || b.now - a.now);
  const total = rows.reduce((s, r) => s + r.pts, 0);

  return (
    <div className="bars" role="table" aria-label="Driver breakdown">
      <div className="bars-head" role="row">
        <span role="columnheader">Driver</span>
        <span role="columnheader">Intensity</span>
        <span role="columnheader" className="num">
          w
        </span>
        <span role="columnheader" className="num">
          pts
        </span>
      </div>
      {rows.map(({ d, now, was, pts }) => {
        const delta = now - was;
        const muted = activeLayers !== null && !activeLayers.includes(d);
        return (
          <div className="bar-row" role="row" key={d} data-muted={muted}>
            <span className="bar-driver" role="cell" title={DRIVER_META[d].blurb}>
              {DRIVER_META[d].label}
            </span>
            <span className="bar-track" role="cell" aria-label={`${now} of 100`}>
              <span className="bar-fill" style={{ width: `${Math.min(was, now)}%`, background: heatCss(now) }} />
              {delta > 0 && (
                <span className="bar-delta" style={{ left: `${was}%`, width: `${delta}%`, color: heatCss(now) }} />
              )}
              <span className="bar-val mono">
                {now}
                {delta !== 0 && <em>{delta > 0 ? `+${delta}` : delta}</em>}
              </span>
            </span>
            <span className="bar-w mono num" role="cell">
              ×{weights[d].toFixed(2)}
            </span>
            <span className="bar-pts mono num" role="cell">
              {pts.toFixed(1)}
            </span>
            <span className="bar-note" role="cell">
              {notes.get(d) ?? ""}
            </span>
          </div>
        );
      })}
      <div className="bars-total" role="row">
        <span role="cell">Σ wᵢ·intensityᵢ{total > 100 ? " (capped)" : ""}</span>
        <span className="mono num" role="cell">
          {Math.min(100, total).toFixed(1)}
        </span>
      </div>
    </div>
  );
}
