import type { Iso3 } from "../data/countries";
import {
  DEFAULT_WEIGHTS,
  DRIVERS,
  type Driver,
  type HeatZone,
  type HeatZoneInput,
  type Scenario,
  type ScenarioAdjustment,
  type Trend,
  type Weights,
} from "../data/schema";

export type Intensities = Record<Driver, number>;

export const clamp = (v: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, v));

export const zeroByDriver = (): Record<Driver, number> => ({
  kinetic: 0,
  frozen: 0,
  maritime: 0,
  nuclear: 0,
  sanctions: 0,
  regime: 0,
  resource: 0,
  great_power: 0,
});

export function baseIntensities(zone: Pick<HeatZoneInput, "drivers_detail">): Intensities {
  const out = zeroByDriver();
  for (const d of zone.drivers_detail) out[d.driver] = clamp(d.weight);
  return out;
}

export function applyAdjustment(base: Intensities, adj: ScenarioAdjustment | undefined): Intensities {
  if (!adj) return base;
  const out = { ...base };
  for (const driver of DRIVERS) {
    const delta = adj.deltas[driver];
    if (delta !== undefined) out[driver] = clamp(out[driver] + delta);
  }
  return out;
}

/** score = Σ weight_d × intensity_d, capped at 100. */
export function compositeScore(i: Intensities, w: Weights): number {
  let sum = 0;
  for (const d of DRIVERS) sum += w[d] * i[d];
  return clamp(sum);
}

/**
 * Layer view: weighted mean over the active drivers only, so a soloed layer
 * reads its raw intensity on the full 0–100 ramp. If every active weight is 0
 * (e.g. frozen alone), the drivers are averaged equally.
 */
export function layerScore(i: Intensities, w: Weights, active: readonly Driver[]): number {
  if (active.length === 0) return 0;
  let num = 0;
  let den = 0;
  for (const d of active) {
    num += w[d] * i[d];
    den += w[d];
  }
  if (den > 0) return clamp(num / den);
  let sum = 0;
  for (const d of active) sum += i[d];
  return clamp(sum / active.length);
}

export type Contribution = { driver: Driver; intensity: number; weight: number; points: number };

export function contributions(i: Intensities, w: Weights): Contribution[] {
  return DRIVERS.filter((d) => i[d] > 0)
    .map((d) => ({ driver: d, intensity: i[d], weight: w[d], points: w[d] * i[d] }))
    .sort((a, b) => b.points - a.points || b.intensity - a.intensity);
}

/** Used by the data module so the stored `score` is always derived, never typed in. */
export function withBaselineScore(input: HeatZoneInput): HeatZone {
  return { ...input, score: Math.round(compositeScore(baseIntensities(input), DEFAULT_WEIGHTS)) };
}

export type ViewMode = "composite" | "layers";

export type ViewConfig = {
  weights: Weights;
  scenario: Scenario;
  mode: ViewMode;
  layers: readonly Driver[];
  risingOnly: boolean;
};

export type ScoredZone = {
  zone: HeatZone;
  /** Intensities after the scenario is applied. */
  intensities: Intensities;
  /** Composite under current weights and scenario. */
  composite: number;
  /** Composite under current weights, baseline scenario — the reference for `delta`. */
  baseline: number;
  delta: number;
  /** What the globe and list display: composite, or the layer view. 0 when filtered out. */
  view: number;
  trend: Trend;
  adjustment: ScenarioAdjustment | null;
};

export function scoreZones(zones: readonly HeatZone[], cfg: ViewConfig): ScoredZone[] {
  const adjustments = new Map(cfg.scenario.adjustments.map((a) => [a.zoneId, a]));
  return zones.map((zone) => {
    const base = baseIntensities(zone);
    const adjustment = adjustments.get(zone.id) ?? null;
    const intensities = applyAdjustment(base, adjustment ?? undefined);
    const composite = compositeScore(intensities, cfg.weights);
    const baseline = adjustment ? compositeScore(base, cfg.weights) : composite;
    const trend = adjustment?.trend ?? zone.trend;
    const raw = cfg.mode === "composite" ? composite : layerScore(intensities, cfg.weights, cfg.layers);
    const view = cfg.risingOnly && trend !== "rising" ? 0 : raw;
    return { zone, intensities, composite, baseline, delta: composite - baseline, view, trend, adjustment };
  });
}

export type CountryHeat = { heat: number; zoneId: string; zoneIds: string[] };

/** Per-country heat = max over zones of (zone view score × country share). */
export function countryHeat(scored: readonly ScoredZone[]): Map<Iso3, CountryHeat> {
  const out = new Map<Iso3, CountryHeat>();
  for (const s of scored) {
    const shares = s.zone.countries;
    if (!shares || s.view <= 0) continue;
    for (const [iso, share] of Object.entries(shares) as [Iso3, number][]) {
      const heat = s.view * share;
      const prev = out.get(iso);
      if (!prev) out.set(iso, { heat, zoneId: s.zone.id, zoneIds: [s.zone.id] });
      else {
        prev.zoneIds.push(s.zone.id);
        if (heat > prev.heat) {
          prev.heat = heat;
          prev.zoneId = s.zone.id;
        }
      }
    }
  }
  return out;
}

export const fmtScore = (v: number): string => Math.round(v).toString();

export const fmtDelta = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(1)}`;
};

export function weightsEqual(a: Weights, b: Weights): boolean {
  return DRIVERS.every((d) => Math.abs(a[d] - b[d]) < 1e-9);
}
