import { m } from "framer-motion";
import { useEffect, useMemo } from "react";
import type { LatLng } from "../data/schema";
import { fmtLat, fmtLng, hhmm } from "../globe/format";
import { countryAt, type Atlas } from "../globe/geo";
import { haversineKm } from "../globe/geoMath";
import { SITE_TAG, type PickedPlace } from "../globe/placeItems";
import { countryKey, FLAG_CAPITAL, fmtPop, loadCountry, provinceAt, type CountryDetail } from "../globe/places";
import { agoShort, domainOf, isVague, KIND_LABEL, shortPlace, slugTitle } from "../intel/eventFormat";
import type { FireCluster } from "../intel/fireClusters";
import type { EventKind, EventPlace } from "../intel/types";
import { headlinesNaming } from "../news/siteMatch";
import type { TaggedItem } from "../news/useNewsFeed";

type Props = {
  picked: PickedPlace;
  items: readonly TaggedItem[];
  siteHeadlines: ReadonlyMap<string, readonly TaggedItem[]>;
  clusters: readonly FireCluster[];
  events: readonly EventPlace[];
  details: ReadonlyMap<string, CountryDetail>;
  atlas: Atlas | null;
  zoneNames: ReadonlyMap<string, string>;
  codes: ReadonlyMap<string, string>;
  compact: boolean;
  onFly: (lat: number, lng: number, altitude?: number) => void;
  onOpenZone: (id: string) => void;
  onClose: () => void;
};

const NEAR_KM = 25;

const coordOf = (p: PickedPlace): LatLng =>
  p.kind === "site"
    ? p.site.coord
    : p.kind === "place"
      ? [p.place.lat, p.place.lng]
      : p.kind === "fire"
        ? [p.cluster.lat, p.cluster.lng]
        : [p.event.lat, p.event.lng];

/** What is at a clicked place: where it is, what the feed says about it, and heat and events reported nearby. */
export function PlaceCard({
  picked,
  items,
  siteHeadlines,
  clusters,
  events,
  details,
  atlas,
  zoneNames,
  codes,
  compact,
  onFly,
  onOpenZone,
  onClose,
}: Props) {
  const at = coordOf(picked);
  const [lat, lng] = at;
  const shape = useMemo(() => (atlas ? countryAt(atlas.countries, [lat, lng]) : null), [atlas, lat, lng]);
  const key = shape ? countryKey(shape) : null;
  useEffect(() => {
    if (key) void loadCountry(key);
  }, [key]);
  const province = key ? provinceAt(details.get(key), at) : null;

  const headlines = useMemo(() => {
    if (picked.kind === "site") return siteHeadlines.get(picked.site.id) ?? [];
    if (picked.kind === "place") return headlinesNaming(items, picked.place.name);
    return [];
  }, [picked, siteHeadlines, items]);

  const nearby = useMemo(() => {
    const own = picked.kind === "fire" ? picked.cluster.id : null;
    const near = clusters.filter((c) => c.id !== own && haversineKm([lat, lng], [c.lat, c.lng]) <= NEAR_KM);
    return { clusters: near.length, n: near.reduce((s, c) => s + c.n, 0) };
  }, [clusters, picked, lat, lng]);

  const nearEvents = useMemo(() => {
    const own = picked.kind === "event" ? picked.event.id : null;
    return events.filter((e) => e.id !== own && haversineKm([lat, lng], [e.lat, e.lng]) <= NEAR_KM);
  }, [events, picked, lat, lng]);

  const zoneId =
    picked.kind === "site" ? picked.site.zoneId : picked.kind === "fire" ? picked.cluster.zoneId : picked.kind === "event" ? picked.event.zoneId : null;

  let kicker: string;
  let title: string;
  let body: string | null = null;
  if (picked.kind === "site") {
    const tag = SITE_TAG[picked.site.kind] || picked.site.kind.toUpperCase();
    kicker = `SITE · ${tag}`;
    title = picked.site.name;
    body = picked.site.note;
  } else if (picked.kind === "place") {
    const p = picked.place;
    kicker = `${p.flags & FLAG_CAPITAL ? "CAPITAL" : p.world ? "CITY" : "TOWN"}${p.pop ? ` · POP ${fmtPop(p.pop)}` : ""}`;
    title = p.name;
  } else if (picked.kind === "fire") {
    const c = picked.cluster;
    kicker = "THERMAL · NASA FIRMS VIIRS 24H";
    title = `${c.n} detection${c.n === 1 ? "" : "s"}${c.near ? ` · ${c.near}` : ""}`;
    body = `Σ fire radiative power ${c.frp.toLocaleString()} MW, peak ${c.maxFrp.toLocaleString()} MW. Heat, not a confirmed strike: crop, wild and industrial fires look the same from orbit.`;
  } else {
    const e = picked.event;
    const mix = (Object.entries(e.kinds) as [EventKind, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${KIND_LABEL[k].toLowerCase()} ×${n}`)
      .join(", ");
    kicker = `REPORTED EVENT · ${KIND_LABEL[e.kind]}`;
    title = shortPlace(e.name);
    body =
      `${e.sources} source article${e.sources === 1 ? "" : "s"} placed ${mix} here in the last 24 h, latest ${agoShort(e.last)}. ` +
      `Machine-coded from news by GDELT: type and location can be wrong${e.sources < 2 ? ", and a single source is unconfirmed" : ""}` +
      `${isVague(e) ? "; located only to a region" : ""}. Check the articles.`;
  }

  return (
    <m.section
      className={`placecard${compact ? " placecard-compact" : ""}`}
      aria-label={`${title} details`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16 }}
    >
      <header className="placecard-head">
        <div className="placecard-kicker mono">{kicker}</div>
        <h3 className="placecard-title">{title}</h3>
        <div className="placecard-loc mono">
          {fmtLat(at[0])} {fmtLng(at[1])}
          {shape ? ` · ${province ? `${province.name}, ` : ""}${shape.name}` : " · open water"}
        </div>
        <button type="button" className="placecard-close" onClick={onClose} aria-label="Close place (Esc)">
          ✕
        </button>
      </header>

      {body && <p className="placecard-body">{body}</p>}

      <dl className="placecard-facts mono">
        {zoneId && (
          <>
            <dt>ZONE</dt>
            <dd>
              <button type="button" className="linkish" onClick={() => onOpenZone(zoneId)}>
                {codes.get(zoneId)} {zoneNames.get(zoneId)}
              </button>
            </dd>
          </>
        )}
        <dt>HEAT ≤{NEAR_KM} KM</dt>
        <dd>{nearby.n ? `${nearby.n} detection${nearby.n === 1 ? "" : "s"} in ${nearby.clusters} cluster${nearby.clusters === 1 ? "" : "s"}` : "none in 24 h (watched zones only)"}</dd>
        <dt>EVENTS ≤{NEAR_KM} KM</dt>
        <dd>
          {nearEvents.length
            ? nearEvents
                .slice(0, 3)
                .map((e) => `${KIND_LABEL[e.kind].toLowerCase()} at ${shortPlace(e.name)} (${e.sources} src)`)
                .join(" · ")
            : "none reported in 24 h"}
        </dd>
        {(picked.kind === "site" || picked.kind === "place") && (
          <>
            <dt>NEWS 36 H</dt>
            <dd>{headlines.length ? `${headlines.length} headline${headlines.length === 1 ? "" : "s"} name it` : "not named in the feed"}</dd>
          </>
        )}
      </dl>

      {picked.kind === "event" && (
        <ul className="placecard-news">
          {picked.event.urls.map((u) => (
            <li key={u}>
              <span className="mono muted">{domainOf(u)}</span>
              <a href={u} target="_blank" rel="noopener noreferrer">
                {slugTitle(u)}
              </a>
            </li>
          ))}
        </ul>
      )}

      {headlines.length > 0 && (
        <ul className="placecard-news">
          {headlines.slice(0, 4).map((n) => (
            <li key={n.id}>
              <span className="mono muted">
                {hhmm(n.seen)} · {n.kind === "rss" ? n.source : n.domain}
              </span>
              <a href={n.url} target="_blank" rel="noopener noreferrer">
                {n.title}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="placecard-actions">
        <button type="button" onClick={() => onFly(at[0], at[1], 0.07)}>
          ⌖ Zoom here
        </button>
        {picked.kind === "site" && zoneId && (
          <button type="button" onClick={() => onOpenZone(zoneId)}>
            Open zone
          </button>
        )}
      </div>
    </m.section>
  );
}
