import { useEffect, useMemo, useRef, useState } from "react";
import { zonesForTitle, type FeedEvent, type FeedStatus, type TaggedItem } from "../news/useNewsFeed";
import type { EventsPayload, FiresPayload, NewsPayload, SourceStatus, TrendsPayload } from "./types";

const NEWS_POLL_MS = 60_000;
const TRENDS_POLL_MS = 120_000;
const FIRES_POLL_MS = 10 * 60_000;
/** GDELT publishes every 15 min; polling faster only matters while the service backfills its first 24 h. */
const EVENTS_POLL_MS = 3 * 60_000;

/** "checking" until the first probe; "server" when intel answers; "direct" otherwise (browser GDELT fallback). */
export type IntelMode = "checking" | "server" | "direct";

export type IntelState = {
  mode: IntelMode;
  items: TaggedItem[];
  status: FeedStatus;
  sources: SourceStatus[];
  trends: TrendsPayload | null;
  fires: FiresPayload | null;
  events: EventsPayload | null;
};

/**
 * Where to pull intel from:
 * - VITE_INTEL_URL → live Node process (absolute origin)
 * - VITE_INTEL_STATIC=1 → JSON snapshots next to the site (GitHub Pages)
 * - otherwise same-origin /api/intel/* (vite dev / preview plugin)
 */
function intelUrl(endpoint: "news" | "trends" | "fires" | "events", focus?: string | null): string {
  const remote = (import.meta.env.VITE_INTEL_URL as string | undefined)?.replace(/\/$/, "");
  if (remote) {
    const q = endpoint === "trends" && focus ? `?focus=${encodeURIComponent(focus)}` : "";
    return `${remote}/api/intel/${endpoint}${q}`;
  }
  if (import.meta.env.VITE_INTEL_STATIC === "1") {
    return `${import.meta.env.BASE_URL}api/intel/${endpoint}.json`;
  }
  const q = endpoint === "trends" && focus ? `?focus=${encodeURIComponent(focus)}` : "";
  return `/api/intel/${endpoint}${q}`;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function feedStatus(sources: readonly SourceStatus[]): FeedStatus {
  const ok = sources.filter((s) => s.state === "ok" || s.state === "stale");
  const throttled = sources.some((s) => s.state === "throttled");
  return {
    state: ok.length ? "live" : throttled ? "throttled" : sources.length ? "error" : "loading",
    lastOkAt: Math.max(0, ...sources.map((s) => s.lastOkAt ?? 0)) || null,
    nextAt: null,
    message: ok.length ? null : (sources.find((s) => s.message)?.message ?? null),
    groupsFresh: ok.length,
    groupsTotal: sources.length,
  };
}

/**
 * Polls intel (news every minute, coverage trends every two, fires every ten),
 * paused while the tab is hidden. If intel isn't there, reports mode "direct"
 * so the caller can fall back to querying GDELT from the browser.
 */
export function useIntel(focusId: string | null, onEvent: (e: FeedEvent) => void): IntelState {
  const [mode, setMode] = useState<IntelMode>("checking");
  const [news, setNews] = useState<NewsPayload | null>(null);
  const [trends, setTrends] = useState<TrendsPayload | null>(null);
  const [fires, setFires] = useState<FiresPayload | null>(null);
  const [events, setEvents] = useState<EventsPayload | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const focusRef = useRef(focusId);
  focusRef.current = focusId;
  const pollTrendsRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const ctrl = new AbortController();
    const timers: number[] = [];
    let lastIds = new Set<string>();
    let lastTrendCount = -1;

    const pollNews = async () => {
      try {
        const n = await getJson<NewsPayload>(intelUrl("news"), ctrl.signal);
        setMode("server");
        setNews(n);
        const fresh = n.items.filter((i) => !lastIds.has(i.id)).length;
        const ok = n.sources.filter((s) => s.state === "ok").length;
        if (lastIds.size === 0 || fresh > 0)
          onEventRef.current({
            at: Date.now(),
            text: `FEED ${ok}/${n.sources.length} SOURCES · ${n.items.length} ITEMS${lastIds.size ? ` · +${fresh} NEW` : ""}`,
          });
        lastIds = new Set(n.items.map((i) => i.id));
      } catch {
        if (ctrl.signal.aborted) return;
        setMode((m) => (m === "server" ? m : "direct"));
      }
    };

    const pollTrends = async () => {
      try {
        const t = await getJson<TrendsPayload>(intelUrl("trends", focusRef.current), ctrl.signal);
        setTrends(t);
        const count = Object.keys(t.zones).length;
        if (count !== lastTrendCount && count > 0 && (lastTrendCount < 0 || count % 10 === 0 || t.pending === 0))
          onEventRef.current({ at: Date.now(), text: `COVERAGE TRENDS ${count}/${count + t.pending} ZONES · GDELT 14D` });
        lastTrendCount = count;
      } catch {
        /* trends are optional */
      }
    };
    pollTrendsRef.current = () => void pollTrends();

    const pollFires = async () => {
      try {
        const f = await getJson<FiresPayload>(intelUrl("fires"), ctrl.signal);
        setFires(f);
        if (f.source.state === "ok")
          onEventRef.current({
            at: Date.now(),
            text: `FIRMS VIIRS 24H · ${f.points.length} DETECTIONS · ${Object.keys(f.counts).length} ZONES`,
          });
      } catch {
        /* fires are optional */
      }
    };

    let lastEventPlaces = -1;
    const pollEvents = async () => {
      try {
        const e = await getJson<EventsPayload>(intelUrl("events"), ctrl.signal);
        setEvents(e);
        const strong = e.places.filter((p) => p.sources >= 2).length;
        if (strong !== lastEventPlaces)
          onEventRef.current({ at: Date.now(), text: `EVENTS GDELT 24H · ${e.places.length} PLACES · ${strong} CORROBORATED (2+ SOURCES)` });
        lastEventPlaces = strong;
      } catch {
        /* events are optional */
      }
    };

    const every = (fn: () => Promise<void>, ms: number) => {
      void fn();
      timers.push(
        window.setInterval(() => {
          if (!document.hidden) void fn();
        }, ms),
      );
    };

    void pollNews().then(() => {
      if (ctrl.signal.aborted) return;
      every(pollTrends, TRENDS_POLL_MS);
      every(pollFires, FIRES_POLL_MS);
      every(pollEvents, EVENTS_POLL_MS);
    });
    timers.push(
      window.setInterval(() => {
        if (!document.hidden) void pollNews();
      }, NEWS_POLL_MS),
    );

    return () => {
      ctrl.abort();
      timers.forEach((t) => window.clearInterval(t));
    };
  }, []);

  // A newly selected zone asks a live service to prioritise its trend (no-op for static snapshots).
  useEffect(() => {
    if (focusId && mode === "server" && import.meta.env.VITE_INTEL_STATIC !== "1") pollTrendsRef.current();
  }, [focusId, mode]);

  const items = useMemo<TaggedItem[]>(() => (news ? news.items.map((n) => ({ ...n, zoneIds: zonesForTitle(n.title) })) : []), [news]);
  const sources = news?.sources ?? [];
  const status = useMemo(() => feedStatus(sources), [sources]);

  return { mode, items, status, sources, trends, fires, events };
}
