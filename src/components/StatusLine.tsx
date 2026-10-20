import { DRIVER_META, type Driver } from "../data/schema";
import type { ViewMode } from "../model/score";

type Props = {
  total: number;
  lit: number;
  mode: ViewMode;
  layers: readonly Driver[];
  scenarioLabel: string;
  customWeights: boolean;
  asOf: string;
  feed: string;
  compact: boolean;
  callsign: string;
};

export function StatusLine({ total, lit, mode, layers, scenarioLabel, customWeights, asOf, feed, compact, callsign }: Props) {
  const layerText = mode === "composite" ? "composite" : layers.map((l) => DRIVER_META[l].short).join("+");
  return (
    <footer className="status mono" role="status" aria-live="polite">
      <span className="status-who">{callsign.toUpperCase()}</span>
      <span>
        {lit}/{total} lit
      </span>
      <span>{layerText}</span>
      {scenarioLabel.toLowerCase() !== "baseline" && <span>{scenarioLabel.toLowerCase()}</span>}
      {customWeights && <span>custom weights</span>}
      <span className="status-feed">{feed}</span>
      {!compact && <span className="status-caveat">analyst composites · not probabilities</span>}
      <span className="status-right">{asOf}</span>
    </footer>
  );
}
