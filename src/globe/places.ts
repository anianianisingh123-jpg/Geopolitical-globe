/**
 * Zoom-detail geodata built by scripts/build-geo.mjs:
 *   geo/cities.json      world cities (50k+, capitals, provincial seats), one fetch
 *   geo/c/<key>.json     per-country towns (1k+) and province polygons, fetched on demand
 *
 * Loaded data lives in a small store so the globe (labels, borders) and the
 * app (naming fire clusters, place cards) share one copy.
 */
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon } from "geojson";
import { feature, mesh } from "topojson-client";
import type { LatLng } from "../data/schema";
import type { CountryShape } from "./geo";
import { geometryBounds, geometryContains, haversineKm, type Bounds } from "./geoMath";

export const FLAG_CAPITAL = 1;
export const FLAG_SEAT = 2;

export type Place = {
  name: string;
  lat: number;
  lng: number;
  pop: number;
  /** Country file key (ISO numeric as world-atlas ids it, or ISO alpha-2). */
  key: string;
  flags: number;
  /** false for places from a country file (towns under 50k). */
  world: boolean;
};

export type Province = { name: string; type: string; label: LatLng; geometry: Polygon | MultiPolygon; bounds: Bounds };

export type CountryDetail = {
  key: string;
  towns: Place[];
  provinces: Province[];
  /** Internal province borders, each shared edge once. */
  borders: MultiLineString | null;
};

type WorldFile = { countries: Record<string, [towns: number, provinces: number]>; cities: [string, number, number, number, string, number][] };
type CountryFile = {
  a1: Parameters<typeof feature>[0] | null;
  towns: [string, number, number, number][];
};

const BASE = import.meta.env.BASE_URL;

/* ───────────────────────── store ───────────────────────── */

type State = { world: Place[] | null; available: ReadonlySet<string>; details: ReadonlyMap<string, CountryDetail> };
let state: State = { world: null, available: new Set(), details: new Map() };
const listeners = new Set<() => void>();
const emit = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const placesStore = {
  get: (): State => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

let worldPromise: Promise<Place[]> | null = null;

export function loadWorld(): Promise<Place[]> {
  worldPromise ??= fetch(`${BASE}geo/cities.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`cities: HTTP ${r.status}`);
      return r.json() as Promise<WorldFile>;
    })
    .then((f) => {
      const world = f.cities.map(([name, lat, lng, pop, key, flags]) => ({ name, lat, lng, pop, key, flags, world: true }));
      emit({ world, available: new Set(Object.keys(f.countries)) });
      return world;
    })
    .catch((e: unknown) => {
      worldPromise = null;
      throw e;
    });
  return worldPromise;
}

const detailPromises = new Map<string, Promise<CountryDetail | null>>();
/** Most recently requested last; bounded so a long session doesn't hold every country. */
const MAX_DETAILS = 10;

export function loadCountry(key: string): Promise<CountryDetail | null> {
  let p = detailPromises.get(key);
  if (p) {
    // Refresh recency.
    detailPromises.delete(key);
    detailPromises.set(key, p);
    return p;
  }
  p = loadWorld()
    .then(() => {
      if (!state.available.has(key)) return null;
      return fetch(`${BASE}geo/c/${key}.json`).then((r) => {
        if (!r.ok) throw new Error(`country ${key}: HTTP ${r.status}`);
        return r.json() as Promise<CountryFile>;
      });
    })
    .then((f) => {
      if (!f) return null;
      const detail = parseCountry(key, f);
      const details = new Map(state.details);
      details.set(key, detail);
      while (details.size > MAX_DETAILS) {
        const oldest = [...detailPromises.keys()].find((k) => k !== key && details.has(k));
        if (!oldest) break;
        details.delete(oldest);
        detailPromises.delete(oldest);
      }
      emit({ details });
      return detail;
    })
    .catch((e: unknown) => {
      detailPromises.delete(key);
      console.warn(`[signal-heat] detail for ${key} unavailable:`, e);
      return null;
    });
  detailPromises.set(key, p);
  return p;
}

function parseCountry(key: string, f: CountryFile): CountryDetail {
  const towns = f.towns.map(([name, lat, lng, pop]) => ({ name, lat, lng, pop, key, flags: 0, world: false }));
  if (!f.a1) return { key, towns, provinces: [], borders: null };
  const topo = f.a1;
  const obj = topo.objects["a1"];
  if (!obj) return { key, towns, provinces: [], borders: null };
  const fc = feature(topo, obj) as FeatureCollection | Feature;
  const features = fc.type === "FeatureCollection" ? fc.features : [fc];
  const provinces: Province[] = [];
  for (const ft of features) {
    const g = ft.geometry;
    if (g?.type !== "Polygon" && g?.type !== "MultiPolygon") continue;
    const p = ft.properties ?? {};
    provinces.push({
      name: String(p["n"] ?? ""),
      type: String(p["t"] ?? ""),
      label: [Number(p["la"]) || 0, Number(p["lo"]) || 0],
      geometry: g,
      bounds: geometryBounds(g),
    });
  }
  const arcsOf = obj as Parameters<typeof mesh>[1];
  return { key, towns, provinces, borders: mesh(topo, arcsOf, (a, b) => a !== b) };
}

/* ───────────────────────── lookups ───────────────────────── */

/** world-atlas ships a few features without a numeric id; map them to their file keys by name. */
const NAMED_KEYS: Record<string, string> = { Kosovo: "XK", "N. Cyprus": "196", Somaliland: "706" };

export function countryKey(shape: CountryShape): string | null {
  if (/^\d+$/.test(shape.key)) return shape.key.padStart(3, "0");
  return NAMED_KEYS[shape.name] ?? null;
}

export function provinceAt(detail: CountryDetail | undefined, [lat, lng]: LatLng): Province | null {
  if (!detail) return null;
  for (const p of detail.provinces) {
    const b = p.bounds;
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) continue;
    if (geometryContains(p.geometry, [lat, lng])) return p;
  }
  return null;
}

/** 1° grid over places, for nearest-neighbour queries. */
export class PlaceIndex {
  private cells = new Map<number, Place[]>();

  constructor(places: Iterable<Place>) {
    for (const p of places) {
      const k = PlaceIndex.cell(Math.floor(p.lat), Math.floor(p.lng));
      let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push(p);
    }
  }

  private static cell(i: number, j: number): number {
    return (i + 90) * 400 + (((j % 360) + 540) % 360);
  }

  /** Nearest place within `maxKm`, preferring larger places when the distances are close. */
  nearest([lat, lng]: LatLng, maxKm: number, minPop = 0): { place: Place; km: number } | null {
    const span = Math.ceil(maxKm / 111) + 1;
    const i0 = Math.floor(lat);
    const j0 = Math.floor(lng);
    let best: { place: Place; km: number; cost: number } | null = null;
    for (let di = -span; di <= span; di++)
      for (let dj = -span; dj <= span; dj++) {
        for (const p of this.cells.get(PlaceIndex.cell(i0 + di, j0 + dj)) ?? []) {
          if (p.pop < minPop) continue;
          const km = haversineKm([lat, lng], [p.lat, p.lng]);
          if (km > maxKm) continue;
          // A town of 50k at 9 km names a spot better than a hamlet at 7 km.
          const cost = km / (1 + 0.12 * Math.log10(Math.max(10, p.pop)));
          if (!best || cost < best.cost) best = { place: p, km, cost };
        }
      }
    return best ? { place: best.place, km: best.km } : null;
  }

  within([lat, lng]: LatLng, km: number): Place[] {
    const span = Math.ceil(km / 111) + 1;
    const out: Place[] = [];
    for (let di = -span; di <= span; di++)
      for (let dj = -span; dj <= span; dj++)
        for (const p of this.cells.get(PlaceIndex.cell(Math.floor(lat) + di, Math.floor(lng) + dj)) ?? [])
          if (haversineKm([lat, lng], [p.lat, p.lng]) <= km) out.push(p);
    return out;
  }
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** Compass direction from `from` to `to`. */
export function compass(from: LatLng, to: LatLng): string {
  const r = Math.PI / 180;
  const φ1 = from[0] * r;
  const φ2 = to[0] * r;
  const Δλ = (to[1] - from[1]) * r;
  const θ = Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ));
  const deg = ((θ / r) + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8] ?? "N";
}

/** "6 km NE of Pokrovsk", or "in Pokrovsk" when closer than 2 km. */
export function describeNear(at: LatLng, near: { place: Place; km: number }): string {
  if (near.km < 2) return `in ${near.place.name}`;
  return `${Math.round(near.km)} km ${compass([near.place.lat, near.place.lng], at)} of ${near.place.name}`;
}

export const fmtPop = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
