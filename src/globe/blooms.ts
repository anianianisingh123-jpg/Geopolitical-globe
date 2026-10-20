import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  type Texture,
} from "three";
import type { Iso3 } from "../data/countries";
import { kmToUnits } from "./geo";

/**
 * A heat target lying on the surface (the group is oriented by three-globe
 * so local +Z is the outward normal):
 * - glow: soft additive disc, the heat itself
 * - core: small disc that pushes toward white as heat rises
 * - mark: crisp ring + four compass ticks in the heat colour (the "target")
 * - hit: invisible disc, smaller than the glow, so a wide bloom does not
 *   swallow clicks on neighbouring countries
 */
export type Bloom = {
  key: string;
  zoneId: string;
  nodeName: string | null;
  lat: number;
  lng: number;
  radiusKm: number;
  opacity: number;
  hostIso: Iso3 | null;
  group: Group;
  glow: Mesh<CircleGeometry, MeshBasicMaterial>;
  core: Mesh<CircleGeometry, MeshBasicMaterial>;
  ring: LineLoop<BufferGeometry, LineBasicMaterial>;
  ticks: LineSegments<BufferGeometry, LineBasicMaterial>;
  hit: Mesh<CircleGeometry, MeshBasicMaterial>;
  /** Written by the update pass, read by the animation loop. */
  state: { base: number; scale: number; coreGain: number; pulse: boolean; lift: number; visible: boolean };
};

let gradient: Texture | null = null;

function gradientTexture(): Texture {
  if (gradient) return gradient;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.22, "rgba(255,255,255,0.55)");
    g.addColorStop(0.5, "rgba(255,255,255,0.16)");
    g.addColorStop(0.8, "rgba(255,255,255,0.03)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  gradient = new CanvasTexture(canvas);
  gradient.colorSpace = SRGBColorSpace;
  return gradient;
}

const DISC = new CircleGeometry(1, 48);
const HIT_DISC = new CircleGeometry(1, 16);

const RING = (() => {
  const g = new BufferGeometry();
  const pts: number[] = [];
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    pts.push(Math.cos(t), Math.sin(t), 0);
  }
  g.setAttribute("position", new Float32BufferAttribute(pts, 3));
  return g;
})();

/** Four short ticks just outside the unit ring, at N/E/S/W. */
const TICKS = (() => {
  const g = new BufferGeometry();
  const a = 1.15;
  const b = 1.5;
  g.setAttribute(
    "position",
    new Float32BufferAttribute([0, a, 0, 0, b, 0, a, 0, 0, b, 0, 0, 0, -a, 0, 0, -b, 0, -a, 0, 0, -b, 0, 0], 3),
  );
  return g;
})();

const noRaycast = (): void => undefined;

const lineMat = () =>
  new LineBasicMaterial({ color: new Color("#c9a44c"), transparent: true, opacity: 0, depthTest: false, depthWrite: false });

export function createBloom(init: Omit<Bloom, "group" | "glow" | "core" | "ring" | "ticks" | "hit" | "state">): Bloom {
  const glowMat = new MeshBasicMaterial({
    map: gradientTexture(),
    color: new Color("#c98a2b"),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const glow = new Mesh(DISC, glowMat);
  const core = new Mesh(DISC, glowMat.clone());
  const ring = new LineLoop(RING, lineMat());
  const ticks = new LineSegments(TICKS, lineMat());
  for (const o of [glow, core, ring, ticks]) o.raycast = noRaycast;
  glow.renderOrder = 10;
  core.renderOrder = 11;
  ring.renderOrder = 12;
  ticks.renderOrder = 12;

  const hit = new Mesh(HIT_DISC, new MeshBasicMaterial({ visible: false }));
  hit.scale.setScalar(Math.max(kmToUnits(init.radiusKm) * 0.45, kmToUnits(70)));

  const group = new Group();
  group.add(glow, core, ring, ticks, hit);
  return {
    ...init,
    group,
    glow,
    core,
    ring,
    ticks,
    hit,
    state: { base: 0, scale: 1, coreGain: 0, pulse: false, lift: 0, visible: false },
  };
}

export function disposeBloom(b: Bloom): void {
  b.glow.material.dispose();
  b.core.material.dispose();
  b.ring.material.dispose();
  b.ticks.material.dispose();
  b.hit.material.dispose();
}
