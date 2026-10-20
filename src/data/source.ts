/**
 * Data-source seam. The app only ever talks to a `HeatSource`; v1 ships the
 * static seed. A live feed implements the same interface (fetch → validate →
 * HeatDataset) and is swapped in at `ACTIVE_SOURCE`.
 */
import { NEWS_TERMS } from "./newsTerms";
import { DRIVERS, type HeatDataset } from "./schema";

export interface HeatSource {
  readonly id: string;
  load(signal?: AbortSignal): Promise<HeatDataset>;
}

/** The seed is a separate chunk, fetched in parallel with first paint — same shape a network feed would have. */
export const staticSource: HeatSource = {
  id: "static-seed",
  load: async () => {
    const [{ HEATZONES, LINKS }, { SCENARIOS }] = await Promise.all([import("./heatzones"), import("./scenarios")]);
    return { asOf: "seed 2026 H1 · war cluster reviewed 2026-09-29", source: "static-seed", zones: HEATZONES, links: LINKS, scenarios: SCENARIOS };
  },
};

export const ACTIVE_SOURCE: HeatSource = staticSource;

/** Structural checks for any dataset, seed or live. Returns human-readable problems. */
export function validateDataset(ds: HeatDataset): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;

  for (const z of ds.zones) {
    const at = `zone "${z.id}"`;
    if (ids.has(z.id)) problems.push(`${at}: duplicate id`);
    ids.add(z.id);
    if (!inRange(z.score, 0, 100)) problems.push(`${at}: score out of range`);
    if (!inRange(z.centroid[0], -90, 90) || !inRange(z.centroid[1], -180, 180)) problems.push(`${at}: bad centroid`);
    if (z.summary.split(/(?<=\.)\s/).length > 4) problems.push(`${at}: summary longer than 2–3 sentences`);
    const detailDrivers = new Set(z.drivers_detail.map((d) => d.driver));
    if (detailDrivers.size !== z.drivers_detail.length) problems.push(`${at}: repeated driver in drivers_detail`);
    for (const d of z.drivers) if (!detailDrivers.has(d)) problems.push(`${at}: driver "${d}" missing from drivers_detail`);
    for (const d of z.drivers_detail) {
      if (!DRIVERS.includes(d.driver)) problems.push(`${at}: unknown driver "${d.driver}"`);
      if (!inRange(d.weight, 0, 100)) problems.push(`${at}: ${d.driver} intensity out of range`);
    }
    if (z.watch.length === 0) problems.push(`${at}: no watch items`);
    if (!z.radiusKm && !z.nodes?.length && !z.countries && !z.polygon) problems.push(`${at}: nothing to render`);
    for (const [iso, share] of Object.entries(z.countries ?? {})) {
      if (!inRange(share, 0, 1)) problems.push(`${at}: share for ${iso} out of 0–1`);
    }
  }
  for (const id of Object.keys(NEWS_TERMS)) {
    if (!ids.has(id)) problems.push(`newsTerms: unknown zone "${id}"`);
  }
  for (const id of ids) if (!NEWS_TERMS[id]) problems.push(`zone "${id}": no newsTerms entry (headlines won't tag it)`);
  for (const s of Object.values(ds.scenarios)) {
    for (const a of s.adjustments) {
      if (!ids.has(a.zoneId)) problems.push(`scenario "${s.id}": unknown zone "${a.zoneId}"`);
    }
  }
  return problems;
}
