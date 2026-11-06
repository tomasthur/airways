import { routeKey } from './airports';
import { NETWORK_ROUTE_IDS } from './routes';

const STORAGE_KEY = 'airways.progress.v1';

export interface Progress {
  /** Airport where the aircraft currently sits. */
  homeAirport: string;
  unlockedRoutes: string[];
  successfulFlights: number;
  crashes: number;
  deaths: number;
}

const DEFAULT: Progress = {
  homeAirport: 'BTS',
  unlockedRoutes: [...NETWORK_ROUTE_IDS],
  successfulFlights: 0,
  crashes: 0,
  deaths: 0,
};

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULT);
    const parsed = JSON.parse(raw) as Partial<Progress>;
    // Always merge in the current network so new hops appear without a progress wipe.
    const unlocked = new Set([...(parsed.unlockedRoutes ?? []), ...NETWORK_ROUTE_IDS]);
    return {
      homeAirport: parsed.homeAirport ?? DEFAULT.homeAirport,
      unlockedRoutes: [...unlocked],
      successfulFlights: parsed.successfulFlights ?? 0,
      crashes: parsed.crashes ?? 0,
      deaths: parsed.deaths ?? 0,
    };
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

/** After a safe arrival the fleet relocates to the destination. */
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
  return { ...p, unlockedRoutes: [...p.unlockedRoutes] };
}
