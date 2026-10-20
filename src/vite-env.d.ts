/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE?: string;
  /** Absolute origin of a hosted intel process, e.g. https://intel.example.com */
  readonly VITE_INTEL_URL?: string;
  /** "1" = read /api/intel/*.json snapshots (GitHub Pages). */
  readonly VITE_INTEL_STATIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
