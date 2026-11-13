import {
  AdMob,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import type { PluginListenerHandle } from '@capacitor/core';
import { adsRemoved } from '../meta/adsPass';
import { isNativePlatform } from '../native';

/** Cash granted only after a completed rewarded ad. */
export const AD_REWARD_CREDITS = 5000;

/** Live AdMob units. Used by signed release / Play builds. */
const PROD = {
  interstitial: 'ca-app-pub-3047265778113232/8544667322',
  rewarded: 'ca-app-pub-3047265778113232/4074939277',
};

/** Google sample units — always return labeled test creatives. */
const TEST = {
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
};

let interstitialId = PROD.interstitial;
let rewardedId = PROD.rewarded;
let testAds = false;
/** Non-personalized extras when UMP has not granted personalized ads yet. */
let npa = false;

const INTERSTITIAL_WAIT_MS = 90_000;
const REWARD_WAIT_MS = 120_000;

let initPromise: Promise<void> | null = null;
let canRequestAds = false;
let interstitialReady = false;
let rewardedReady = false;
let preparingInterstitial: Promise<boolean> | null = null;
let preparingRewarded: Promise<boolean> | null = null;

export function adsAvailable(): boolean {
  return isNativePlatform();
}

/** Native-only. Safe to call more than once; a no-op in the browser. */
export function initAds(): Promise<void> {
  if (!isNativePlatform()) return Promise.resolve();
  if (!initPromise) {
    initPromise = bootAds().catch((err) => {
      initPromise = null;
      console.warn('[airways] AdMob init failed', err);
    });
  }
  return initPromise;
}

async function bootAds(): Promise<void> {
  testAds = await detectTestAds();
  interstitialId = testAds ? TEST.interstitial : PROD.interstitial;
  rewardedId = testAds ? TEST.rewarded : PROD.rewarded;
  await AdMob.initialize({ initializeForTesting: testAds });
  if (testAds) {
    console.info('[airways] AdMob Google test units');
    canRequestAds = true;
  } else {
    canRequestAds = await resolveConsent();
  }
  if (!canRequestAds) return;
  await Promise.all([adsRemoved() ? Promise.resolve(false) : preloadInterstitial(), preloadRewarded()]);
}

/**
 * UMP in the EEA can report canRequestAds=false when the form is missing or
 * unfinished. Test ads skip this. Live ads still try NPA rather than going silent.
 */
async function resolveConsent(): Promise<boolean> {
  try {
    let info = await AdMob.requestConsentInfo();
    if (!info.canRequestAds) {
      try {
        info = await AdMob.showConsentForm();
      } catch {
        /* form not configured / immersive activity — keep going */
      }
    }
    if (info.canRequestAds) {
      npa = false;
      return true;
    }
    npa = true;
    return true;
  } catch {
    npa = true;
    return true;
  }
}

function adOptions(adId: string): { adId: string; isTesting: boolean; npa: boolean; immersiveMode: boolean } {
  return { adId, isTesting: testAds, npa, immersiveMode: true };
}

/**
 * Full-screen ad before a flight. Never blocks departure: a miss, skip, or
 * timeout still starts the hop.
 */
export async function showInterstitialThen(): Promise<void> {
  if (!isNativePlatform() || adsRemoved()) return;
  await initAds();
  if (!canRequestAds) return;
  const loaded = interstitialReady || (await preloadInterstitial());
  if (!loaded) return;

  const handles: PluginListenerHandle[] = [];
  try {
    const { closed } = await listenClose(
      handles,
      InterstitialAdPluginEvents.Dismissed,
      InterstitialAdPluginEvents.FailedToShow,
    );
    interstitialReady = false;
    const shown = AdMob.showInterstitial().catch(() => undefined);
    await Promise.race([closed, shown, sleep(INTERSTITIAL_WAIT_MS)]);
  } catch {
    // Not prepared / failed to show — player still flies.
  } finally {
    await drop(handles);
    void preloadInterstitial();
  }
}

/** True only when the player finished the rewarded video. */
export async function showRewarded(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  await initAds();
  if (!canRequestAds) return false;
  const loaded = rewardedReady || (await preloadRewarded());
  if (!loaded) return false;

  let earned = false;
  const handles: PluginListenerHandle[] = [];
  try {
    const { closed } = await listenClose(
      handles,
      RewardAdPluginEvents.Dismissed,
      RewardAdPluginEvents.FailedToShow,
    );
    handles.push(
      await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
        earned = true;
      }),
    );
    rewardedReady = false;
    // Plugin resolves show() only on reward — dismiss must come from Dismissed.
    const shown = AdMob.showRewardVideoAd().catch(() => undefined);
    await Promise.race([closed, shown, sleep(REWARD_WAIT_MS)]);
  } catch {
    return false;
  } finally {
    await drop(handles);
    void preloadRewarded();
  }
  return earned;
}

function preloadInterstitial(): Promise<boolean> {
  if (!isNativePlatform() || !canRequestAds || adsRemoved()) return Promise.resolve(false);
  if (preparingInterstitial) return preparingInterstitial;
  preparingInterstitial = loadFullScreen(() => AdMob.prepareInterstitial(adOptions(interstitialId)))
    .then((ok) => {
      interstitialReady = ok;
      return ok;
    })
    .finally(() => {
      preparingInterstitial = null;
    });
  return preparingInterstitial;
}

function preloadRewarded(): Promise<boolean> {
  if (!isNativePlatform() || !canRequestAds) return Promise.resolve(false);
  if (preparingRewarded) return preparingRewarded;
  preparingRewarded = loadFullScreen(() => AdMob.prepareRewardVideoAd(adOptions(rewardedId)))
    .then((ok) => {
      rewardedReady = ok;
      return ok;
    })
    .finally(() => {
      preparingRewarded = null;
    });
  return preparingRewarded;
}

/** First prepare often races MobileAds.initialize — retry once. */
async function loadFullScreen(prepare: () => Promise<unknown>): Promise<boolean> {
  if (await tryPrepare(prepare)) return true;
  await sleep(1500);
  return tryPrepare(prepare);
}

async function tryPrepare(prepare: () => Promise<unknown>): Promise<boolean> {
  try {
    await prepare();
    return true;
  } catch (err) {
    console.warn('[airways] AdMob prepare failed', err);
    return false;
  }
}

/**
 * Debug APKs ship `ads-mode.json` from the Android debug source set (and the
 * APK script copies it into Capacitor's public folder). Release builds omit it.
 */
async function detectTestAds(): Promise<boolean> {
  const bases = [document.baseURI, document.location.href, 'https://localhost/', 'http://localhost/', 'capacitor://localhost/'];
  for (const base of bases) {
    try {
      const url = new URL('ads-mode.json', base).href;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim().startsWith('{')) continue;
      const data = JSON.parse(text) as { testAds?: boolean };
      if (data.testAds === true) return true;
    } catch {
      /* try the next origin */
    }
  }
  return false;
}

async function listenClose(
  handles: PluginListenerHandle[],
  dismissed: InterstitialAdPluginEvents | RewardAdPluginEvents,
  failed: InterstitialAdPluginEvents | RewardAdPluginEvents,
): Promise<{ closed: Promise<void> }> {
  let finish: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  handles.push(await AdMob.addListener(dismissed as never, () => finish()));
  handles.push(await AdMob.addListener(failed as never, () => finish()));
  return { closed };
}

async function drop(handles: PluginListenerHandle[]): Promise<void> {
  await Promise.all(handles.splice(0).map((h) => h.remove()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
