import { memo, useMemo } from "react";
import type { TrendsPayload, ZoneTrend } from "../intel/types";

/** Surge threshold for badges: recent coverage share at least 1.5× the prior baseline. */
export const SURGE = 1.5;
/** Ignore ratios built on almost no articles (GDELT counts articles; RSS counts headlines, far fewer). */
const MIN_TOTAL = { gdelt: 40, rss: 12 } as const;

export function surgeOf(t: ZoneTrend | undefined): number | null {
  if (!t || t.ratio === null || t.total < MIN_TOTAL[t.source]) return null;
  return t.ratio;
}

/** GDELT trend where available, otherwise the RSS headline-count trend. */
export function mergedTrends(p: TrendsPayload | null): Record<string, ZoneTrend> {
  return p ? { ...p.local, ...p.zones } : {};
}

export const fmtRatio = (r: number): string => `${r >= 10 ? r.toFixed(0) : r.toFixed(1)}×`;

/** 14 daily bars of coverage share; the last three days (the "recent" window) in gold. */
export function Sparkline({ trend, height = 38 }: { trend: ZoneTrend; height?: number }) {
  const max = Math.max(...trend.days.map((d) => d.share), 1e-12);
  const n = trend.days.length;
  const w = 100 / Math.max(n, 1);
  return (
    <svg className="spark" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label="Daily coverage share, last 14 days">
      {trend.days.map((d, i) => {
        const h = Math.max(1, (d.share / max) * (height - 2));
        return (
          <rect
            key={d.d}
            x={i * w + w * 0.15}
            y={height - h}
            width={w * 0.7}
            height={h}
            className={i >= n - 3 ? "spark-recent" : "spark-base"}
          >
            <title>
              {`${d.d.slice(0, 4)}-${d.d.slice(4, 6)}-${d.d.slice(6, 8)}: ${d.count} articles`}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

type MoversProps = {
  trends: TrendsPayload | null;
  zoneNames: ReadonlyMap<string, string>;
  codes: ReadonlyMap<string, string>;
  onPick: (id: string) => void;
};

/** Zones whose share of world coverage rose most over the last 3 days vs the 11 before. */
export const CoverageMovers = memo(function CoverageMovers({ trends, zoneNames, codes, onPick }: MoversProps) {
  const movers = useMemo(() => {
    if (!trends) return [];
    return Object.entries(mergedTrends(trends))
      .map(([id, t]) => ({ id, r: surgeOf(t), t }))
      .filter((m): m is { id: string; r: number; t: ZoneTrend } => m.r !== null)
      .sort((a, b) => b.r - a.r)
      .slice(0, 5);
  }, [trends]);
  const computed = trends ? Object.keys(trends.zones).length : 0;
  const localDays = trends ? Math.max(0, ...Object.values(trends.local).map((t) => t.days.length)) : 0;

  return (
    <section className="movers" aria-label="Coverage movers">
      <header className="rail-h">
        <span>COVERAGE MOVERS</span>
        <span className="rail-h-meta mono">
          {trends ? `GDELT ${computed}/${computed + trends.pending} · RSS ${localDays}D` : "LINKING"}
        </span>
      </header>
      {movers.length === 0 ? (
        <p className="movers-empty mono">
          {!trends
            ? "Waiting for the intel service…"
            : computed === 0 && localDays < 6
              ? `Building baselines: GDELT ${trends.source.state === "throttled" ? "is rate-limiting, retrying" : "queries one zone at a time"}; RSS history ${localDays} of 6+ days needed.`
              : "No zone above its baseline yet."}
        </p>
      ) : (
        <ol className="movers-list">
          {movers.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => onPick(m.id)} title={`${m.t.total} articles in 14 days`}>
                <span className="mono movers-code">{codes.get(m.id)}</span>
                <span className="movers-name">{zoneNames.get(m.id)?.split(/[·(]/)[0]?.trim()}</span>
                <span className={`mono movers-r${m.r >= SURGE ? " surge" : m.r < 0.7 ? " fade" : ""}`}>{fmtRatio(m.r)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
});
