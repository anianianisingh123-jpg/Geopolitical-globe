/** Headline → named-site tagging: which towns, bases and crossings the live feed is naming right now. */
import type { Site } from "../data/sites";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export type SiteMatcher = { re: RegExp; byTerm: Map<string, string[]> } | null;

export function buildSiteMatcher(sites: readonly Site[]): SiteMatcher {
  const byTerm = new Map<string, string[]>();
  for (const s of sites) {
    if (s.match === false) continue;
    for (const t of [s.name, ...(s.aka ?? [])]) {
      const k = fold(t);
      if (k.length < 4) continue;
      const l = byTerm.get(k);
      if (l) l.push(s.id);
      else byTerm.set(k, [s.id]);
    }
  }
  if (!byTerm.size) return null;
  const terms = [...byTerm.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  return { re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.join("|")})(?![\\p{L}\\p{N}])`, "gu"), byTerm };
}

/** Site id → headlines (newest first) that name it, within `windowMs`. */
export function matchSites<T extends { title: string; seen: number }>(items: readonly T[], m: SiteMatcher, windowMs: number): Map<string, T[]> {
  const out = new Map<string, T[]>();
  if (!m) return out;
  const cutoff = Date.now() - windowMs;
  for (const n of items) {
    if (n.seen < cutoff) continue;
    const hit = new Set<string>();
    for (const x of fold(n.title).matchAll(m.re)) for (const id of m.byTerm.get(x[0]) ?? []) hit.add(id);
    for (const id of hit) {
      const l = out.get(id);
      if (l) l.push(n);
      else out.set(id, [n]);
    }
  }
  return out;
}

/** Headlines naming an arbitrary place (a clicked city), newest first. */
export function headlinesNaming<T extends { title: string }>(items: readonly T[], name: string, limit = 5): T[] {
  const k = fold(name);
  if (k.length < 3) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(k)}(?![\\p{L}\\p{N}])`, "u");
  const out: T[] = [];
  for (const n of items) {
    if (re.test(fold(n.title))) out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}
