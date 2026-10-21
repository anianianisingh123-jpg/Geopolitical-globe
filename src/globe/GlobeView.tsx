import Globe, { type GlobeInstance } from "globe.gl";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LineBasicMaterial, PerspectiveCamera, Vector2, Vector3, type LineSegments } from "three";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { Iso3 } from "../data/countries";
import type { Site } from "../data/sites";
import type { FireCluster } from "../intel/fireClusters";
import type { EventPlace, FirePoint, FiresPayload } from "../intel/types";
import type { Driver, HeatZone, LatLng, LinkArc } from "../data/schema";
import { heatCss, heatRgb } from "../model/heatColor";
import { fmtDelta, fmtScore, type CountryHeat, type ScoredZone } from "../model/score";
import { createBloom, disposeBloom, type Bloom } from "./blooms";
import { atlasStore, globeCommands, povStore } from "./bus";
import { createEarthMaterial, EARTH, graticule, landMask, lineLayer, loadLights, subsolarPoint, sunDirection } from "./earth";
import {
  circlePath,
  countryAt,
  fmtLat,
  fmtLng,
  geometryContains,
  GLOBE_RADIUS,
  kmToUnits,
  loadAtlas,
  type Atlas,
  type CountryShape,
  type Resolution,
} from "./geo";
import { GlobeHud, type HudHandle } from "./GlobeHud";
import { LabelLayer } from "./labels";
import { placeItems, type PickedPlace } from "./placeItems";
import { countryKey, describeNear, loadCountry, loadWorld, PlaceIndex, placesStore, provinceAt, type CountryDetail } from "./places";

export type NewsPing = { id: string; lat: number; lng: number };
export type { PickedPlace };

export type GlobeViewProps = {
  baseZones: readonly HeatZone[];
  scored: readonly ScoredZone[];
  countryHeat: ReadonlyMap<Iso3, CountryHeat>;
  links: readonly LinkArc[];
  codes: ReadonlyMap<string, string>;
  pings: readonly NewsPing[];
  fires: FiresPayload | null;
  showFires: boolean;
  selectedId: string | null;
  solo: Driver | null;
  scenarioActive: boolean;
  showLinks: boolean;
  showRoutes: boolean;
  autoRotate: boolean;
  sweep: boolean;
  lowPower: boolean;
  resolution: Resolution;
  focus: { id: string; nonce: number } | null;
  sites: readonly Site[];
  /** Site id → headlines naming it in the feed window. */
  siteNews: ReadonlyMap<string, number>;
  fireClusters: readonly FireCluster[];
  /** GDELT event places (already filtered by the caller's toggle). */
  eventPlaces: readonly EventPlace[] | null;
  showPlaces: boolean;
  /** Operator callsign for the boot sequence. */
  callsign: string;
  onSelect: (id: string) => void;
  onPickPlace: (p: PickedPlace) => void;
  onError: (err: Error) => void;
};

type CountryDatum = { kind: "country"; shape: CountryShape; geometry: CountryShape["geometry"] };
type FootprintDatum = { kind: "footprint"; zone: HeatZone; geometry: NonNullable<HeatZone["polygon"]> };
type PolyDatum = CountryDatum | FootprintDatum;
type PathDatum = { kind: "route" | "range"; key: string; points: LatLng[]; color: string };
type LabelDatum = { key: string; lat: number; lng: number; alt: number; el: HTMLElement };

const DEFAULT_POV = { lat: 27, lng: 42, altitude: 2.35 };
const BASE = import.meta.env.BASE_URL;
const PULSE_MS = 4000;
const PULSE_AMPLITUDE = 0.06;
/** Must match `.glabel { margin-top }` in global.css. */
const LABEL_LIFT_PX = 22;
/** Closest approach, in globe radii above the surface (~250 km). */
const MIN_ALTITUDE = 0.04;
/** Below this altitude, provinces and towns load for the countries on screen. */
const DETAIL_ALTITUDE = 0.9;
/** Extruded countries flatten below FLAT_IN and rise again above FLAT_OUT (hysteresis). */
const FLAT_IN = 0.55;
const FLAT_OUT = 0.65;
/** At most this many countries carry province detail at once. */
const MAX_DETAIL_COUNTRIES = 4;
/** Labelled places when the full render is on / in low-power mode. */
/** Sparse label budget — denser only when the operator zooms in. */
const LABEL_BUDGET = 72;
const LABEL_BUDGET_LOW = 40;

/** globe.gl accessors are typed over `object`; this narrows once, in one place. */
const acc =
  <T, R>(fn: (d: T) => R) =>
  (d: object): R =>
    fn(d as T);

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const tooltip = (name: string, score: number | null, sub?: string): string =>
  `<div class="gtt"><span class="gtt-name">${esc(name)}</span><span class="gtt-score" style="color:${
    score === null ? "var(--muted)" : heatCss(Math.max(score, 30))
  }">${score === null ? "—" : fmtScore(score)}</span>${sub ? `<span class="gtt-sub">${esc(sub)}</span>` : ""}</div>`;

/** Country extrusion: hot countries rise, cold ones sit flat. */
const altitudeFor = (heat: number): number => (heat > 0 ? 0.006 + 0.07 * (heat / 100) ** 1.35 : 0.002);
/** Close in, extrusions would tower hundreds of km over the towns; the map flattens instead. */
const heightFor = (heat: number, flat: boolean): number => (flat ? (heat > 0 ? 0.0022 : 0.0012) : altitudeFor(heat));

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function makeLabel(text: string, score: string, color: string, delta?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "glabel";
  const name = document.createElement("span");
  name.className = "glabel-name";
  name.textContent = text;
  const val = document.createElement("span");
  val.className = "glabel-score";
  val.style.color = color;
  val.textContent = score;
  el.append(name, val);
  if (delta) {
    const d = document.createElement("span");
    d.className = "glabel-delta";
    d.textContent = delta;
    el.append(d);
  }
  return el;
}

/** Labels arrive in priority order; hide any whose box overlaps a higher-priority one on screen. */
function declutter(globe: GlobeInstance, labels: readonly LabelDatum[]): void {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const l of labels) {
    if (l.el.style.opacity === "0") continue; // behind the globe
    const { x, y } = globe.getScreenCoords(l.lat, l.lng, l.alt);
    const w = l.el.offsetWidth / 2 + 3;
    const h = l.el.offsetHeight / 2 + 2;
    const cy = y - LABEL_LIFT_PX;
    const r = { x0: x - w, x1: x + w, y0: cy - h, y1: cy + h };
    const clash = placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);
    l.el.style.visibility = clash ? "hidden" : "visible";
    if (!clash) placed.push(r);
  }
}

export default function GlobeView(props: GlobeViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HudHandle>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const bloomsRef = useRef<Bloom[]>([]);
  const labelsRef = useRef<LabelDatum[]>([]);
  const vectorRef = useRef<LineSegments[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const atlasRef = useRef<Atlas | null>(null);
  atlasRef.current = atlas;
  const [globeReady, setGlobeReady] = useState(false);
  const [hovered, setHovered] = useState<PolyDatum | null>(null);
  const [flat, setFlat] = useState(false);
  /** Countries under the camera, when close enough for province detail. */
  const [viewKeys, setViewKeys] = useState<string[]>([]);
  const placeLayerRef = useRef<LabelLayer | null>(null);
  const provinceLinesRef = useRef(new Map<string, LineSegments>());
  const placeIndexRef = useRef<PlaceIndex | null>(null);
  const places = useSyncExternalStore(placesStore.subscribe, placesStore.get, placesStore.get);

  const byId = useMemo(() => new Map(props.scored.map((s) => [s.zone.id, s])), [props.scored]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  /** Only countries a zone can heat become polygons; land itself is drawn by the earth shader. */
  const heatable = useMemo(() => {
    const set = new Set<Iso3>();
    for (const z of props.baseZones) for (const iso of Object.keys(z.countries ?? {})) set.add(iso as Iso3);
    return set;
  }, [props.baseZones]);

  // ── mount: one globe instance for the component's lifetime ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let globe: GlobeInstance;
    try {
      globe = new Globe(host, {
        animateIn: false,
        rendererConfig: { antialias: true, alpha: false, powerPreference: "high-performance" },
      });
    } catch (e) {
      propsRef.current.onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    globeRef.current = globe;
    if (import.meta.env.DEV) (window as unknown as { __globe?: GlobeInstance }).__globe = globe;

    const layer = new LabelLayer(host);
    placeLayerRef.current = layer;
    void loadWorld().catch((e: unknown) => console.warn("[signal-heat] city labels unavailable:", e));

    // A click on a place label also reaches globe.gl, which reports it a frame later as a globe/polygon
    // click; the flag swallows that one click and resets on the next press.
    let labelPicked = false;
    const picked = () => labelPicked;
    let clickTimer = 0;
    const zoomAt = (lat: number, lng: number) => {
      const alt = globe.pointOfView().altitude;
      globe.pointOfView({ lat, lng, altitude: alt > 1.2 ? 0.75 : Math.max(MIN_ALTITUDE + 0.02, alt * 0.45) }, 900);
    };
    // A single click zooms in, after waiting out a possible double-click (which resets the view).
    const zoomSoon = (lat: number, lng: number) => {
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => zoomAt(lat, lng), 260);
    };
    /** First click on a zone selects it; clicking inside the selected zone zooms in. */
    const zoneClick = (zoneIds: readonly string[], lat: number, lng: number) => {
      if (picked()) return;
      const sel = propsRef.current.selectedId;
      if (zoneIds.length === 0 || (sel && zoneIds.includes(sel))) zoomSoon(lat, lng);
      else if (zoneIds[0]) propsRef.current.onSelect(zoneIds[0]);
    };

    const earth = createEarthMaterial();
    loadLights(`${BASE}textures/earth-night.jpg`, earth);
    const sunTimer = window.setInterval(() => sunDirection(new Date(), earth.uniforms.uSun.value), 30_000);

    globe
      .backgroundColor("#02050b")
      .globeMaterial(earth)
      .showAtmosphere(true)
      .atmosphereColor("#3d6aa8")
      .atmosphereAltitude(0.16)
      .showGraticules(false)
      .polygonsTransitionDuration(650)
      .polygonCapCurvatureResolution(3)
      .pathTransitionDuration(0)
      .pathPoints("points")
      .pathPointLat(acc<LatLng, number>((p) => p[0]))
      .pathPointLng(acc<LatLng, number>((p) => p[1]))
      .pathPointAlt(0.004)
      .pathResolution(2)
      .pathColor(acc<PathDatum, string>((p) => p.color))
      .pathStroke(null)
      .pathDashLength(acc<PathDatum, number>((p) => (p.kind === "range" ? 0.006 : 1)))
      .pathDashGap(acc<PathDatum, number>((p) => (p.kind === "range" ? 0.006 : 0)))
      .arcStartLat(acc<LinkArc, number>((a) => a.from[0]))
      .arcStartLng(acc<LinkArc, number>((a) => a.from[1]))
      .arcEndLat(acc<LinkArc, number>((a) => a.to[0]))
      .arcEndLng(acc<LinkArc, number>((a) => a.to[1]))
      .arcColor(
        acc<LinkArc, string[]>((a) =>
          a.kind === "exposure" ? ["rgba(111,147,200,0.2)", "rgba(201,164,76,0.2)"] : ["rgba(216,224,236,0.2)", "rgba(232,66,48,0.2)"],
        ),
      )
      .arcStroke(0.28)
      .arcAltitudeAutoScale(0.32)
      .arcDashLength(0.4)
      .arcDashGap(0.12)
      .arcDashAnimateTime(7000)
      .arcsTransitionDuration(0)
      .arcLabel(acc<LinkArc, string>((a) => tooltip(a.label, null, a.note)))
      .pointLat(acc<FirePoint, number>((p) => p[0]))
      .pointLng(acc<FirePoint, number>((p) => p[1]))
      .pointColor(acc<FirePoint, string>((p) => (p[2] >= 80 ? "#ffe2c6" : p[2] >= 20 ? "#ff4a2a" : p[2] >= 5 ? "#f07a2e" : "#e0a64a")))
      .pointRadius(0.07)
      .pointResolution(6)
      .pointsMerge(true)
      .pointsTransitionDuration(0)
      .ringLat(acc<NewsPing, number>((r) => r.lat))
      .ringLng(acc<NewsPing, number>((r) => r.lng))
      .ringAltitude(0.01)
      .ringColor(() => (t: number) => `rgba(201,164,76,${(0.42 * (1 - t)).toFixed(3)})`)
      .ringMaxRadius(2.2)
      .ringPropagationSpeed(1.2)
      .ringRepeatPeriod(3600)
      .objectLat(acc<Bloom, number>((b) => b.lat))
      .objectLng(acc<Bloom, number>((b) => b.lng))
      .objectAltitude(0.001)
      .objectFacesSurface(true)
      .objectThreeObject(acc<Bloom, Bloom["group"]>((b) => b.group))
      .objectLabel(
        acc<Bloom, string>((b) => {
          const s = byIdRef.current.get(b.zoneId);
          return s ? tooltip(s.zone.name, s.view, b.nodeName ?? undefined) : "";
        }),
      )
      .htmlLat(acc<LabelDatum, number>((l) => l.lat))
      .htmlLng(acc<LabelDatum, number>((l) => l.lng))
      .htmlAltitude(acc<LabelDatum, number>((l) => l.alt))
      .htmlElement(acc<LabelDatum, HTMLElement>((l) => l.el))
      .htmlTransitionDuration(0)
      .htmlElementVisibilityModifier((el, visible) => {
        el.style.opacity = visible ? "1" : "0";
      })
      .pointerEventsFilter((_obj, data) => {
        if (!data) return true;
        if ("glow" in data) return (data as Bloom).state.visible;
        if ("kind" in data) {
          const d = data as PolyDatum | PathDatum;
          if (d.kind === "route" || d.kind === "range") return false;
          if (d.kind === "footprint") return (byIdRef.current.get(d.zone.id)?.view ?? 0) > 0;
          if (d.kind === "country") return (d.shape.iso3 ? propsRef.current.countryHeat.get(d.shape.iso3)?.heat ?? 0 : 0) > 0;
        }
        return true;
      })
      .onPolygonHover((d) => setHovered(d ? (d as PolyDatum) : null))
      .onPolygonClick((d, _e, at) => {
        const p = d as PolyDatum;
        if (p.kind === "footprint") return zoneClick([p.zone.id], at.lat, at.lng);
        const heat = p.shape.iso3 ? propsRef.current.countryHeat.get(p.shape.iso3) : undefined;
        // The country's top zone first, then the others that heat it.
        zoneClick(heat ? [heat.zoneId, ...heat.zoneIds.filter((z) => z !== heat.zoneId)] : [], at.lat, at.lng);
      })
      .onObjectClick((d) => {
        const b = d as Bloom;
        zoneClick([b.zoneId], b.lat, b.lng);
      })
      .onGlobeClick(({ lat, lng }) => {
        if (!picked()) zoomSoon(lat, lng);
      })
      .onGlobeReady(() => setGlobeReady(true));

    // Soft bloom — enough for heat cores, not a neon wash.
    const composer = globe.postProcessingComposer();
    const bloom = new UnrealBloomPass(new Vector2(host.clientWidth, host.clientHeight), 0.38, 0.45, 0.4);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    bloomPassRef.current = bloom;

    const controls = globe.controls();
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.7;
    controls.minDistance = GLOBE_RADIUS * (1 + MIN_ALTITUDE);
    controls.maxDistance = GLOBE_RADIUS * 6;
    controls.autoRotateSpeed = 0.18;

    const resize = () => globe.width(host.clientWidth).height(host.clientHeight);
    resize();
    globe.pointOfView(host.clientHeight < 520 ? { ...DEFAULT_POV, altitude: 1.85 } : DEFAULT_POV, 0);
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const onDbl = () => {
      window.clearTimeout(clickTimer);
      globe.pointOfView(DEFAULT_POV, 900);
    };
    host.addEventListener("dblclick", onDbl);

    globeCommands.register((lat, lng, altitude) => globe.pointOfView(altitude === undefined ? { lat, lng } : { lat, lng, altitude }, 900));

    // Cursor readout: screen → lat/lng → country, throttled to the frame.
    let cursor: { x: number; y: number } | null = null;
    const local = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      cursor = local(e);
    };
    const onLeave = () => {
      cursor = null;
      hudRef.current?.cursor(null);
      layer.hover(null);
    };
    // Place labels ignore pointer events (so drag and wheel reach the globe); clicks are hit-tested here.
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { ...local(e), t: performance.now() };
      labelPicked = false;
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || e.button !== 0) return;
      const p = local(e);
      if (Math.hypot(p.x - d.x, p.y - d.y) > 5 || performance.now() - d.t > 600) return;
      const hit = layer.hit(p.x, p.y);
      if (!hit?.data) return;
      labelPicked = true;
      propsRef.current.onPickPlace(hit.data as PickedPlace);
    };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("pointerdown", onDown, true);
    host.addEventListener("pointerup", onUp, true);

    const camPos = new Vector3();
    const pos = new Vector3();
    const tgt = new Vector3();
    let raf = 0;
    let lastDeclutter = 0;
    let lastPov = "";
    let lastCursor = "";
    let lastKeys = "";
    let flatNow = false;
    /** Screen points sampled for "which countries are on screen". */
    const SAMPLES = [
      [0.5, 0.5],
      [0.28, 0.3],
      [0.72, 0.3],
      [0.28, 0.72],
      [0.72, 0.72],
    ] as const;
    /** "UKRAINE · DONETSK · 4 KM SW OF POKROVSK" for the cursor readout. */
    const whereIs = (at: LatLng, altitude: number): string => {
      const atlas = atlasRef.current;
      const c = atlas ? countryAt(atlas.countries, at) : null;
      if (!c) return "OPEN WATER";
      const parts = [c.name];
      const ck = countryKey(c);
      const prov = ck ? provinceAt(placesStore.get().details.get(ck), at) : null;
      if (prov) parts.push(prov.name);
      const near = altitude < 0.45 ? placeIndexRef.current?.nearest(at, 25) : null;
      if (near) parts.push(describeNear(at, near));
      return parts.join(" · ").toUpperCase();
    };
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const cam = globe.camera();
      camPos.copy(cam.position);
      const dist = camPos.length();
      camPos.normalize();
      const horizon = GLOBE_RADIUS / dist;
      const altitude = dist / GLOBE_RADIUS - 1;

      layer.frame(t, cam, host.clientWidth, host.clientHeight, altitude);
      if (!flatNow && altitude < FLAT_IN) setFlat((flatNow = true));
      else if (flatNow && altitude > FLAT_OUT) setFlat((flatNow = false));
      const provinceFade = smoothstep(DETAIL_ALTITUDE, 0.4, altitude);
      for (const l of provinceLinesRef.current.values()) (l.material as LineBasicMaterial).opacity = 0.42 * provinceFade;
      // Glow sprites are sized for the whole-globe view; close in they would wash out the map.
      const glowFade = 0.15 + 0.85 * smoothstep(0.06, 0.85, altitude);
      earth.uniforms.uCoastGain.value = 0.2 + 0.8 * smoothstep(0.1, 0.7, altitude);
      earth.uniforms.uLightsGain.value = 0.12 + 0.88 * smoothstep(0.15, 0.8, altitude);

      // HUD geometry: projected globe disc.
      const fov = cam instanceof PerspectiveCamera ? cam.fov : 50;
      const radiusPx = ((host.clientHeight / 2) * Math.tan(Math.asin(Math.min(1, horizon)))) / Math.tan(((fov / 2) * Math.PI) / 180);
      const hud = hudRef.current;
      hud?.frame(t, host.clientWidth / 2, host.clientHeight / 2, radiusPx);

      // Target brackets on the selected zone.
      const sel = propsRef.current.selectedId ? byIdRef.current.get(propsRef.current.selectedId) : undefined;
      if (hud) {
        if (sel) {
          const [lat, lng] = sel.zone.centroid;
          const sc = globe.getScreenCoords(lat, lng, 0.02);
          const c = globe.getCoords(lat, lng, 0);
          tgt.set(c.x, c.y, c.z).normalize();
          const facing = smoothstep(horizon - 0.02, horizon + 0.08, tgt.dot(camPos));
          hud.target(sc.x, sc.y, facing, propsRef.current.codes.get(sel.zone.id) ?? "", sel.zone.name, sel.composite);
        } else hud.target(0, 0, 0, "", "", 0);
      }

      if (t - lastDeclutter > 120) {
        lastDeclutter = t;
        declutter(globe, labelsRef.current);
        const pov = globe.pointOfView();
        const key = `${pov.lat.toFixed(2)}|${pov.lng.toFixed(2)}|${pov.altitude.toFixed(2)}`;
        if (key !== lastPov) {
          lastPov = key;
          povStore.set({ lat: pov.lat, lng: pov.lng, altitude: pov.altitude });
          hud?.center(pov.lat, pov.lng, pov.altitude);
          // Countries on screen, for province borders and towns.
          const keys: string[] = [];
          const atlas = atlasRef.current;
          if (atlas && altitude < DETAIL_ALTITUDE) {
            for (const [fx, fy] of SAMPLES) {
              const g = globe.toGlobeCoords(host.clientWidth * fx, host.clientHeight * fy);
              const c = g ? countryAt(atlas.countries, [g.lat, g.lng]) : null;
              const ck = c ? countryKey(c) : null;
              if (ck && !keys.includes(ck)) keys.push(ck);
            }
          }
          const sig = keys.slice(0, MAX_DETAIL_COUNTRIES).join(",");
          if (sig !== lastKeys) {
            lastKeys = sig;
            setViewKeys(sig ? sig.split(",") : []);
          }
        }
        const cur = cursor;
        if (cur && hud) {
          const hit = layer.hit(cur.x, cur.y);
          layer.hover(hit?.data ? hit.id : null);
          host.style.cursor = hit?.data ? "pointer" : "";
          const g = globe.toGlobeCoords(cur.x, cur.y);
          const k = g ? `${g.lat.toFixed(2)}|${g.lng.toFixed(2)}` : "off";
          if (k !== lastCursor) {
            lastCursor = k;
            hud.cursor(g ? `${fmtLat(g.lat)} ${fmtLng(g.lng)} · ${whereIs([g.lat, g.lng], altitude)}` : null);
          }
        }
      }

      const phase = Math.sin((t / PULSE_MS) * Math.PI * 2);
      const selectedZone = propsRef.current.selectedId;
      for (const b of bloomsRef.current) {
        const st = b.state;
        if (!st.visible) {
          b.group.visible = false;
          continue;
        }
        b.group.getWorldPosition(pos);
        const facing = smoothstep(horizon - 0.02, horizon + 0.1, pos.normalize().dot(camPos));
        b.group.visible = facing > 0.001;
        if (!b.group.visible) continue;
        const k = st.pulse ? 1 + PULSE_AMPLITUDE * phase : 1;
        const o = st.base * facing * (st.pulse ? 0.92 + 0.08 * phase : 1);
        b.glow.scale.setScalar(st.scale * k);
        b.core.scale.setScalar(st.scale * 0.28 * k);
        b.glow.material.opacity = o * 0.55 * glowFade;
        b.core.material.opacity = o * st.coreGain * glowFade;
        // Compass ticks only on the tracked target — everywhere else is soft glow.
        const marked = b.zoneId === selectedZone;
        const mark = marked ? Math.min(1, 0.4 + st.base) * facing : 0;
        b.ring.material.opacity = mark * 0.85;
        b.ticks.material.opacity = mark * 0.65;
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(sunTimer);
      ro.disconnect();
      host.removeEventListener("dblclick", onDbl);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerdown", onDown, true);
      host.removeEventListener("pointerup", onUp, true);
      window.clearTimeout(clickTimer);
      layer.dispose();
      placeLayerRef.current = null;
      for (const l of provinceLinesRef.current.values()) l.geometry.dispose();
      provinceLinesRef.current.clear();
      globeCommands.register(null);
      bloomsRef.current.forEach(disposeBloom);
      bloomsRef.current = [];
      vectorRef.current = [];
      bloomPassRef.current = null;
      earth.dispose();
      globe._destructor();
      globeRef.current = null;
      host.replaceChildren();
    };
  }, []);

  // ── geodata at the requested resolution ──
  useEffect(() => {
    let live = true;
    loadAtlas(props.resolution)
      .then((a) => {
        if (!live) return;
        setAtlas(a);
        atlasStore.set(a);
      })
      .catch((e: unknown) => live && propsRef.current.onError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      live = false;
    };
  }, [props.resolution]);

  // ── static geometry: land mask, borders, graticule, polygons, bloom objects ──
  const polyData = useMemo<PolyDatum[]>(() => {
    if (!atlas) return [];
    const cs: PolyDatum[] = atlas.countries
      .filter((c) => c.iso3 && heatable.has(c.iso3))
      .map((shape) => ({ kind: "country", shape, geometry: shape.geometry }));
    const fp: PolyDatum[] = props.baseZones.flatMap((zone) =>
      zone.polygon ? [{ kind: "footprint" as const, zone, geometry: zone.polygon }] : [],
    );
    return [...cs, ...fp];
  }, [atlas, heatable, props.baseZones]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !atlas) return;

    // Land mask for the earth shader.
    const mat = globe.globeMaterial();
    if ("uniforms" in mat) {
      const size = props.resolution === "50m" ? 4096 : 2048;
      const u = (mat as ReturnType<typeof createEarthMaterial>).uniforms;
      u.uMask.value?.dispose();
      u.uMask.value = landMask(atlas.countries, size);
      u.uTexel.value.set(1 / size, 2 / size);
    }

    // Vector overlays: graticule, coastlines, borders.
    const scene = globe.scene();
    vectorRef.current.forEach((o) => {
      scene.remove(o);
      o.geometry.dispose();
    });
    const vectors = [graticule(), lineLayer(atlas.coasts, EARTH.coast, 0.55, 0.0012), lineLayer(atlas.borders, EARTH.border, 0.5, 0.0014)];
    vectors.forEach((o) => scene.add(o));
    vectorRef.current = vectors;

    const hostOf = (coord: LatLng): Iso3 | null =>
      atlas.countries.find((c) => c.iso3 && geometryContains(c.geometry, coord))?.iso3 ?? null;

    const blooms: Bloom[] = [];
    for (const zone of props.baseZones) {
      const opacity = zone.opacity ?? 1;
      // Network zones are their nodes; radiusKm is only the default node size there.
      const centroidIsNode = zone.nodes?.some((n) => n.coord[0] === zone.centroid[0] && n.coord[1] === zone.centroid[1]);
      if (zone.radiusKm && zone.kind !== "network" && !centroidIsNode) {
        const [lat, lng] = zone.centroid;
        blooms.push(
          createBloom({ key: zone.id, zoneId: zone.id, nodeName: null, lat, lng, radiusKm: zone.radiusKm, opacity, hostIso: hostOf(zone.centroid) }),
        );
      }
      for (const [i, n] of (zone.nodes ?? []).entries()) {
        const [lat, lng] = n.coord;
        const radiusKm = n.radiusKm ?? zone.radiusKm ?? 80;
        blooms.push(
          createBloom({ key: `${zone.id}#${i}`, zoneId: zone.id, nodeName: n.name, lat, lng, radiusKm, opacity, hostIso: hostOf(n.coord) }),
        );
      }
    }
    bloomsRef.current.forEach(disposeBloom);
    bloomsRef.current = blooms;
    globe.polygonsData(polyData).objectsData(blooms);
  }, [atlas, polyData, props.baseZones, props.resolution]);

  // ── heat repaint: polygons + bloom state ──
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const { countryHeat, selectedId } = props;
    const heatOf = (iso: Iso3 | null): number => (iso ? (countryHeat.get(iso)?.heat ?? 0) : 0);
    const footprintAlt = (z: HeatZone): number =>
      flat ? 0.0026 : Math.max(0, ...Object.keys(z.countries ?? {}).map((iso) => altitudeFor(heatOf(iso as Iso3)))) + 0.007;
    // Flattened, the caps become a tint so borders, towns and fire spikes read through them.
    const capAlpha = flat ? 0.4 : 1;

    globe
      .polygonAltitude(
        acc<PolyDatum, number>((d) => {
          if (d.kind === "country") return heightFor(heatOf(d.shape.iso3), flat);
          return (byId.get(d.zone.id)?.view ?? 0) > 0 ? footprintAlt(d.zone) : 0.001;
        }),
      )
      .polygonCapColor(
        acc<PolyDatum, string>((d) => {
          if (d.kind === "country") {
            const h = heatOf(d.shape.iso3);
            return h > 0 ? heatCss(h, (0.22 + 0.48 * (h / 100)) * capAlpha) : "rgba(0,0,0,0)";
          }
          const v = byId.get(d.zone.id)?.view ?? 0;
          const sel = d.zone.id === selectedId;
          return v > 0 ? heatCss(v, ((sel ? 0.36 : 0.16) + 0.3 * (v / 100)) * capAlpha) : "rgba(0,0,0,0)";
        }),
      )
      .polygonSideColor(
        acc<PolyDatum, string>((d) => {
          if (d.kind === "footprint") return "rgba(0,0,0,0)";
          const h = heatOf(d.shape.iso3);
          if (h <= 0) return "rgba(0,0,0,0)";
          const [r, g, b] = heatRgb(h);
          return `rgba(${Math.round(r * 0.55)},${Math.round(g * 0.55)},${Math.round(b * 0.55)},0.6)`;
        }),
      )
      .polygonLabel(
        acc<PolyDatum, string>((d) => {
          if (d.kind === "footprint") {
            const s = byIdRef.current.get(d.zone.id);
            return s && s.view > 0 ? tooltip(d.zone.name, s.view) : "";
          }
          const h = d.shape.iso3 ? propsRef.current.countryHeat.get(d.shape.iso3) : undefined;
          return h && h.heat > 0 ? tooltip(d.shape.name, h.heat) : "";
        }),
      );

    for (const b of bloomsRef.current) {
      const s = byId.get(b.zoneId);
      const v = s?.view ?? 0;
      const st = b.state;
      st.visible = v > 0;
      if (!st.visible || !s) continue;
      const [r, g, bl] = heatRgb(v);
      b.glow.material.color.setRGB(r / 255, g / 255, bl / 255).convertSRGBToLinear();
      b.ring.material.color.setRGB(r / 255, g / 255, bl / 255).convertSRGBToLinear();
      b.ticks.material.color.copy(b.ring.material.color);
      const white = Math.max(0, (v - 45) / 55);
      b.core.material.color
        .setRGB((r + (255 - r) * white) / 255, (g + (246 - g) * white) / 255, (bl + (236 - bl) * white) / 255)
        .convertSRGBToLinear();
      st.coreGain = 0.25 + 0.75 * white;
      st.base = Math.min(1, 0.12 + 0.95 * (v / 100) ** 0.9) * b.opacity;
      st.scale = kmToUnits(b.radiusKm) * (0.75 + 0.5 * (v / 100));
      st.pulse = s.trend === "rising" && v > 70;
      st.lift = heightFor(heatOf(b.hostIso), flat) * GLOBE_RADIUS + (flat ? 0.12 : 0.25);
      b.group.position.z = st.lift;
      // The target ring sits at ~55% of the glow radius, never smaller than ~45 km.
      const ringUnits = Math.max(st.scale * 0.55, kmToUnits(45));
      b.ring.scale.setScalar(ringUnits);
      b.ticks.scale.setScalar(ringUnits);
    }
  }, [byId, props.countryHeat, props.selectedId, polyData, flat]);

  // ── outlines: heated countries, footprints, hover ──
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const { countryHeat, selectedId } = props;
    globe.polygonStrokeColor(
      acc<PolyDatum, string | false>((d) => {
        if (d === hovered) return "#e8c877";
        if (d.kind === "footprint") {
          const v = byId.get(d.zone.id)?.view ?? 0;
          return v > 0 ? heatCss(v, d.zone.id === selectedId ? 0.95 : 0.6) : false;
        }
        const h = d.shape.iso3 ? countryHeat.get(d.shape.iso3) : undefined;
        if (!h || h.heat <= 0) return false;
        if (h.zoneIds.includes(selectedId ?? "")) return "rgba(232,200,119,0.85)";
        return heatCss(h.heat, 0.55);
      }),
    );
  }, [hovered, byId, props.countryHeat, props.selectedId, polyData]);

  // ── routes and range rings ──
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const { showRoutes, selectedId, solo } = props;
    const paths: PathDatum[] = [];
    for (const s of byId.values()) {
      const z = s.zone;
      const selected = z.id === selectedId;
      if (z.routes && (selected || (showRoutes && s.view > 0))) {
        const color = heatCss(Math.max(s.view, 35), selected ? 0.85 : 0.42);
        z.routes.forEach((r, i) => paths.push({ kind: "route", key: `${z.id}#r${i}`, points: r.path, color }));
      }
      if (z.ranges && (selected || (solo === "nuclear" && s.view > 0))) {
        z.ranges.forEach((r, i) =>
          paths.push({ kind: "range", key: `${z.id}#g${i}`, points: circlePath(r.center, r.km), color: "rgba(232,200,119,0.5)" }),
        );
      }
    }
    globe.pathsData(paths);
  }, [byId, props.showRoutes, props.selectedId, props.solo]);

  useEffect(() => {
    globeRef.current?.arcsData(props.showLinks ? [...props.links] : []);
  }, [props.showLinks, props.links]);

  useEffect(() => {
    globeRef.current?.ringsData([...props.pings]);
  }, [props.pings]);

  // ── thermal detections: thin spikes that clear the extruded country they sit in ──
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const f = props.fires;
    if (!f || !props.showFires) {
      globe.pointsData([]);
      return;
    }
    const zonesById = new Map(props.baseZones.map((z) => [z.id, z]));
    const zoneAlt = f.zones.map((id) => {
      const top = Object.entries(zonesById.get(id)?.countries ?? {}).sort((a, b) => b[1] - a[1])[0];
      const heat = top ? (props.countryHeat.get(top[0] as Iso3)?.heat ?? 0) : 0;
      return heightFor(heat, flat);
    });
    // Close in, spikes shrink toward their true footprint (a VIIRS pixel is 375 m).
    const [base, span] = flat ? [0.0012, 0.006] : [0.004, 0.02];
    globe
      .pointRadius(flat ? 0.022 : 0.07)
      .pointAltitude(acc<FirePoint, number>((p) => (zoneAlt[p[3]] ?? 0) + base + Math.min(span, p[2] / (flat ? 12000 : 4000))))
      .pointsData([...f.points]);
  }, [props.fires, props.showFires, props.countryHeat, props.baseZones, flat]);

  // ── zoom detail: provinces and towns for the countries on screen ──
  useEffect(() => {
    for (const k of viewKeys) void loadCountry(k);
  }, [viewKeys]);

  const activeDetails = useMemo(
    () => viewKeys.flatMap((k) => places.details.get(k) ?? []),
    [viewKeys, places.details],
  );

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const scene = globe.scene();
    const lines = provinceLinesRef.current;
    const want = new Set(activeDetails.filter((d) => d.borders).map((d) => d.key));
    for (const [k, l] of lines) {
      if (want.has(k)) continue;
      scene.remove(l);
      l.geometry.dispose();
      lines.delete(k);
    }
    for (const d of activeDetails) {
      if (!d.borders || lines.has(d.key)) continue;
      // Above the flattened country caps so provinces read through the heat tint.
      const l = lineLayer(d.borders, EARTH.coast, 0, 0.003);
      scene.add(l);
      lines.set(d.key, l);
    }
  }, [activeDetails]);

  const placeLabels = useMemo(
    () =>
      placeItems({
        world: places.world,
        details: activeDetails,
        sites: props.sites,
        siteNews: props.siteNews,
        clusters: props.showFires ? props.fireClusters : null,
        events: props.eventPlaces,
        selectedId: props.selectedId,
      }),
    [places.world, activeDetails, props.sites, props.siteNews, props.fireClusters, props.showFires, props.eventPlaces, props.selectedId],
  );

  useEffect(() => {
    placeLayerRef.current?.setItems(placeLabels);
  }, [placeLabels]);

  useEffect(() => {
    placeIndexRef.current = new PlaceIndex([...(places.world ?? []), ...activeDetails.flatMap((d) => d.towns)]);
  }, [places.world, activeDetails]);

  useEffect(() => {
    placeLayerRef.current?.setVisible(props.showPlaces);
  }, [props.showPlaces]);

  useEffect(() => {
    const hud = hudRef.current;
    if (!hud) return;
    const nameOf = (d: CountryDetail) => atlas?.countries.find((c) => countryKey(c) === d.key)?.name ?? d.key;
    const world = places.world ? `${places.world.length.toLocaleString()} CITIES` : "CITIES LOADING";
    const local = activeDetails
      .slice(0, 2)
      .map((d) => `${nameOf(d).toUpperCase()} ${d.provinces.length} PROV · ${d.towns.length.toLocaleString()} TOWNS`);
    hud.detail(props.showPlaces ? [world, ...local].join(" · ") : "LABELS OFF");
  }, [places.world, activeDetails, atlas, props.showPlaces, globeReady]);

  // ── labels: only when a layer is soloed, plus labelled scenario deltas ──
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const { solo, scenarioActive } = props;
    const labels: LabelDatum[] = [];
    const seen = new Set<string>();
    if (scenarioActive) {
      for (const s of byId.values()) {
        if (!s.adjustment) continue;
        seen.add(s.zone.id);
        const [lat, lng] = s.zone.centroid;
        labels.push({
          key: s.zone.id,
          lat,
          lng,
          alt: 0.03,
          el: makeLabel(s.zone.name, `${fmtScore(s.baseline)}→${fmtScore(s.composite)}`, heatCss(Math.max(s.composite, 35)), fmtDelta(s.delta)),
        });
      }
    }
    if (solo) {
      [...byId.values()]
        .filter((s) => s.view > 0 && s.intensities[solo] > 0 && !seen.has(s.zone.id))
        .sort((a, b) => b.view - a.view)
        .slice(0, 8)
        .forEach((s) => {
          const [lat, lng] = s.zone.centroid;
          labels.push({ key: s.zone.id, lat, lng, alt: 0.02, el: makeLabel(s.zone.name, fmtScore(s.view), heatCss(Math.max(s.view, 35))) });
        });
    }
    labelsRef.current = labels;
    globe.htmlElementsData(labels);
  }, [byId, props.solo, props.scenarioActive]);

  useEffect(() => {
    const globe = globeRef.current;
    if (globe) globe.controls().autoRotate = props.autoRotate;
  }, [props.autoRotate]);

  useEffect(() => {
    const globe = globeRef.current;
    const bloom = bloomPassRef.current;
    if (!globe) return;
    if (bloom) bloom.enabled = !props.lowPower;
    if (placeLayerRef.current) placeLayerRef.current.budget = props.lowPower ? LABEL_BUDGET_LOW : LABEL_BUDGET;
    globe.renderer().setPixelRatio(props.lowPower ? 1 : Math.min(window.devicePixelRatio, 2));
    const host = hostRef.current;
    if (host) globe.width(host.clientWidth).height(host.clientHeight);
  }, [props.lowPower]);

  useEffect(() => {
    const globe = globeRef.current;
    const f = props.focus;
    if (!globe || !f) return;
    const z = byIdRef.current.get(f.id)?.zone;
    if (!z) return;
    const current = globe.pointOfView();
    globe.pointOfView({ lat: z.centroid[0], lng: z.centroid[1], altitude: Math.min(current.altitude, 1.9) }, 1000);
  }, [props.focus]);

  const sun = useMemo(() => subsolarPoint(new Date()), []);

  return (
    <div className="globe-wrap">
      <div
        ref={hostRef}
        className="globe-host"
        aria-label="3D heat globe. Drag to rotate, scroll or click to zoom in, double-click to reset."
        role="img"
      />
      <GlobeHud
        ref={hudRef}
        sweep={props.sweep && !props.lowPower}
        ready={globeReady && atlas !== null}
        resolution={props.resolution}
        zoneCount={props.baseZones.length}
        sunLabel={`${fmtLat(sun.lat)} ${fmtLng(sun.lng)}`}
        callsign={props.callsign}
      />
    </div>
  );
}
