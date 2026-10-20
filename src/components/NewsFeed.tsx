import { memo, useMemo, useState } from "react";
import { hhmm } from "../globe/format";
import { NEWS_GROUPS } from "../news/gdelt";
import type { FeedStatus, TaggedItem } from "../news/useNewsFeed";

type Filter = "geo" | "all" | "tagged" | "zone";

type Props = {
  items: readonly TaggedItem[];
  status: FeedStatus;
  zoneNames: ReadonlyMap<string, string>;
  codes: ReadonlyMap<string, string>;
  selectedId: string | null;
  onPickZone: (id: string) => void;
  sourcesLabel: string;
  limit?: number;
};

const GROUP_LABEL = new Map(NEWS_GROUPS.map((g) => [g.id, g.label]));

/**
 * Broad RSS desks carry sport, weather and human-interest stories. The default
 * view keeps headlines that name a zone, come from a GDELT geopolitical query,
 * or use the vocabulary of statecraft and conflict.
 */
const GEO_RE = new RegExp(
  "(?:^|[^p{L}])(?:" +
    [
      "war", "wars", "military", "army", "navy", "troops", "soldiers", "missile", "missiles", "drone", "drones", "strike", "strikes",
      "airstrike", "airstrikes", "shelling", "attack", "attacks", "ceasefire", "truce", "peace talks", "sanction", "sanctions", "nuclear",
      "coup", "junta", "rebel", "rebels", "militia", "militants", "insurgent", "insurgents", "invasion", "occupied", "hostage", "hostages",
      "refugee", "refugees", "border", "blockade", "tanker", "strait", "pipeline", "oil", "gas", "tariff", "tariffs", "embargo",
      "president", "prime minister", "foreign minister", "defence", "defense", "pentagon", "kremlin", "nato", "un security council",
      "security council", "diplomat", "diplomatic", "summit", "treaty", "election", "protest", "protests", "regime", "annex",
      "espionage", "cyberattack", "hackers", "intelligence",
    ].join("|") +
    ")(?![p{L}])",
  "iu",
);

const isGeo = (i: TaggedItem): boolean => i.zoneIds.length > 0 || i.kind === "gdelt" || GEO_RE.test(i.title);


const ago = (ms: number): string => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};

const STATE_LABEL: Record<FeedStatus["state"], string> = {
  idle: "STANDBY",
  loading: "LINKING",
  live: "LIVE",
  throttled: "THROTTLED",
  offline: "OFFLINE",
  error: "ERROR",
};

/** Open-source headlines, newest first, tagged with the zones they mention. */
export const NewsFeed = memo(function NewsFeed({ items, status, zoneNames, codes, selectedId, onPickZone, sourcesLabel, limit = 150 }: Props) {
  const [filter, setFilter] = useState<Filter>("geo");
  const effective: Filter = filter === "zone" && !selectedId ? "geo" : filter;
  const geoCount = useMemo(() => items.filter(isGeo).length, [items]);
  const shown = useMemo(() => {
    const f =
      effective === "tagged"
        ? items.filter((i) => i.zoneIds.length > 0)
        : effective === "zone" && selectedId
          ? items.filter((i) => i.zoneIds.includes(selectedId))
          : effective === "geo"
            ? items.filter(isGeo)
            : items;
    return f.slice(0, limit);
  }, [items, effective, selectedId, limit]);

  return (
    <section className="feed" aria-label="Live news feed">
      <header className="rail-h">
        <span className={`feed-dot feed-${status.state}`} aria-hidden />
        <span>OSINT FEED</span>
        <span className="rail-h-meta mono">
          {STATE_LABEL[status.state]} · {status.groupsFresh}/{status.groupsTotal} {sourcesLabel}
          {status.lastOkAt ? ` · ${hhmm(status.lastOkAt)}` : ""}
        </span>
      </header>
      <div className="feed-filters" role="group" aria-label="Feed filter">
        <button type="button" aria-pressed={effective === "geo"} onClick={() => setFilter("geo")} title="Zone-tagged, GDELT, or conflict/statecraft vocabulary">
          Geopolitical <span className="mono">{geoCount}</span>
        </button>
        <button type="button" aria-pressed={effective === "all"} onClick={() => setFilter("all")}>
          All <span className="mono">{items.length}</span>
        </button>
        <button type="button" aria-pressed={effective === "tagged"} onClick={() => setFilter("tagged")}>
          Tagged
        </button>
        <button type="button" aria-pressed={effective === "zone"} disabled={!selectedId} onClick={() => setFilter("zone")}>
          {selectedId ? (codes.get(selectedId) ?? "Selected") : "Selected"}
        </button>
      </div>
      <ol className="feed-list">
        {shown.length === 0 && (
          <li className="feed-empty mono">
            {status.state === "throttled" || status.state === "error"
              ? `Feed ${STATE_LABEL[status.state].toLowerCase()} — ${status.message ?? "retrying"}`
              : status.state === "offline"
                ? "Browser offline."
                : effective === "zone"
                  ? "No headlines mention this zone in the last 36 h."
                  : "Linking to GDELT…"}
          </li>
        )}
        {shown.map((n) => (
          <li key={n.id} className="feed-item">
            <div className="feed-meta mono">
              <span className="feed-time" title={new Date(n.seen).toUTCString()}>
                {hhmm(n.seen)}
              </span>
              <span className="feed-ago">−{ago(n.seen)}</span>
              <span className="feed-src" title={n.sources.join(", ")}>
                {n.kind === "rss" ? n.source : n.domain}
                {n.sources.length > 1 ? ` +${n.sources.length - 1}` : ""}
              </span>
              <span className="feed-country">{n.kind === "gdelt" ? (n.country || "GDELT").toUpperCase() : "RSS"}</span>
            </div>
            <a className="feed-title" href={n.url} target="_blank" rel="noopener noreferrer">
              {n.title}
            </a>
            <div className="feed-tags">
              {n.zoneIds.slice(0, 4).map((z) => (
                <button key={z} type="button" className="feed-tag mono" data-active={z === selectedId} onClick={() => onPickZone(z)} title={zoneNames.get(z)}>
                  {codes.get(z)} {zoneNames.get(z)?.split(/[·(]/)[0]?.trim()}
                </button>
              ))}
              {n.zoneIds.length === 0 && n.kind === "gdelt" && (
                <span className="feed-band mono">{GROUP_LABEL.get(n.groupId) ?? n.groupId}</span>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="feed-note mono">
        Open-source headlines (world-news RSS + GDELT); unverified, not scored. Tags mean a headline names a zone.
      </p>
    </section>
  );
});
