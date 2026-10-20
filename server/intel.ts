/**
 * Local intel service, mounted into the Vite dev and preview servers.
 *
 *   GET /api/intel/news            world-news RSS + GDELT bands, merged
 *   GET /api/intel/trends?focus=id GDELT 14-day coverage per zone
 *   GET /api/intel/fires           NASA FIRMS detections in kinetic zones
 *   GET /api/intel/events          GDELT violent events geolocated inside zones, last 24 h
 *
 * Why a server: publishers' RSS feeds and the FIRMS file don't allow
 * cross-origin browser requests, and GDELT rate-limits per IP. Here, one
 * process holds one GDELT queue for every open tab, caches results on disk,
 * and goes quiet 10 minutes after the last tab stops asking.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { HEATZONES } from "../src/data/heatzones";
import { NEWS_TERMS } from "../src/data/newsTerms";
import type { EventPlace, EventsPayload, FiresPayload, NewsPayload, SourceStatus, TrendsPayload, WireNewsItem, ZoneTrend } from "../src/intel/types";
import { FeedError, fetchGroup, fetchTimeline, mergeItems, NEWS_GROUPS, trendRatio, zoneQuery } from "../src/news/gdelt";
import { zonesForTitle } from "../src/news/match";
import {
  aggregate,
  buildEventRegions,
  EVENTS_BASE,
  EVENTS_PRODUCT,
  EVENTS_WINDOW_MS,
  parseExport,
  stampOf,
  stampTime,
  unzipFirst,
  warZoneIds,
  type EventRow,
} from "./events";
import { buildRegions, filterFires, FIRMS_PRODUCT, FIRMS_URL } from "./firms";
import { FEEDS, fetchFeed } from "./rss";

const RSS_TTL = 5 * 60_000;
const BAND_TTL = 15 * 60_000;
const TREND_TTL = 6 * 3_600_000;
const FOCUS_TREND_TTL = 60 * 60_000;
const FIRES_TTL = 60 * 60_000;
const GDELT_SPACING = 12_000;
const BACKOFF_START = 60_000;
const BACKOFF_MAX = 10 * 60_000;
const IDLE_MS = 10 * 60_000;
const MAX_AGE = 36 * 3_600_000;
const LOCAL_DAYS = 21;
const EVENTS_CHECK = 5 * 60_000;
const EVENTS_STEP = 15 * 60_000;
/** Outside the project tree, so cache writes never wake the dev server's file watcher (and OneDrive). */
const CACHE_FILE = join(tmpdir(), "signal-heat", "intel-cache-v2.json");
/** Holds filtered rows, so bump the version whenever the filter in events.ts changes. */
const EVENTS_CACHE_FILE = join(tmpdir(), "signal-heat", "events-cache-v2.json");

type Persisted = {
  gdeltItems: WireNewsItem[];
  bandAt: Record<string, number>;
  trends: Record<string, ZoneTrend>;
  nextAllowed: number;
  backoff: number;
  rssDaily: Record<string, Record<string, number>>;
  rssTotals: Record<string, number>;
  seenIds: Record<string, string>;
};

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

const status = (id: string, label: string): SourceStatus => ({ id, label, state: "pending", lastOkAt: null, message: null, count: 0 });

class IntelService {
  private lastClientAt = 0;
  private timer: NodeJS.Timeout | null = null;

  private rssItems: WireNewsItem[] = [];
  private rssAt = 0;
  private rssInflight: Promise<void> | null = null;
  private rssStatus = new Map(FEEDS.map((f) => [f.id, status(f.id, f.label)]));
  /** zone → UTC day → zone-tagged RSS headlines first seen that day. */
  private rssDaily: Record<string, Record<string, number>> = {};
  private rssTotals: Record<string, number> = {};
  private seenIds: Record<string, string> = {};

  private gdeltItems: WireNewsItem[] = [];
  private bandAt: Record<string, number> = {};
  private trends = new Map<string, ZoneTrend>();
  private gdeltStatus = status("gdelt", "GDELT (7 bands + trends)");
  private nextAllowed = 0;
  private backoff = 0;
  private gdeltBusy = false;
  private focus: { id: string; at: number } | null = null;

  private fires: FiresPayload | null = null;
  private firesAt = 0;
  private firesInflight: Promise<void> | null = null;
  private firesStatus = status("firms", FIRMS_PRODUCT);
  private regions = buildRegions(HEATZONES);

  /** 15-minute file stamp → filtered rows ([] for files that were empty or missing). */
  private eventFiles = new Map<string, EventRow[]>();
  private eventsAt = 0;
  private eventsInflight: Promise<void> | null = null;
  private eventsStatus = status("gdelt-events", EVENTS_PRODUCT);
  private eventPlaces: EventPlace[] | null = null;
  private eventRegions = buildEventRegions(HEATZONES);
  private warZones = warZoneIds(HEATZONES);

  constructor() {
    this.load();
    this.loadEvents();
  }

  /* ── lifecycle ── */

  private touch(): void {
    this.lastClientAt = Date.now();
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), 2_000);
      this.timer.unref();
    }
  }

  private tick(): void {
    if (Date.now() - this.lastClientAt > IDLE_MS) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (Date.now() - this.rssAt > RSS_TTL) void this.refreshRss();
    if (Date.now() - this.firesAt > FIRES_TTL) void this.refreshFires();
    if (Date.now() - this.eventsAt > EVENTS_CHECK) void this.refreshEvents();
    void this.gdeltStep();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* ── disk cache (GDELT only: it is the rate-limited source) ── */

  private load(): void {
    try {
      const p = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Partial<Persisted>;
      this.gdeltItems = Array.isArray(p.gdeltItems) ? p.gdeltItems : [];
      this.bandAt = p.bandAt ?? {};
      this.trends = new Map(Object.entries(p.trends ?? {}));
      this.nextAllowed = p.nextAllowed ?? 0;
      this.backoff = p.backoff ?? 0;
      this.rssDaily = p.rssDaily ?? {};
      this.rssTotals = p.rssTotals ?? {};
      this.seenIds = p.seenIds ?? {};
      if (this.gdeltItems.length || this.trends.size) {
        this.gdeltStatus = { ...this.gdeltStatus, state: "stale", count: this.gdeltItems.length, message: "from cache" };
      }
    } catch {
      /* first run */
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(CACHE_FILE), { recursive: true });
      const p: Persisted = {
        gdeltItems: this.gdeltItems,
        bandAt: this.bandAt,
        trends: Object.fromEntries(this.trends),
        nextAllowed: this.nextAllowed,
        backoff: this.backoff,
        rssDaily: this.rssDaily,
        rssTotals: this.rssTotals,
        seenIds: this.seenIds,
      };
      writeFileSync(CACHE_FILE, JSON.stringify(p));
    } catch {
      /* cache is an optimisation */
    }
  }

  /* ── RSS ── */

  private refreshRss(): Promise<void> {
    this.rssInflight ??= (async () => {
      this.rssAt = Date.now();
      const results = await Promise.all(
        FEEDS.map(async (f) => {
          try {
            const items = await fetchFeed(f, AbortSignal.timeout(15_000));
            this.rssStatus.set(f.id, { ...status(f.id, f.label), state: "ok", lastOkAt: Date.now(), count: items.length });
            return items;
          } catch (e) {
            const prev = this.rssStatus.get(f.id) ?? status(f.id, f.label);
            this.rssStatus.set(f.id, { ...prev, state: prev.lastOkAt ? "stale" : "error", message: e instanceof Error ? e.message : String(e) });
            return this.rssItems.filter((i) => i.groupId === f.id);
          }
        }),
      );
      this.rssItems = mergeItems([], results.flat(), MAX_AGE, 600);
      this.countRss(results.flat());
      this.save();
    })().finally(() => {
      this.rssInflight = null;
    });
    return this.rssInflight;
  }

  /**
   * Count each RSS headline once, on the UTC day this service first observed
   * it, for every zone it names. Feeds list only their latest items, so
   * counting by publish date would make older days look artificially quiet;
   * the backlog present at first contact is skipped for the same reason.
   */
  private countRss(items: readonly WireNewsItem[]): void {
    const now = Date.now();
    const day = dayKey(now);
    for (const it of items) {
      if (this.seenIds[it.id]) continue;
      this.seenIds[it.id] = day;
      if (now - it.seen > 36 * 3_600_000) continue;
      this.rssTotals[day] = (this.rssTotals[day] ?? 0) + 1;
      for (const z of zonesForTitle(it.title)) {
        const byDay = (this.rssDaily[z] ??= {});
        byDay[day] = (byDay[day] ?? 0) + 1;
      }
    }
    const cutoff = dayKey(Date.now() - LOCAL_DAYS * 86_400_000);
    const seenCutoff = dayKey(Date.now() - 4 * 86_400_000);
    for (const d of Object.keys(this.rssTotals)) if (d < cutoff) delete this.rssTotals[d];
    for (const byDay of Object.values(this.rssDaily)) for (const d of Object.keys(byDay)) if (d < cutoff) delete byDay[d];
    for (const [id, d] of Object.entries(this.seenIds)) if (d < seenCutoff) delete this.seenIds[id];
  }

  private localTrends(): { local: Record<string, ZoneTrend>; since: string | null } {
    const days = Object.keys(this.rssTotals).sort().slice(-14);
    const local: Record<string, ZoneTrend> = {};
    for (const [zone, byDay] of Object.entries(this.rssDaily)) {
      const series = days.map((d) => {
        const count = byDay[d] ?? 0;
        const total = this.rssTotals[d] ?? 0;
        return { d, count, share: total > 0 ? count / total : 0 };
      });
      const total = series.reduce((s, x) => s + x.count, 0);
      if (total > 0) local[zone] = { source: "rss", days: series, ratio: trendRatio(series), total, updatedAt: this.rssAt };
    }
    return { local, since: days[0] ?? null };
  }

  /* ── GDELT queue: bands, focused trend, background trends ── */

  private async gdeltStep(): Promise<void> {
    const now = Date.now();
    if (this.gdeltBusy || now < this.nextAllowed) return;

    const focus = this.focus && now - this.focus.at < 120_000 ? this.focus.id : null;
    const focusStale = focus && NEWS_TERMS[focus] && now - (this.trends.get(focus)?.updatedAt ?? 0) > FOCUS_TREND_TTL;
    const band = [...NEWS_GROUPS].sort((a, b) => (this.bandAt[a.id] ?? 0) - (this.bandAt[b.id] ?? 0))[0];
    const bandStale = band && now - (this.bandAt[band.id] ?? 0) > BAND_TTL;
    const trendZone = HEATZONES.map((z) => z.id)
      .filter((id) => NEWS_TERMS[id])
      .sort((a, b) => (this.trends.get(a)?.updatedAt ?? 0) - (this.trends.get(b)?.updatedAt ?? 0))[0];
    const trendStale = trendZone && now - (this.trends.get(trendZone)?.updatedAt ?? 0) > TREND_TTL;

    let job: (() => Promise<string>) | null = null;
    if (focusStale && focus) job = () => this.fetchTrend(focus);
    else if (bandStale && band)
      job = async () => {
        const got = await fetchGroup(band, AbortSignal.timeout(20_000));
        this.bandAt[band.id] = Date.now();
        const wire: WireNewsItem[] = got.map((n) => ({ ...n, source: n.country || n.domain, kind: "gdelt" }));
        this.gdeltItems = mergeItems(this.gdeltItems, wire, MAX_AGE, 500);
        return `band ${band.label}`;
      };
    else if (trendStale && trendZone) job = () => this.fetchTrend(trendZone);
    if (!job) return;

    this.gdeltBusy = true;
    try {
      const what = await job();
      this.backoff = 0;
      this.nextAllowed = Date.now() + GDELT_SPACING;
      this.gdeltStatus = { ...this.gdeltStatus, state: "ok", lastOkAt: Date.now(), message: what, count: this.gdeltItems.length };
    } catch (e) {
      this.backoff = this.backoff ? Math.min(this.backoff * 2, BACKOFF_MAX) : BACKOFF_START;
      this.nextAllowed = Date.now() + this.backoff;
      const kind = e instanceof FeedError ? e.kind : "network";
      this.gdeltStatus = {
        ...this.gdeltStatus,
        state: kind === "bad-response" ? "error" : "throttled",
        message: `${e instanceof Error ? e.message : String(e)} · retry in ${Math.round(this.backoff / 1000)}s`,
      };
    } finally {
      this.gdeltBusy = false;
      this.save();
    }
  }

  private async fetchTrend(zoneId: string): Promise<string> {
    const terms = NEWS_TERMS[zoneId] ?? [];
    const days = await fetchTimeline(zoneQuery(terms), AbortSignal.timeout(20_000));
    this.trends.set(zoneId, {
      source: "gdelt",
      days,
      ratio: trendRatio(days),
      total: days.reduce((s, d) => s + d.count, 0),
      updatedAt: Date.now(),
    });
    return `trend ${zoneId}`;
  }

  /* ── FIRMS ── */

  private refreshFires(): Promise<void> {
    this.firesInflight ??= (async () => {
      this.firesAt = Date.now();
      try {
        const res = await fetch(FIRMS_URL, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = filterFires(await res.text(), this.regions);
        this.firesStatus = { ...this.firesStatus, state: "ok", lastOkAt: Date.now(), message: null, count: parsed.points.length };
        this.fires = { ...parsed, generatedAt: Date.now(), source: this.firesStatus };
      } catch (e) {
        this.firesStatus = {
          ...this.firesStatus,
          state: this.fires ? "stale" : "error",
          message: e instanceof Error ? e.message : String(e),
        };
        if (this.fires) this.fires = { ...this.fires, source: this.firesStatus };
      }
    })().finally(() => {
      this.firesInflight = null;
    });
    return this.firesInflight;
  }

  /* ── GDELT event stream ── */

  private loadEvents(): void {
    try {
      const p = JSON.parse(readFileSync(EVENTS_CACHE_FILE, "utf8")) as { files?: Record<string, EventRow[]> };
      const cutoff = Date.now() - EVENTS_WINDOW_MS;
      for (const [stamp, rows] of Object.entries(p.files ?? {})) if (stampTime(stamp) >= cutoff) this.eventFiles.set(stamp, rows);
      if (this.eventFiles.size) this.eventsStatus = { ...this.eventsStatus, state: "stale", message: "from cache" };
    } catch {
      /* first run */
    }
  }

  private saveEvents(): void {
    try {
      mkdirSync(dirname(EVENTS_CACHE_FILE), { recursive: true });
      writeFileSync(EVENTS_CACHE_FILE, JSON.stringify({ files: Object.fromEntries(this.eventFiles) }));
    } catch {
      /* cache is an optimisation */
    }
  }

  /**
   * Find the newest 15-minute file, then fetch every file of the last 24 h
   * not yet held, newest first (so a cold start shows the latest hours soonest).
   */
  private refreshEvents(): Promise<void> {
    this.eventsInflight ??= (async () => {
      this.eventsAt = Date.now();
      try {
        const res = await fetch(`${EVENTS_BASE}lastupdate.txt`, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`lastupdate HTTP ${res.status}`);
        const latest = /(\d{14})\.export\.CSV\.zip/.exec(await res.text())?.[1];
        if (!latest) throw new Error("lastupdate: no export file listed");
        const cutoff = Date.now() - EVENTS_WINDOW_MS;
        for (const stamp of [...this.eventFiles.keys()]) if (stampTime(stamp) < cutoff) this.eventFiles.delete(stamp);
        const wanted: string[] = [];
        for (let t = stampTime(latest); t >= cutoff; t -= EVENTS_STEP) {
          const s = stampOf(t);
          if (!this.eventFiles.has(s)) wanted.push(s);
        }
        let fetched = 0;
        for (const stamp of wanted) {
          if (Date.now() - this.lastClientAt > IDLE_MS) break;
          const r = await fetch(`${EVENTS_BASE}${stamp}.export.CSV.zip`, { signal: AbortSignal.timeout(30_000) });
          // GDELT occasionally skips a slot; remember it as empty rather than retrying forever.
          const rows = r.ok ? parseExport(unzipFirst(Buffer.from(await r.arrayBuffer())).toString("utf8"), stampTime(stamp), this.eventRegions, this.warZones)
            : [];
          this.eventFiles.set(stamp, rows);
          this.eventPlaces = null;
          fetched++;
          if (fetched % 12 === 0) this.saveEvents();
          await new Promise((ok) => setTimeout(ok, 250));
        }
        const rows = [...this.eventFiles.values()].reduce((n, r) => n + r.length, 0);
        this.eventsStatus = {
          ...this.eventsStatus,
          state: "ok",
          lastOkAt: Date.now(),
          count: rows,
          message: null,
        };
        if (fetched) this.saveEvents();
      } catch (e) {
        this.eventsStatus = {
          ...this.eventsStatus,
          state: this.eventFiles.size ? "stale" : "error",
          message: e instanceof Error ? e.message : String(e),
        };
      }
    })().finally(() => {
      this.eventsInflight = null;
    });
    return this.eventsInflight;
  }

  private eventsPayload(): EventsPayload {
    this.eventPlaces ??= aggregate([...this.eventFiles.values()].flat());
    const stamps = [...this.eventFiles.keys()].sort();
    return {
      generatedAt: Date.now(),
      source: { ...this.eventsStatus, message: this.eventsInflight ? `backfilling · ${this.eventFiles.size} of ~96 files` : this.eventsStatus.message },
      windowHours: 24,
      since: stamps[0] ? stampTime(stamps[0]) : null,
      places: this.eventPlaces,
    };
  }

  /* ── HTTP ── */

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://local");
    this.touch();
    if (url.pathname === "/api/intel/news") {
      if (!this.rssItems.length) await Promise.race([this.refreshRss(), new Promise((r) => setTimeout(r, 9_000))]);
      const items = mergeItems(this.rssItems, this.gdeltItems, MAX_AGE, 700);
      const body: NewsPayload = {
        generatedAt: Date.now(),
        sources: [...this.rssStatus.values(), { ...this.gdeltStatus, count: this.gdeltItems.length }],
        items,
      };
      return send(res, body);
    }
    if (url.pathname === "/api/intel/trends") {
      const focus = url.searchParams.get("focus");
      if (focus) this.focus = { id: focus, at: Date.now() };
      const { local, since } = this.localTrends();
      const body: TrendsPayload = {
        generatedAt: Date.now(),
        source: this.gdeltStatus,
        zones: Object.fromEntries(this.trends),
        local,
        localSince: since,
        pending: HEATZONES.filter((z) => NEWS_TERMS[z.id] && !this.trends.has(z.id)).length,
      };
      return send(res, body);
    }
    if (url.pathname === "/api/intel/fires") {
      if (!this.fires) await Promise.race([this.refreshFires(), new Promise((r) => setTimeout(r, 25_000))]);
      const body: FiresPayload = this.fires ?? {
        generatedAt: Date.now(),
        source: this.firesStatus,
        windowHours: 24,
        product: FIRMS_PRODUCT,
        zones: [],
        points: [],
        counts: {},
      };
      return send(res, body);
    }
    if (url.pathname === "/api/intel/events") {
      if (!this.eventFiles.size) {
        void this.refreshEvents();
        // Give the newest files a moment to arrive on a cold start.
        await new Promise((r) => setTimeout(r, 6_000));
      }
      return send(res, this.eventsPayload());
    }
    res.statusCode = 404;
    res.end();
  }
}

function send(res: ServerResponse, body: unknown): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Vite plugin: the same endpoints under `vite` (dev) and `vite preview`. */
export function intelPlugin(): Plugin {
  let service: IntelService | null = null;
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/intel/")) return next();
    service ??= new IntelService();
    service.handle(req, res).catch((e: unknown) => {
      res.statusCode = 500;
      res.end(e instanceof Error ? e.message : "intel error");
    });
  };
  return {
    name: "signal-heat-intel",
    configureServer(server) {
      server.middlewares.use(handler);
      server.httpServer?.once("close", () => service?.dispose());
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
      server.httpServer.once("close", () => service?.dispose());
    },
  };
}
