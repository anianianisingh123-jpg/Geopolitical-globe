/**
 * GDELT DOC 2.0 client. GDELT indexes worldwide online news in near real time
 * (15-minute cadence), needs no key, and serves CORS headers, so the static
 * app can query it directly from the browser.
 *
 * Etiquette: GDELT asks for at most one request every 5 seconds per client
 * and answers faster callers with HTTP 429 (without CORS headers, so the
 * browser reports a network error). The scheduler in useNewsFeed.ts spaces
 * requests well beyond that and backs off on any failure.
 */

export type NewsGroup = { id: string; label: string; query: string };

/** Rotating query groups, built from the zone set so the feed tracks what the globe tracks. */
export const NEWS_GROUPS: NewsGroup[] = [
  { id: "mena", label: "MENA", query: '("Strait of Hormuz" OR Iran OR Houthi OR "Red Sea" OR Hezbollah OR Gaza OR Syria OR Yemen)' },
  { id: "europe", label: "EUR", query: '(Ukraine OR NATO OR "Black Sea" OR Baltic OR Kaliningrad OR Belarus OR Moldova OR Kosovo)' },
  { id: "indopac", label: "INDO-PAC", query: '(Taiwan OR "South China Sea" OR "North Korea" OR Senkaku OR "Chinese military" OR Scarborough)' },
  { id: "africa", label: "AFR", query: '(Sudan OR Sahel OR "Burkina Faso" OR Mali OR M23 OR Somalia OR Ethiopia OR "Boko Haram")' },
  { id: "asia", label: "S/C ASIA", query: '(Kashmir OR Pakistan OR Myanmar OR Armenia OR Azerbaijan OR Afghanistan)' },
  { id: "statecraft", label: "STATECRAFT", query: '(sanctions OR "export controls" OR "rare earth" OR "shadow fleet" OR "Suez Canal" OR "Panama Canal" OR LNG)' },
  { id: "americas", label: "AMER/ARCTIC", query: "(Venezuela OR Haiti OR Greenland OR Arctic OR Svalbard OR Cuba)" },
];

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  domain: string;
  country: string;
  seen: number;
  groupId: string;
  /** Outlets (domains) that carried the same headline in this window. */
  sources: string[];
};

type GdeltArticle = {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  domain?: unknown;
  sourcecountry?: unknown;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** "20260929T220000Z" → epoch ms. */
function parseSeen(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return Date.now();
  const [, y, mo, d, h, mi, se] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** GDELT tokenises titles ("Oct . 4th", "Bolsonaro ? Brazil"); undo that and drop outlet suffixes. */
export function cleanTitle(raw: string, domain: string): string {
  let s = raw
    .replace(/\s+([,.;:?!%)\]'’])/g, "$1")
    .replace(/([(\[‘])\s+/g, "$1")
    .replace(/\s+-\s+(?=[a-z])/g, "-")
    .replace(/\s{2,}/g, " ")
    .trim();
  s = s.replace(/\s+\|\s+[^|]{2,70}$/, "");
  const dash = s.lastIndexOf(" - ");
  if (dash > 20) {
    const tail = squash(s.slice(dash + 3));
    const dom = squash(domain.replace(/^www\./, "").replace(/\.[a-z.]+$/, ""));
    if (tail.length >= 4 && (dom.includes(tail) || tail.includes(dom))) s = s.slice(0, dash);
  }
  return s.trim();
}

export class FeedError extends Error {
  constructor(
    message: string,
    readonly kind: "throttled" | "network" | "bad-response",
  ) {
    super(message);
  }
}

export async function fetchGroup(group: NewsGroup, signal: AbortSignal): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    query: `${group.query} sourcelang:english`,
    mode: "artlist",
    format: "json",
    maxrecords: "60",
    sort: "hybridrel",
    timespan: "24h",
  });
  let res: Response;
  try {
    res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { signal });
  } catch (e) {
    if (signal.aborted) throw e;
    // A 429 arrives without CORS headers and surfaces here as a network error.
    throw new FeedError("GDELT unreachable or throttling", "network");
  }
  if (res.status === 429) throw new FeedError("GDELT rate limit", "throttled");
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FeedError(text.slice(0, 120) || `HTTP ${res.status}`, text.includes("limit requests") ? "throttled" : "bad-response");
  }
  const articles = (body as { articles?: unknown }).articles;
  if (!Array.isArray(articles)) return [];
  return (articles as GdeltArticle[])
    .map((a) => {
      const domain = str(a.domain);
      return {
        id: str(a.url),
        title: cleanTitle(str(a.title), domain),
        url: str(a.url),
        domain,
        country: str(a.sourcecountry),
        seen: parseSeen(str(a.seendate)),
        groupId: group.id,
        sources: [domain],
      };
    })
    .filter((n) => n.url.startsWith("http") && n.title.length >= 24);
}

/** Merge new items, collapsing identical headlines from syndicated outlets. */
export function mergeItems<T extends Pick<NewsItem, "id" | "title" | "seen" | "sources">>(
  existing: readonly T[],
  incoming: readonly T[],
  maxAgeMs: number,
  cap: number,
): T[] {
  // Collapse by headline (syndication) and by URL (one article listed in two feeds under different titles).
  const byTitle = new Map<string, T>();
  const byId = new Map<string, T>();
  const cutoff = Date.now() - maxAgeMs;
  for (const n of [...existing, ...incoming]) {
    if (n.seen < cutoff) continue;
    const key = squash(n.title).slice(0, 90);
    const prev = byTitle.get(key) ?? byId.get(n.id);
    if (!prev) {
      const copy = { ...n, sources: [...n.sources] };
      byTitle.set(key, copy);
      byId.set(n.id, copy);
    } else {
      for (const d of n.sources) if (!prev.sources.includes(d) && prev.sources.length < 12) prev.sources.push(d);
      if (n.seen < prev.seen) prev.seen = n.seen;
    }
  }
  return [...new Set(byTitle.values())].sort((a, b) => b.seen - a.seen).slice(0, cap);
}

/* ───────────────────────── coverage timelines ───────────────────────── */

export type TimelineDay = { d: string; count: number; share: number };

type RawPoint = { date?: unknown; value?: unknown; norm?: unknown };

/** GDELT query for a zone: its headline terms, phrase-quoted, OR-ed (GDELT rejects very long queries, so cap at 8). */
export function zoneQuery(terms: readonly string[]): string {
  const parts = terms
    .filter((t) => t.length >= 3)
    .slice(0, 8)
    .map((t) => (/[\s-]/.test(t) ? `"${t}"` : t));
  return parts.length > 1 ? `(${parts.join(" OR ")})` : (parts[0] ?? "");
}

/**
 * Daily article counts for a query over 14 days (GDELT "timelinevolraw"),
 * with each day's share of all articles GDELT monitored, so a quiet news day
 * globally doesn't read as a fall in attention.
 */
export async function fetchTimeline(query: string, signal: AbortSignal): Promise<TimelineDay[]> {
  const params = new URLSearchParams({
    query: `${query} sourcelang:english`,
    mode: "timelinevolraw",
    format: "json",
    timespan: "14d",
  });
  let res: Response;
  try {
    res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new FeedError("GDELT unreachable or throttling", "network");
  }
  if (res.status === 429) throw new FeedError("GDELT rate limit", "throttled");
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FeedError(text.slice(0, 120) || `HTTP ${res.status}`, text.includes("limit requests") ? "throttled" : "bad-response");
  }
  const series = (body as { timeline?: { data?: RawPoint[] }[] }).timeline?.[0]?.data;
  if (!Array.isArray(series)) return [];
  const byDay = new Map<string, { count: number; norm: number }>();
  for (const p of series) {
    const date = typeof p.date === "string" ? p.date.replace(/[^0-9]/g, "").slice(0, 8) : "";
    if (date.length !== 8) continue;
    const day = byDay.get(date) ?? { count: 0, norm: 0 };
    day.count += typeof p.value === "number" ? p.value : 0;
    day.norm += typeof p.norm === "number" ? p.norm : 0;
    byDay.set(date, day);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([d, v]) => ({ d, count: v.count, share: v.norm > 0 ? v.count / v.norm : 0 }));
}

/** Last 3 days vs the days before, on share of coverage. */
export function trendRatio(days: readonly TimelineDay[]): number | null {
  if (days.length < 6) return null;
  const recent = days.slice(-3);
  const base = days.slice(0, -3);
  const mean = (xs: readonly TimelineDay[]) => xs.reduce((s, x) => s + x.share, 0) / xs.length;
  const b = mean(base);
  return b > 0 ? mean(recent) / b : null;
}
