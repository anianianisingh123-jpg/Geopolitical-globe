/**
 * NASA FIRMS active-fire detections (VIIRS S-NPP, 375 m, last 24 h),
 * filtered to the regions of kinetic zones.
 *
 * Thermal anomalies include agricultural burning, wildfires and industrial
 * heat, not only strikes. That is why the layer is limited to active
 * conflict zones, oil/gas-flare-heavy zones are excluded, and the UI states
 * the caveat. The global 24 h text file is public (no key).
 */
import type { HeatZone } from "../src/data/schema";
import type { FirePoint, FiresPayload } from "../src/intel/types";
import { baseIntensities } from "../src/model/score";
import { circle, countryGeometries, inRegion, poly, region, type Region, type Shape } from "./regions";

export const FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv";
export const FIRMS_PRODUCT = "VIIRS S-NPP 375 m (NASA FIRMS NRT)";

/** Zones where flares dominate detections, or where the zone is open sea. */
const EXCLUDE = new Set(["hormuz", "lng-load-ports", "iran-shadow-fleet", "malacca", "suez", "panama", "turkish-straits"]);
/** Zones watched only around their named nodes (national territory is full of oil/gas flares). */
const NODES_ONLY = new Set(["iran-nuclear"]);
/**
 * Conflicts that genuinely span their whole country; everywhere else the
 * watch area is the zone footprint or a radius around the conflict, so
 * seasonal savanna and crop burning elsewhere in large countries (e.g. the
 * southern DRC in September) doesn't swamp the signal.
 */
const WHOLE_COUNTRY = new Set([
  "ukraine-front",
  "gaza-lebanon-israel",
  "lebanon-state",
  "haiti",
  "sudan",
  "myanmar",
  "yemen-residual",
  "red-sea-houthis",
  "somalia",
]);
const RADIUS_PAD = 1.4;
const MIN_KINETIC = 50;
const MAX_POINTS = 6000;

export function buildRegions(zones: readonly HeatZone[]): Region[] {
  const countries = countryGeometries();
  const regions: Region[] = [];
  for (const z of zones) {
    if (EXCLUDE.has(z.id) || z.kind === "network") continue;
    if (baseIntensities(z).kinetic < MIN_KINETIC) continue;
    const shapes: Shape[] = [];
    if (NODES_ONLY.has(z.id)) {
      for (const n of z.nodes ?? []) shapes.push(circle(n.coord, (n.radiusKm ?? 60) * 1.2));
    } else {
      if (z.polygon) shapes.push(poly(z.polygon));
      if (WHOLE_COUNTRY.has(z.id)) {
        for (const [iso, share] of Object.entries(z.countries ?? {})) {
          const g = share >= 0.5 ? countries.get(iso) : undefined;
          if (g) shapes.push(poly(g));
        }
      }
      if (shapes.length === 0) {
        if (z.radiusKm) shapes.push(circle(z.centroid, z.radiusKm * RADIUS_PAD));
        for (const n of z.nodes ?? []) shapes.push(circle(n.coord, (n.radiusKm ?? z.radiusKm ?? 80) * RADIUS_PAD));
      }
    }
    const r = region(z.id, shapes);
    if (r) regions.push(r);
  }
  return regions;
}

/** Parse the FIRMS CSV and keep nominal/high-confidence detections that fall in a watched region. */
export function filterFires(csv: string, regions: readonly Region[]): Omit<FiresPayload, "generatedAt" | "source"> {
  const lines = csv.split(/\r?\n/);
  const header = (lines[0] ?? "").split(",");
  const col = (name: string) => header.indexOf(name);
  const iLat = col("latitude");
  const iLng = col("longitude");
  const iFrp = col("frp");
  const iConf = col("confidence");
  const zones = regions.map((r) => r.zoneId);
  const counts: Record<string, { n: number; frp: number }> = {};
  const points: FirePoint[] = [];
  if (iLat < 0 || iLng < 0) return { windowHours: 24, product: FIRMS_PRODUCT, zones, points, counts };

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row) continue;
    const f = row.split(",");
    const lat = Number(f[iLat]);
    const lng = Number(f[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const conf = iConf >= 0 ? (f[iConf] ?? "") : "";
    if (conf === "l" || conf === "low") continue;
    const frp = iFrp >= 0 ? Number(f[iFrp]) || 0 : 0;
    let first = -1;
    regions.forEach((r, ri) => {
      if (!inRegion(r, lat, lng)) return;
      const c = (counts[r.zoneId] ??= { n: 0, frp: 0 });
      c.n += 1;
      c.frp += frp;
      if (first < 0) first = ri;
    });
    if (first >= 0) points.push([Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000, Math.round(frp * 10) / 10, first]);
  }
  points.sort((a, b) => b[2] - a[2]);
  for (const c of Object.values(counts)) c.frp = Math.round(c.frp);
  return { windowHours: 24, product: FIRMS_PRODUCT, zones, points: points.slice(0, MAX_POINTS), counts };
}
