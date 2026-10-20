/**
 * Build-time stand-ins for dependencies of globe layers this app never uses
 * (three-globe's heatmap layer → three/webgpu + three/tsl; hexbin layers →
 * h3-js). vite.config.ts aliases those imports here, which removes ~1 MB from
 * the globe chunk. Every export throws if reached, so enabling one of those
 * layers fails loudly instead of silently.
 */
const unavailable = (what: string) => (): never => {
  throw new Error(`${what} is stubbed out in this build (see vite.config.ts). Remove the alias to use it.`);
};

// h3-js (hexBin / hexPolygon layers)
export const latLngToCell = unavailable("h3-js");
export const cellToLatLng = unavailable("h3-js");
export const cellToBoundary = unavailable("h3-js");
export const polygonToCells = unavailable("h3-js");

// three/webgpu (heatmap layer compute)
export class WebGPURenderer {
  constructor() {
    unavailable("three/webgpu")();
  }
}
export class StorageInstancedBufferAttribute {
  constructor() {
    unavailable("three/webgpu")();
  }
}

// three/tsl (heatmap layer compute)
export const Fn = unavailable("three/tsl");
export const If = unavailable("three/tsl");
export const uniform = unavailable("three/tsl");
export const storage = unavailable("three/tsl");
export const float = unavailable("three/tsl");
export const instanceIndex = unavailable("three/tsl");
export const Loop = unavailable("three/tsl");
export const sqrt = unavailable("three/tsl");
export const sin = unavailable("three/tsl");
export const cos = unavailable("three/tsl");
export const asin = unavailable("three/tsl");
export const exp = unavailable("three/tsl");
export const negate = unavailable("three/tsl");
