/**
 * Tiny out-of-React channel between the globe and the HUD widgets that follow
 * it (mini-map, readouts). The camera moves every frame; routing that through
 * React state would re-render the whole instrument at 60 Hz.
 */
import { useSyncExternalStore } from "react";
import type { Atlas } from "./geo";

export type Pov = { lat: number; lng: number; altitude: number };

type Listener = () => void;

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const povStore = store<Pov>({ lat: 27, lng: 42, altitude: 2.35 });

export function usePov(): Pov {
  return useSyncExternalStore(povStore.subscribe, povStore.get, povStore.get);
}

/** The globe publishes its geodata so the mini-map can draw without a second download. */
export const atlasStore = store<Atlas | null>(null);

export function useAtlas(): Atlas | null {
  return useSyncExternalStore(atlasStore.subscribe, atlasStore.get, atlasStore.get);
}

type FlyTo = (lat: number, lng: number, altitude?: number) => void;
let flyHandler: FlyTo | null = null;

/** Registered by the globe; called by the mini-map, place cards and the detail panel. */
export const globeCommands = {
  register(fn: FlyTo | null) {
    flyHandler = fn;
  },
  /** Keeps the current altitude when none is given. */
  flyTo(lat: number, lng: number, altitude?: number) {
    flyHandler?.(lat, lng, altitude);
  },
};
