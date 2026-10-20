import { m } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { DRIVER_META, type Driver, type Weights } from "../data/schema";
import type { Site } from "../data/sites";
import { SITE_TAG } from "../globe/placeItems";
import { agoShort, KIND_LABEL, shortPlace } from "../intel/eventFormat";
import type { FireCluster } from "../intel/fireClusters";
import type { EventPlace } from "../intel/types";
import { heatCss } from "../model/heatColor";
import { baseIntensities, fmtDelta, fmtScore, type ScoredZone, type ViewMode } from "../model/score";
import { fmtLat, fmtLng } from "../globe/format";
import type { TaggedItem } from "../news/useNewsFeed";
import { DriverBars } from "./DriverBars";
import type { ZoneTrend } from "../intel/types";
import { fmtRatio, Sparkline, SURGE, surgeOf } from "./Coverage";
import { hhmm } from "../globe/format";
import { TrendGlyph } from "./TrendGlyph";

type Props = {
  scored: ScoredZone;
  weights: Weights;
  mode: ViewMode;
  layers: readonly Driver[];
  scenarioActive: boolean;
  sheet: boolean;
  code: string;
  pinned: boolean;
  headlines: readonly TaggedItem[];
  trend: ZoneTrend | undefined;
  trendNote: string;
  fires: { n: number; frp: number } | null;
  firesNote: string;
  /** Named places in the zone, with headline and heat counts. */
  sites: readonly { site: Site; headlines: number; fires: number }[];
  /** Largest thermal clusters in the zone. */
  clusters: readonly FireCluster[];
  /** GDELT event places in the zone, strongest first; null when the event layer is unavailable or off. */
  events: readonly EventPlace[] | null;
  onPickEvent: (e: EventPlace) => void;
  onFly: (lat: number, lng: number, altitude?: number) => void;
  onPickSite: (site: Site) => void;
  onPickCluster: (cluster: FireCluster) => void;
  onTogglePin: () => void;
  onClose: () => void;
};

const SEARCH_URL = "https://duckduckgo.com/?q=";
const SITES_COLLAPSED = 8;

/** Camera altitude that frames a zone of this radius. */
const frameAltitude = (radiusKm: number | undefined): number =>
  radiusKm ? Math.min(0.6, Math.max(0.09, (radiusKm / 6371) * 3.4)) : 0.35;

export function DetailPanel({
  scored,
  weights,
  mode,
  layers,
  scenarioActive,
  sheet,
  code,
  pinned,
  headlines,
  trend,
  trendNote,
  fires,
  firesNote,
  sites,
  clusters,
  events,
  onPickEvent,
  onFly,
  onPickSite,
  onPickCluster,
  onTogglePin,
  onClose,
}: Props) {
  const { zone } = scored;
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const base = baseIntensities(zone);
  const [allSites, setAllSites] = useState(false);
  // Places in the news first, then places with heat nearby, then the curated order.
  const rankedSites = useMemo(
    () =>
      sites
        .map((s, i) => ({ ...s, i }))
        .sort((a, b) => b.headlines - a.headlines || b.fires - a.fires || a.i - b.i),
    [sites],
  );

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    setAllSites(false);
  }, [zone.id]);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const shares = Object.entries(zone.countries ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([iso, s]) => `${iso} ${s.toFixed(2)}`);

  return (
    <m.aside
      className={`panel${sheet ? " panel-sheet" : ""}`}
      ref={panelRef}
      tabIndex={-1}
      aria-label={`${zone.name} detail`}
      initial={sheet ? { y: "100%" } : { x: 400, opacity: 0.4 }}
      animate={sheet ? { y: 0 } : { x: 0, opacity: 1 }}
      exit={sheet ? { y: "100%" } : { x: 400, opacity: 0 }}
      transition={{ type: "tween", duration: 0.22, ease: [0.2, 0, 0, 1] }}
    >
      <header className="panel-head">
        <div className="panel-kicker mono">
          <span className="panel-code">{code}</span> // {zone.region.toUpperCase()} // {zone.kind.toUpperCase()} // CONF{" "}
          {zone.confidence.toUpperCase()}
        </div>
        <h2 className="panel-title">{zone.name}</h2>
        <div className="panel-sub mono">
          <span>
            {fmtLat(zone.centroid[0])} {fmtLng(zone.centroid[1])} · REVIEWED {zone.reviewed ?? "2026 H1 SEED"}
          </span>
          <span className="panel-sub-actions">
            <button
              type="button"
              className="pin-btn"
              onClick={() => onFly(zone.centroid[0], zone.centroid[1], frameAltitude(zone.radiusKm))}
              title="Fly down to ground level: towns, provinces and sites appear"
            >
              ⌖ ZOOM IN
            </button>
            <button type="button" className="pin-btn" aria-pressed={pinned} onClick={onTogglePin}>
              {pinned ? "✓ WATCHING" : "＋ WATCH"}
            </button>
          </span>
        </div>
        <button type="button" className="panel-close" onClick={onClose} aria-label="Close panel (Esc)">
          ✕
        </button>
      </header>

      <div className="panel-body" ref={bodyRef}>
        <div className="score-block">
          <div className="score-main">
            <span className="score-num mono" style={{ color: heatCss(Math.max(scored.composite, 30)) }}>
              {fmtScore(scored.composite)}
            </span>
            <span className="score-cap">composite / 100</span>
          </div>
          <div className="score-side">
            <TrendGlyph trend={scored.trend} label />
            {mode === "layers" && (
              <span className="score-layer mono">
                layer view {fmtScore(scored.view)} · {layers.map((l) => DRIVER_META[l].short).join("+")}
              </span>
            )}
          </div>
        </div>

        {scenarioActive && scored.adjustment && (
          <div className="assume" role="note">
            <div className="assume-delta mono">
              baseline {fmtScore(scored.baseline)} → {fmtScore(scored.composite)} <b>{fmtDelta(scored.delta)}</b>
            </div>
            <p>
              <span className="assume-k">Escalation assumes:</span> {scored.adjustment.assumption}
            </p>
          </div>
        )}

        <section className="panel-sec signals">
          <h3 className="panel-h">Signals · live, unscored</h3>
          <div className="signal">
            <div className="signal-k mono">
              {trend?.source === "rss" ? `COVERAGE · RSS HEADLINES ${trend.days.length}D` : "COVERAGE · GDELT 14D"}
              {trend && surgeOf(trend) !== null && (
                <b className={(surgeOf(trend) ?? 0) >= SURGE ? "surge" : ""}>{fmtRatio(surgeOf(trend) ?? 0)} vs prior 11d</b>
              )}
            </div>
            {trend ? (
              <>
                <Sparkline trend={trend} />
                <p className="signal-note">
                  {trend.source === "gdelt"
                    ? `${trend.total.toLocaleString()} English-language articles naming this zone in 14 days; bars show each day's share of all coverage GDELT monitored.`
                    : `${trend.total.toLocaleString()} headlines naming this zone across 13 world-news desks, counted since this service started (${trend.days.length} day${trend.days.length === 1 ? "" : "s"}; a ratio needs 6+). GDELT's 14-day series replaces this when available.`}
                </p>
              </>
            ) : (
              <p className="signal-note mono">{trendNote}</p>
            )}
          </div>
          <div className="signal">
            <div className="signal-k mono">THERMAL · NASA FIRMS VIIRS 24H</div>
            {fires ? (
              <p className="signal-note">
                <b className="mono">{fires.n.toLocaleString()}</b> detections · Σ fire radiative power{" "}
                <span className="mono">{fires.frp.toLocaleString()} MW</span>. Includes crop, wild and industrial fires, not only strikes.
              </p>
            ) : (
              <p className="signal-note mono">{firesNote}</p>
            )}
            {clusters.length > 0 && (
              <ul className="clusters">
                {clusters.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onPickCluster(c)} title="Fly to this cluster">
                      <b className="mono">{c.n}</b>
                      <span>{c.near ?? `${fmtLat(c.lat)} ${fmtLng(c.lng)}`}</span>
                      <span className="mono muted">{c.frp.toLocaleString()} MW</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {events && (
            <div className="signal">
              <div className="signal-k mono">
                EVENTS · GDELT 24H
                {events.length > 0 && (
                  <b>
                    {events.filter((e) => e.sources >= 2).length} corroborated / {events.length}
                  </b>
                )}
              </div>
              {events.length ? (
                <ul className="clusters">
                  {events.slice(0, 6).map((e) => (
                    <li key={e.id}>
                      <button type="button" onClick={() => onPickEvent(e)} title="Fly to this place">
                        <b className="mono">{e.sources}</b>
                        <span>
                          {KIND_LABEL[e.kind].toLowerCase()} · {shortPlace(e.name)}
                        </span>
                        <span className="mono muted">{agoShort(e.last)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="signal-note mono">No violent events geolocated here in 24 h.</p>
              )}
              <p className="signal-note">Number = source articles. Machine-coded from news; single-source places are unconfirmed.</p>
            </div>
          )}
        </section>

        {rankedSites.length > 0 && (
          <section className="panel-sec">
            <h3 className="panel-h">Places · where it is happening</h3>
            <ul className="sites">
              {(allSites ? rankedSites : rankedSites.slice(0, SITES_COLLAPSED)).map(({ site, headlines: nNews, fires: nFires }) => (
                <li key={site.id}>
                  <button type="button" onClick={() => onPickSite(site)} title="Fly to this place">
                    <span className="site-row">
                      <span className="site-tag mono" data-kind={site.kind}>
                        {SITE_TAG[site.kind] || (site.kind === "capital" ? "CAPITAL" : "CITY")}
                      </span>
                      <span className="site-name">{site.name}</span>
                      {nNews > 0 && <span className="site-count site-news mono">{nNews} NEWS</span>}
                      {nFires > 0 && <span className="site-count site-heat mono">{nFires} HEAT</span>}
                    </span>
                    <span className="site-note">{site.note}</span>
                  </button>
                </li>
              ))}
            </ul>
            {rankedSites.length > SITES_COLLAPSED && (
              <button type="button" className="linkish mono small" onClick={() => setAllSites((v) => !v)}>
                {allSites ? "Show fewer" : `Show all ${rankedSites.length}`}
              </button>
            )}
            <p className="muted small">NEWS = headlines naming the place in 36 h. HEAT = FIRMS detections within 25 km in 24 h. Notes are background, not live status.</p>
          </section>
        )}

        <section className="panel-sec">
          <h3 className="panel-h">Driver breakdown</h3>
          <DriverBars scored={scored} base={base} weights={weights} activeLayers={mode === "layers" ? layers : null} />
        </section>

        <section className="panel-sec">
          <h3 className="panel-h">Mechanism</h3>
          <p className="summary">{zone.summary}</p>
        </section>

        <section className="panel-sec">
          <h3 className="panel-h">
            Live headlines · {headlines.length ? `${headlines.length} in 36 h` : "none tagged"}
          </h3>
          {headlines.length === 0 ? (
            <p className="muted small">No open-source headline in the current feed names this zone.</p>
          ) : (
            <ul className="panel-news">
              {headlines.slice(0, 6).map((n) => (
                <li key={n.id}>
                  <span className="mono muted">
                    {hhmm(n.seen)} · {n.kind === "rss" ? n.source : n.domain}
                    {n.sources.length > 1 ? ` +${n.sources.length - 1}` : ""}
                  </span>
                  <a href={n.url} target="_blank" rel="noopener noreferrer">
                    {n.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-sec">
          <h3 className="panel-h">Watch · falsifiers &amp; tripwires</h3>
          <ul className="watch">
            {zone.watch.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>

        {(shares.length > 0 || (zone.nodes?.length ?? 0) > 0) && (
          <section className="panel-sec">
            <h3 className="panel-h">Footprint</h3>
            {shares.length > 0 && <p className="mono footprint">{shares.join(" · ")}</p>}
            {zone.nodes && zone.nodes.length > 0 && (
              <ul className="nodes mono">
                {zone.nodes.map((n) => (
                  <li key={n.name}>
                    <span>{n.name}</span>
                    <span className="muted">
                      {n.coord[0].toFixed(2)}, {n.coord[1].toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="panel-sec">
          <h3 className="panel-h">Research queries</h3>
          <ul className="queries">
            {zone.links.map((l) => (
              <li key={l.query}>
                <a href={`${SEARCH_URL}${encodeURIComponent(l.query)}`} target="_blank" rel="noopener noreferrer">
                  {l.label}
                </a>
                <span className="mono muted">{l.query}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </m.aside>
  );
}
