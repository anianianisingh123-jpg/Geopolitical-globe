/**
 * Wire types for the local intel service (server/intel.ts), shared by the
 * Vite dev/preview middleware and the browser.
 */

export type SourceState = "pending" | "ok" | "stale" | "throttled" | "error";

export type SourceStatus = {
  id: string;
  label: string;
  state: SourceState;
  lastOkAt: number | null;
  message: string | null;
  count: number;
};

export type WireNewsItem = {
  id: string;
  title: string;
  url: string;
  domain: string;
  /** Publisher label for RSS items ("BBC World"), GDELT source country otherwise. */
  source: string;
  country: string;
  seen: number;
  kind: "rss" | "gdelt";
  /** GDELT query band, or the RSS feed id. */
  groupId: string;
  sources: string[];
};

export type NewsPayload = {
  generatedAt: number;
  sources: SourceStatus[];
  items: WireNewsItem[];
};

export type TrendDay = { d: string; count: number; share: number };

export type ZoneTrend = {
  /** gdelt: 14-day GDELT volume; rss: zone-tagged headlines from the RSS desks, counted by this service since it first ran. */
  source: "gdelt" | "rss";
  days: TrendDay[];
  /** Mean share over the last 3 days ÷ mean share over the 11 days before; null when the baseline is empty. */
  ratio: number | null;
  total: number;
  updatedAt: number;
};

export type TrendsPayload = {
  generatedAt: number;
  source: SourceStatus;
  zones: Record<string, ZoneTrend>;
  /** Fallback trends from RSS headline counts, per zone. */
  local: Record<string, ZoneTrend>;
  /** First UTC day (YYYYMMDD) of RSS history, or null. */
  localSince: string | null;
  pending: number;
};

/** [lat, lng, frp (MW), zone index] */
export type FirePoint = [number, number, number, number];

/** Event types kept from the GDELT stream (CAMEO roots 18 assault, 19 fight, 20 mass violence). */
export type EventKind = "airstrike" | "shelling" | "bombing" | "clash" | "assassination" | "abduction" | "assault" | "mass-violence" | "ceasefire-breach";

/** One place, with every violent event GDELT geolocated there in the window. */
export type EventPlace = {
  id: string;
  lat: number;
  lng: number;
  /** "Kharkiv, Kharkivs'ka Oblast', Ukraine" as GDELT names it. */
  name: string;
  zoneId: string;
  /** Events coded at this place (one article can yield several). */
  n: number;
  /** Distinct source articles. */
  sources: number;
  /** Most frequent kind, and the count per kind. */
  kind: EventKind;
  kinds: Partial<Record<EventKind, number>>;
  first: number;
  last: number;
  /** Most recent distinct article URLs (up to 6). */
  urls: string[];
};

export type EventsPayload = {
  generatedAt: number;
  source: SourceStatus;
  windowHours: number;
  /** Time of the oldest 15-minute file included. */
  since: number | null;
  places: EventPlace[];
};

export type FiresPayload = {
  generatedAt: number;
  source: SourceStatus;
  windowHours: number;
  product: string;
  zones: string[];
  points: FirePoint[];
  counts: Record<string, { n: number; frp: number }>;
};
