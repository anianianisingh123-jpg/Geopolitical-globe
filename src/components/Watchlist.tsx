import { memo, useRef } from "react";
import { heatCss } from "../model/heatColor";
import { fmtDelta, fmtScore, type ScoredZone } from "../model/score";
import { fmtRatio, SURGE } from "./Coverage";
import { TrendGlyph } from "./TrendGlyph";

type Props = {
  ids: readonly string[];
  byId: ReadonlyMap<string, ScoredZone>;
  codes: ReadonlyMap<string, string>;
  selectedId: string | null;
  surges: ReadonlyMap<string, number>;
  onPick: (id: string) => void;
  onRemove: (id: string) => void;
};

/**
 * Pinned zones with their live composite. The delta is measured from the
 * value when the zone was pinned, so reweighting or switching scenario shows
 * up here as movement.
 */
export const Watchlist = memo(function Watchlist({ ids, byId, codes, selectedId, surges, onPick, onRemove }: Props) {
  const pinnedAt = useRef(new Map<string, number>());
  for (const id of ids) {
    const s = byId.get(id);
    if (s && !pinnedAt.current.has(id)) pinnedAt.current.set(id, s.composite);
  }
  for (const id of [...pinnedAt.current.keys()]) if (!ids.includes(id)) pinnedAt.current.delete(id);

  return (
    <div className="watch-strip" aria-label="Watchlist">
      <span className="watch-k mono">WATCH</span>
      {ids.length === 0 && <span className="watch-hint mono">Pin zones from the detail panel (＋ WATCH) to track them here.</span>}
      {ids.map((id) => {
        const s = byId.get(id);
        if (!s) return null;
        const d = s.composite - (pinnedAt.current.get(id) ?? s.composite);
        return (
          <div key={id} className="watch-chip" data-active={id === selectedId}>
            <button type="button" className="watch-main" onClick={() => onPick(id)} title={s.zone.name}>
              <span className="watch-code mono">{codes.get(id)}</span>
              <span className="watch-name">{s.zone.name.split(/[·(]/)[0]?.trim()}</span>
              <span className="watch-score mono" style={{ color: heatCss(Math.max(s.composite, 30)) }}>
                {fmtScore(s.composite)}
              </span>
              {Math.abs(d) >= 0.05 && <span className="watch-delta mono">{fmtDelta(d)}</span>}
              {(surges.get(id) ?? 0) >= SURGE && <span className="surge-badge mono">NEWS ▲{fmtRatio(surges.get(id) ?? 0)}</span>}
              <TrendGlyph trend={s.trend} />
            </button>
            <button type="button" className="watch-x" onClick={() => onRemove(id)} aria-label={`Unpin ${s.zone.name}`}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
});
