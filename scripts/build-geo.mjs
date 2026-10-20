/**
 * Builds the zoom-detail geodata under public/geo from two open datasets:
 *
 *   GeoNames cities1000 (CC BY 4.0) — every populated place of 1,000+ people
 *   Natural Earth 10m admin-1 states/provinces (public domain)
 *
 * Output
 *   public/geo/cities.json    world cities (50k+, capitals, provincial seats), loaded once
 *   public/geo/c/<key>.json   one per country: province polygons (TopoJSON) + towns,
 *                             fetched only when the camera closes in on that country
 *
 * <key> is the ISO 3166-1 numeric code that world-atlas uses as feature id
 * ("804" = Ukraine), or the ISO alpha-2 code where no numeric exists ("XK").
 *
 * Run: npm run geo   (downloads ~50 MB once into the OS temp dir)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { feature } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, quantile, simplify } from "topojson-simplify";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "geo");
const CACHE = join(tmpdir(), "signal-heat-geo-src");

const SOURCES = {
  cities: ["cities1000.zip", "https://download.geonames.org/export/dump/cities1000.zip"],
  countryInfo: ["countryInfo.txt", "https://download.geonames.org/export/dump/countryInfo.txt"],
  admin1: [
    "ne_10m_admin_1_states_provinces.geojson",
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
  ],
};

/** World file: cities at or above this size, plus every capital and provincial seat. */
const WORLD_MIN_POP = 50_000;
/** Share of province-border vertices kept after simplification. */
const KEEP = 0.14;
/** Natural Earth admin-0 codes without a usable ISO alpha-2. */
const ADM0_FALLBACK = { CYN: "196", SOL: "706", KOS: "XK", SAH: "732", PSX: "275" };
/** Populated-place feature codes kept (drops sections, historical and abandoned places). */
const PLACE_CODES = new Set(["PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5", "PPLC", "PPLG", "PPLL", "PPLS", "PPLF", "PPLR"]);

const FLAG_CAPITAL = 1;
const FLAG_SEAT = 2;

async function source([name, url]) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, name);
  if (!existsSync(path)) {
    console.log(`download ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(path);
}

/** First entry of a zip archive (GeoNames ships one file per archive). */
function unzipFirst(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip archive");
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  return method === 0 ? data : inflateRawSync(data);
}

const r3 = (x) => Math.round(x * 1000) / 1000;

async function main() {
  // ── countries: ISO2 → file key, ISO3 → file key ──
  const byIso2 = new Map();
  const byIso3 = new Map();
  for (const line of (await source(SOURCES.countryInfo)).toString("utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [iso2, iso3, num] = line.split("\t");
    const n = Number(num);
    const key = n > 0 ? String(n).padStart(3, "0") : iso2;
    byIso2.set(iso2, key);
    byIso3.set(iso3, key);
  }

  // ── places ──
  const world = [];
  const towns = new Map();
  const text = unzipFirst(await source(SOURCES.cities)).toString("utf8");
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f.length < 15) continue;
    const [, name, , , lat, lng, , code, cc] = f;
    if (!PLACE_CODES.has(code)) continue;
    const key = byIso2.get(cc);
    if (!key || !name) continue;
    const pop = Number(f[14]) || 0;
    const flags = (code === "PPLC" ? FLAG_CAPITAL : 0) | (code === "PPLA" ? FLAG_SEAT : 0);
    const la = r3(Number(lat));
    const lo = r3(Number(lng));
    if (pop >= WORLD_MIN_POP || flags) world.push([name, la, lo, pop, key, flags]);
    else {
      let list = towns.get(key);
      if (!list) towns.set(key, (list = []));
      list.push([name, la, lo, pop]);
    }
  }
  world.sort((a, b) => b[3] - a[3]);

  // ── provinces ──
  console.log("parse admin-1 …");
  const ne = JSON.parse((await source(SOURCES.admin1)).toString("utf8"));
  const keyOf = (p) => {
    const a2 = typeof p.iso_a2 === "string" && /^[A-Z]{2}$/.test(p.iso_a2) ? byIso2.get(p.iso_a2) : undefined;
    return a2 ?? byIso3.get(p.adm0_a3) ?? ADM0_FALLBACK[p.adm0_a3] ?? null;
  };
  const features = [];
  for (const f of ne.features) {
    const p = f.properties ?? {};
    const k = keyOf(p);
    if (!k || !f.geometry) continue;
    const name = p.name_en || p.name || p.gn_name;
    if (!name) continue;
    features.push({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        k,
        n: name,
        t: p.type_en || p.type || "",
        la: r3(Number(p.latitude) || 0),
        lo: r3(Number(p.longitude) || 0),
      },
    });
  }
  console.log(`simplify ${features.length} provinces …`);
  let topo = topology({ a1: { type: "FeatureCollection", features } }, 1e6);
  topo = presimplify(topo);
  topo = simplify(topo, quantile(topo, 1 - KEEP));

  const provinces = new Map();
  for (const g of topo.objects.a1.geometries) {
    const f = feature(topo, g);
    if (!f.geometry) continue;
    const k = f.properties.k;
    delete f.properties.k;
    let list = provinces.get(k);
    if (!list) provinces.set(k, (list = []));
    list.push(f);
  }

  // ── write ──
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "c"), { recursive: true });
  const keys = new Set([...towns.keys(), ...provinces.keys()]);
  const index = {};
  let bytes = 0;
  for (const k of [...keys].sort()) {
    const fs = provinces.get(k) ?? [];
    const t = (towns.get(k) ?? []).sort((a, b) => b[3] - a[3]);
    const body = JSON.stringify({
      a1: fs.length ? topology({ a1: { type: "FeatureCollection", features: fs } }, 5e4) : null,
      towns: t,
    });
    writeFileSync(join(OUT, "c", `${k}.json`), body);
    bytes += body.length;
    index[k] = [t.length, fs.length];
  }
  const worldBody = JSON.stringify({ countries: index, cities: world });
  writeFileSync(join(OUT, "cities.json"), worldBody);
  console.log(
    `cities.json: ${world.length} places, ${(worldBody.length / 1024).toFixed(0)} KB · ` +
      `${keys.size} country files, ${(bytes / 1048576).toFixed(1)} MB total`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
