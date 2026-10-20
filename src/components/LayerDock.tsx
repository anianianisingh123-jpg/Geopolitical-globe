import { m } from "framer-motion";
import { memo, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_WEIGHTS, DRIVER_META, DRIVERS, type Driver, type HeatZone, type Weights } from "../data/schema";
import { HEAT_GRADIENT } from "../model/heatColor";
import { baseIntensities, weightsEqual, zeroByDriver, type ViewMode } from "../model/score";
import { WeightControl } from "./WeightControl";

type Props = {
  open: boolean;
  mode: ViewMode;
  layers: readonly Driver[];
  weights: Weights;
  zones: readonly HeatZone[];
  showLinks: boolean;
  showRoutes: boolean;
  autoRotate: boolean;
  sweep: boolean;
  lowPower: boolean;
  showFires: boolean;
  showPlaces: boolean;
  showEvents: boolean;
  firesAvailable: boolean;
  minimap: ReactNode;
  onToggleOpen: () => void;
  onComposite: () => void;
  onToggleLayer: (d: Driver) => void;
  onSoloLayer: (d: Driver) => void;
  onWeight: (d: Driver, v: number) => void;
  onResetWeights: () => void;
  onToggleLinks: () => void;
  onToggleRoutes: () => void;
  onToggleAutoRotate: () => void;
  onToggleSweep: () => void;
  onToggleFires: () => void;
  onTogglePlaces: () => void;
  onToggleEvents: () => void;
  onLowPower: (v: boolean) => void;
};

export const LayerDock = memo(function LayerDock(p: Props) {
  const [weightsOpen, setWeightsOpen] = useState(true);
  const counts = useMemo(() => {
    const out = zeroByDriver();
    for (const z of p.zones) {
      const i = baseIntensities(z);
      for (const d of DRIVERS) if (i[d] > 0) out[d] += 1;
    }
    return out;
  }, [p.zones]);
  const custom = !weightsEqual(p.weights, DEFAULT_WEIGHTS);

  return (
    <m.aside
      className="dock"
      data-open={p.open}
      initial={false}
      animate={{ width: p.open ? 240 : 44 }}
      transition={{ type: "tween", duration: 0.2, ease: [0.2, 0, 0, 1] }}
      aria-label="Layers and weights"
    >
      <button
        type="button"
        className="dock-toggle"
        onClick={p.onToggleOpen}
        aria-expanded={p.open}
        aria-label={p.open ? "Collapse layer rail" : "Expand layer rail"}
        title={p.open ? "Collapse" : "Expand"}
      >
        {p.open ? "‹" : "›"}
      </button>

      <section className="dock-section">
        {p.open && <h2 className="dock-h">Layers</h2>}
        <ul className="layer-list">
          <li>
            <button
              type="button"
              className="layer-row"
              aria-pressed={p.mode === "composite"}
              onClick={p.onComposite}
              title="Composite (0)"
            >
              <kbd>0</kbd>
              {p.open && <span className="layer-name">Composite</span>}
              {p.open && <span className="layer-count mono">Σw·i</span>}
            </button>
          </li>
          {DRIVERS.map((d, i) => {
            const on = p.mode === "layers" && p.layers.includes(d);
            const inComposite = p.mode === "composite" && p.weights[d] > 0;
            return (
              <li key={d}>
                <button
                  type="button"
                  className="layer-row"
                  aria-pressed={on}
                  data-included={inComposite}
                  onClick={(e) => (e.shiftKey || e.altKey ? p.onSoloLayer(d) : p.onToggleLayer(d))}
                  title={`${DRIVER_META[d].label} (${i + 1}) — ${DRIVER_META[d].blurb} Shift-click to solo.`}
                >
                  <kbd>{i + 1}</kbd>
                  {p.open && <span className="layer-name">{DRIVER_META[d].label}</span>}
                  {p.open && <span className="layer-count mono">{counts[d]}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {p.open && (
          <p className="dock-note">
            {p.mode === "composite"
              ? "Click a driver to solo it; click more to combine."
              : "Layer view: weighted mean of active drivers, full 0–100 ramp."}
          </p>
        )}
      </section>

      {p.open && (
        <>
          <section className="dock-section">
            <h2 className="dock-h">
              <button type="button" className="dock-h-btn" onClick={() => setWeightsOpen((o) => !o)} aria-expanded={weightsOpen}>
                Weights {custom && <span className="tag">custom</span>}
                <span className="dock-caret">{weightsOpen ? "−" : "+"}</span>
              </button>
            </h2>
            {weightsOpen && <WeightControl weights={p.weights} onWeight={p.onWeight} onReset={p.onResetWeights} custom={custom} />}
          </section>

          <section className="dock-section">
            <h2 className="dock-h">Overlays</h2>
            <label className="switch">
              <input type="checkbox" checked={p.showLinks} onChange={p.onToggleLinks} />
              <span>Proxy &amp; supply links</span>
            </label>
            <label className="switch">
              <input type="checkbox" checked={p.showRoutes} onChange={p.onToggleRoutes} />
              <span>Routes &amp; lanes</span>
            </label>
            <label className="switch">
              <input type="checkbox" checked={p.autoRotate} onChange={p.onToggleAutoRotate} />
              <span>Auto-rotate</span>
            </label>
            <label className="switch" title={p.firesAvailable ? "NASA FIRMS VIIRS, last 24 h, kinetic zones only" : "Needs the local intel service (npm run dev / preview)"}>
              <input type="checkbox" checked={p.showFires && p.firesAvailable} onChange={p.onToggleFires} disabled={!p.firesAvailable} />
              <span>Thermal detections (FIRMS)</span>
            </label>
            <label className="switch" title="Cities, then provinces and towns as you zoom in; named sites inside each zone">
              <input type="checkbox" checked={p.showPlaces} onChange={p.onTogglePlaces} />
              <span>Places &amp; sites</span>
            </label>
            <label
              className="switch"
              title={p.firesAvailable ? "Violent events GDELT geolocated from news in the last 24 h, inside zones" : "Needs the local intel service (npm run dev / preview)"}
            >
              <input type="checkbox" checked={p.showEvents && p.firesAvailable} onChange={p.onToggleEvents} disabled={!p.firesAvailable} />
              <span>Reported events (GDELT)</span>
            </label>
            <label className="switch">
              <input type="checkbox" checked={p.sweep} onChange={p.onToggleSweep} disabled={p.lowPower} />
              <span>Radar sweep</span>
            </label>
            <label className="switch">
              <input type="checkbox" checked={p.lowPower} onChange={(e) => p.onLowPower(e.target.checked)} />
              <span>Low-power render</span>
            </label>
          </section>

          <section className="dock-section">
            <h2 className="dock-h">Overview</h2>
            {p.minimap}
          </section>

          <section className="dock-section legend">
            <div className="legend-bar" style={{ background: HEAT_GRADIENT }} aria-hidden />
            <div className="legend-scale mono">
              <span>0</span>
              <span>50</span>
              <span>100</span>
            </div>
            <p className="dock-note">Colour and extrusion ∝ score. Blooms pulse only when rising and above 70.</p>
          </section>
        </>
      )}
    </m.aside>
  );
});
