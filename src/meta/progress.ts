import { AIRPORTS, STARTER_IATAS } from './airports';
import { getRoute } from './routes';

const STORAGE_KEY = 'airways.progress.v3';
const LEGACY_KEYS = ['airways.progress.v2', 'airways.progress.v1'];

/** Kept here (not in economy) to avoid a circular import with progress ↔ economy. */
export const STARTER_AIRCRAFT_ID = 'c172rg';
/** Temporary testing balance so the full fleet and airport unlocks are buyable. */
export const STARTING_CREDITS = 100_000_000;

export interface Progress {
  /** Airport where the aircraft currently sits. */
  homeAirport: string;
  /** Cleared airports (can be flown to when a route + range allow). */
  unlockedAirports: string[];
  /**
   * Legacy directed route keys — kept for migration; open status prefers unlockedAirports.
   * Starter CE hops are always treated as cleared.
   */
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
  unlockedAirports: [...STARTER_IATAS],
  unlockedRoutes: [],
  successfulFlights: 0,
  crashes: 0,
  deaths: 0,
  credits: STARTING_CREDITS,
  ownedAircraft: [STARTER_AIRCRAFT_ID],
  activeAircraft: STARTER_AIRCRAFT_ID,
};

export function loadProgress(): Progress {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const k of LEGACY_KEYS) {
        raw = localStorage.getItem(k);
        if (raw) break;
      }
    }
    if (!raw) return clone(DEFAULT);
    const parsed = JSON.parse(raw) as Partial<Progress>;
    const unlockedAirports = new Set([...(parsed.unlockedAirports ?? []), ...STARTER_IATAS]);
    // Legacy v1/v2 treated every network route as open — map those destinations into airports.
    for (const id of parsed.unlockedRoutes ?? []) {
      const to = id.split('-')[1];
      if (to && AIRPORTS.some((a) => a.iata === to)) unlockedAirports.add(to);
    }
    // The ATR 42 placeholder became the ATR 72.
    const renamed = (id: string) => (id === 'at42' ? 'atr72' : id);
    const owned = parsed.ownedAircraft?.length ? [...new Set(parsed.ownedAircraft.map(renamed))] : [STARTER_AIRCRAFT_ID];
    if (!owned.includes(STARTER_AIRCRAFT_ID)) owned.unshift(STARTER_AIRCRAFT_ID);
    const home =
      parsed.homeAirport && AIRPORTS.some((a) => a.iata === parsed.homeAirport)
        ? parsed.homeAirport
        : DEFAULT.homeAirport;
    const active =
      parsed.activeAircraft && owned.includes(renamed(parsed.activeAircraft))
        ? renamed(parsed.activeAircraft)
        : STARTER_AIRCRAFT_ID;
    const next: Progress = {
      homeAirport: home,
      unlockedAirports: [...unlockedAirports],
      unlockedRoutes: parsed.unlockedRoutes ?? [],
      successfulFlights: parsed.successfulFlights ?? 0,
      crashes: parsed.crashes ?? 0,
      deaths: parsed.deaths ?? 0,
      // Top up older saves that still sit below the current testing starting balance.
      credits: typeof parsed.credits === 'number' ? Math.max(parsed.credits, STARTING_CREDITS) : STARTING_CREDITS,
      ownedAircraft: owned,
      activeAircraft: active,
    };
    saveProgress(next);
    return next;
  } catch {
    return clone(DEFAULT);
  }
}

export function saveProgress(p: Progress): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

export function isAirportUnlocked(p: Progress, iata: string): boolean {
  return p.unlockedAirports.includes(iata);
}

export function isRouteUnlocked(p: Progress, from: string, to: string): boolean {
  if (!isAirportUnlocked(p, from) || !isAirportUnlocked(p, to)) return false;
  return getRoute(from, to) !== undefined;
}

export function airportStatus(p: Progress, iata: string): 'home' | 'open' | 'locked' {
  if (iata === p.homeAirport) return 'home';
  return isAirportUnlocked(p, iata) ? 'open' : 'locked';
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
  return {
    ...p,
    unlockedAirports: [...p.unlockedAirports],
    unlockedRoutes: [...p.unlockedRoutes],
    ownedAircraft: [...p.ownedAircraft],
  };
}
