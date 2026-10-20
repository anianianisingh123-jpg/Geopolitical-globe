/**
 * Groups FIRMS detections into clusters (connected ~0.1° cells, about 11 km)
 * so the globe and the detail panel can say "23 detections, 6 km NE of
 * Pokrovsk" instead of showing hundreds of anonymous dots.
 */
import type { LatLng } from "../data/schema";
import { describeNear, type PlaceIndex } from "../globe/places";
import type { FiresPayload } from "./types";

export type FireCluster = {
  id: string;
  zoneId: string;
  lat: number;
  lng: number;
  n: number;
  /** Σ fire radiative power, MW. */
  frp: number;
  maxFrp: number;
  /** "6 km NE of Pokrovsk"; null until a place index is available or nothing is within range. */
  near: string | null;
};

const CELL = 0.1;

export function clusterFires(f: FiresPayload): FireCluster[] {
  const cells = new Map<string, number[]>();
  f.points.forEach((p, i) => {
    const k = `${Math.floor(p[0] / CELL)}:${Math.floor(p[1] / CELL)}`;
    const l = cells.get(k);
    if (l) l.push(i);
    else cells.set(k, [i]);
  });

  const seen = new Set<string>();
  const out: FireCluster[] = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start];
    const members: number[] = [];
    while (stack.length) {
      const k = stack.pop() as string;
      members.push(...(cells.get(k) ?? []));
      const [i = 0, j = 0] = k.split(":").map(Number);
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const nk = `${i + di}:${j + dj}`;
          if (!seen.has(nk) && cells.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
    }
    let lat = 0;
    let lng = 0;
    let frp = 0;
    let maxFrp = 0;
    let top = members[0] ?? 0;
    const zoneVotes = new Map<number, number>();
    for (const m of members) {
      const p = f.points[m];
      if (!p) continue;
      lat += p[0];
      lng += p[1];
      frp += p[2];
      if (p[2] > maxFrp) {
        maxFrp = p[2];
        top = m;
      }
      zoneVotes.set(p[3], (zoneVotes.get(p[3]) ?? 0) + 1);
    }
    const zi = [...zoneVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const tp = f.points[top];
    out.push({
      id: tp ? `${tp[0].toFixed(2)},${tp[1].toFixed(2)}` : start,
      zoneId: f.zones[zi] ?? "",
      lat: lat / members.length,
      lng: lng / members.length,
      n: members.length,
      frp: Math.round(frp),
      maxFrp,
      near: null,
    });
  }
  return out.sort((a, b) => b.n - a.n || b.frp - a.frp);
}

export function nameClusters(clusters: readonly FireCluster[], index: PlaceIndex | null): FireCluster[] {
  if (!index) return [...clusters];
  return clusters.map((c) => {
    const at: LatLng = [c.lat, c.lng];
    // Remote clusters fall back to the nearest sizeable city.
    const near = index.nearest(at, 40) ?? index.nearest(at, 160, 50_000);
    return { ...c, near: near ? describeNear(at, near) : null };
  });
}
