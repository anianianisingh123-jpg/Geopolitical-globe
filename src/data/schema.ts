import type { MultiPolygon, Polygon } from "geojson";
import type { CountryShares } from "./countries";

/**
 * Drivers in keyboard order (keys 1–8). The derived type is exactly
 *   "kinetic" | "frozen" | "maritime" | "nuclear" | "sanctions" | "regime" | "resource" | "great_power"
 */
export const DRIVERS = [
  "kinetic",
  "frozen",
  "maritime",
  "nuclear",
  "sanctions",
  "regime",
  "resource",
  "great_power",
] as const;

export type Driver = (typeof DRIVERS)[number];
export type Trend = "rising" | "stable" | "falling";
export type Confidence = "high" | "medium" | "low";
/** [lat, lng] — every coordinate in this data layer is lat-first, except GeoJSON geometry. */
export type LatLng = [lat: number, lng: number];

/** Rendering/grouping hint. The composite never reads it. */
export type ZoneKind = "theater" | "chokepoint" | "network" | "corridor";

export type DriverDetail = {
  driver: Driver;
  /** Driver intensity, 0–100. Multiplied by the global driver weight to give composite points. */
  weight: number;
  note: string;
};

export type SearchLink = { label: string; query: string };
export type ZoneNode = { name: string; coord: LatLng; radiusKm?: number };
export type ZoneRoute = { name: string; path: LatLng[] };
export type RangeRing = { name: string; center: LatLng; km: number };

export type HeatZone = {
  id: string;
  name: string;
  region: string;
  /** Primary classification (drives chips and search). Layer membership comes from drivers_detail. */
  drivers: Driver[];
  /** 0–100 composite at default weights, baseline scenario. Computed from drivers_detail, never hand-entered. */
  score: number;
  trend: Trend;
  centroid: LatLng;
  /** Footprint where a real sub-national or maritime extent exists. GeoJSON order: [lng, lat]. */
  polygon?: Polygon | MultiPolygon;
  /** Point bloom radius for chokepoints, cities, facilities. For kind "network" it is only the default node radius. */
  radiusKm?: number;
  summary: string;
  drivers_detail: DriverDetail[];
  /** Falsifiers and tripwires. */
  watch: string[];
  /** Search queries, not URLs. */
  links: SearchLink[];

  // — Extensions to the base schema —
  kind: ZoneKind;
  /** Analyst confidence in the score itself (not in the underlying facts). */
  confidence: Confidence;
  /** ISO date the zone was last checked against current reporting; absent = dataset seed date. */
  reviewed?: string;
  /** Country polygons this zone heats, with a share of its score (max-aggregated per country). */
  countries?: CountryShares;
  /** Additional point blooms (fab nodes, silo fields, load ports). */
  nodes?: ZoneNode[];
  /** Lanes drawn as thin paths (shadow-fleet lanes, export routes, cable corridors). */
  routes?: ZoneRoute[];
  /** Strike-range rings, shown when the zone is selected or the nuclear layer is soloed. */
  ranges?: RangeRing[];
  /** Bloom opacity multiplier, for deliberately faint layers. Default 1. */
  opacity?: number;
};

/** What an author writes; `score` is derived. */
export type HeatZoneInput = Omit<HeatZone, "score">;

export type Weights = Record<Driver, number>;

/**
 * Default driver weights. They sum to 1.00, so the composite of a zone at
 * 100 on every weighted driver is exactly 100. `frozen` is 0: frozen conflicts
 * score through their kinetic residual and great-power exposure, not through a
 * synthetic war score. The frozen intensity is still used when that layer is soloed.
 */
export const DEFAULT_WEIGHTS: Weights = {
  kinetic: 0.3,
  frozen: 0,
  maritime: 0.15,
  nuclear: 0.2,
  sanctions: 0.08,
  regime: 0.07,
  resource: 0.05,
  great_power: 0.15,
};

export const DRIVER_META: Record<Driver, { label: string; short: string; blurb: string }> = {
  kinetic: { label: "Kinetic", short: "KIN", blurb: "Active use of force: fronts, strikes, insurgency tempo." },
  frozen: {
    label: "Frozen",
    short: "FRZ",
    blurb: "Unresolved lines. Weight 0 by default; scores via kinetic residual + great power.",
  },
  maritime: { label: "Maritime", short: "MAR", blurb: "Chokepoint and sea-lane exposure." },
  nuclear: { label: "Nuclear", short: "NUC", blurb: "Nuclear and missile posture, thresholds, verification gaps." },
  sanctions: { label: "Sanctions", short: "SAN", blurb: "Economic statecraft, enforcement and leakage." },
  regime: { label: "Regime", short: "REG", blurb: "State control, coups, governance breakdown." },
  resource: { label: "Resource", short: "RES", blurb: "Critical minerals, energy, food, data infrastructure." },
  great_power: { label: "Great power", short: "GP", blurb: "Direct US–China–Russia deterrence interfaces." },
};

export type LinkKind = "proxy" | "supply" | "exposure";

export type LinkArc = {
  id: string;
  label: string;
  kind: LinkKind;
  from: LatLng;
  to: LatLng;
  note: string;
};

export type ScenarioId = "baseline" | "escalation";

export type ScenarioAdjustment = {
  zoneId: string;
  /** One line, stated in the detail panel. */
  assumption: string;
  /** Added to driver intensities before weighting, then clamped to 0–100. */
  deltas: Partial<Record<Driver, number>>;
  trend?: Trend;
};

export type Scenario = {
  id: ScenarioId;
  label: string;
  assumption: string;
  adjustments: ScenarioAdjustment[];
};

export type HeatDataset = {
  asOf: string;
  source: string;
  zones: HeatZone[];
  links: LinkArc[];
  scenarios: Record<ScenarioId, Scenario>;
};
