import { m } from "framer-motion";
import { useEffect, useRef } from "react";
import type { Scenario } from "../data/schema";
import { fmtDelta, fmtScore, type ScoredZone } from "../model/score";

type Props = { scenario: Scenario; adjusted: readonly ScoredZone[]; onPick: (id: string) => void };

/** Escalation is never silent: the assumption and every delta stay on screen while it is active. */
export function ScenarioBanner({ scenario, adjusted, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Publish the banner's height so the rail and panel sit below it at any wrap width.
  useEffect(() => {
    const el = ref.current;
    const app = el?.closest<HTMLElement>(".app");
    if (!el || !app) return;
    const ro = new ResizeObserver(() => app.style.setProperty("--banner-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      app.style.setProperty("--banner-h", "0px");
    };
  }, []);

  return (
    <m.div
      ref={ref}
      className="banner"
      role="note"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.16 }}
    >
      <span className="banner-k mono">{scenario.label.toUpperCase()}</span>
      <span className="banner-text">{scenario.assumption}</span>
      <span className="banner-deltas">
        {adjusted.map((s) => (
          <button key={s.zone.id} type="button" className="delta-chip mono" onClick={() => onPick(s.zone.id)} title={s.adjustment?.assumption}>
            {s.zone.name} {fmtScore(s.baseline)}→{fmtScore(s.composite)} <b>{fmtDelta(s.delta)}</b>
          </button>
        ))}
      </span>
    </m.div>
  );
}
