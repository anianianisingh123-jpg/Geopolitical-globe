import { DEFAULT_WEIGHTS, DRIVER_META, DRIVERS, type Driver, type Weights } from "../data/schema";

type Props = {
  weights: Weights;
  custom: boolean;
  onWeight: (d: Driver, v: number) => void;
  onReset: () => void;
};

export function WeightControl({ weights, custom, onWeight, onReset }: Props) {
  const sum = DRIVERS.reduce((acc, d) => acc + weights[d], 0);
  return (
    <div className="weights">
      {DRIVERS.map((d) => (
        <label key={d} className="weight-row" title={DRIVER_META[d].blurb}>
          <span className="weight-name">{DRIVER_META[d].short}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={weights[d]}
            onChange={(e) => onWeight(d, Number(e.target.value))}
            aria-label={`${DRIVER_META[d].label} weight`}
            data-changed={Math.abs(weights[d] - DEFAULT_WEIGHTS[d]) > 1e-9}
          />
          <span className="weight-val mono">{weights[d].toFixed(2)}</span>
        </label>
      ))}
      <div className="weights-foot">
        <span className="mono" data-warn={Math.abs(sum - 1) > 0.005}>
          Σ {sum.toFixed(2)}
        </span>
        <button type="button" className="link-btn" onClick={onReset} disabled={!custom}>
          reset
        </button>
      </div>
      <p className="dock-note">
        score = Σ wᵢ × intensityᵢ, capped at 100. Weights are not renormalised, so raising one driver lifts only zones that carry it.
      </p>
    </div>
  );
}
