import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon } from "geojson";
import { geometryContains } from "./geoMath";
import { feature, mesh } from "topojson-client";
import atlas50Url from "world-atlas/countries-50m.json?url";
import atlas110Url from "world-atlas/countries-110m.json?url";
import { iso3ForAtlasFeature, type Iso3 } from "../data/countries";
import type { LatLng } from "../data/schema";

export type CountryShape = {
  key: string;
  name: string;
  iso3: Iso3 | null;
  geometry: Polygon | MultiPolygon;
};

export type Resolution = "50m" | "110m";

export type Atlas = {
  countries: CountryShape[];
  /** Internal borders (each shared edge once). */
  borders: MultiLineString;
  /** Coastlines (edges that belong to exactly one country). */
  coasts: MultiLineString;
};

type Topology = Parameters<typeof feature>[0];

function isTopology(v: unknown): v is Topology {
  return typeof v === "object" && v !== null && (v as { type?: unknown }).type === "Topology";
}

function isAreal(f: Feature): f is Feature<Polygon | MultiPolygon> {
  return f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon";
}

const cache = new Map<Resolution, Promise<Atlas>>();

/**
 * Natural Earth countries (50m on desktop for crisp borders, 110m on small
 * screens), served as a static asset and parsed once per resolution.
 */
export function loadAtlas(res: Resolution): Promise<Atlas> {
  let p = cache.get(res);
  if (!p) {
    p = fetch(res === "50m" ? atlas50Url : atlas110Url)
      .then((r) => {
        if (!r.ok) throw new Error(`country atlas ${res}: HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then((topo) => {
        if (!isTopology(topo)) throw new Error("country atlas: not a TopoJSON topology");
        const obj = topo.objects["countries"];
        if (!obj) throw new Error("country atlas: missing 'countries' collection");
        const fc = feature(topo, obj) as FeatureCollection | Feature;
        const features = fc.type === "FeatureCollection" ? fc.features : [fc];
        const countries = features.filter(isAreal).map((f, i) => {
          const name = typeof f.properties?.["name"] === "string" ? (f.properties["name"] as string) : "Unknown";
          const id = f.id === undefined ? undefined : String(f.id);
          return { key: id ?? `n:${name}:${i}`, name, iso3: iso3ForAtlasFeature(id, name), geometry: f.geometry };
        });
        // @types/topojson-client types mesh()'s object with {} properties; the data is the same collection.
        const arcsOf = obj as Parameters<typeof mesh>[1];
        return {
          countries,
          borders: mesh(topo, arcsOf, (a, b) => a !== b),
          coasts: mesh(topo, arcsOf, (a, b) => a === b),
        };
      });
    cache.set(res, p);
  }
  return p;
}

export { geometryContains } from "./geoMath";

type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };
const boundsCache = new WeakMap<CountryShape, Bounds>();

function boundsOf(c: CountryShape): Bounds {
  let b = boundsCache.get(c);
  if (b) return b;
  b = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
  const polys = c.geometry.type === "Polygon" ? [c.geometry.coordinates] : c.geometry.coordinates;
  for (const p of polys)
    for (const [lng = 0, lat = 0] of p[0] ?? []) {
      if (lat < b.minLat) b.minLat = lat;
      if (lat > b.maxLat) b.maxLat = lat;
      if (lng < b.minLng) b.minLng = lng;
      if (lng > b.maxLng) b.maxLng = lng;
    }
  boundsCache.set(c, b);
  return b;
}

/** Country under a point, with a bounding-box prefilter (fast enough for per-frame cursor readout). */
export function countryAt(countries: readonly CountryShape[], coord: LatLng): CountryShape | null {
  const [lat, lng] = coord;
  for (const c of countries) {
    const b = boundsOf(c);
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) continue;
    if (geometryContains(c.geometry, coord)) return c;
  }
  return null;
}

const EARTH_KM = 6371;

/** Great-circle ring of `km` around a centre, as lat-first points (closed). */
export function circlePath([lat, lng]: LatLng, km: number, steps = 96): LatLng[] {
  const d = km / EARTH_KM;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const out: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (i / steps) * 2 * Math.PI;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    out.push([(φ2 * 180) / Math.PI, ((((λ2 * 180) / Math.PI + 540) % 360) - 180)]);
  }
  return out;
}

/** Globe radius in three-globe scene units. */
export const GLOBE_RADIUS = 100;
export const kmToUnits = (km: number): number => (km / EARTH_KM) * GLOBE_RADIUS;

/** three-globe's lat/lng → scene coordinates (matches its polar2Cartesian). */
export function toXYZ(lat: number, lng: number, r: number): [number, number, number] {
  const φ = ((90 - lat) * Math.PI) / 180;
  const θ = ((90 - lng) * Math.PI) / 180;
  return [r * Math.sin(φ) * Math.cos(θ), r * Math.cos(φ), r * Math.sin(φ) * Math.sin(θ)];
}

export { fmtLat, fmtLng } from "./format";
