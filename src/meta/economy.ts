/**
 * Charter economy: distance-based fares, landing quality, fleet seat multipliers.
 */
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

/** Starter C172 owned; mid twin and late turboprop are buyable placeholders. */
export const FLEET: FleetAircraft[] = [
  {
    id: 'c172rg',
    name: 'Cessna 172RG',
    shortName: 'C172',
    price: 0,
    seatsMult: 1,
    repairMult: 1,
    rangeKm: 420,
    blurb: 'Four seats, retractable gear. Your first charter ship.',
  },
  {
    id: 'pa34',
    name: 'Piper Seneca',
    shortName: 'Twin',
    price: 48000,
    seatsMult: 1.45,
    repairMult: 1.35,
    rangeKm: 900,
    blurb: 'Light twin. More seats, better charter rates.',
  },
  {
    id: 'at42',
    name: 'ATR 42',
    shortName: 'ATR',
    price: 175000,
    seatsMult: 2.15,
    repairMult: 1.85,
    rangeKm: 1800,
    blurb: 'Regional turboprop. Covers Europe end-to-end.',
  },
  {
    id: 'a320',
    name: 'Airbus A320',
    shortName: 'A320',
    price: 420000,
    seatsMult: 3.2,
    repairMult: 2.4,
    rangeKm: 5500,
    blurb: 'Narrow-body jet. Cross the Atlantic on good days.',
  },
  {
    id: 'b777',
    name: 'Boeing 777',
    shortName: '777',
    price: 980000,
    seatsMult: 4.5,
    repairMult: 3.2,
    rangeKm: 13000,
    blurb: 'Long-haul widebody. Anywhere on the board.',
  },
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
  return `${km} km is too far for the ${craft.shortName} (range ${craft.rangeKm} km)`;
}

/** Great-circle distance in km (same formula as the hub map). */
export function distanceKm(fromIata: string, toIata: string): number {
  const from = airportByIata(fromIata);
  const to = airportByIata(toIata);
  if (!from || !to) return 200;
  const midLat = (((from.lat + to.lat) / 2) * Math.PI) / 180;
  return (
    111.32 *
    Math.sqrt((to.lat - from.lat) ** 2 + ((to.lon - from.lon) * Math.cos(midLat)) ** 2)
  );
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
  if (p.ownedAircraft.includes(aircraftId)) return { ok: false, reason: 'Already in your fleet' };
  if (craft.price <= 0) return { ok: false, reason: 'Not for sale' };
  if (p.credits < craft.price) {
    return { ok: false, reason: `Need ${formatCredits(craft.price - p.credits)} more` };
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
  if (!p.ownedAircraft.includes(aircraftId)) return { ok: false, reason: 'Not owned' };
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
  if (!ap) return { ok: false, reason: 'Unknown airport' };
  if (isAirportUnlocked(p, iata)) return { ok: false, reason: 'Already cleared' };
  if (ap.unlockCost <= 0) return { ok: false, reason: 'Already in the starter network' };
  if (p.credits < ap.unlockCost) {
    return { ok: false, reason: `Need ${formatCredits(ap.unlockCost - p.credits)} more` };
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
