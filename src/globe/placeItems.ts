/**
 * Turns places, provinces, zone sites and fire clusters into label items,
 * each with the camera altitude below which it may appear (see labels.ts).
 */
import type { Site, SiteKind } from "../data/sites";
import { isVague, KIND_LABEL, shortPlace } from "../intel/eventFormat";
import type { FireCluster } from "../intel/fireClusters";
import type { EventPlace } from "../intel/types";
import type { LabelItem } from "./labels";
import { FLAG_CAPITAL, FLAG_SEAT, fmtPop, type CountryDetail, type Place } from "./places";

export type PickedPlace =
  | { kind: "site"; site: Site }
  | { kind: "place"; place: Place }
  | { kind: "fire"; cluster: FireCluster }
  | { kind: "event"; event: EventPlace };

/** Reported in the last few hours: drawn pulsing. */
export const EVENT_FRESH_MS = 3 * 3_600_000;

export const SITE_TAG: Record<SiteKind, string> = {
  front: "FRONT",
  city: "",
  capital: "",
  port: "PORT",
  base: "BASE",
  nuclear: "NUC",
  energy: "ENERGY",
  crossing: "CROSSING",
  camp: "CAMP",
  sea: "SEA",
  node: "NODE",
};

/** Altitude (globe radii) below which a city of this size is labelled. */
function cityAlt(pop: number, flags: number): number {
  if (flags & FLAG_CAPITAL) return 1.5;
  if (pop >= 5e6) return 1.25;
  if (pop >= 1e6) return 0.95;
  if (pop >= 3e5) return 0.6;
  if (pop >= 1e5) return 0.4;
  return flags & FLAG_SEAT ? 0.3 : 0.24;
}

function townAlt(pop: number): number {
  if (pop >= 2e4) return 0.2;
  if (pop >= 5e3) return 0.13;
  return 0.085;
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

type Args = {
  world: readonly Place[] | null;
  details: readonly CountryDetail[];
  sites: readonly Site[];
  siteNews: ReadonlyMap<string, number>;
  clusters: readonly FireCluster[] | null;
  events: readonly EventPlace[] | null;
  selectedId: string | null;
};

export function placeItems({ world, details, sites, siteNews, clusters, events, selectedId }: Args): LabelItem[] {
  const items: LabelItem[] = [];

  // Reported events outrank everything, including sites named in headlines: they say what happened, not just that a place was mentioned.
  // Single-source places are often mis-located, so they appear only close in.
  const now = Date.now();
  for (const e of events ?? []) {
    const corroborated = e.sources >= 2;
    // Region-level places ("Nigeria (general)") are often a mis-read name; only heavy sourcing lifts them to the world view.
    const vague = isVague(e) && e.sources < 8;
    items.push({
      id: `e:${e.id}`,
      lat: e.lat,
      lng: e.lng,
      kind: "event",
      variant: e.kind,
      text: shortPlace(e.name),
      tag: KIND_LABEL[e.kind],
      ...(corroborated ? { badge: e.sources } : {}),
      hot: corroborated && now - e.last < EVENT_FRESH_MS,
      priority: corroborated ? 980 + Math.min(e.sources, 40) + (e.zoneId === selectedId ? 60 : 0) - (vague ? 60 : 0) : 620,
      maxAlt: vague ? (corroborated ? 0.6 : 0.3) : e.sources >= 4 ? 2.4 : corroborated ? 1.2 : 0.45,
      data: { kind: "event", event: e } satisfies PickedPlace,
    });
  }

  // Sites first: a city that is also a site is labelled once, as the site.
  const siteKeys = new Set<string>();
  for (const s of sites) {
    siteKeys.add(`${fold(s.name)}|${Math.round(s.coord[0])}|${Math.round(s.coord[1])}`);
    const news = siteNews.get(s.id) ?? 0;
    const selected = s.zoneId === selectedId;
    const isPlace = s.kind === "city" || s.kind === "capital";
    items.push({
      id: `s:${s.id}`,
      lat: s.coord[0],
      lng: s.coord[1],
      kind: "site",
      variant: s.kind,
      text: s.name,
      ...(SITE_TAG[s.kind] ? { tag: SITE_TAG[s.kind] } : {}),
      ...(news ? { badge: news } : {}),
      hot: news > 0 || selected,
      priority:
        800 + (news ? 150 + Math.min(news, 40) : 0) + (selected ? 100 : 0) + (s.key ? 20 : 0) + (isPlace ? 5 : 0) - (s.kind === "node" ? 40 : 0),
      maxAlt: news || selected ? 2.4 : s.kind === "node" ? 0.6 : 0.8,
      data: { kind: "site", site: s } satisfies PickedPlace,
    });
  }

  if (clusters) {
    for (const c of clusters) {
      if (c.n < 2 && c.maxFrp < 20) continue;
      items.push({
        id: `f:${c.id}`,
        lat: c.lat,
        lng: c.lng,
        kind: "fire",
        text: `${c.n} ${c.n === 1 ? "FIRE" : "FIRES"}`,
        ...(c.near ? { sub: c.near } : {}),
        priority: 700 + Math.min(c.n, 200) / 2,
        maxAlt: c.n >= 20 ? 1.1 : c.n >= 6 ? 0.6 : 0.3,
        data: { kind: "fire", cluster: c } satisfies PickedPlace,
      });
    }
  }

  const skip = (p: Place) => siteKeys.has(`${fold(p.name)}|${Math.round(p.lat)}|${Math.round(p.lng)}`);

  for (const p of world ?? []) {
    if (skip(p)) continue;
    const capital = (p.flags & FLAG_CAPITAL) !== 0;
    items.push({
      id: `c:${p.key}:${p.name}:${p.lat}`,
      lat: p.lat,
      lng: p.lng,
      kind: capital ? "capital" : "city",
      text: p.name,
      ...(p.pop >= 1e5 ? { sub: fmtPop(p.pop) } : {}),
      priority: (capital ? 500 : 100) + Math.log10(Math.max(10, p.pop)) * 20 + (p.flags & FLAG_SEAT ? 8 : 0),
      maxAlt: cityAlt(p.pop, p.flags),
      data: { kind: "place", place: p } satisfies PickedPlace,
    });
  }

  for (const d of details) {
    for (const pr of d.provinces) {
      if (!pr.name) continue;
      items.push({
        id: `p:${d.key}:${pr.name}`,
        lat: pr.label[0],
        lng: pr.label[1],
        kind: "province",
        text: pr.name.toUpperCase(),
        priority: 96,
        maxAlt: 0.75,
      });
    }
    for (const t of d.towns) {
      if (skip(t)) continue;
      items.push({
        id: `t:${d.key}:${t.name}:${t.lat}`,
        lat: t.lat,
        lng: t.lng,
        kind: "town",
        text: t.name,
        priority: Math.log10(Math.max(10, t.pop)) * 20,
        maxAlt: townAlt(t.pop),
        data: { kind: "place", place: t } satisfies PickedPlace,
      });
    }
  }
  return items;
}
