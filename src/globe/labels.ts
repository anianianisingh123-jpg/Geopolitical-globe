/**
 * Level-of-detail place labels, drawn as a DOM overlay above the globe.
 *
 * Every item carries `maxAlt`, the camera altitude (in globe radii above the
 * surface) below which it may appear, and a priority. A selection pass, run
 * at most ~10 times a second while the camera moves, walks items by priority
 * and keeps those that are zoomed-in enough, face the camera, sit in the
 * viewport and don't collide with a label already placed, up to a budget.
 * A cheap positioning pass moves the placed labels every frame.
 *
 * Labels never take pointer events: dragging and wheel-zoom pass straight to
 * the globe. Clicks are hit-tested against the placed boxes instead (`hit`).
 */
import { Vector3, type Camera } from "three";
import { GLOBE_RADIUS, toXYZ } from "./geo";

export type LabelKind = "site" | "event" | "capital" | "city" | "town" | "province" | "fire";

export type LabelItem = {
  id: string;
  lat: number;
  lng: number;
  kind: LabelKind;
  text: string;
  /** Short secondary text (population, distance). */
  sub?: string;
  /** Category chip for sites ("FRONT", "PORT"). */
  tag?: string;
  /** Headline count for sites named in live news. */
  badge?: number;
  /** Selected zone or live mention: drawn brighter. */
  hot?: boolean;
  /** Site subtype, exposed as data-kind for styling. */
  variant?: string;
  priority: number;
  maxAlt: number;
  /** Caller payload returned by `hit`. */
  data?: unknown;
};

type Prepared = LabelItem & {
  ux: number;
  uy: number;
  uz: number;
  w: number;
  h: number;
  sig: string;
  // screen state, valid while placed
  /** Text drawn to the left of the marker (the right side was taken). */
  left: boolean;
  sx: number;
  sy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/** Approximate glyph widths (px per character) per label style. */
const METRICS: Record<LabelKind, { char: number; h: number; lead: number; center?: boolean }> = {
  site: { char: 6.6, h: 16, lead: 14 },
  event: { char: 6.6, h: 16, lead: 14 },
  fire: { char: 6.2, h: 15, lead: 12 },
  capital: { char: 6.4, h: 15, lead: 11 },
  city: { char: 6.0, h: 14, lead: 9 },
  town: { char: 5.5, h: 13, lead: 8 },
  province: { char: 6.8, h: 13, lead: 0, center: true },
};

const CELL = 96;
const LIFT = 1.0025;
const MAX_POOL = 700;

const sigOf = (i: LabelItem): string => `${i.text}|${i.sub ?? ""}|${i.tag ?? ""}|${i.badge ?? 0}|${i.hot ? 1 : 0}|${i.variant ?? ""}`;

export class LabelLayer {
  readonly root: HTMLDivElement;
  budget = 170;
  private items: Prepared[] = [];
  private placed: Prepared[] = [];
  private pool = new Map<string, HTMLElement>();
  private dirty = true;
  private lastSelect = 0;
  private lastCam = "";
  private hoverId: string | null = null;
  private readonly v = new Vector3();

  /** The overlay is inserted right after `canvasHost`, so later siblings (the HUD) draw above it. */
  constructor(canvasHost: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "plabels";
    this.root.setAttribute("aria-hidden", "true");
    canvasHost.after(this.root);
  }

  setItems(items: readonly LabelItem[]): void {
    const prev = new Map(this.items.map((p) => [p.id, p]));
    this.items = items
      .map((i) => {
        const old = prev.get(i.id);
        const [x, y, z] = old && old.lat === i.lat && old.lng === i.lng ? [old.ux, old.uy, old.uz] : toXYZ(i.lat, i.lng, 1);
        const m = METRICS[i.kind];
        const chars = i.text.length + (i.sub ? i.sub.length + 1 : 0) + (i.tag ? i.tag.length + 1 : 0) + (i.badge ? 3 : 0);
        return {
          ...i,
          ux: x,
          uy: y,
          uz: z,
          w: m.lead + chars * m.char + 8,
          h: m.h,
          sig: sigOf(i),
          left: old?.left ?? false,
          sx: 0,
          sy: 0,
          x0: 0,
          y0: 0,
          x1: 0,
          y1: 0,
        };
      })
      .sort((a, b) => b.priority - a.priority);
    this.dirty = true;
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? "" : "none";
    this.dirty = true;
  }

  /** Call every animation frame. */
  frame(t: number, camera: Camera, width: number, height: number, altitude: number): void {
    if (this.root.style.display === "none") return;
    const e = camera.matrixWorld.elements;
    const key = `${e[12]?.toFixed(3)}|${e[13]?.toFixed(3)}|${e[14]?.toFixed(3)}|${e[0]?.toFixed(4)}|${e[1]?.toFixed(4)}|${width}|${height}`;
    const moved = key !== this.lastCam;
    this.lastCam = key;
    if (this.dirty || (moved && t - this.lastSelect > 90)) {
      this.lastSelect = t;
      this.dirty = false;
      this.select(camera, width, height, altitude);
    } else if (moved) this.position(camera, width, height);
  }

  /** Topmost placed label under a point in host pixels. */
  hit(x: number, y: number): LabelItem | null {
    for (const p of this.placed) {
      if (p.kind === "province") continue;
      if (x >= p.x0 - 3 && x <= p.x1 + 3 && y >= p.y0 - 3 && y <= p.y1 + 3) return p;
    }
    return null;
  }

  hover(id: string | null): void {
    if (id === this.hoverId) return;
    if (this.hoverId) this.pool.get(this.hoverId)?.classList.remove("pl-hover");
    this.hoverId = id;
    if (id) this.pool.get(id)?.classList.add("pl-hover");
  }

  dispose(): void {
    this.root.remove();
    this.pool.clear();
    this.items = [];
    this.placed = [];
  }

  private project(p: Prepared, camera: Camera, w: number, h: number): boolean {
    const r = GLOBE_RADIUS * LIFT;
    this.v.set(p.ux * r, p.uy * r, p.uz * r).project(camera);
    if (this.v.z > 1) return false;
    p.sx = ((this.v.x + 1) / 2) * w;
    p.sy = ((1 - this.v.y) / 2) * h;
    box(p, p.left);
    return true;
  }

  private select(camera: Camera, w: number, h: number, altitude: number): void {
    const cam = camera.position;
    const dist = cam.length();
    const cx = cam.x / dist;
    const cy = cam.y / dist;
    const cz = cam.z / dist;
    // Points whose normal is within this of the view direction are on the visible cap.
    const horizon = GLOBE_RADIUS / dist + 0.012;
    const grid = new Map<number, Prepared[]>();
    const placed: Prepared[] = [];
    const clashes = (p: Prepared): boolean => {
      const i0 = Math.floor(p.x0 / CELL);
      const i1 = Math.floor(p.x1 / CELL);
      const j0 = Math.floor(p.y0 / CELL);
      const j1 = Math.floor(p.y1 / CELL);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++)
          for (const q of grid.get(i * 10007 + j) ?? []) if (p.x0 < q.x1 + 4 && p.x1 > q.x0 - 4 && p.y0 < q.y1 + 2 && p.y1 > q.y0 - 2) return true;
      return false;
    };
    const add = (p: Prepared) => {
      for (let i = Math.floor(p.x0 / CELL); i <= Math.floor(p.x1 / CELL); i++)
        for (let j = Math.floor(p.y0 / CELL); j <= Math.floor(p.y1 / CELL); j++) {
          const k = i * 10007 + j;
          const l = grid.get(k);
          if (l) l.push(p);
          else grid.set(k, [p]);
        }
    };

    for (const p of this.items) {
      if (p.maxAlt < altitude) continue;
      if (p.ux * cx + p.uy * cy + p.uz * cz < horizon) continue;
      if (!this.project(p, camera, w, h)) continue;
      if (p.sx < -40 || p.sx > w + 40 || p.sy < -10 || p.sy > h + 10) continue;
      // Text right of the marker first, then left of it.
      box(p, false);
      if (clashes(p) || p.x1 > w) {
        if (METRICS[p.kind].center) continue;
        box(p, true);
        if (clashes(p) || p.x0 < 0) continue;
      }
      add(p);
      placed.push(p);
      if (placed.length >= this.budget) break;
    }

    const keep = new Set(placed.map((p) => p.id));
    for (const p of this.placed) if (!keep.has(p.id)) this.pool.get(p.id)?.style.setProperty("display", "none");
    for (const p of placed) {
      let el = this.pool.get(p.id);
      if (!el || el.dataset["sig"] !== p.sig) {
        el?.remove();
        el = build(p);
        el.dataset["sig"] = p.sig;
        this.pool.set(p.id, el);
        this.root.append(el);
      }
      el.style.display = "";
      el.classList.toggle("pl-hover", p.id === this.hoverId);
      el.classList.toggle("pl-left", p.left);
      el.style.transform = place(p);
    }
    this.placed = placed;

    if (this.pool.size > MAX_POOL) {
      for (const [id, el] of this.pool) {
        if (keep.has(id)) continue;
        el.remove();
        this.pool.delete(id);
        if (this.pool.size <= MAX_POOL * 0.7) break;
      }
    }
  }

  private position(camera: Camera, w: number, h: number): void {
    for (const p of this.placed) {
      const el = this.pool.get(p.id);
      if (!el || !this.project(p, camera, w, h)) continue;
      el.style.transform = place(p);
    }
  }
}

/** Screen box for a label anchored at (sx, sy), with its text right or left of the marker. */
function box(p: Prepared, left: boolean): void {
  p.left = left;
  if (METRICS[p.kind].center) {
    p.x0 = p.sx - p.w / 2;
    p.x1 = p.sx + p.w / 2;
  } else if (left) {
    p.x0 = p.sx + 5 - p.w;
    p.x1 = p.sx + 5;
  } else {
    p.x0 = p.sx - 5;
    p.x1 = p.sx - 5 + p.w;
  }
  p.y0 = p.sy - p.h / 2;
  p.y1 = p.sy + p.h / 2;
}

const place = (p: Prepared): string =>
  `translate3d(${p.sx.toFixed(1)}px,${p.sy.toFixed(1)}px,0)${p.left ? " translateX(-100%)" : ""}`;

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

function build(p: Prepared): HTMLElement {
  const el = document.createElement("div");
  el.className = `pl pl-${p.kind}${p.hot ? " pl-hot" : ""}`;
  if (p.variant) el.dataset["kind"] = p.variant;
  if (p.kind === "province") {
    el.append(span("pl-name", p.text));
    return el;
  }
  const mark = document.createElement("i");
  mark.className = "pl-mark";
  el.append(mark, span("pl-name", p.text));
  if (p.tag) el.append(span("pl-tag", p.tag));
  if (p.sub) el.append(span("pl-sub", p.sub));
  if (p.badge) el.append(span("pl-badge", String(p.badge)));
  return el;
}
