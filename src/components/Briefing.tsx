import { m } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { agoShort, isVague, KIND_LABEL, shortPlace } from "../intel/eventFormat";
import type { FireCluster } from "../intel/fireClusters";
import type { EventPlace, EventsPayload } from "../intel/types";
import { fmtScore, type ScoredZone } from "../model/score";
import type { TaggedItem } from "../news/useNewsFeed";

type Props = {
  /** Previous session (ms), or null on a first visit. */
  lastVisit: number | null;
  callsign: string;
  onCallsign: (s: string) => void;
  showOnOpen: boolean;
  onShowOnOpen: (v: boolean) => void;
  /** null while loading; "off" when there is no intel service (static hosting). */
  events: EventsPayload | null | "off";
  clusters: readonly FireCluster[];
  items: readonly TaggedItem[];
  watchlist: readonly string[];
  byId: ReadonlyMap<string, ScoredZone>;
  codes: ReadonlyMap<string, string>;
  surges: ReadonlyMap<string, number>;
  compact: boolean;
  onPickEvent: (e: EventPlace) => void;
  onPickCluster: (c: FireCluster) => void;
  onSelectZone: (id: string) => void;
  onClose: () => void;
};

const SURGE = 1.5;

function greeting(d: Date): string {
  const h = d.getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** "SEP 29, 2026 · 23:39 LOCAL · 04:39Z" */
const stamp = (d: Date): string =>
  `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()} · ${d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })} LOCAL · ${d.toISOString().slice(11, 16)}Z`;

/**
 * The opening brief: what moved since the last session, where violence is
 * being reported, the largest heat, and the watchlist. Every row flies the
 * globe to the place.
 */
export function Briefing(p: Props) {
  const now = useMemo(() => new Date(), []);
  const since = p.lastVisit ?? now.getTime() - 24 * 3_600_000;
  const [editing, setEditing] = useState(false);
  const enterRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    enterRef.current?.focus({ preventScroll: true });
  }, []);

  const hot = useMemo(() => {
    if (!p.events || p.events === "off") return [];
    return [...p.events.places]
      .filter((e) => e.sources >= 2 && (!isVague(e) || e.sources >= 8))
      .sort((a, b) => b.sources + (b.last > since ? 3 : 0) - (a.sources + (a.last > since ? 3 : 0)) || b.last - a.last)
      .slice(0, 5);
  }, [p.events, since]);
  const newPlaces = p.events && p.events !== "off" ? p.events.places.filter((e) => e.first > since && e.sources >= 2).length : 0;

  const watch = p.watchlist.flatMap((id) => {
    const s = p.byId.get(id);
    if (!s) return [];
    const headlines = p.items.filter((n) => n.seen > since && n.zoneIds.includes(id)).length;
    const events = p.events && p.events !== "off" ? p.events.places.filter((e) => e.zoneId === id && e.sources >= 2).length : 0;
    return [{ s, headlines, events }];
  });

  const surging = [...p.surges.entries()]
    .filter(([, r]) => r >= SURGE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .flatMap(([id, r]) => (p.byId.get(id) ? [{ s: p.byId.get(id) as ScoredZone, r }] : []));

  return (
    <m.div
      className="brief-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={(e) => e.target === e.currentTarget && p.onClose()}
    >
      <m.section
        className={`brief${p.compact ? " brief-compact" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Opening brief"
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 10, opacity: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      >
        <div className="brief-class mono">BRIEF // OPEN SOURCE // FOR {p.callsign.toUpperCase()}</div>
        <header className="brief-head">
          <div className="brief-kicker mono">DAILY BRIEF · {stamp(now)}</div>
          <h2 className="brief-title">
            {greeting(now)},{" "}
            {editing ? (
              <input
                className="brief-callsign"
                defaultValue={p.callsign}
                maxLength={24}
                autoFocus
                aria-label="Callsign"
                onBlur={(e) => {
                  p.onCallsign(e.target.value.trim() || "Operator");
                  setEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  e.stopPropagation();
                }}
              />
            ) : (
              <button type="button" className="brief-name" onClick={() => setEditing(true)} title="Change callsign">
                {p.callsign}
              </button>
            )}
            .
          </h2>
          <p className="brief-sub">
            {p.lastVisit
              ? `Last on watch ${agoShort(p.lastVisit, now.getTime())}. ${newPlaces ? `${newPlaces} new place${newPlaces === 1 ? "" : "s"} reporting violence since then.` : "Here is what moved."}`
              : "First session. Here is the picture right now."}
          </p>
        </header>

        <section className="brief-sec">
          <h3 className="brief-h mono">WHERE IT IS HOT · REPORTED 24 H</h3>
          {p.events === "off" ? (
            <p className="brief-empty">Needs the local intel service (npm run dev).</p>
          ) : !p.events ? (
            <p className="brief-empty mono">Linking to the event stream…</p>
          ) : hot.length === 0 ? (
            <p className="brief-empty">No corroborated events yet; the stream is still filling its 24-hour window.</p>
          ) : (
            <ul className="brief-list">
              {hot.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => p.onPickEvent(e)}>
                    <span className="brief-tag mono" data-kind={e.kind}>
                      {KIND_LABEL[e.kind]}
                    </span>
                    <span className="brief-main">
                      {shortPlace(e.name)}
                      <span className="muted"> · {p.codes.get(e.zoneId)} {p.byId.get(e.zoneId)?.zone.name.split(/[·(]/)[0]?.trim()}</span>
                    </span>
                    <span className="brief-meta mono">
                      {e.first > since && p.lastVisit ? <b className="brief-new">NEW</b> : null}
                      {e.sources} src · {agoShort(e.last, now.getTime())}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {p.clusters.length > 0 && (
          <section className="brief-sec">
            <h3 className="brief-h mono">LARGEST HEAT · NASA FIRMS 24 H</h3>
            <ul className="brief-list">
              {p.clusters.slice(0, 2).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => p.onPickCluster(c)}>
                    <span className="brief-tag brief-tag-heat mono">{c.n} FIRES</span>
                    <span className="brief-main">
                      {c.near ?? "remote area"}
                      <span className="muted"> · {p.codes.get(c.zoneId)}</span>
                    </span>
                    <span className="brief-meta mono">{c.frp.toLocaleString()} MW</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="brief-sec">
          <h3 className="brief-h mono">YOUR WATCHLIST</h3>
          {watch.length === 0 ? (
            <p className="brief-empty">Pin zones with ＋ WATCH in a zone's panel and they are tracked here each time you open the app.</p>
          ) : (
            <ul className="brief-list">
              {watch.map(({ s, headlines, events }) => (
                <li key={s.zone.id}>
                  <button type="button" onClick={() => p.onSelectZone(s.zone.id)}>
                    <span className="brief-tag mono">{p.codes.get(s.zone.id)}</span>
                    <span className="brief-main">
                      {s.zone.name} <span className="muted">· {fmtScore(s.composite)}</span>
                    </span>
                    <span className="brief-meta mono">
                      {headlines ? `+${headlines} news` : "quiet"}
                      {events ? ` · ${events} events` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {surging.length > 0 && (
            <p className="brief-surge">
              <span className="mono">COVERAGE SURGING:</span>{" "}
              {surging.map(({ s, r }, i) => (
                <span key={s.zone.id}>
                  {i > 0 && ", "}
                  <button type="button" className="linkish" onClick={() => p.onSelectZone(s.zone.id)}>
                    {s.zone.name.split(/[·(]/)[0]?.trim()}
                  </button>{" "}
                  <span className="mono">{r.toFixed(1)}×</span>
                </span>
              ))}
            </p>
          )}
        </section>

        <footer className="brief-foot">
          <label className="brief-pref">
            <input type="checkbox" checked={p.showOnOpen} onChange={(e) => p.onShowOnOpen(e.target.checked)} />
            <span>Brief me when I open the app</span>
          </label>
          <button ref={enterRef} type="button" className="brief-enter" onClick={p.onClose}>
            Enter the map ⏎
          </button>
        </footer>
      </m.section>
    </m.div>
  );
}
