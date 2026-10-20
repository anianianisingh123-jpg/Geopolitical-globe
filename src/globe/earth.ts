import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  NoColorSpace,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  type Texture,
} from "three";
import type { MultiLineString, Position } from "geojson";
import type { CountryShape } from "./geo";
import { subsolarPoint } from "./format";
import { GLOBE_RADIUS, toXYZ } from "./geo";

export { subsolarPoint };

/* ───────────────────────── palette (navy / gold) ───────────────────────── */

export const EARTH = {
  water: "#040c1c",
  waterDeep: "#02060f",
  land: "#1a2f52",
  landDay: "#243f69",
  coast: "#6f93c8",
  border: "#5a7cb0",
  lights: "#e9c46a",
  graticule: "#1b3259",
};

/* ───────────────────────── land mask from vectors ───────────────────────── */

/**
 * Rasterise country polygons into an equirectangular mask (white = land).
 * Generated from Natural Earth vectors at runtime, so coastlines stay crisp
 * at any zoom the camera allows, unlike the stock 1600px water texture.
 */
export function landMask(countries: readonly CountryShape[], width: number): CanvasTexture {
  const height = width / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    const x = (lng: number) => ((lng + 180) / 360) * width;
    const y = (lat: number) => ((90 - lat) / 180) * height;
    const ring = (r: Position[]) => {
      r.forEach(([lng = 0, lat = 0], i) => (i === 0 ? ctx.moveTo(x(lng), y(lat)) : ctx.lineTo(x(lng), y(lat))));
      ctx.closePath();
    };
    for (const c of countries) {
      const polys = c.geometry.type === "Polygon" ? [c.geometry.coordinates] : c.geometry.coordinates;
      for (const p of polys) {
        // Skip polygons that wrap the antimeridian in raw lng space (none at 50m/110m except Antarctica's closure).
        ctx.beginPath();
        p.forEach(ring);
        ctx.fill("evenodd");
      }
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = NoColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/* ───────────────────────── sun position ───────────────────────── */

export function sunDirection(date: Date, out = new Vector3()): Vector3 {
  const { lat, lng } = subsolarPoint(date);
  const [x, y, z] = toXYZ(lat, lng, 1);
  return out.set(x, y, z).normalize();
}

/* ───────────────────────── earth material ───────────────────────── */

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uMask;
  uniform sampler2D uLights;
  uniform vec2 uTexel;
  uniform vec3 uSun;
  uniform vec3 uWater;
  uniform vec3 uWaterDeep;
  uniform vec3 uLand;
  uniform vec3 uLandDay;
  uniform vec3 uCoast;
  uniform vec3 uLightsTint;
  uniform float uHasLights;
  uniform float uCoastGain;
  uniform float uLightsGain;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  void main() {
    float land = texture2D(uMask, vUv).r;
    // Coastline: gradient of the mask, one texel either side.
    float gx = texture2D(uMask, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uMask, vUv - vec2(uTexel.x, 0.0)).r;
    float gy = texture2D(uMask, vUv + vec2(0.0, uTexel.y)).r - texture2D(uMask, vUv - vec2(0.0, uTexel.y)).r;
    float coast = clamp(length(vec2(gx, gy)) * 1.4, 0.0, 1.0);

    vec3 n = normalize(vNormalW);
    float sun = dot(n, uSun);
    float day = smoothstep(-0.10, 0.18, sun);
    float terminator = 1.0 - smoothstep(0.0, 0.07, abs(sun + 0.02));

    // Water deepens toward the limb; land lifts slightly on the day side.
    float facing = clamp(dot(n, normalize(vViewDir)), 0.0, 1.0);
    vec3 water = mix(uWaterDeep, uWater, pow(facing, 0.6)) * (0.7 + 0.3 * day);
    vec3 landC = mix(uLand * 0.62, uLandDay, day);
    vec3 col = mix(water, landC, land);

    // City lights only on the night side, only on land, tinted gold.
    vec3 lights = texture2D(uLights, vUv).rgb;
    float lum = dot(lights, vec3(0.299, 0.587, 0.114));
    // The source texture carries faint land (~0.03 linear) under the cities (~0.1–0.2); keep only the cities.
    float city = smoothstep(0.045, 0.2, lum);
    col += uLightsTint * city * (1.0 - day) * land * 1.7 * uHasLights * uLightsGain;

    col += uCoast * coast * (0.55 + 0.25 * day) * uCoastGain;
    col += vec3(0.55, 0.45, 0.2) * terminator * 0.05;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export type EarthMaterial = ShaderMaterial & {
  uniforms: {
    uMask: { value: Texture | null };
    uLights: { value: Texture | null };
    uTexel: { value: Vector2 };
    uSun: { value: Vector3 };
    uHasLights: { value: number };
    /** Mask-edge glow. The mask is ~10 km per texel, so close in the vector coastline takes over. */
    uCoastGain: { value: number };
    /** City lights. The texture is coarse; close in its blobs read as fires, and labels name the cities anyway. */
    uLightsGain: { value: number };
  };
};

const linear = (hex: string): Color => new Color(hex);

export function createEarthMaterial(): EarthMaterial {
  const mat = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uMask: { value: null },
      uLights: { value: null },
      uTexel: { value: new Vector2(1 / 4096, 1 / 2048) },
      uSun: { value: sunDirection(new Date()) },
      uWater: { value: linear(EARTH.water) },
      uWaterDeep: { value: linear(EARTH.waterDeep) },
      uLand: { value: linear(EARTH.land) },
      uLandDay: { value: linear(EARTH.landDay) },
      uCoast: { value: linear(EARTH.coast) },
      uLightsTint: { value: linear(EARTH.lights) },
      uHasLights: { value: 0 },
      uCoastGain: { value: 1 },
      uLightsGain: { value: 1 },
    },
  });
  return mat as EarthMaterial;
}

export function loadLights(url: string, mat: EarthMaterial): void {
  new TextureLoader().load(url, (tex) => {
    tex.colorSpace = SRGBColorSpace;
    mat.uniforms.uLights.value = tex;
    mat.uniforms.uHasLights.value = 1;
  });
}

/* ───────────────────────── vector line layers ───────────────────────── */

function segments(lines: Position[][], r: number): Float32BufferAttribute {
  const pts: number[] = [];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (!a || !b) continue;
      pts.push(...toXYZ(a[1] ?? 0, a[0] ?? 0, r), ...toXYZ(b[1] ?? 0, b[0] ?? 0, r));
    }
  }
  return new Float32BufferAttribute(pts, 3);
}

export function lineLayer(ml: MultiLineString, color: string, opacity: number, lift = 0.0015): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute("position", segments(ml.coordinates, GLOBE_RADIUS * (1 + lift)));
  const obj = new LineSegments(geo, new LineBasicMaterial({ color: new Color(color), transparent: true, opacity, depthWrite: false }));
  obj.renderOrder = 2;
  return obj;
}

/** 15° graticule, sampled every 2° so lines follow the sphere. */
export function graticule(): LineSegments {
  const lines: Position[][] = [];
  for (let lat = -75; lat <= 75; lat += 15) {
    const l: Position[] = [];
    for (let lng = -180; lng <= 180; lng += 2) l.push([lng, lat]);
    lines.push(l);
  }
  for (let lng = -180; lng < 180; lng += 15) {
    const l: Position[] = [];
    for (let lat = -88; lat <= 88; lat += 2) l.push([lng, lat]);
    lines.push(l);
  }
  return lineLayer({ type: "MultiLineString", coordinates: lines }, EARTH.graticule, 0.55, 0.001);
}
