/**
 * Charter economy: distance-based fares, landing quality, fleet seat multipliers.
 */
import { t } from '../i18n';
import { airportByIata } from './airports';
import {
  isAirportUnlocked,
  loadProgress,
  saveProgress,
  STARTER_AIRCRAFT_ID,
  STARTING_CREDITS,
  type Progress,
} from './progress';

export { STARTER_AIRCRAFT_ID, STARTING_CREDITS };

export interface FleetAircraft {
  id: string;
  name: string;
  shortName: string;
  /** Passenger seats (crew excluded). */
  seats: number;
  /** Purchase price; 0 = starter. */
  price: number;
  /** Multiplier on charter fare (capacity / class). */
  seatsMult: number;
  /** Multiplier on crash repair bills. */
  repairMult: number;
  /**
   * Practical one-hop charter range (km) with reserves — not ferry brochure range.
   * Starter C172 stays on short CE hops; longer legs need a bigger ship.
   */
  rangeKm: number;
  blurb: string;
}

const plane = (
  id: string,
  name: string,
  shortName: string,
  seats: number,
  price: number,
  seatsMult: number,
  repairMult: number,
  rangeKm: number,
  blurb: string,
): FleetAircraft => ({ id, name, shortName, seats, price, seatsMult, repairMult, rangeKm, blurb });

/** The career ladder: each step carries more people further and faster. Ids match `sim/aircraft`. */
export const FLEET: FleetAircraft[] = [
  plane('c172rg', 'Cessna 172RG', 'C172', 4, 0, 1, 1, 420, 'Four seats, retractable gear. Your first charter ship.'),
  plane('pa34', 'Piper Seneca V', 'Seneca', 6, 48000, 1.45, 1.35, 900, 'Light piston twin. More seats, better charter rates.'),
  plane('be350', 'King Air 350', 'King Air', 11, 120000, 1.9, 1.7, 1800, 'Executive turboprop. Quick, quiet and comfortable.'),
  plane('atr72', 'ATR 72-600', 'ATR 72', 70, 260000, 2.5, 2.2, 1500, 'High-wing regional turboprop with a T-tail. Short hops, full cabins.'),
  plane('dh8d', 'Dash 8 Q400', 'Q400', 78, 380000, 2.8, 2.5, 2000, 'The fast turboprop. Jet-like times on regional legs.'),
  plane('e190', 'Embraer E190', 'E190', 100, 600000, 3.3, 3.0, 4000, 'Your first jet. Spool-up lag and a long landing roll.'),
  plane('a320', 'Airbus A320neo', 'A320', 180, 900000, 3.9, 3.6, 6000, 'The workhorse narrow-body. Europe and beyond.'),
  plane('b789', 'Boeing 787-9', '787', 290, 1600000, 4.8, 4.6, 13000, 'Composite long-hauler with raked wingtips. Crosses oceans.'),
  plane('b777', 'Boeing 777-300ER', '777', 396, 2200000, 5.4, 5.2, 13600, 'Twin-engine giant with huge fans. Anywhere on the board.'),
  plane('a388', 'Airbus A380', 'A380', 555, 3200000, 6.2, 6.0, 15000, 'Four engines, two decks. The queen of the network.'),
];
export function fleetById(id: string): FleetAircraft {
  return FLEET.find((a) => a.id === id) ?? FLEET[0];
}

/** True when the hop fits the aircraft’s practical range (with a tiny float margin). */
export function isWithinRange(fromIata: string, toIata: string, aircraftId: string): boolean {
  return distanceKm(fromIata, toIata) <= fleetById(aircraftId).rangeKm + 0.5;
}

/** Copy for hub toast / dock when a cleared destination is still too far. */
export function rangeBlockedMessage(fromIata: string, toIata: string, aircraftId: string): string {
  const craft = fleetById(aircraftId);
  const km = Math.round(distanceKm(fromIata, toIata));
  return t('econ.rangeFar', { km, name: craft.shortName, range: craft.rangeKm });
}

/** Great-circle (haversine) distance in km; correct across the date line. */
export function distanceKm(fromIata: string, toIata: string): number {
  const from = airportByIata(fromIata);
  const to = airportByIata(toIata);
  if (!from || !to) return 200;
  const rad = Math.PI / 180;
  const dLat = (to.lat - from.lat) * rad;
  const dLon = (to.lon - from.lon) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function baseFare(km: number): number {
  return 800 + km * 18;
}

export function operatingCost(km: number): number {
  return 200 + km * 3;
}

/** Map landing report total 0..100 → payout multiplier. */
export function qualityMult(score: number): number {
  const t = Math.max(0, Math.min(100, score)) / 100;
  return 0.7 + t * 0.55; // 0.70 … 1.25
}

export interface PayoutBreakdown {
  distanceKm: number;
  base: number;
  ops: number;
  quality: number;
  seats: number;
  gross: number;
  /** Credits after ops (can be negative only for crash bills elsewhere). */
  net: number;
}

export function computeSuccessPayout(
  fromIata: string,
  toIata: string,
  aircraftId: string,
  landingScore: number,
): PayoutBreakdown {
  const km = distanceKm(fromIata, toIata);
  const craft = fleetById(aircraftId);
  const base = baseFare(km);
  const ops = operatingCost(km);
  const quality = qualityMult(landingScore);
  const seats = craft.seatsMult;
  const gross = Math.round(base * quality * seats);
  const net = Math.max(0, gross - Math.round(ops));
  return { distanceKm: km, base, ops, quality, seats, gross, net };
}

/** Mid-quality estimate for the hub dock (~score 75). */
export function estimatePayout(fromIata: string, toIata: string, aircraftId: string): number {
  return computeSuccessPayout(fromIata, toIata, aircraftId, 75).net;
}

export function crashRepairBill(aircraftId: string): number {
  return Math.round(2800 * fleetById(aircraftId).repairMult);
}

export function formatCredits(n: number): string {
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(Math.round(n));
  return `${sign}€${abs.toLocaleString('en-US')}`;
}

/** Short cash for tight HUD / hub chrome (€100M, €1.2M, €850k). */
export function formatCreditsCompact(n: number): string {
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(Math.round(n));
  const trim = (s: string) => s.replace(/\.0$/, '');
  if (abs >= 1_000_000_000) return `${sign}€${trim((abs / 1_000_000_000).toFixed(1))}B`;
  if (abs >= 1_000_000) return `${sign}€${trim((abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1))}M`;
  if (abs >= 10_000) return `${sign}€${Math.round(abs / 1000)}k`;
  return formatCredits(n);
}

export function settleSuccess(
  p: Progress,
  fromIata: string,
  toIata: string,
  landingScore: number,
): { progress: Progress; payout: PayoutBreakdown } {
  const payout = computeSuccessPayout(fromIata, toIata, p.activeAircraft, landingScore);
  const next: Progress = {
    ...p,
    homeAirport: toIata,
    successfulFlights: p.successfulFlights + 1,
    credits: p.credits + payout.net,
  };
  saveProgress(next);
  return { progress: next, payout };
}

export function settleCrash(p: Progress): { progress: Progress; bill: number } {
  const bill = crashRepairBill(p.activeAircraft);
  const next: Progress = {
    ...p,
    credits: Math.max(0, p.credits - bill),
  };
  saveProgress(next);
  return { progress: next, bill };
}

export function buyAircraft(p: Progress, aircraftId: string): { ok: true; progress: Progress } | { ok: false; reason: string } {
  const craft = fleetById(aircraftId);
  if (p.ownedAircraft.includes(aircraftId)) return { ok: false, reason: t('econ.alreadyFleet') };
  if (craft.price <= 0) return { ok: false, reason: t('econ.notForSale') };
  if (p.credits < craft.price) {
    return { ok: false, reason: t('econ.needMore', { n: formatCredits(craft.price - p.credits) }) };
  }
  const next: Progress = {
    ...p,
    credits: p.credits - craft.price,
    ownedAircraft: [...p.ownedAircraft, aircraftId],
    activeAircraft: aircraftId,
  };
  saveProgress(next);
  return { ok: true, progress: next };
}

export function selectAircraft(p: Progress, aircraftId: string): { ok: true; progress: Progress } | { ok: false; reason: string } {
  if (!p.ownedAircraft.includes(aircraftId)) return { ok: false, reason: t('econ.notOwned') };
  const next: Progress = { ...p, activeAircraft: aircraftId };
  saveProgress(next);
  return { ok: true, progress: next };
}

/** One-time clearance to add an airport to the career network. */
export function buyAirportUnlock(
  p: Progress,
  iata: string,
): { ok: true; progress: Progress } | { ok: false; reason: string } {
  const ap = airportByIata(iata);
  if (!ap) return { ok: false, reason: t('econ.unknownAirport') };
  if (isAirportUnlocked(p, iata)) return { ok: false, reason: t('econ.alreadyCleared') };
  if (ap.unlockCost <= 0) return { ok: false, reason: t('econ.starterNet') };
  if (p.credits < ap.unlockCost) {
    return { ok: false, reason: t('econ.needMore', { n: formatCredits(ap.unlockCost - p.credits) }) };
  }
  const next: Progress = {
    ...p,
    credits: p.credits - ap.unlockCost,
    unlockedAirports: [...p.unlockedAirports, iata],
  };
  saveProgress(next);
  return { ok: true, progress: next };
}

/** Convenience: reload + settle when Game does not already hold Progress. */
export function settleSuccessFromStorage(fromIata: string, toIata: string, landingScore: number) {
  return settleSuccess(loadProgress(), fromIata, toIata, landingScore);
}

export function settleCrashFromStorage() {
  return settleCrash(loadProgress());
}
