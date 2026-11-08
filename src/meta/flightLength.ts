/**
 * Map real hop distance → target flight time → side-view corridor for the flown aircraft.
 * Authored scenery stays on the reference layout (origin pad 0–2000, destination pad
 * 11 500–13 700); live hops remap x with {@link remapCorridorX}.
 */

/** Reference destination pad used when authoring World / landmarks. */
export const BASE_DEST_X0 = 11500;
export const BASE_DEST_X1 = 13700;
/** End of the reference origin runway pad. */
export const ORIGIN_PAD_END = 2000;
/** Authored departure / arrival scenery kept rigid (unstretched) next to each airport. */
const REF_ZONE = 3000;
/** Reference touchdown aim point, 300 m past the destination threshold. */
const REF_AIM_X = BASE_DEST_X0 + 300;

const D_MIN_KM = 48;
const D_MAX_KM = 9000;
const T_MIN_SEC = 180;
const T_MAX_SEC = 720;

export interface CorridorPerformance {
  cruiseKmh: number;
  cruiseAltM: number;
  runwayM: number;
  padTimeS: number;
}

/** Live corridor for one hop in one aircraft. */
export interface CorridorLayout {
  /** End of the departure runway (it starts at x = 0). */
  originEnd: number;
  destX0: number;
  destX1: number;
  /** Cruise altitude that still leaves room to climb and descend on this hop. */
  cruiseAltM: number;
}

/** The authored layout itself (identity remap). */
export const REFERENCE_LAYOUT: CorridorLayout = {
  originEnd: ORIGIN_PAD_END,
  destX0: BASE_DEST_X0,
  destX1: BASE_DEST_X1,
  cruiseAltM: 350,
};

/** Target airborne time for a great-circle distance (log curve, clamped). */
export function targetFlightSec(km: number): number {
  const d = Math.min(D_MAX_KM, Math.max(D_MIN_KM, km));
  const u = Math.log(d / D_MIN_KM) / Math.log(D_MAX_KM / D_MIN_KM);
  return T_MIN_SEC + (T_MAX_SEC - T_MIN_SEC) * u;
}

/**
 * Corridor for this hop: both runways get the type's runway length, and the middle is as long
 * as the aircraft covers at cruise in the target time minus its take-off / landing budget —
 * so every aircraft flies a hop in about the same time and faster ones simply go further.
 */
export function corridorLayout(km: number, p: CorridorPerformance): CorridorLayout {
  const cruiseSec = Math.max(30, targetFlightSec(km) - p.padTimeS);
  const originEnd = p.runwayM;
  const mid = Math.round((p.cruiseKmh / 3.6) * cruiseSec);
  const destX0 = originEnd + mid;
  const cruiseAltM = Math.max(300, Math.min(p.cruiseAltM, Math.round((mid * 0.035) / 50) * 50));
  return { originEnd, destX0, destX1: destX0 + p.runwayM, cruiseAltM };
}

/**
 * Remap an authored x onto the live corridor. Five pieces, all monotonic:
 * the origin runway scales to its live length, ~3 km of departure and arrival scenery stay
 * rigid next to the airports (shrinking on very short corridors), the en-route middle stretches,
 * and the destination runway scales; anything past it shifts rigidly.
 */
export function remapCorridorX(x: number, L: CorridorLayout): number {
  if (x <= 0) return x;
  if (x <= ORIGIN_PAD_END) return (x * L.originEnd) / ORIGIN_PAD_END;
  const mid = L.destX0 - L.originEnd;
  const zone = Math.min(REF_ZONE, mid * 0.32);
  const refMid0 = ORIGIN_PAD_END + REF_ZONE;
  const refMid1 = BASE_DEST_X0 - REF_ZONE;
  if (x <= refMid0) return L.originEnd + ((x - ORIGIN_PAD_END) * zone) / REF_ZONE;
  if (x <= refMid1) return L.originEnd + zone + ((x - refMid0) * (mid - 2 * zone)) / (refMid1 - refMid0);
  if (x <= BASE_DEST_X0) return L.destX0 - ((BASE_DEST_X0 - x) * zone) / REF_ZONE;
  if (x <= BASE_DEST_X1) return L.destX0 + ((x - BASE_DEST_X0) * (L.destX1 - L.destX0)) / (BASE_DEST_X1 - BASE_DEST_X0);
  return L.destX1 + (x - BASE_DEST_X1);
}

export function remapCorridorSpan(x0: number, x1: number, L: CorridorLayout): [number, number] {
  return [remapCorridorX(x0, L), remapCorridorX(x1, L)];
}

/** Touchdown aim point (PAPI position) on the live destination runway. */
export function aimPointX(L: CorridorLayout): number {
  return remapCorridorX(REF_AIM_X, L);
}

/** Short label for hub / HUD, e.g. "~5 min". */
export function formatFlightMinutes(km: number): string {
  const m = targetFlightSec(km) / 60;
  if (m < 2) return `~${m.toFixed(1)} min`;
  return `~${Math.round(m)} min`;
}
