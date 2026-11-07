import { routeKey } from './airports';
import { NETWORK_ROUTE_IDS } from './routes';

const STORAGE_KEY = 'airways.progress.v2';
const LEGACY_KEY = 'airways.progress.v1';

/** Kept here (not in economy) to avoid a circular import with progress ↔ economy. */
export const STARTER_AIRCRAFT_ID = 'c172rg';
export const STARTING_CREDITS = 7500;

export interface Progress {
  /** Airport where the aircraft currently sits. */
  homeAirport: string;
  unlockedRoutes: string[];
  successfulFlights: number;
  crashes: number;
  deaths: number;
  /** Soft currency (€ charter credits). */
  credits: number;
  ownedAircraft: string[];
  activeAircraft: string;
}

const DEFAULT: Progress = {
  homeAirport: 'BTS',
  unlockedRoutes: [...NETWORK_ROUTE_IDS],
  successfulFlights: 0,
  crashes: 0,
  deaths: 0,
  credits: STARTING_CREDITS,
  ownedAircraft: [STARTER_AIRCRAFT_ID],
  activeAircraft: STARTER_AIRCRAFT_ID,
};

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return clone(DEFAULT);
    const parsed = JSON.parse(raw) as Partial<Progress>;
    // Always merge in the current network so new hops appear without a progress wipe.
    const unlocked = new Set([...(parsed.unlockedRoutes ?? []), ...NETWORK_ROUTE_IDS]);
    const owned = parsed.ownedAircraft?.length ? [...parsed.ownedAircraft] : [STARTER_AIRCRAFT_ID];
    if (!owned.includes(STARTER_AIRCRAFT_ID)) owned.unshift(STARTER_AIRCRAFT_ID);
    const active =
      parsed.activeAircraft && owned.includes(parsed.activeAircraft)
        ? parsed.activeAircraft
        : STARTER_AIRCRAFT_ID;
    const next: Progress = {
      homeAirport: parsed.homeAirport ?? DEFAULT.homeAirport,
      unlockedRoutes: [...unlocked],
      successfulFlights: parsed.successfulFlights ?? 0,
      crashes: parsed.crashes ?? 0,
      deaths: parsed.deaths ?? 0,
      credits: typeof parsed.credits === 'number' ? parsed.credits : STARTING_CREDITS,
      ownedAircraft: owned,
      activeAircraft: active,
    };
    // Persist migration to v2.
    saveProgress(next);
    return next;
  } catch {
    return clone(DEFAULT);
  }
}

export function saveProgress(p: Progress): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

export function isRouteUnlocked(p: Progress, from: string, to: string): boolean {
  return p.unlockedRoutes.includes(routeKey(from, to));
}

export function airportStatus(p: Progress, iata: string): 'home' | 'open' | 'locked' {
  if (iata === p.homeAirport) return 'home';
  if (p.unlockedRoutes.some((r) => r === routeKey(p.homeAirport, iata))) return 'open';
  return 'locked';
}

/** After a safe arrival the fleet relocates to the destination (credits applied separately). */
export function recordSuccess(p: Progress, destIata: string): Progress {
  const next = {
    ...p,
    homeAirport: destIata,
    successfulFlights: p.successfulFlights + 1,
  };
  saveProgress(next);
  return next;
}

export function recordCrash(p: Progress, soulsOnBoard: number): Progress {
  const next = {
    ...p,
    crashes: p.crashes + 1,
    deaths: p.deaths + Math.max(0, soulsOnBoard),
  };
  saveProgress(next);
  return next;
}

function clone(p: Progress): Progress {
  return { ...p, unlockedRoutes: [...p.unlockedRoutes], ownedAircraft: [...p.ownedAircraft] };
}
