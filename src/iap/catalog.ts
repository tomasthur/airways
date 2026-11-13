/**
 * Google Play one-time INAPP product IDs. Must match Play Console exactly.
 * Starter C172 is free and has no SKU.
 */
export const AIRCRAFT_SKU_PREFIX = 'aircraft_';

/** Fallback EUR labels when Play has not returned a localized price yet. */
export const AIRCRAFT_EUR: Record<string, string> = {
  pa34: '€0.99',
  be350: '€1.99',
  atr72: '€2.49',
  dh8d: '€2.99',
  e190: '€3.49',
  a320: '€3.99',
  b789: '€4.49',
  b777: '€4.99',
  a388: '€5.99',
};

export function aircraftSku(aircraftId: string): string | null {
  if (!(aircraftId in AIRCRAFT_EUR)) return null;
  return `${AIRCRAFT_SKU_PREFIX}${aircraftId}`;
}

export function aircraftIdFromSku(sku: string): string | null {
  if (!sku.startsWith(AIRCRAFT_SKU_PREFIX)) return null;
  const id = sku.slice(AIRCRAFT_SKU_PREFIX.length);
  return id in AIRCRAFT_EUR ? id : null;
}

export const AIRCRAFT_SKUS: string[] = Object.keys(AIRCRAFT_EUR).map((id) => `${AIRCRAFT_SKU_PREFIX}${id}`);

/** One-time INAPP: skip interstitial ads. Rewarded More Money stays. */
export const REMOVE_ADS_SKU = 'remove_ads';
export const REMOVE_ADS_EUR = '€2.99';
