import { useEffect, useMemo, useRef, useState } from "react";
import { zonesForTitle } from "./match";
import type { WireNewsItem } from "../intel/types";
import { FeedError, fetchGroup, mergeItems, NEWS_GROUPS, type NewsItem } from "./gdelt";

/** GDELT refreshes every 15 minutes; asking more often only returns cached results. */
const GROUP_TTL_MS = 15 * 60_000;
/** GDELT documents a 5 s floor but penalises bursts for longer; one request per 20 s during the initial fill. */
const MIN_SPACING_MS = 20_000;
const BACKOFF_START_MS = 90_000;
const BACKOFF_MAX_MS = 10 * 60_000;
const MAX_AGE_MS = 36 * 3_600_000;
const MAX_ITEMS = 400;
const CACHE_KEY = "signal-heat:news:v1";

export type FeedState = "idle" | "loading" | "live" | "throttled" | "offline" | "error";

export type FeedStatus = {
  state: FeedState;
  lastOkAt: number | null;
  nextAt: number | null;
  message: string | null;
  groupsFresh: number;
  groupsTotal: number;
};

export type TaggedItem = WireNewsItem & { zoneIds: string[] };

export type FeedEvent = { at: number; text: string };

/**
 * Persisted across reloads, including request timing, so reloading the page
 * never produces a burst of requests or skips a backoff GDELT asked for.
 */
type Cache = {
  items: NewsItem[];
  fetchedAt: Record<string, number>;
  lastRequestAt: number;
  backoffMs: number;
  holdUntil: number;
};

const EMPTY: Cache = { items: [], fetchedAt: {}, lastRequestAt: 0, backoffMs: 0, holdUntil: 0 };
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<Cache>;
    return {
      items: Array.isArray(parsed.items) ? parsed.items.filter((i) => Array.isArray(i.sources)) : [],
      fetchedAt: parsed.fetchedAt ?? {},
      lastRequestAt: num(parsed.lastRequestAt),
      backoffMs: num(parsed.backoffMs),
      holdUntil: num(parsed.holdUntil),
    };
  } catch {
    return { ...EMPTY };
  }
}

function writeCache(c: Cache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage full or blocked: the feed still works, it just refetches on reload */
  }
}

export { zonesForTitle };

/**
 * Rotating, rate-limited poll of GDELT. One request at a time, groups
 * refreshed oldest-first, paused while the tab is hidden, backed off on any
 * failure, and cached in localStorage so a reload doesn't re-hit the API.
 */
/**
 * Browser-side GDELT fallback, used only when the local intel service is absent
 * (static hosting). Pass enabled=false to keep it idle.
 */
export function useNewsFeed(enabled: boolean, onEvent: (e: FeedEvent) => void): { items: TaggedItem[]; status: FeedStatus } {
  const initial = useMemo(readCache, []);
  const [items, setItems] = useState<NewsItem[]>(() => mergeItems([], initial.items, MAX_AGE_MS, MAX_ITEMS));
  const [status, setStatus] = useState<FeedStatus>(() => ({
    state: initial.items.length ? "live" : "idle",
    lastOkAt: Math.max(0, ...Object.values(initial.fetchedAt)) || null,
    nextAt: null,
    message: null,
    groupsFresh: 0,
    groupsTotal: NEWS_GROUPS.length,
  }));
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const cache: Cache = { ...initial, fetchedAt: { ...initial.fetchedAt } };
    let timer = 0;

    const fresh = () => NEWS_GROUPS.filter((g) => Date.now() - (cache.fetchedAt[g.id] ?? 0) < GROUP_TTL_MS).length;

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      const at = Date.now() + delay;
      setStatus((s) => ({ ...s, nextAt: at, groupsFresh: fresh() }));
      timer = window.setTimeout(step, delay);
    };

    const step = async () => {
      if (ctrl.signal.aborted) return;
      if (document.hidden) {
        // Paused while hidden; visibilitychange resumes sooner, this is the fallback.
        schedule(30_000);
        return;
      }
      if (!navigator.onLine) {
        setStatus((s) => ({ ...s, state: "offline", message: "browser offline" }));
        schedule(60_000);
        return;
      }
      const stalest = [...NEWS_GROUPS].sort((a, b) => (cache.fetchedAt[a.id] ?? 0) - (cache.fetchedAt[b.id] ?? 0))[0];
      if (!stalest) return;
      const age = Date.now() - (cache.fetchedAt[stalest.id] ?? 0);
      if (age < GROUP_TTL_MS) {
        schedule(GROUP_TTL_MS - age + 1_000);
        return;
      }
      const wait = Math.max(cache.lastRequestAt + MIN_SPACING_MS, cache.holdUntil) - Date.now();
      if (wait > 0) {
        if (cache.holdUntil > Date.now())
          setStatus((s) => ({ ...s, state: "throttled", message: `backing off, retry ${Math.ceil(wait / 1000)}s` }));
        schedule(wait);
        return;
      }

      cache.lastRequestAt = Date.now();
      writeCache(cache);
      setStatus((s) => ({ ...s, state: s.state === "idle" ? "loading" : s.state, message: `querying ${stalest.label}` }));
      try {
        const got = await fetchGroup(stalest, ctrl.signal);
        cache.backoffMs = 0;
        cache.holdUntil = 0;
        cache.fetchedAt[stalest.id] = Date.now();
        cache.items = mergeItems(cache.items, got, MAX_AGE_MS, MAX_ITEMS);
        writeCache(cache);
        setItems(cache.items);
        const matched = got.filter((n) => zonesForTitle(n.title).length > 0).length;
        onEventRef.current({ at: Date.now(), text: `FEED ${stalest.label} · ${got.length} ITEMS · ${matched} ZONE-TAGGED` });
        setStatus((s) => ({ ...s, state: "live", lastOkAt: Date.now(), message: null }));
        schedule(MIN_SPACING_MS);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        cache.backoffMs = cache.backoffMs ? Math.min(cache.backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_START_MS;
        cache.holdUntil = Date.now() + cache.backoffMs;
        writeCache(cache);
        const kind = e instanceof FeedError ? e.kind : "network";
        onEventRef.current({ at: Date.now(), text: `FEED ${stalest.label} · ${kind.toUpperCase()} · RETRY ${Math.round(cache.backoffMs / 1000)}S` });
        setStatus((s) => ({
          ...s,
          state: kind === "bad-response" ? "error" : "throttled",
          message: e instanceof Error ? e.message : String(e),
        }));
        schedule(cache.backoffMs);
      }
    };

    const onVisible = () => {
      if (!document.hidden) schedule(1_000);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    schedule(800);

    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [initial, enabled]);

  const tagged = useMemo<TaggedItem[]>(
    () => items.map((n) => ({ ...n, source: n.country || n.domain, kind: "gdelt" as const, zoneIds: zonesForTitle(n.title) })),
    [items],
  );
  return { items: tagged, status };
}
