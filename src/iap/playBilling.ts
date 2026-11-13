/**
 * Google Play Billing for one-time aircraft unlocks.
 * Web / missing Play store: no-ops that never grant the plane.
 */
import { NativePurchases, PURCHASE_TYPE, type Transaction } from '@capgo/native-purchases';
import { adsRemoved, grantAdsRemoved } from '../meta/adsPass';
import { grantPurchasedAircraft } from '../meta/economy';
import { loadProgress } from '../meta/progress';
import { isNativePlatform } from '../native';
import { AIRCRAFT_EUR, AIRCRAFT_SKUS, REMOVE_ADS_EUR, REMOVE_ADS_SKU, aircraftIdFromSku, aircraftSku } from './catalog';

export type IapFail = 'web' | 'unavailable' | 'cancelled' | 'pending' | 'fail';
export type IapResult = { ok: true } | { ok: false; reason: IapFail };

const prices = new Map<string, string>();
let initPromise: Promise<void> | null = null;
let billingOk = false;

function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return '';
}

function isCancel(err: unknown): boolean {
  const s = errorText(err).toLowerCase();
  return s.includes('cancel') || s.includes('user_canceled') || s.includes('user cancelled');
}

function isAlreadyOwned(err: unknown): boolean {
  const s = errorText(err).toLowerCase();
  return s.includes('already') || s.includes('item_already_owned') || s.includes('owned');
}

function isPaid(tx: Transaction): boolean {
  return !tx.purchaseState || tx.purchaseState === '1';
}

export function iapAvailable(): boolean {
  return isNativePlatform();
}

export function aircraftPriceLabel(aircraftId: string): string {
  const sku = aircraftSku(aircraftId);
  if (!sku) return '';
  return prices.get(sku) ?? AIRCRAFT_EUR[aircraftId] ?? '';
}

export function removeAdsPriceLabel(): string {
  return prices.get(REMOVE_ADS_SKU) ?? REMOVE_ADS_EUR;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Native-only. Safe to call more than once; a no-op in the browser. */
export async function initIap(): Promise<void> {
  if (!isNativePlatform()) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const { isBillingSupported } = await withTimeout(NativePurchases.isBillingSupported(), 8000);
      billingOk = isBillingSupported;
      if (!billingOk) return;
      const { products } = await withTimeout(
        NativePurchases.getProducts({
          productIdentifiers: [...AIRCRAFT_SKUS, REMOVE_ADS_SKU],
          productType: PURCHASE_TYPE.INAPP,
        }),
        8000,
      );
      for (const p of products) {
        if (p.priceString) prices.set(p.identifier, p.priceString);
      }
    } catch {
      billingOk = false;
      initPromise = null;
    }
  })();
  return initPromise;
}

export async function purchaseAircraft(aircraftId: string): Promise<IapResult> {
  if (!isNativePlatform()) return { ok: false, reason: 'web' };
  const sku = aircraftSku(aircraftId);
  if (!sku) return { ok: false, reason: 'fail' };
  await initIap();
  if (!billingOk) return { ok: false, reason: 'unavailable' };
  try {
    const tx = await withTimeout(
      NativePurchases.purchaseProduct({
        productIdentifier: sku,
        productType: PURCHASE_TYPE.INAPP,
        isConsumable: false,
      }),
      120_000,
    );
    if (!isPaid(tx)) return { ok: false, reason: 'pending' };
    grantPurchasedAircraft(aircraftId);
    return { ok: true };
  } catch (err) {
    if (isAlreadyOwned(err)) {
      grantPurchasedAircraft(aircraftId);
      return { ok: true };
    }
    if (isCancel(err)) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'fail' };
  }
}

export async function purchaseRemoveAds(): Promise<IapResult> {
  if (!isNativePlatform()) return { ok: false, reason: 'web' };
  if (adsRemoved()) return { ok: true };
  await initIap();
  if (!billingOk) return { ok: false, reason: 'unavailable' };
  try {
    const tx = await withTimeout(
      NativePurchases.purchaseProduct({
        productIdentifier: REMOVE_ADS_SKU,
        productType: PURCHASE_TYPE.INAPP,
        isConsumable: false,
      }),
      120_000,
    );
    if (!isPaid(tx)) return { ok: false, reason: 'pending' };
    grantAdsRemoved();
    return { ok: true };
  } catch (err) {
    if (isAlreadyOwned(err)) {
      grantAdsRemoved();
      return { ok: true };
    }
    if (isCancel(err)) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'fail' };
  }
}

/** Unlock Play-owned aircraft and ad removal missing from local save. */
export async function restoreAircraftPurchases(): Promise<string[]> {
  if (!isNativePlatform()) return [];
  await initIap();
  if (!billingOk) return [];
  try {
    await withTimeout(NativePurchases.restorePurchases(), 8000);
  } catch {
    // Android may have nothing queued; still query owned INAPP.
  }
  let purchases: Transaction[] = [];
  try {
    const res = await withTimeout(NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP }), 8000);
    purchases = res.purchases;
  } catch {
    return [];
  }
  const owned = new Set(loadProgress().ownedAircraft);
  const granted: string[] = [];
  for (const tx of purchases) {
    if (!isPaid(tx)) continue;
    if (tx.productIdentifier === REMOVE_ADS_SKU) {
      grantAdsRemoved();
      continue;
    }
    const id = aircraftIdFromSku(tx.productIdentifier);
    if (!id || owned.has(id)) continue;
    grantPurchasedAircraft(id);
    owned.add(id);
    granted.push(id);
  }
  return granted;
}
