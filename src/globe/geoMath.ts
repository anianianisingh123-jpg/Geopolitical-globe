/** Pure geometry helpers, safe to import from both the browser and the Node intel service. */
import type { MultiPolygon, Polygon, Position } from "geojson";

export type LatLngPair = [lat: number, lng: number];

function ringContains(ring: Position[], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [xi = 0, yi = 0] = a;
    const [xj = 0, yj = 0] = b;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonContains(rings: Position[][], lng: number, lat: number): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !ringContains(outer, lng, lat)) return false;
  return !holes.some((h) => ringContains(h, lng, lat));
}

export function geometryContains(g: Polygon | MultiPolygon, [lat, lng]: LatLngPair): boolean {
  return g.type === "Polygon"
    ? polygonContains(g.coordinates, lng, lat)
    : g.coordinates.some((p) => polygonContains(p, lng, lat));
}

export type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

export function geometryBounds(g: Polygon | MultiPolygon): Bounds {
  const b = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const p of polys)
    for (const [lng = 0, lat = 0] of p[0] ?? []) {
      if (lat < b.minLat) b.minLat = lat;
      if (lat > b.maxLat) b.maxLat = lat;
      if (lng < b.minLng) b.minLng = lng;
      if (lng > b.maxLng) b.maxLng = lng;
    }
  return b;
}

const EARTH_KM = 6371;

export function haversineKm([lat1, lng1]: LatLngPair, [lat2, lng2]: LatLngPair): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
