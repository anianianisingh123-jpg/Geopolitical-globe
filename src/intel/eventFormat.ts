/** Display helpers for GDELT event places. */
import type { EventKind, EventPlace } from "./types";

export const KIND_LABEL: Record<EventKind, string> = {
  airstrike: "AIRSTRIKE",
  shelling: "SHELLING",
  bombing: "BOMBING",
  clash: "CLASH",
  assassination: "ASSASSINATION",
  abduction: "ABDUCTION",
  assault: "ASSAULT",
  "mass-violence": "MASS VIOLENCE",
  "ceasefire-breach": "CEASEFIRE BREACH",
};

/** "Kharkiv, Kharkivs'ka Oblast', Ukraine" → "Kharkiv"; "Gaza, Israel (general), Israel" → "Gaza". */
export const shortPlace = (name: string): string => (name.split(",")[0] ?? name).replace(/\s*\(general\)/i, "").trim() || name;

/** Place names GDELT gives as a whole region ("Donbass, Ukraine (general)") are only roughly located. */
export const isVague = (p: EventPlace): boolean => /\(general\)/i.test(p.name);

/** A readable headline from an article URL's slug, or the outlet's domain when the slug is an id. */
export function slugTitle(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname
      .split("/")
      .map((s) => decodeURIComponent(s).replace(/\.(s?html?|php|aspx?)$/i, ""))
      .filter((s) => /[a-z]/i.test(s) && (s.match(/[-_]/g)?.length ?? 0) >= 3);
    const best = parts.sort((a, b) => b.length - a.length)[0];
    if (!best) return u.hostname.replace(/^www\./, "");
    const words = best
      .replace(/[-_]+/g, " ")
      .replace(/\b[0-9a-f]{8,}\b|\b\d{5,}\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return url;
  }
}

export const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function agoShort(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
