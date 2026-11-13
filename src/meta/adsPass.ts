/** Play-owned ad removal. Lives outside career progress so a restart keeps it. */
const KEY = 'airways.iap.removeAds';
let granted = false;

export function adsRemoved(): boolean {
  if (granted) return true;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function grantAdsRemoved(): void {
  granted = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // This session still skips ads; Play restore will grant again next launch.
  }
}
