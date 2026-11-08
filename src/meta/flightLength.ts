/**
 * Map real hop distance → target flight time → side-view corridor length.
 * Authored scenery stays on the reference 11.5 km layout; live hops remap x.
 */

/** Reference destination pad start (metres) used when authoring World / landmarks. */
export const BASE_DEST_X0 = 11500;
export const BASE_DEST_X1 = 13700;
/** End of the shared origin runway pad. */
export const ORIGIN_PAD_END = 2000;
/** Arrival runway length stays fixed across all hops. */
export const DEST_PAD_LEN = BASE_DEST_X1 - BASE_DEST_X0;

const D_MIN_KM = 48;
const D_MAX_KM = 20_000;
const T_MIN_SEC = 180;
const T_MAX_SEC = 720;
/** Soft cruise used only to size the mid corridor (~200 km/h). */
const CRUISE_MPS = 200 / 3.6;
/** Fixed takeoff + approach budget carved out of target time. */
const PAD_TIME_SEC = 70;

/** Target airborne time for a great-circle distance (log curve, clamped). */
export function targetFlightSec(km: number): number {
  const d = Math.min(D_MAX_KM, Math.max(D_MIN_KM, km));
  const u = Math.log(d / D_MIN_KM) / Math.log(D_MAX_KM / D_MIN_KM);
  return T_MIN_SEC + (T_MAX_SEC - T_MIN_SEC) * u;
}

/** Destination runway slot for this hop distance. */
export function corridorDest(km: number): { x0: number; x1: number } {
  const cruiseSec = Math.max(20, targetFlightSec(km) - PAD_TIME_SEC);
  const x0 = Math.round(ORIGIN_PAD_END + CRUISE_MPS * cruiseSec);
  return { x0, x1: x0 + DEST_PAD_LEN };
}

/** Mid-corridor stretch vs the authored reference layout. */
export function midScaleFor(destX0: number): number {
  return (destX0 - ORIGIN_PAD_END) / (BASE_DEST_X0 - ORIGIN_PAD_END);
}

/**
 * Remap an authored x onto the live corridor.
 * Origin pad stays put; mid stretches; arrival pad shifts as a rigid block.
 */
export function remapCorridorX(x: number, destX0: number): number {
  if (x <= ORIGIN_PAD_END) return x;
  if (x >= BASE_DEST_X0) return destX0 + (x - BASE_DEST_X0);
  return ORIGIN_PAD_END + (x - ORIGIN_PAD_END) * midScaleFor(destX0);
}

export function remapCorridorSpan(x0: number, x1: number, destX0: number): [number, number] {
  return [remapCorridorX(x0, destX0), remapCorridorX(x1, destX0)];
}

/** Short label for hub / HUD, e.g. "~5 min". */
export function formatFlightMinutes(km: number): string {
  const m = targetFlightSec(km) / 60;
  if (m < 2) return `~${m.toFixed(1)} min`;
  return `~${Math.round(m)} min`;
}
