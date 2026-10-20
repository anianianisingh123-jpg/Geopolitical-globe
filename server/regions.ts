/**
 * Watch regions: the areas on the ground that belong to a zone, used to
 * filter point data (FIRMS detections, GDELT events) to the zones.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { MultiPolygon, Polygon } from "geojson";
import { feature } from "topojson-client";
import { iso3ForAtlasFeature } from "../src/data/countries";
import { geometryBounds, geometryContains, haversineKm, type Bounds, type LatLngPair } from "../src/globe/geoMath";

export type Shape =
  | { kind: "poly"; geometry: Polygon | MultiPolygon; bounds: Bounds }
  | { kind: "circle"; center: LatLngPair; km: number; bounds: Bounds };

export type Region = { zoneId: string; shapes: Shape[]; bounds: Bounds };

export function circle(center: LatLngPair, km: number): Shape {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos((center[0] * Math.PI) / 180)));
  return {
    kind: "circle",
    center,
    km,
    bounds: { minLat: center[0] - dLat, maxLat: center[0] + dLat, minLng: center[1] - dLng, maxLng: center[1] + dLng },
  };
}

export function poly(geometry: Polygon | MultiPolygon): Shape {
  return { kind: "poly", geometry, bounds: geometryBounds(geometry) };
}

export function region(zoneId: string, shapes: Shape[]): Region | null {
  if (!shapes.length) return null;
  const bounds = shapes.reduce(
    (a, { bounds: b }) => ({
      minLat: Math.min(a.minLat, b.minLat),
      maxLat: Math.max(a.maxLat, b.maxLat),
      minLng: Math.min(a.minLng, b.minLng),
      maxLng: Math.max(a.maxLng, b.maxLng),
    }),
    { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 },
  );
  return { zoneId, shapes, bounds };
}

const inBounds = (b: Bounds, lat: number, lng: number) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;

function contains(s: Shape, lat: number, lng: number): boolean {
  if (!inBounds(s.bounds, lat, lng)) return false;
  return s.kind === "poly" ? geometryContains(s.geometry, [lat, lng]) : haversineKm(s.center, [lat, lng]) <= s.km;
}

export function inRegion(r: Region, lat: number, lng: number): boolean {
  return inBounds(r.bounds, lat, lng) && r.shapes.some((s) => contains(s, lat, lng));
}

let countries: Map<string, Polygon | MultiPolygon> | null = null;

/** Natural Earth 1:110m country outlines by ISO3 (coarse, but only used as watch areas). */
export function countryGeometries(): Map<string, Polygon | MultiPolygon> {
  if (countries) return countries;
  const require = createRequire(import.meta.url);
  const topo = JSON.parse(readFileSync(require.resolve("world-atlas/countries-110m.json"), "utf8")) as Parameters<typeof feature>[0];
  const obj = topo.objects["countries"];
  const out = new Map<string, Polygon | MultiPolygon>();
  if (obj) {
    const fc = feature(topo, obj);
    for (const f of "features" in fc ? fc.features : [fc]) {
      const g = f.geometry;
      if (g?.type !== "Polygon" && g?.type !== "MultiPolygon") continue;
      const name = typeof f.properties?.["name"] === "string" ? (f.properties["name"] as string) : "";
      const iso = iso3ForAtlasFeature(f.id === undefined ? undefined : String(f.id), name);
      if (iso) out.set(iso, g);
    }
  }
  countries = out;
  return out;
}
