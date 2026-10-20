/** Headline → zone tagging, shared by the browser and the local intel service. */
import { NEWS_TERMS } from "../data/newsTerms";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MATCHERS: [string, RegExp][] = Object.entries(NEWS_TERMS).map(([id, terms]) => [
  id,
  new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${terms.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "iu"),
]);

export function zonesForTitle(title: string): string[] {
  return MATCHERS.filter(([, re]) => re.test(title)).map(([id]) => id);
}
