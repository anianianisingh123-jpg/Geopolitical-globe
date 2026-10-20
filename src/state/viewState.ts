import { DEFAULT_WEIGHTS, DRIVERS, type Driver, type ScenarioId, type Weights } from "../data/schema";
import type { ViewMode } from "../model/score";

export type SortKey = "score" | "name";

export type ViewState = {
  mode: ViewMode;
  /** Active driver layers when mode === "layers" (kept in DRIVERS order). */
  layers: Driver[];
  weights: Weights;
  scenario: ScenarioId;
  risingOnly: boolean;
  sort: SortKey;
  query: string;
  selectedId: string | null;
  /** Fly-to request; nonce lets the same zone be re-focused. */
  focus: { id: string; nonce: number } | null;
  railOpen: boolean;
  showLinks: boolean;
  showRoutes: boolean;
  autoRotate: boolean;
  showFires: boolean;
  /** Zoom-dependent city, town, province and site labels. */
  showPlaces: boolean;
  /** GDELT-reported violent events as map pins. */
  showEvents: boolean;
  sweep: boolean;
  lowPower: boolean;
  feedOpen: boolean;
  /** Pinned zone ids, in pin order. */
  watchlist: string[];
};

export const initialViewState: ViewState = {
  mode: "composite",
  layers: [],
  weights: DEFAULT_WEIGHTS,
  scenario: "baseline",
  risingOnly: false,
  sort: "score",
  query: "",
  selectedId: null,
  focus: null,
  railOpen: true,
  showLinks: false,
  showRoutes: true,
  autoRotate: false,
  showFires: true,
  showPlaces: true,
  showEvents: true,
  sweep: true,
  lowPower: false,
  feedOpen: true,
  watchlist: [],
};

export type ViewAction =
  | { type: "toggleLayer"; driver: Driver }
  | { type: "soloLayer"; driver: Driver }
  | { type: "composite" }
  | { type: "setWeight"; driver: Driver; value: number }
  | { type: "resetWeights" }
  | { type: "setScenario"; scenario: ScenarioId }
  | { type: "toggleRising" }
  | { type: "setSort"; sort: SortKey }
  | { type: "setQuery"; query: string }
  | { type: "select"; id: string | null; focus?: boolean }
  | { type: "toggleRail" }
  | { type: "toggleLinks" }
  | { type: "toggleRoutes" }
  | { type: "toggleAutoRotate" }
  | { type: "toggleSweep" }
  | { type: "toggleFires" }
  | { type: "togglePlaces" }
  | { type: "toggleEvents" }
  | { type: "setLowPower"; value: boolean }
  | { type: "toggleFeed" }
  | { type: "toggleWatch"; id: string }
  | { type: "setWatchlist"; ids: string[] };

const ordered = (set: Set<Driver>): Driver[] => DRIVERS.filter((d) => set.has(d));

export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "toggleLayer": {
      // From composite, the first toggle solos that layer.
      if (state.mode === "composite") return { ...state, mode: "layers", layers: [action.driver] };
      const next = new Set(state.layers);
      if (next.has(action.driver)) next.delete(action.driver);
      else next.add(action.driver);
      return next.size === 0 ? { ...state, mode: "composite", layers: [] } : { ...state, layers: ordered(next) };
    }
    case "soloLayer":
      return { ...state, mode: "layers", layers: [action.driver] };
    case "composite":
      return { ...state, mode: "composite", layers: [] };
    case "setWeight":
      return { ...state, weights: { ...state.weights, [action.driver]: Math.max(0, Math.min(1, action.value)) } };
    case "resetWeights":
      return { ...state, weights: DEFAULT_WEIGHTS };
    case "setScenario":
      return { ...state, scenario: action.scenario };
    case "toggleRising":
      return { ...state, risingOnly: !state.risingOnly };
    case "setSort":
      return { ...state, sort: action.sort };
    case "setQuery":
      return { ...state, query: action.query };
    case "select": {
      const focus = action.id && action.focus ? { id: action.id, nonce: (state.focus?.nonce ?? 0) + 1 } : state.focus;
      return { ...state, selectedId: action.id, focus };
    }
    case "toggleRail":
      return { ...state, railOpen: !state.railOpen };
    case "toggleLinks":
      return { ...state, showLinks: !state.showLinks };
    case "toggleRoutes":
      return { ...state, showRoutes: !state.showRoutes };
    case "toggleAutoRotate":
      return { ...state, autoRotate: !state.autoRotate };
    case "toggleSweep":
      return { ...state, sweep: !state.sweep };
    case "toggleFires":
      return { ...state, showFires: !state.showFires };
    case "togglePlaces":
      return { ...state, showPlaces: !state.showPlaces };
    case "toggleEvents":
      return { ...state, showEvents: !state.showEvents };
    case "setLowPower":
      return { ...state, lowPower: action.value };
    case "toggleFeed":
      return { ...state, feedOpen: !state.feedOpen };
    case "toggleWatch":
      return {
        ...state,
        watchlist: state.watchlist.includes(action.id)
          ? state.watchlist.filter((w) => w !== action.id)
          : [...state.watchlist, action.id].slice(-8),
      };
    case "setWatchlist":
      return { ...state, watchlist: action.ids };
  }
}

/** The single driver on screen, if exactly one layer is active. */
export const soloDriver = (s: ViewState): Driver | null =>
  s.mode === "layers" && s.layers.length === 1 ? (s.layers[0] ?? null) : null;
