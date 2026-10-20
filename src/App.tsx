import { AnimatePresence, LazyMotion, MotionConfig } from "framer-motion";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { Briefing } from "./components/Briefing";
import { CoverageMovers, mergedTrends, surgeOf } from "./components/Coverage";
import { DetailPanel } from "./components/DetailPanel";
import { EventLog } from "./components/EventLog";
import { FallbackTable } from "./components/FallbackTable";
import { GlobeBoundary } from "./components/GlobeBoundary";
import { LayerChips } from "./components/LayerChips";
import { LayerDock } from "./components/LayerDock";
import { MiniMap } from "./components/MiniMap";
import { NewsFeed } from "./components/NewsFeed";
import { PlaceCard } from "./components/PlaceCard";
import { ScenarioBanner } from "./components/ScenarioBanner";
import { StatusLine } from "./components/StatusLine";
import { TopBar } from "./components/TopBar";
import { Watchlist } from "./components/Watchlist";
import { WeightControl } from "./components/WeightControl";
import { ZoneList } from "./components/ZoneList";
import { ACTIVE_SOURCE, validateDataset } from "./data/source";
import { DEFAULT_WEIGHTS, DRIVER_META, DRIVERS, type Driver, type HeatDataset } from "./data/schema";
import { zoneSites } from "./data/sites";
import { globeCommands, useAtlas } from "./globe/bus";
import { countryAt } from "./globe/geo";
import type { NewsPing, PickedPlace } from "./globe/GlobeView";
import { haversineKm } from "./globe/geoMath";
import { countryKey, loadCountry, loadWorld, PlaceIndex, placesStore } from "./globe/places";
import { hasWebGL } from "./globe/webgl";
import { clusterFires, nameClusters, type FireCluster } from "./intel/fireClusters";
import type { EventPlace } from "./intel/types";
import { buildSiteMatcher, matchSites } from "./news/siteMatch";
import { useInView } from "./hooks/useInView";
import { useKeyboard } from "./hooks/useKeyboard";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { countryHeat, scoreZones, weightsEqual, type ScoredZone } from "./model/score";
import { useIntel } from "./intel/useIntel";
import { useNewsFeed, type FeedEvent } from "./news/useNewsFeed";
import { initialViewState, soloDriver, viewReducer, type SortKey } from "./state/viewState";

const MOBILE_QUERY = "(max-width: 760px)";
/** `?view=table` renders the ranked table instead of the globe (accessibility, low-power devices, QA of the fallback). */
const FORCE_TABLE = new URLSearchParams(window.location.search).get("view") === "table";
const loadGlobe = () => import("./globe/GlobeView");
const GlobeView = lazy(loadGlobe);
const loadMotionFeatures = () => import("./motionFeatures").then((m) => m.default);
const WATCH_KEY = "signal-heat:watch:v1";
const VISIT_KEY = "signal-heat:visit:v1";
const BRIEF_KEY = "signal-heat:brief:v1";
const CALLSIGN_KEY = "signal-heat:callsign:v1";
/** Reopening within this long counts as the same session: no automatic brief. */
const SAME_SESSION_MS = 15 * 60_000;

/** Per-viewer conveniences in localStorage; every access tolerates a blocked or empty store. */
const local = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* per-viewer convenience only */
    }
  },
};

function useDataset(): { data: HeatDataset | null; error: string | null } {
  const [data, setData] = useState<HeatDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    ACTIVE_SOURCE.load(ctrl.signal)
      .then((ds) => {
        if (import.meta.env.DEV) {
          const problems = validateDataset(ds);
          if (problems.length) console.warn(`[signal-heat] dataset issues:\n  ${problems.join("\n  ")}`);
        }
        setData(ds);
      })
      .catch((e: unknown) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : String(e)));
    return () => ctrl.abort();
  }, []);
  return { data, error };
}

export default function App() {
  const { data, error } = useDataset();
  // On desktop the globe is the instrument: fetch its chunk alongside the data, not after it.
  useEffect(() => {
    if (!FORCE_TABLE && !window.matchMedia(MOBILE_QUERY).matches && hasWebGL()) void loadGlobe();
  }, []);
  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">
        {data ? (
          <Instrument dataset={data} />
        ) : (
          <div className="boot mono">{error ? `data source failed: ${error}` : "loading zones…"}</div>
        )}
      </MotionConfig>
    </LazyMotion>
  );
}

function matches(s: ScoredZone, q: string): boolean {
  if (!q) return true;
  const hay = `${s.zone.name} ${s.zone.region} ${s.zone.kind} ${s.zone.drivers.map((d) => DRIVER_META[d].label).join(" ")}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

function sortZones(zones: ScoredZone[], sort: SortKey): ScoredZone[] {
  return sort === "name"
    ? zones.sort((a, b) => a.zone.name.localeCompare(b.zone.name))
    : zones.sort((a, b) => b.view - a.view || b.composite - a.composite);
}

function readWatch(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type MobileTab = "zones" | "feed" | "log";

function Instrument({ dataset }: { dataset: HeatDataset }) {
  const [state, dispatch] = useReducer(viewReducer, initialViewState, (s) => ({
    ...s,
    lowPower: window.matchMedia(MOBILE_QUERY).matches,
    watchlist: readWatch().filter((id) => dataset.zones.some((z) => z.id === id)),
  }));
  const weights = useDeferredValue(state.weights);
  const scenario = dataset.scenarios[state.scenario];
  const scenarioActive = scenario.adjustments.length > 0;
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const webgl = useMemo(hasWebGL, []);
  const [globeError, setGlobeError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("zones");
  const searchRef = useRef<HTMLInputElement>(null);
  const globeSlotRef = useRef<HTMLDivElement>(null);
  const globeInView = useInView(globeSlotRef, isMobile);

  // ── event log: real events only ──
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const log = useCallback((text: string) => setEvents((ev) => [{ at: Date.now(), text }, ...ev].slice(0, 150)), []);
  const onFeedEvent = useCallback((e: FeedEvent) => setEvents((ev) => [e, ...ev].slice(0, 150)), []);
  const intel = useIntel(state.selectedId, onFeedEvent);
  // Browser-side GDELT only when the local intel service is absent (static hosting).
  const direct = useNewsFeed(intel.mode === "direct", onFeedEvent);
  const news = intel.mode === "direct" ? direct : { items: intel.items, status: intel.status };
  const surges = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, t] of Object.entries(mergedTrends(intel.trends))) {
      const r = surgeOf(t);
      if (r !== null) m.set(id, r);
    }
    return m;
  }, [intel.trends]);

  const scored = useMemo(
    () => scoreZones(dataset.zones, { weights, scenario, mode: state.mode, layers: state.layers, risingOnly: state.risingOnly }),
    [dataset.zones, weights, scenario, state.mode, state.layers, state.risingOnly],
  );
  const byId = useMemo(() => new Map(scored.map((s) => [s.zone.id, s])), [scored]);
  const heat = useMemo(() => countryHeat(scored), [scored]);
  const lit = useMemo(() => scored.filter((s) => s.view > 0).length, [scored]);
  const results = useMemo(
    () => sortZones(scored.filter((s) => matches(s, state.query) && (!state.risingOnly || s.view > 0)), state.sort),
    [scored, state.query, state.sort, state.risingOnly],
  );
  const adjusted = useMemo(() => scored.filter((s) => s.adjustment), [scored]);
  const selected = state.selectedId ? (byId.get(state.selectedId) ?? null) : null;
  const solo = soloDriver(state);

  const codes = useMemo(
    () => new Map(dataset.zones.map((z, i) => [z.id, `ZN-${String(i + 1).padStart(3, "0")}`])),
    [dataset.zones],
  );
  const zoneNames = useMemo(() => new Map(dataset.zones.map((z) => [z.id, z.name])), [dataset.zones]);

  // ── named places: which towns, bases and crossings the feed is naming ──
  const sites = useMemo(() => zoneSites(dataset.zones), [dataset.zones]);
  const sitesById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
  const siteMatcher = useMemo(() => buildSiteMatcher(sites), [sites]);
  const siteHeadlines = useMemo(() => matchSites(news.items, siteMatcher, 36 * 3_600_000), [news.items, siteMatcher]);
  const siteNews = useMemo(() => new Map([...siteHeadlines].map(([id, l]) => [id, l.length])), [siteHeadlines]);

  /**
   * Headlines from the last 3 hours ping the globe: at the named site when a
   * headline names one, otherwise at the zone centroid.
   */
  const pings = useMemo<NewsPing[]>(() => {
    const cutoff = Date.now() - 3 * 3_600_000;
    const recent = matchSites(news.items, siteMatcher, 3 * 3_600_000);
    const siteZones = new Set<string>();
    const out: NewsPing[] = [];
    // Sparse rings: a few named sites beat a carpet of zone centroids.
    for (const id of recent.keys()) {
      const s = sitesById.get(id);
      if (!s || out.length >= 6) continue;
      siteZones.add(s.zoneId);
      out.push({ id: s.id, lat: s.coord[0], lng: s.coord[1] });
    }
    const seen = new Set<string>();
    for (const n of news.items) {
      if (n.seen < cutoff || out.length >= 8) break;
      for (const id of n.zoneIds) {
        const z = byId.get(id)?.zone;
        if (!z || seen.has(id) || siteZones.has(id)) continue;
        seen.add(id);
        out.push({ id, lat: z.centroid[0], lng: z.centroid[1] });
      }
    }
    return out;
  }, [news.items, byId, siteMatcher, sitesById]);

  // ── fire clusters, named after the nearest town ──
  const places = useSyncExternalStore(placesStore.subscribe, placesStore.get, placesStore.get);
  const atlas = useAtlas();
  const rawClusters = useMemo(() => (intel.fires ? clusterFires(intel.fires) : []), [intel.fires]);
  // Towns name clusters far better than cities of 50k+; load the countries the biggest clusters sit in.
  useEffect(() => {
    if (!atlas || !places.world) return;
    const keys = new Set<string>();
    for (const c of rawClusters) {
      if (c.n < 3 || keys.size >= 6) continue;
      const shape = countryAt(atlas.countries, [c.lat, c.lng]);
      const k = shape ? countryKey(shape) : null;
      if (k) keys.add(k);
    }
    for (const k of keys) void loadCountry(k);
  }, [rawClusters, atlas, places.world]);
  const placeIndex = useMemo(
    () => (places.world ? new PlaceIndex([...places.world, ...[...places.details.values()].flatMap((d) => d.towns)]) : null),
    [places.world, places.details],
  );
  const fireClusters = useMemo(() => nameClusters(rawClusters, placeIndex), [rawClusters, placeIndex]);
  // Without the globe (table view, mobile) nothing else loads the city list the cluster names need.
  useEffect(() => {
    if (intel.fires) void loadWorld().catch(() => undefined);
  }, [intel.fires]);
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const pickPlace = useCallback((p: PickedPlace) => setPicked(p), []);
  const flyTo = useCallback((lat: number, lng: number, altitude?: number) => globeCommands.flyTo(lat, lng, altitude), []);

  // ── reported events (GDELT) ──
  const eventPlaces = useMemo(
    () => (state.showEvents && intel.events ? intel.events.places : null),
    [state.showEvents, intel.events],
  );
  const selectedEvents = useMemo(
    () => (state.selectedId && eventPlaces ? eventPlaces.filter((e) => e.zoneId === state.selectedId) : null),
    [state.selectedId, eventPlaces],
  );
  /** A few fresh, well-sourced event rings — not a full pulse carpet. */
  const globePings = useMemo<NewsPing[]>(() => {
    const cutoff = Date.now() - 3_600_000;
    const fresh = (eventPlaces ?? [])
      .filter((e) => e.sources >= 4 && e.last >= cutoff)
      .slice(0, 4)
      .map((e) => ({ id: `e:${e.id}`, lat: e.lat, lng: e.lng }));
    return [...fresh, ...pings].slice(0, 10);
  }, [eventPlaces, pings]);
  const pickEvent = useCallback(
    (event: EventPlace) => {
      pickPlace({ kind: "event", event });
      flyTo(event.lat, event.lng, 0.14);
    },
    [pickPlace, flyTo],
  );
  const pickCluster = useCallback(
    (cluster: FireCluster) => {
      pickPlace({ kind: "fire", cluster });
      flyTo(cluster.lat, cluster.lng, 0.12);
    },
    [pickPlace, flyTo],
  );

  // ── opening brief ──
  const [lastVisit] = useState<number | null>(() => Number(local.get(VISIT_KEY)) || null);
  const [callsign, setCallsign] = useState(() => local.get(CALLSIGN_KEY) || "Operator");
  const [briefOnOpen, setBriefOnOpen] = useState(() => local.get(BRIEF_KEY) !== "off");
  const [briefOpen, setBriefOpen] = useState(() => briefOnOpen && (!lastVisit || Date.now() - lastVisit > SAME_SESSION_MS));
  useEffect(() => {
    // "Last on watch" is the last minute the app was open.
    const mark = () => local.set(VISIT_KEY, String(Date.now()));
    mark();
    const t = window.setInterval(mark, 60_000);
    window.addEventListener("pagehide", mark);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("pagehide", mark);
    };
  }, []);

  const selectedSites = useMemo(() => {
    if (!state.selectedId) return [];
    const zoneClusters = fireClusters.filter((c) => c.zoneId === state.selectedId);
    return sites
      .filter((s) => s.zoneId === state.selectedId)
      .map((site) => ({
        site,
        headlines: siteNews.get(site.id) ?? 0,
        fires: zoneClusters.reduce((n, c) => (haversineKm(site.coord, [c.lat, c.lng]) <= 25 ? n + c.n : n), 0),
      }));
  }, [state.selectedId, sites, siteNews, fireClusters]);
  const selectedClusters = useMemo(
    () => (state.selectedId ? fireClusters.filter((c) => c.zoneId === state.selectedId).slice(0, 6) : []),
    [state.selectedId, fireClusters],
  );

  const headlines = useMemo(
    () => (state.selectedId ? news.items.filter((n) => n.zoneIds.includes(state.selectedId ?? "")) : []),
    [news.items, state.selectedId],
  );

  const select = useCallback((id: string) => dispatch({ type: "select", id, focus: true }), []);
  const close = useCallback(() => dispatch({ type: "select", id: null }), []);
  const onGlobeError = useCallback((e: Error) => {
    console.error("[signal-heat] globe failed:", e);
    setGlobeError(e.message || "WebGL error");
  }, []);

  // ── log what changed; each watcher skips its initial value ──
  const scoredRef = useRef(scored);
  scoredRef.current = scored;

  const bootLogged = useRef(false);
  useEffect(() => {
    if (bootLogged.current) return;
    bootLogged.current = true;
    log(`DATASET ${dataset.asOf.toUpperCase()} · ${dataset.zones.length} ZONES · ${dataset.links.length} LINKS`);
  }, [dataset, log]);

  const layerKey = state.mode === "composite" ? "COMPOSITE" : state.layers.map((l) => DRIVER_META[l].label.toUpperCase()).join(" + ");
  const prevLayer = useRef(layerKey);
  useEffect(() => {
    if (prevLayer.current !== layerKey) log(`LAYER VIEW → ${layerKey}`);
    prevLayer.current = layerKey;
  }, [layerKey, log]);

  const prevScenario = useRef(state.scenario);
  useEffect(() => {
    if (prevScenario.current !== state.scenario)
      log(`SCENARIO → ${scenario.label.toUpperCase()}${scenario.adjustments.length ? ` · ${scenario.adjustments.length} ZONES ADJUSTED` : ""}`);
    prevScenario.current = state.scenario;
  }, [state.scenario, scenario, log]);

  useEffect(() => {
    if (!state.selectedId) return;
    const s = scoredRef.current.find((z) => z.zone.id === state.selectedId);
    if (s) log(`TRACK ${codes.get(s.zone.id)} ${s.zone.name.toUpperCase()} · ${Math.round(s.composite)}`);
  }, [state.selectedId, codes, log]);

  const loggedWeights = useRef(state.weights);
  const loggedScores = useRef(new Map(scored.map((s) => [s.zone.id, s.composite])));
  useEffect(() => {
    const t = window.setTimeout(() => {
      const before = loggedWeights.current;
      const changed = DRIVERS.filter((d) => Math.abs(before[d] - state.weights[d]) > 1e-9);
      if (!changed.length) return;
      const moved = scoredRef.current.filter((s) => Math.abs(s.composite - (loggedScores.current.get(s.zone.id) ?? s.composite)) >= 1).length;
      log(`WEIGHT ${changed.map((d) => `${DRIVER_META[d].short} ${before[d].toFixed(2)}→${state.weights[d].toFixed(2)}`).join(", ")} · ${moved} ZONES Δ≥1`);
      loggedWeights.current = state.weights;
      loggedScores.current = new Map(scoredRef.current.map((s) => [s.zone.id, s.composite]));
    }, 700);
    return () => window.clearTimeout(t);
  }, [state.weights, log]);

  const prevWatch = useRef(state.watchlist);
  useEffect(() => {
    const added = state.watchlist.filter((id) => !prevWatch.current.includes(id));
    const removed = prevWatch.current.filter((id) => !state.watchlist.includes(id));
    added.forEach((id) => log(`WATCH + ${codes.get(id)} ${zoneNames.get(id)?.toUpperCase()}`));
    removed.forEach((id) => log(`WATCH − ${codes.get(id)} ${zoneNames.get(id)?.toUpperCase()}`));
    prevWatch.current = state.watchlist;
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(state.watchlist));
    } catch {
      /* per-viewer convenience only */
    }
  }, [state.watchlist, codes, zoneNames, log]);

  useKeyboard({
    onSlash: () => searchRef.current?.focus(),
    onBrief: () => setBriefOpen(true),
    onEscape: () => {
      if (briefOpen) setBriefOpen(false);
      else if (document.activeElement === searchRef.current) {
        dispatch({ type: "setQuery", query: "" });
        searchRef.current?.blur();
      } else if (picked) setPicked(null);
      else if (state.selectedId) close();
    },
    onDigit: (n) => {
      const d: Driver | undefined = DRIVERS[n - 1];
      if (n === 0 || !d) dispatch({ type: "composite" });
      else dispatch({ type: "toggleLayer", driver: d });
    },
  });

  const customWeights = !weightsEqual(state.weights, DEFAULT_WEIGHTS);
  const showTable = FORCE_TABLE || !webgl || globeError !== null;
  const feedLabel = `${news.status.state} ${news.status.groupsFresh}/${news.status.groupsTotal}${intel.fires ? ` · fires ${intel.fires.points.length}` : ""}`;
  const selectedTrend = state.selectedId ? mergedTrends(intel.trends)[state.selectedId] : undefined;
  const trendNote =
    intel.mode === "direct"
      ? "Needs the local intel service (npm run dev or npm run preview)."
      : !intel.trends
        ? "Linking to the intel service…"
        : intel.trends.source.state === "throttled"
          ? `Queued — GDELT is rate-limiting (${intel.trends.source.message ?? "retrying"}).`
          : "Queued — this zone was moved to the front of the GDELT queue.";
  const selectedFires = state.selectedId && intel.fires ? (intel.fires.counts[state.selectedId] ?? null) : null;
  const firesNote =
    intel.mode === "direct"
      ? "Needs the local intel service (npm run dev or npm run preview)."
      : !intel.fires
        ? "Loading NASA FIRMS…"
        : state.selectedId && intel.fires.zones.includes(state.selectedId)
          ? "No detections in the last 24 h."
          : "Not monitored: only active kinetic zones are watched (flare-heavy and open-sea zones excluded).";

  const globe = showTable ? (
    <FallbackTable
      zones={scored}
      weights={weights}
      scenarioActive={scenarioActive}
      reason={FORCE_TABLE ? "?view=table" : webgl ? `render error: ${globeError}` : "WebGL not available"}
      onPick={select}
    />
  ) : (
    globeInView && (
      <GlobeBoundary onError={onGlobeError}>
        <Suspense fallback={<div className="globe-loading mono">initialising globe…</div>}>
          <GlobeView
            baseZones={dataset.zones}
            scored={scored}
            countryHeat={heat}
            links={dataset.links}
            codes={codes}
            pings={globePings}
            fires={intel.fires}
            showFires={state.showFires}
            selectedId={state.selectedId}
            solo={solo}
            scenarioActive={scenarioActive}
            showLinks={state.showLinks}
            showRoutes={state.showRoutes}
            autoRotate={state.autoRotate}
            sweep={state.sweep}
            lowPower={state.lowPower}
            resolution={isMobile ? "110m" : "50m"}
            focus={state.focus}
            sites={sites}
            siteNews={siteNews}
            fireClusters={fireClusters}
            eventPlaces={eventPlaces}
            showPlaces={state.showPlaces}
            callsign={callsign}
            onSelect={select}
            onPickPlace={pickPlace}
            onError={onGlobeError}
          />
        </Suspense>
      </GlobeBoundary>
    )
  );

  const placeCard = picked && (
    <PlaceCard
      key="place"
      picked={picked}
      items={news.items}
      siteHeadlines={siteHeadlines}
      clusters={fireClusters}
      events={eventPlaces ?? []}
      details={places.details}
      atlas={atlas}
      zoneNames={zoneNames}
      codes={codes}
      compact={isMobile}
      onFly={flyTo}
      onOpenZone={(id) => {
        setPicked(null);
        select(id);
      }}
      onClose={() => setPicked(null)}
    />
  );

  const feed = (
    <NewsFeed
      items={news.items}
      status={news.status}
      zoneNames={zoneNames}
      codes={codes}
      selectedId={state.selectedId}
      onPickZone={select}
      sourcesLabel={intel.mode === "direct" ? "BANDS" : "SOURCES"}
    />
  );
  const movers = <CoverageMovers trends={intel.trends} zoneNames={zoneNames} codes={codes} onPick={select} />;
  const watch = (
    <Watchlist
      ids={state.watchlist}
      byId={byId}
      codes={codes}
      selectedId={state.selectedId}
      surges={surges}
      onPick={select}
      onRemove={(id) => dispatch({ type: "toggleWatch", id })}
    />
  );

  return (
    <div
      className="app"
      data-mobile={isMobile}
      data-feed={state.feedOpen}
      data-rail={state.railOpen}
      data-watch={state.watchlist.length > 0}
    >
      <TopBar
        searchRef={searchRef}
        query={state.query}
        sort={state.sort}
        risingOnly={state.risingOnly}
        scenario={state.scenario}
        results={results}
        selectedId={state.selectedId}
        scenarioActive={scenarioActive}
        compact={isMobile}
        callsign={callsign}
        onQuery={(query) => dispatch({ type: "setQuery", query })}
        onSort={(sort) => dispatch({ type: "setSort", sort })}
        onRising={() => dispatch({ type: "toggleRising" })}
        onScenario={(s) => dispatch({ type: "setScenario", scenario: s })}
        onPick={select}
        onBrief={() => setBriefOpen(true)}
      />

      <AnimatePresence>
        {briefOpen && (
          <Briefing
            key="brief"
            lastVisit={lastVisit}
            callsign={callsign}
            onCallsign={(s) => {
              setCallsign(s);
              local.set(CALLSIGN_KEY, s);
            }}
            showOnOpen={briefOnOpen}
            onShowOnOpen={(v) => {
              setBriefOnOpen(v);
              local.set(BRIEF_KEY, v ? "on" : "off");
            }}
            events={intel.mode === "direct" ? "off" : intel.events}
            clusters={fireClusters}
            items={news.items}
            watchlist={state.watchlist}
            byId={byId}
            codes={codes}
            surges={surges}
            compact={isMobile}
            onPickEvent={(e) => {
              setBriefOpen(false);
              pickEvent(e);
            }}
            onPickCluster={(c) => {
              setBriefOpen(false);
              pickCluster(c);
            }}
            onSelectZone={(id) => {
              setBriefOpen(false);
              select(id);
            }}
            onClose={() => setBriefOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {scenarioActive &&<ScenarioBanner key="banner" scenario={scenario} adjusted={adjusted} onPick={select} />}
      </AnimatePresence>

      {isMobile ? (
        <main className="mobile">
          <LayerChips
            mode={state.mode}
            layers={state.layers}
            onComposite={() => dispatch({ type: "composite" })}
            onToggleLayer={(d) => dispatch({ type: "toggleLayer", driver: d })}
          />
          <details className="m-weights">
            <summary>Weights{customWeights ? " · custom" : ""}</summary>
            <WeightControl
              weights={state.weights}
              custom={customWeights}
              onWeight={(driver, value) => dispatch({ type: "setWeight", driver, value })}
              onReset={() => dispatch({ type: "resetWeights" })}
            />
          </details>
          {state.watchlist.length > 0 && watch}
          <div className="m-tabs seg" role="tablist" aria-label="Lists">
            {(["zones", "feed", "log"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={mobileTab === t} onClick={() => setMobileTab(t)}>
                {t === "zones" ? `Zones ${results.length}` : t === "feed" ? `Feed ${news.items.length}` : "Log"}
              </button>
            ))}
          </div>
          <section className="m-list" aria-label={mobileTab}>
            {mobileTab === "zones" && (
              <ZoneList zones={results} selectedId={state.selectedId} scenarioActive={scenarioActive} surges={surges} onPick={select} />
            )}
            {mobileTab === "feed" && (
              <>
                {intel.mode === "server" && movers}
                {feed}
              </>
            )}
            {mobileTab === "log" && <EventLog events={events} />}
          </section>
          <div className="m-globe" ref={globeSlotRef}>
            {globe}
            <AnimatePresence>{placeCard}</AnimatePresence>
          </div>
        </main>
      ) : (
        <main className="stage">
          <div className="globe-slot" ref={globeSlotRef}>
            {globe}
            <AnimatePresence>{placeCard}</AnimatePresence>
          </div>
          <LayerDock
            open={state.railOpen}
            mode={state.mode}
            layers={state.layers}
            weights={state.weights}
            zones={dataset.zones}
            showLinks={state.showLinks}
            showRoutes={state.showRoutes}
            autoRotate={state.autoRotate}
            sweep={state.sweep}
            lowPower={state.lowPower}
            showFires={state.showFires}
            showPlaces={state.showPlaces}
            showEvents={state.showEvents}
            firesAvailable={intel.mode === "server"}
            minimap={<MiniMap zones={scored} />}
            onToggleOpen={() => dispatch({ type: "toggleRail" })}
            onComposite={() => dispatch({ type: "composite" })}
            onToggleLayer={(d) => dispatch({ type: "toggleLayer", driver: d })}
            onSoloLayer={(d) => dispatch({ type: "soloLayer", driver: d })}
            onWeight={(driver, value) => dispatch({ type: "setWeight", driver, value })}
            onResetWeights={() => dispatch({ type: "resetWeights" })}
            onToggleLinks={() => dispatch({ type: "toggleLinks" })}
            onToggleRoutes={() => dispatch({ type: "toggleRoutes" })}
            onToggleAutoRotate={() => dispatch({ type: "toggleAutoRotate" })}
            onToggleSweep={() => dispatch({ type: "toggleSweep" })}
            onToggleFires={() => dispatch({ type: "toggleFires" })}
            onTogglePlaces={() => dispatch({ type: "togglePlaces" })}
            onToggleEvents={() => dispatch({ type: "toggleEvents" })}
            onLowPower={(value) => {
              dispatch({ type: "setLowPower", value });
              log(`RENDER ${value ? "LOW-POWER" : "FULL"} · GLOW + SWEEP ${value ? "OFF" : "ON"}`);
            }}
          />
          <aside className="opsrail" data-open={state.feedOpen} aria-label="Feed and log">
            <button
              type="button"
              className="opsrail-toggle"
              onClick={() => dispatch({ type: "toggleFeed" })}
              aria-expanded={state.feedOpen}
              aria-label={state.feedOpen ? "Collapse feed" : "Expand feed"}
              title={state.feedOpen ? "Collapse feed" : "Expand feed"}
            >
              {state.feedOpen ? "›" : "‹"}
            </button>
            {state.feedOpen && (
              <>
                {intel.mode === "server" && movers}
                {feed}
                <EventLog events={events} />
              </>
            )}
          </aside>
          {state.watchlist.length > 0 && watch}
        </main>
      )}

      <AnimatePresence>
        {selected && (
          <DetailPanel
            key="panel"
            scored={selected}
            weights={weights}
            mode={state.mode}
            layers={state.layers}
            scenarioActive={scenarioActive}
            sheet={isMobile}
            code={codes.get(selected.zone.id) ?? ""}
            pinned={state.watchlist.includes(selected.zone.id)}
            headlines={headlines}
            trend={selectedTrend}
            trendNote={trendNote}
            fires={selectedFires}
            firesNote={firesNote}
            sites={selectedSites}
            clusters={selectedClusters}
            onFly={flyTo}
            onPickSite={(site) => {
              pickPlace({ kind: "site", site });
              flyTo(site.coord[0], site.coord[1], 0.12);
            }}
            onPickCluster={pickCluster}
            events={selectedEvents}
            onPickEvent={pickEvent}
            onTogglePin={() => dispatch({ type: "toggleWatch", id: selected.zone.id })}
            onClose={close}
          />
        )}
      </AnimatePresence>

      <StatusLine
        total={dataset.zones.length}
        lit={lit}
        mode={state.mode}
        layers={state.layers}
        scenarioLabel={scenario.label}
        customWeights={customWeights}
        asOf={dataset.asOf}
        feed={feedLabel}
        compact={isMobile}
        callsign={callsign}
      />
    </div>
  );
}
