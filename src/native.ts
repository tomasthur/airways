import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Android/iOS lifecycle hooks. No-ops in the desktop browser.
 * `onBack` should return true when the press was handled (do not exit).
 */
export async function bindNativeLifecycle(handlers: {
  onPause: () => void;
  onResume: () => void;
  onBack: () => boolean;
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) handlers.onResume();
    else handlers.onPause();
  });

  await App.addListener('backButton', () => {
    if (!handlers.onBack()) void App.exitApp();
  });
}

/** Keep the screen awake during play (Wake Lock API; falls back silently). */
let wake: WakeLockSentinel | null = null;

export async function acquireWakeLock(): Promise<void> {
  try {
    if (!('wakeLock' in navigator) || wake) return;
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => {
      wake = null;
    });
  } catch {
    // Unsupported or denied — MainActivity also sets FLAG_KEEP_SCREEN_ON.
  }
}

export function releaseWakeLock(): void {
  void wake?.release();
  wake = null;
}
