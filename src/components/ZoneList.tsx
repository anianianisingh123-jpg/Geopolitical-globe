import { memo } from "react";
import { DRIVER_META } from "../data/schema";
import { heatCss } from "../model/heatColor";
import { fmtDelta, fmtScore, type ScoredZone } from "../model/score";
import { fmtRatio, SURGE } from "./Coverage";
import { TrendGlyph } from "./TrendGlyph";

type Props = {
  zones: readonly ScoredZone[];
  selectedId: string | null;
  cursorId?: string | null;
  scenarioActive: boolean;
  dense?: boolean;
  /** Coverage ratio per zone (last 3 d vs prior 11 d); badges show at or above SURGE. */
  surges?: ReadonlyMap<string, number>;
  onPick: (id: string) => void;
};

/** Ranked zone rows: search dropdown on desktop, primary list on mobile. */
export const ZoneList = memo(function ZoneList({ zones, selectedId, cursorId, scenarioActive, dense, surges, onPick }: Props) {
  if (zones.length === 0) return <p className="empty">No zones match.</p>;
  return (
    <ol className={`zone-list${dense ? " dense" : ""}`}>
      {zones.map((s) => {
        const dim = s.view <= 0;
        return (
          <li key={s.zone.id}>
            <button
              type="button"
              className="zone-row"
              data-active={s.zone.id === selectedId || s.zone.id === cursorId}
              data-dim={dim}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(s.zone.id)}
            >
              <span className="zone-heat" style={{ background: dim ? "var(--line)" : heatCss(s.view) }} aria-hidden />
              <span className="zone-main">
                <span className="zone-name">{s.zone.name}</span>
                <span className="zone-meta">
                  {s.zone.region} · {s.zone.drivers.map((d) => DRIVER_META[d].short).join(" ")}
                  {(surges?.get(s.zone.id) ?? 0) >= SURGE && (
                    <span className="surge-badge mono" title="News coverage, last 3 days vs prior 11 (GDELT)">
                      {" "}
                      · NEWS ▲{fmtRatio(surges?.get(s.zone.id) ?? 0)}
                    </span>
                  )}
                </span>
              </span>
              <span className="zone-delta mono">{scenarioActive && s.adjustment ? fmtDelta(s.delta) : ""}</span>
              <TrendGlyph trend={s.trend} />
              <span className="zone-score mono">{dim ? "—" : fmtScore(s.view)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
});
