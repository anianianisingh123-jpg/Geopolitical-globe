/**
 * Minimal RSS 2.0 / RDF / Atom reader for a fixed list of world-news feeds.
 * Runs in the local intel service (Node), because publishers' feeds don't
 * send CORS headers for browsers.
 */
import type { WireNewsItem } from "../src/intel/types";

export type Feed = { id: string; label: string; url: string };

/** World and security desks with public feeds (checked reachable Sept 2026). */
export const FEEDS: Feed[] = [
  { id: "bbc", label: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { id: "aljazeera", label: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { id: "guardian", label: "Guardian World", url: "https://www.theguardian.com/world/rss" },
  { id: "dw", label: "DW World", url: "https://rss.dw.com/xml/rss-en-world" },
  { id: "npr", label: "NPR World", url: "https://feeds.npr.org/1004/rss.xml" },
  { id: "france24", label: "France 24", url: "https://www.france24.com/en/rss" },
  { id: "un", label: "UN News", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml" },
  { id: "defensenews", label: "Defense News", url: "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml" },
  { id: "cnbc", label: "CNBC World", url: "https://www.cnbc.com/id/100727362/device/rss/rss.html" },
  { id: "sky", label: "Sky World", url: "https://feeds.skynews.com/feeds/rss/world.xml" },
  { id: "diplomat", label: "The Diplomat", url: "https://thediplomat.com/feed/" },
  { id: "rfi", label: "RFI English", url: "https://www.rfi.fr/en/rss" },
  { id: "globalnews", label: "Global News World", url: "https://globalnews.ca/world/feed/" },
];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m?.[1] ? decode(m[1]) : "";
}

function atomLink(block: string): string {
  const alt = /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(block) ?? /<link[^>]*href=["']([^"']+)["']/i.exec(block);
  return alt?.[1] ?? "";
}

const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function parseFeed(xml: string, feed: Feed): WireNewsItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const out: WireNewsItem[] = [];
  for (const b of blocks) {
    const title = tag(b, "title");
    const url = tag(b, "link") || atomLink(b) || tag(b, "guid");
    const when = tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "updated") || tag(b, "published");
    const seen = Date.parse(when);
    if (!title || !url.startsWith("http") || !Number.isFinite(seen)) continue;
    out.push({
      id: url,
      title,
      url,
      domain: domainOf(url),
      source: feed.label,
      country: "",
      seen: Math.min(seen, Date.now()),
      kind: "rss",
      groupId: feed.id,
      sources: [domainOf(url)],
    });
  }
  return out;
}

export async function fetchFeed(feed: Feed, signal: AbortSignal): Promise<WireNewsItem[]> {
  const res = await fetch(feed.url, {
    signal,
    headers: { "User-Agent": "SIGNAL-HEAT/1.0 (personal news dashboard; RSS reader)", Accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), feed);
}
