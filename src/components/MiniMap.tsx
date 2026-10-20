import { memo, useEffect, useRef } from "react";
import { globeCommands, useAtlas, usePov } from "../globe/bus";
import { fmtLat, fmtLng, subsolarPoint } from "../globe/format";
import { heatCss } from "../model/heatColor";
import type { ScoredZone } from "../model/score";

const W = 216;
const H = 108;

const x = (lng: number) => ((lng + 180) / 360) * W;
const y = (lat: number) => ((90 - lat) / 180) * H;

/** Equirectangular overview: land, night side, zone heat, and where the camera is looking. Click to fly. */
export const MiniMap = memo(function MiniMap({ zones }: { zones: readonly ScoredZone[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const atlas = useAtlas();
  const pov = usePov();

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== W * dpr) {
      c.width = W * dpr;
      c.height = H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#030915";
    ctx.fillRect(0, 0, W, H);

    // Graticule.
    ctx.strokeStyle = "rgba(40,70,120,0.35)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let lng = -150; lng < 180; lng += 30) {
      ctx.moveTo(x(lng), 0);
      ctx.lineTo(x(lng), H);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.moveTo(0, y(lat));
      ctx.lineTo(W, y(lat));
    }
    ctx.stroke();

    // Land.
    if (atlas) {
      ctx.fillStyle = "#1b3155";
      for (const country of atlas.countries) {
        const polys = country.geometry.type === "Polygon" ? [country.geometry.coordinates] : country.geometry.coordinates;
        for (const p of polys) {
          ctx.beginPath();
          for (const ring of p) ring.forEach(([lng = 0, lat = 0], i) => (i ? ctx.lineTo(x(lng), y(lat)) : ctx.moveTo(x(lng), y(lat))));
          ctx.fill("evenodd");
        }
      }
    }

    // Night side.
    const sun = subsolarPoint(new Date());
    const decl = (sun.lat * Math.PI) / 180;
    const tanD = Math.tan(Math.abs(decl) < 0.01 ? 0.01 : decl);
    ctx.fillStyle = "rgba(0,2,8,0.5)";
    ctx.beginPath();
    for (let px = 0; px <= W; px += 2) {
      const lng = (px / W) * 360 - 180;
      const t = (Math.atan(-Math.cos(((lng - sun.lng) * Math.PI) / 180) / tanD) * 180) / Math.PI;
      if (px === 0) ctx.moveTo(px, y(t));
      else ctx.lineTo(px, y(t));
    }
    ctx.lineTo(W, decl > 0 ? H : 0);
    ctx.lineTo(0, decl > 0 ? H : 0);
    ctx.closePath();
    ctx.fill();

    // Zones.
    for (const s of zones) {
      if (s.view <= 0) continue;
      const [lat, lng] = s.zone.centroid;
      ctx.fillStyle = heatCss(s.view, 0.9);
      ctx.beginPath();
      ctx.arc(x(lng), y(lat), 1 + (s.view / 100) * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Camera reticle.
    const cx = x(pov.lng);
    const cy = y(pov.lat);
    const r = Math.max(10, 26 * (pov.altitude / 2.35));
    ctx.strokeStyle = "rgba(232,200,119,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.moveTo(cx - r - 4, cy);
    ctx.lineTo(cx - r + 3, cy);
    ctx.moveTo(cx + r - 3, cy);
    ctx.lineTo(cx + r + 4, cy);
    ctx.moveTo(cx, cy - r - 4);
    ctx.lineTo(cx, cy - r + 3);
    ctx.moveTo(cx, cy + r - 3);
    ctx.lineTo(cx, cy + r + 4);
    ctx.stroke();
  }, [atlas, zones, pov]);

  return (
    <div className="minimap">
      <canvas
        ref={ref}
        style={{ width: W, height: H }}
        role="button"
        tabIndex={0}
        aria-label="Overview map. Click to point the globe there."
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const lng = ((e.clientX - r.left) / r.width) * 360 - 180;
          const lat = 90 - ((e.clientY - r.top) / r.height) * 180;
          globeCommands.flyTo(lat, lng);
        }}
      />
      <div className="minimap-cap mono">
        LOOK {fmtLat(pov.lat)} {fmtLng(pov.lng)}
      </div>
    </div>
  );
});
