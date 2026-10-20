/**
 * GDELT 2.0 event stream: every 15 minutes GDELT publishes the events it
 * machine-coded from world news, each with a geolocated place. These are
 * static files (not the rate-limited search API).
 *
 * Kept: violent events (CAMEO roots 18 assault, 19 fight, 20 mass violence)
 * from the lead of an article, located to a city, inside a zone, and involving
 * an armed actor (military, rebels, insurgents, militias) or an unambiguous
 * act of war (air or artillery strike, bombing, mass violence). Most of the
 * raw stream is crime reporting and mis-coded sport; these filters remove the
 * bulk of it. What remains is still machine-coded and should be read as
 * "reported here", not as verified.
 */
import { inflateRawSync } from "node:zlib";
import type { HeatZone } from "../src/data/schema";
import type { EventKind, EventPlace } from "../src/intel/types";
import { baseIntensities } from "../src/model/score";
import { circle, countryGeometries, inRegion, poly, region, type Region, type Shape } from "./regions";

export const EVENTS_BASE = "https://data.gdeltproject.org/gdeltv2/";
export const EVENTS_PRODUCT = "GDELT 2.0 event stream";
export const EVENTS_WINDOW_MS = 24 * 3_600_000;

/** [time ms, lat, lng, kind, place name, source URL, zone id] */
export type EventRow = [number, number, number, EventKind, string, string, string];

// Column indices in the 61-column export.
const C = {
  actor1Group: 8,
  actor1Types: [12, 13, 14],
  actor2Group: 18,
  actor2Types: [22, 23, 24],
  isRoot: 25,
  code: 26,
  root: 28,
  geoType: 51,
  geoName: 52,
  lat: 56,
  lng: 57,
  url: 60,
} as const;

const ARMED = new Set(["MIL", "REB", "INS", "UAF", "SEP"]);
/** Codes that are acts of war whoever the actors are. */
const WAR_CODE = /^(183|185|186|194|195|196|20)/;
/** City-level precision (3 = US city, 4 = world city). */
const CITY_LEVEL = new Set(["3", "4"]);

function kindOf(code: string): EventKind {
  if (code.startsWith("195")) return "airstrike";
  if (code === "194") return "shelling";
  if (code.startsWith("183")) return "bombing";
  if (code === "185" || code === "186") return "assassination";
  if (code.startsWith("181")) return "abduction";
  if (code === "196") return "ceasefire-breach";
  if (code.startsWith("20")) return "mass-violence";
  if (code.startsWith("19")) return "clash";
  return "assault";
}

/**
 * CAMEO codes most war reporting as a generic "fight"; the article slug is
 * usually more specific ("russian-drone-strike-hits-kharkiv").
 */
function refineKind(kind: EventKind, url: string): EventKind {
  if (kind !== "clash" && kind !== "assault") return kind;
  const slug = url.toLowerCase();
  if (/air-?strike|drone|missile|air-?raid|warplane/.test(slug)) return "airstrike";
  if (/shell(ing|ed|s)|artillery|mortar|rocket/.test(slug)) return "shelling";
  if (/bomb(ing|ed|er)?\b|explosion|blast|ied\b/.test(slug)) return "bombing";
  return kind;
}

const VIOLENCE =
  /\b(kill|killed|kills|killing|dead|death|deaths|dies|died|strike|strikes|struck|attack|attacks|attacked|shell\w*|bomb\w*|drone\w*|missile\w*|rocket\w*|clash\w*|fight\w*|battle\w*|troops?|army|armed|military|soldiers?|militants?|militia\w*|rebels?|insurg\w*|raids?|airstrikes?|wounded|injur\w*|gunmen|gunfire|shoot\w*|shot|explos\w*|blasts?|war|offensive|front|frontline|ceasefire|truce|hostages?|massacre|violence|terror\w*|jihad\w*|siege|besieged|invasion|assault\w*|ambush\w*|casualt\w*|idf|hamas|hezbollah|houthis?|rsf|jnim|shabaab|m23|isis|isil|captured?|seized?|advance[sd]?|retreat\w*|evacuat\w*|abduct\w*|kidnap\w*|looted|burn\w*|destroy\w*)\b/;

/**
 * News about a place is not an event there ("student group slams film about
 * Gaza"). When the URL slug is readable, keep the article only if it uses the
 * vocabulary of violence; ID-only URLs can't be judged and are kept.
 */
function offTopic(url: string): boolean {
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    /* keep the raw string */
  }
  const words = path.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));
  return words.length >= 4 && !VIOLENCE.test(words.join(" "));
}

export const warZoneIds = (zones: readonly HeatZone[]): Set<string> =>
  new Set(zones.filter((z) => baseIntensities(z).kinetic >= 50).map((z) => z.id));

/** Watch areas for every zone that sits on the ground, highest-scoring first (an event takes the first zone it falls in). */
export function buildEventRegions(zones: readonly HeatZone[]): Region[] {
  const countries = countryGeometries();
  const out: Region[] = [];
  for (const z of [...zones].sort((a, b) => b.score - a.score)) {
    if (z.kind === "network") continue;
    const shapes: Shape[] = [];
    if (z.polygon) shapes.push(poly(z.polygon));
    for (const [iso, share] of Object.entries(z.countries ?? {})) {
      const g = share >= 0.5 ? countries.get(iso) : undefined;
      if (g) shapes.push(poly(g));
    }
    if (z.radiusKm) shapes.push(circle(z.centroid, z.radiusKm * 1.3));
    for (const n of z.nodes ?? []) shapes.push(circle(n.coord, (n.radiusKm ?? z.radiusKm ?? 80) * 1.3));
    const r = region(z.id, shapes);
    if (r) out.push(r);
  }
  return out;
}

/** "20260930043000" → epoch ms. */
export function stampTime(stamp: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return 0;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  return Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0);
}

export function stampOf(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/** First entry of a zip archive (GDELT ships one CSV per archive). */
export function unzipFirst(buf: Buffer): Buffer {
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

/**
 * `warZones`: zones with an active war (kinetic ≥ 50). There, fighting and
 * mass violence (roots 19, 20) count even between state actors with no armed
 * type code ("Russia vs Ukraine"); elsewhere an armed actor or act of war is required.
 */
export function parseExport(text: string, at: number, regions: readonly Region[], warZones: ReadonlySet<string>): EventRow[] {
  const out: EventRow[] = [];
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f.length < 61) continue;
    const root = f[C.root];
    if (root !== "18" && root !== "19" && root !== "20") continue;
    if (f[C.isRoot] !== "1" || !CITY_LEVEL.has(f[C.geoType] ?? "")) continue;
    const code = f[C.code] ?? "";
    const lat = Number(f[C.lat]);
    const lng = Number(f[C.lng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const zone = regions.find((r) => inRegion(r, lat, lng));
    if (!zone) continue;
    const armed =
      [...C.actor1Types, ...C.actor2Types].some((i) => ARMED.has(f[i] ?? "")) ||
      !!f[C.actor1Group] ||
      !!f[C.actor2Group] ||
      WAR_CODE.test(code) ||
      (root !== "18" && warZones.has(zone.zoneId));
    if (!armed) continue;
    const url = (f[C.url] ?? "").trim();
    if (!url.startsWith("http") || offTopic(url)) continue;
    out.push([at, lat, lng, refineKind(kindOf(code), url), f[C.geoName] ?? "", url, zone.zoneId]);
  }
  return out;
}

/** Group rows by place (GDELT gives each place one coordinate), strongest first. */
export function aggregate(rows: readonly EventRow[]): EventPlace[] {
  const byPlace = new Map<string, { p: EventPlace; urls: Map<string, number> }>();
  for (const [at, lat, lng, kind, name, url, zoneId] of rows) {
    const id = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    let e = byPlace.get(id);
    if (!e) {
      e = { p: { id, lat, lng, name, zoneId, n: 0, sources: 0, kind, kinds: {}, first: at, last: at, urls: [] }, urls: new Map() };
      byPlace.set(id, e);
    }
    const p = e.p;
    p.n += 1;
    p.kinds[kind] = (p.kinds[kind] ?? 0) + 1;
    p.first = Math.min(p.first, at);
    p.last = Math.max(p.last, at);
    e.urls.set(url, Math.max(e.urls.get(url) ?? 0, at));
  }
  const out: EventPlace[] = [];
  for (const { p, urls } of byPlace.values()) {
    p.sources = urls.size;
    p.urls = [...urls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([u]) => u);
    p.kind = (Object.entries(p.kinds) as [EventKind, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? p.kind;
    out.push(p);
  }
  return out.sort((a, b) => b.sources - a.sources || b.n - a.n);
}
