import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { fmtScore } from "../model/score";
import { fmtLat, fmtLng } from "./format";
import type { Resolution } from "./geo";

export type HudHandle = {
  /** Every frame: projected globe centre and radius in CSS px. */
  frame(t: number, cx: number, cy: number, r: number): void;
  /** Selected-zone brackets; facing 0 hides them. */
  target(x: number, y: number, facing: number, code: string, name: string, score: number): void;
  center(lat: number, lng: number, altitude: number): void;
  cursor(text: string | null): void;
  /** Zoom-detail readout: which country's provinces and towns are loaded. */
  detail(text: string): void;
};

type Props = {
  ref: Ref<HudHandle>;
  sweep: boolean;
  ready: boolean;
  resolution: Resolution;
  zoneCount: number;
  sunLabel: string;
};

const SWEEP_MS = 8000;
const SWEEP_SLICES = 14;
const SWEEP_SPAN_DEG = 42;
const BEARINGS = Array.from({ length: 12 }, (_, i) => i * 30);

function arcPath(r: number, a0: number, a1: number): string {
  const p = (a: number) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  return `M0 0 L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`;
}

function ticksPath(r: number): string {
  let d = "";
  for (let deg = 0; deg < 360; deg += 5) {
    const a = ((deg - 90) * Math.PI) / 180;
    const len = deg % 30 === 0 ? 11 : deg % 10 === 0 ? 6 : 3;
    const c = Math.cos(a);
    const s = Math.sin(a);
    d += `M${(c * r).toFixed(1)} ${(s * r).toFixed(1)}L${(c * (r + len)).toFixed(1)} ${(s * (r + len)).toFixed(1)}`;
  }
  return d;
}

/** Four corner brackets around (0,0). */
function bracketsPath(h: number, arm: number): string {
  return [
    `M${-h} ${-h + arm}V${-h}H${-h + arm}`,
    `M${h - arm} ${-h}H${h}V${-h + arm}`,
    `M${h} ${h - arm}V${h}H${h - arm}`,
    `M${-h + arm} ${h}H${-h}V${h - arm}`,
  ].join("");
}

const BOOT_LINES = (res: Resolution, zones: number, sun: string) => [
  "SIGNAL // HEAT — INSTRUMENT INITIALISING",
  `› GEODATA ........ NATURAL EARTH 1:${res === "50m" ? "50M" : "110M"}`,
  `› EPHEMERIS ...... SUBSOLAR ${sun}`,
  `› ZONES .......... ${zones} ANALYST COMPOSITES`,
  "› FEED ........... GDELT DOC 2.0 (OPEN SOURCE)",
  "› RENDER ......... READY",
];

export function GlobeHud({ ref, sweep, ready, resolution, zoneCount, sunLabel }: Props) {
  const clipId = useId().replace(/:/g, "");
  const rootRef = useRef<SVGSVGElement>(null);
  const clipRef = useRef<SVGCircleElement>(null);
  const sweepRef = useRef<SVGGElement>(null);
  const sweepSlicesRef = useRef<SVGGElement>(null);
  const ringRef = useRef<SVGGElement>(null);
  const ringCircleRef = useRef<SVGCircleElement>(null);
  const ringInnerRef = useRef<SVGCircleElement>(null);
  const ticksRef = useRef<SVGPathElement>(null);
  const labelsRef = useRef<(SVGTextElement | null)[]>([]);
  const targetRef = useRef<SVGGElement>(null);
  const leaderRef = useRef<SVGPathElement>(null);
  const tgtCodeRef = useRef<SVGTextElement>(null);
  const tgtNameRef = useRef<SVGTextElement>(null);
  const centerRef = useRef<HTMLSpanElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const detailRef = useRef<HTMLSpanElement>(null);
  const lastR = useRef(0);
  const sweepOn = useRef(sweep);
  sweepOn.current = sweep;
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => setBooted(true), 450);
    return () => window.clearTimeout(t);
  }, [ready]);

  useImperativeHandle(
    ref,
    () => ({
      frame(t, cx, cy, r) {
        const tr = `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`;
        ringRef.current?.setAttribute("transform", tr);
        clipRef.current?.setAttribute("cx", cx.toFixed(1));
        clipRef.current?.setAttribute("cy", cy.toFixed(1));
        if (Math.abs(r - lastR.current) > 0.5) {
          lastR.current = r;
          clipRef.current?.setAttribute("r", r.toFixed(1));
          ringCircleRef.current?.setAttribute("r", (r + 10).toFixed(1));
          ringInnerRef.current?.setAttribute("r", (r + 2).toFixed(1));
          ticksRef.current?.setAttribute("d", ticksPath(r + 10));
          BEARINGS.forEach((deg, i) => {
            const el = labelsRef.current[i];
            if (!el) return;
            const a = ((deg - 90) * Math.PI) / 180;
            el.setAttribute("x", (Math.cos(a) * (r + 32)).toFixed(1));
            el.setAttribute("y", (Math.sin(a) * (r + 32) + 3).toFixed(1));
          });
          const slices = sweepSlicesRef.current;
          if (slices) {
            const step = ((SWEEP_SPAN_DEG / SWEEP_SLICES) * Math.PI) / 180;
            [...slices.children].forEach((c, i) => {
              c.setAttribute("d", arcPath(r, -step * (i + 1), -step * i));
            });
          }
        }
        const sw = sweepRef.current;
        if (sw) {
          sw.style.display = sweepOn.current ? "" : "none";
          if (sweepOn.current) sw.setAttribute("transform", `${tr} rotate(${(((t % SWEEP_MS) / SWEEP_MS) * 360).toFixed(2)})`);
        }
      },
      target(x, y, facing, code, name, score) {
        const g = targetRef.current;
        if (!g) return;
        if (facing <= 0.01) {
          g.style.opacity = "0";
          return;
        }
        g.style.opacity = facing.toFixed(2);
        g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        const w = rootRef.current?.clientWidth ?? 0;
        leaderRef.current?.setAttribute("d", `M26 -26L52 -52H${Math.max(60, w - x).toFixed(0)}`);
        if (tgtCodeRef.current && tgtCodeRef.current.textContent !== `TGT ${code} · ${fmtScore(score)}`)
          tgtCodeRef.current.textContent = `TGT ${code} · ${fmtScore(score)}`;
        if (tgtNameRef.current && tgtNameRef.current.textContent !== name.toUpperCase()) tgtNameRef.current.textContent = name.toUpperCase();
      },
      center(lat, lng, altitude) {
        if (centerRef.current) centerRef.current.textContent = `${fmtLat(lat)} ${fmtLng(lng)} · ALT ${altitude.toFixed(2)}R`;
      },
      cursor(text) {
        if (cursorRef.current) cursorRef.current.textContent = text ?? "—";
      },
      detail(text) {
        if (detailRef.current && detailRef.current.textContent !== text) detailRef.current.textContent = text;
      },
    }),
    [],
  );

  return (
    <div className="hud" aria-hidden>
      <svg ref={rootRef} className="hud-svg">
        <defs>
          <clipPath id={clipId}>
            <circle ref={clipRef} r="0" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <g ref={sweepRef} className="hud-sweep">
            <g ref={sweepSlicesRef}>
              {Array.from({ length: SWEEP_SLICES }, (_, i) => (
                <path key={i} style={{ opacity: 0.16 * (1 - i / SWEEP_SLICES) ** 1.6 }} />
              ))}
            </g>
            <line x1="0" y1="0" x2="4000" y2="0" className="hud-sweep-edge" />
          </g>
        </g>
        <g ref={ringRef} className="hud-ring">
          <circle ref={ringInnerRef} className="hud-ring-inner" />
          <circle ref={ringCircleRef} className="hud-ring-outer" />
          <path ref={ticksRef} className="hud-ticks" />
          {BEARINGS.map((deg, i) => (
            <text
              key={deg}
              ref={(el) => {
                labelsRef.current[i] = el;
              }}
              className="hud-bearing"
              textAnchor="middle"
            >
              {String(deg).padStart(3, "0")}
            </text>
          ))}
        </g>
        <g ref={targetRef} className="hud-target" style={{ opacity: 0 }}>
          <path d={bracketsPath(18, 7)} className="hud-brackets" />
          <circle r="2" className="hud-target-dot" />
          <path ref={leaderRef} className="hud-leader" />
          <text ref={tgtCodeRef} x="56" y="-58" className="hud-tgt-code" />
          <text ref={tgtNameRef} x="56" y="-42" className="hud-tgt-name" />
        </g>
      </svg>

      <div className="hud-corner hud-tl mono">
        <span className="hud-k">PROJ</span> ORTHO · NE 1:{resolution === "50m" ? "50M" : "110M"}
        <br />
        <span className="hud-k">SUBSOLAR</span> {sunLabel}
        <br />
        <span className="hud-k">DETAIL</span> <span ref={detailRef}>—</span>
      </div>
      <div className="hud-corner hud-bl mono">
        <div>
          <span className="hud-k">CTR</span> <span ref={centerRef}>—</span>
        </div>
        <div>
          <span className="hud-k">CUR</span> <span ref={cursorRef}>—</span>
        </div>
      </div>

      {!booted && (
        <div className={`boot-overlay mono${ready ? " boot-done" : ""}`}>
          {BOOT_LINES(resolution, zoneCount, sunLabel).map((l, i) => (
            <div key={l} className="boot-line" style={{ animationDelay: `${i * 140}ms` }}>
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
