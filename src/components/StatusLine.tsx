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
};

export function StatusLine({ total, lit, mode, layers, scenarioLabel, customWeights, asOf, feed, compact }: Props) {
  const layerText = mode === "composite" ? "composite" : layers.map((l) => DRIVER_META[l].label.toLowerCase()).join(" + ");
  return (
    <footer className="status mono" role="status" aria-live="polite">
      <span>
        {total} zones · {lit} lit
      </span>
      <span>layers: {layerText}</span>
      <span>scenario: {scenarioLabel.toLowerCase()}</span>
      <span>weights: {customWeights ? "custom" : "default"}</span>
      <span>feed: {feed}</span>
      <span className="status-caveat">scores are analyst composites, not probabilities</span>
      {!compact && (
        <span className="status-right">
          {asOf} · drag rotate · scroll zoom · dbl-click reset · / search · 0–8 layers · esc close
        </span>
      )}
    </footer>
  );
}
