import { routeKey } from './airports';

const STORAGE_KEY = 'airways.progress.v1';

export interface Progress {
  homeAirport: string;
  unlockedRoutes: string[];
  /** Placeholder stats for the hub strip; filled by later career tracking. */
  successfulFlights: number;
  crashes: number;
  deaths: number;
}

const DEFAULT: Progress = {
  homeAirport: 'BTS',
  unlockedRoutes: [routeKey('BTS', 'VIE')],
  successfulFlights: 0,
  crashes: 0,
  deaths: 0,
};

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT, unlockedRoutes: [...DEFAULT.unlockedRoutes] };
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      homeAirport: parsed.homeAirport ?? DEFAULT.homeAirport,
      unlockedRoutes: parsed.unlockedRoutes?.length ? [...parsed.unlockedRoutes] : [...DEFAULT.unlockedRoutes],
      successfulFlights: parsed.successfulFlights ?? 0,
      crashes: parsed.crashes ?? 0,
      deaths: parsed.deaths ?? 0,
    };
  } catch {
    return { ...DEFAULT, unlockedRoutes: [...DEFAULT.unlockedRoutes] };
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
  if (p.unlockedRoutes.some((r) => r.startsWith(`${p.homeAirport}-`) && r.endsWith(`-${iata}`))) return 'open';
  return 'locked';
}
