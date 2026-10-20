/**
 * Checks src/data/sites.ts coordinates against GeoNames: for each site whose
 * name (or alias) matches a populated place within 150 km, prints how far the
 * site sits from it. Run after `npm run geo` (which caches the GeoNames dump).
 *
 *   node scripts/check-sites.mjs
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { SITE_ROWS } from "../src/data/sites.ts";

const buf = readFileSync(join(tmpdir(), "signal-heat-geo-src", "cities1000.zip"));
let eocd = buf.length - 22;
while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
const cd = buf.readUInt32LE(eocd + 16);
const local = buf.readUInt32LE(cd + 42);
const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
const text = inflateRawSync(buf.subarray(start, start + buf.readUInt32LE(cd + 20))).toString("utf8");

const fold = (s) => s.normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, "").toLowerCase().trim();
const places = new Map();
for (const line of text.split("\n")) {
  const f = line.split("\t");
  if (f.length < 15) continue;
  const names = new Set([f[1], f[2], ...(f[3] ? f[3].split(",") : [])].map(fold));
  const p = { name: f[1], lat: Number(f[4]), lng: Number(f[5]), pop: Number(f[14]) };
  for (const n of names) {
    if (!n) continue;
    let l = places.get(n);
    if (!l) places.set(n, (l = []));
    l.push(p);
  }
}

const km = (a1, b1, a2, b2) => {
  const r = Math.PI / 180;
  const x = (b2 - b1) * r * Math.cos(((a1 + a2) / 2) * r);
  return Math.hypot(x, (a2 - a1) * r) * 6371;
};

let flagged = 0;
for (const [zone, rows] of Object.entries(SITE_ROWS)) {
  for (const [name, lat, lng, kind, , aka] of rows) {
    const keys = [name, ...(aka ?? [])].map(fold);
    let best = null;
    for (const k of keys)
      for (const p of places.get(k) ?? []) {
        const d = km(lat, lng, p.lat, p.lng);
        if (d < 150 && (!best || d < best.d)) best = { ...p, d };
      }
    const tag = !best ? "no match" : best.d > 8 ? `${best.d.toFixed(1)} km off → ${best.lat.toFixed(3)}, ${best.lng.toFixed(3)} (${best.name})` : null;
    if (tag && kind !== "sea" && kind !== "base" && kind !== "energy" && kind !== "nuclear") {
      flagged++;
      console.log(`${zone.padEnd(20)} ${name.padEnd(28)} ${tag}`);
    }
  }
}
console.log(`${flagged} flagged`);
