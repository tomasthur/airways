import {
  AdMob,
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import type { PluginListenerHandle } from '@capacitor/core';
import { isNativePlatform } from '../native';

/** Cash granted only after a completed rewarded ad. */
export const AD_REWARD_CREDITS = 5000;

const INTERSTITIAL_ID = 'ca-app-pub-3047265778113232/8544667322';
const REWARDED_ID = 'ca-app-pub-3047265778113232/4074939277';

const INTERSTITIAL_WAIT_MS = 90_000;
const REWARD_WAIT_MS = 120_000;

let started = false;
let canRequestAds = false;
let interstitialReady = false;
let rewardedReady = false;
let preparingInterstitial: Promise<boolean> | null = null;
let preparingRewarded: Promise<boolean> | null = null;

export function adsAvailable(): boolean {
  return isNativePlatform();
}

/** Native-only. Safe to call more than once; a no-op in the browser. */
export async function initAds(): Promise<void> {
  if (!isNativePlatform() || started) return;
  started = true;
  try {
    await AdMob.initialize();
    canRequestAds = true;
    try {
      const info = await AdMob.requestConsentInfo();
      const after =
        info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable
          ? await AdMob.showConsentForm()
          : info;
      canRequestAds = after.canRequestAds !== false;
    } catch {
      // UMP message not configured yet — still serve ads where allowed.
    }
    if (!canRequestAds) return;
    void preloadInterstitial();
    void preloadRewarded();
  } catch {
    started = false;
    canRequestAds = false;
  }
}

/**
 * Full-screen ad before a flight. Never blocks departure: a miss, skip, or
 * timeout still starts the hop.
 */
export async function showInterstitialThen(): Promise<void> {
  if (!isNativePlatform() || !canRequestAds) return;
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
    await AdMob.showInterstitial();
    await Promise.race([closed, sleep(INTERSTITIAL_WAIT_MS)]);
  } catch {
    // Not prepared / failed to show — player still flies.
  } finally {
    await drop(handles);
    void preloadInterstitial();
  }
}

/** True only when the player finished the rewarded video. */
export async function showRewarded(): Promise<boolean> {
  if (!isNativePlatform() || !canRequestAds) return false;
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
    void AdMob.showRewardVideoAd()
      .then(() => {
        earned = true;
      })
      .catch(() => {
        /* dismissed without a reward, or not ready */
      });
    await Promise.race([closed, sleep(REWARD_WAIT_MS)]);
  } catch {
    return false;
  } finally {
    await drop(handles);
    void preloadRewarded();
  }
  return earned;
}

function preloadInterstitial(): Promise<boolean> {
  if (!isNativePlatform() || !canRequestAds) return Promise.resolve(false);
  if (preparingInterstitial) return preparingInterstitial;
  preparingInterstitial = AdMob.prepareInterstitial({ adId: INTERSTITIAL_ID })
    .then(() => {
      interstitialReady = true;
      return true;
    })
    .catch(() => {
      interstitialReady = false;
      return false;
    })
    .finally(() => {
      preparingInterstitial = null;
    });
  return preparingInterstitial;
}

function preloadRewarded(): Promise<boolean> {
  if (!isNativePlatform() || !canRequestAds) return Promise.resolve(false);
  if (preparingRewarded) return preparingRewarded;
  preparingRewarded = AdMob.prepareRewardVideoAd({ adId: REWARDED_ID })
    .then(() => {
      rewardedReady = true;
      return true;
    })
    .catch(() => {
      rewardedReady = false;
      return false;
    })
    .finally(() => {
      preparingRewarded = null;
    });
  return preparingRewarded;
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
