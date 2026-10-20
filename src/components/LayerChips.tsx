import { DRIVER_META, DRIVERS, type Driver } from "../data/schema";
import type { ViewMode } from "../model/score";

type Props = {
  mode: ViewMode;
  layers: readonly Driver[];
  onComposite: () => void;
  onToggleLayer: (d: Driver) => void;
};

/** Mobile replacement for the left rail: one horizontal row of layer toggles. */
export function LayerChips({ mode, layers, onComposite, onToggleLayer }: Props) {
  return (
    <nav className="chips" aria-label="Layers">
      <button type="button" className="chip" aria-pressed={mode === "composite"} onClick={onComposite}>
        Composite
      </button>
      {DRIVERS.map((d) => (
        <button
          key={d}
          type="button"
          className="chip"
          aria-pressed={mode === "layers" && layers.includes(d)}
          onClick={() => onToggleLayer(d)}
        >
          {DRIVER_META[d].label}
        </button>
      ))}
    </nav>
  );
}
