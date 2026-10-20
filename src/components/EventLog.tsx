import { memo } from "react";
import type { FeedEvent } from "../news/useNewsFeed";

const stamp = (ms: number): string => {
  const d = new Date(ms);
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((n) => String(n).padStart(2, "0")).join(":") + "Z";
};

/** Real events only: what the analyst changed and what the feed returned. */
export const EventLog = memo(function EventLog({ events }: { events: readonly FeedEvent[] }) {
  return (
    <section className="log" aria-label="Event log">
      <header className="rail-h">
        <span>EVENT LOG</span>
        <span className="rail-h-meta mono">{events.length}</span>
      </header>
      <ol className="log-list mono" aria-live="off">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <span className="log-t">{stamp(e.at)}</span>
            <span className="log-x">{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
});
