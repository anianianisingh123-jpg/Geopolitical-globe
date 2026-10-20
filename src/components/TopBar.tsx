import { AnimatePresence, m } from "framer-motion";
import { useState, type RefObject } from "react";
import type { ScenarioId } from "../data/schema";
import type { ScoredZone } from "../model/score";
import type { SortKey } from "../state/viewState";
import { WorldClocks } from "./WorldClocks";
import { ZoneList } from "./ZoneList";

type Props = {
  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  sort: SortKey;
  risingOnly: boolean;
  scenario: ScenarioId;
  results: readonly ScoredZone[];
  selectedId: string | null;
  scenarioActive: boolean;
  compact: boolean;
  callsign: string;
  onQuery: (q: string) => void;
  onSort: (s: SortKey) => void;
  onRising: () => void;
  onScenario: (s: ScenarioId) => void;
  onPick: (id: string) => void;
  onBrief: () => void;
};

export function TopBar(p: Props) {
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(0);
  const open = !p.compact && (focused || p.query.length > 0);

  const pick = (id: string) => {
    p.onPick(id);
    p.onQuery("");
    p.searchRef.current?.blur();
  };

  return (
    <>
      <div className="classbar mono" role="note">
        <span className="classbar-station">STATION // {p.callsign.toUpperCase()}</span>
        <span className="classbar-sep" aria-hidden>
          ·
        </span>
        <span>
          UNCLASSIFIED // OPEN SOURCE
          <span className="classbar-long"> // ANALYST COMPOSITE</span>
        </span>
      </div>
      <header className="topbar">
        <div className="brand" aria-label="SIGNAL // HEAT">
          <span className="brand-dot" aria-hidden />
          <span className="brand-name">SIGNAL</span>
          <span className="brand-sep">//</span>
          <span className="brand-name">HEAT</span>
        </div>

        <div className="search" role="search">
          <input
            ref={p.searchRef}
            type="search"
            value={p.query}
            placeholder="Find a zone"
            aria-label="Search zones"
            aria-expanded={open}
            aria-controls="search-results"
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onChange={(e) => {
              p.onQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, p.results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const hit = p.results[cursor];
                if (hit) pick(hit.zone.id);
              } else if (e.key === "Escape") {
                p.onQuery("");
                e.currentTarget.blur();
              }
            }}
          />
          <kbd className="search-kbd" aria-hidden>
            /
          </kbd>
          <AnimatePresence>
            {open && (
              <m.div
                id="search-results"
                className="search-results"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14 }}
              >
                <ZoneList
                  zones={p.results}
                  selectedId={p.selectedId}
                  cursorId={p.results[cursor]?.zone.id ?? null}
                  scenarioActive={p.scenarioActive}
                  onPick={pick}
                  dense
                />
              </m.div>
            )}
          </AnimatePresence>
        </div>

        <WorldClocks compact={p.compact} />

        <div className="topbar-controls">
          <button type="button" className="chip chip-brief" onClick={p.onBrief} title="Open the brief (B)">
            Brief
          </button>
          <div className="seg seg-scenario" role="group" aria-label="Scenario">
            <button type="button" aria-pressed={p.scenario === "baseline"} onClick={() => p.onScenario("baseline")}>
              Baseline
            </button>
            <button
              type="button"
              className="seg-escalation"
              aria-pressed={p.scenario === "escalation"}
              onClick={() => p.onScenario("escalation")}
            >
              Escalation
            </button>
          </div>
          {!p.compact && (
            <div className="topbar-more" role="group" aria-label="List filters">
              <button type="button" className="chip chip-quiet" aria-pressed={p.sort === "name"} onClick={() => p.onSort(p.sort === "name" ? "score" : "name")} title="Toggle A–Z sort">
                {p.sort === "name" ? "A–Z" : "Score"}
              </button>
              <button type="button" className="chip chip-quiet" aria-pressed={p.risingOnly} onClick={p.onRising} title="Rising zones only">
                Rising
              </button>
            </div>
          )}
        </div>
      </header>
    </>
  );
}
