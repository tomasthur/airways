import { adsAvailable, AD_REWARD_CREDITS, showRewarded } from '../ads/admob';
import { hasT, t } from '../i18n';
import { adsRemoved } from '../meta/adsPass';
import { aircraftPriceLabel, purchaseAircraft, purchaseRemoveAds, removeAdsPriceLabel, restoreAircraftPurchases, type IapFail } from '../iap/playBilling';
import { AIRPORTS, airportByIata, type Airport } from '../meta/airports';
import {
  buyAircraft,
  buyAirportUnlock,
  distanceKm,
  estimatePayout,
  FLEET,
  fleetById,
  formatCredits,
  formatCreditsCompact,
  grantAdReward,
  isWithinRange,
  rangeBlockedMessage,
  selectAircraft,
} from '../meta/economy';
import { formatFlightMinutes } from '../meta/flightLength';
import {
  airportStatus,
  isAirportUnlocked,
  loadProgress,
  resetCareerProgress,
  type Progress,
} from '../meta/progress';
import { BORDER_PATH, LAND_PATH, WORLD_H, WORLD_W, projectLonLat } from '../meta/worldMap';
import { aircraftById } from '../sim/aircraft';
import type { Propulsion } from '../sim/aircraft/AircraftConfig';
import { deleteCareerPlayer, fetchLeaderboard, loadPlayer, type LeaderboardRow } from '../meta/player';
import { aircraftPortraitUrl } from './AircraftPortrait';
import { HubTour } from './HubTour';
import { MapCamera, type CameraView } from './MapCamera';

const PROPULSION_KEY: Record<Propulsion, string> = {
  piston: 'hangar.prop.piston',
  turboprop: 'hangar.prop.turboprop',
  jet: 'hangar.prop.turbofan',
};

/** Screen-pixel nudges so BTS/VIE (55 km apart) stay separately tappable. */
const PIN_NUDGE: Record<string, { x: number; y: number }> = {
  BTS: { x: 7, y: 5 },
  VIE: { x: -7, y: -4 },
};
/** Initial frame never zooms closer than this many times the whole-world fit. */
const HOME_FIT_MAX_ZOOM = 16;
/** How many nearest other airports to include around the base when framing. */
const HOME_NEIGHBOURS = 6;
/** Below this zoom (× world fit) secondary labels hide to keep the chart clean. */
const LABEL_ZOOM = 5;
const DEFAULT_AIRLINE_TAG = 'World charter · earn · unlock · fly';

export interface HubFlyRequest {
  from: string;
  to: string;
}

/**
 * Full-screen map hub: world network, unlocks, route pick, Fly into the mission.
 */
export class HubMenu {
  private readonly root: HTMLElement;
  private readonly mapStage: HTMLElement;
  private readonly pinsLayer: SVGElement;
  private readonly routePath: SVGPathElement;
  private readonly dock: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly hangar: HTMLElement;
  private readonly hangarList: HTMLElement;
  private readonly board: HTMLElement;
  private readonly boardList: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly camera: MapCamera;
  private progress: Progress;
  private selected: string | null = null;
  /** Locked airport offered for purchase in the dock. */
  private unlockTarget: string | null = null;
  private toastTimer = 0;
  private readonly onFly: (req: HubFlyRequest) => void | Promise<void>;
  private readonly onCareerWiped: () => void;
  private pinEls: { el: SVGGElement; x: number; y: number }[] = [];
  private boardReq = 0;
  private lastBoard: LeaderboardRow[] | null = null;
  private flyBusy = false;
  private rewardBusy = false;
  private iapBusy = false;
  private iapRestoreBusy = false;
  private careerBusy = false;
  private readonly tour: HubTour;

  constructor(
    root: HTMLElement,
    onFly: (req: HubFlyRequest) => void | Promise<void>,
    onCareerWiped: () => void,
  ) {
    this.root = root;
    this.onFly = onFly;
    this.onCareerWiped = onCareerWiped;
    this.progress = loadProgress();

    this.mapStage = root.querySelector('[data-hub="map"]')!;
    this.dock = root.querySelector('[data-hub="dock"]')!;
    this.toastEl = root.querySelector('[data-hub="toast"]')!;
    this.hangar = root.querySelector('[data-hub="hangar"]')!;
    this.hangarList = root.querySelector('[data-hub="hangarList"]')!;
    this.board = root.querySelector('[data-hub="board"]')!;
    this.boardList = root.querySelector('[data-hub="boardList"]')!;

    this.svg = this.mapStage.querySelector('svg')!;
    this.pinsLayer = this.svg.querySelector('[data-hub="pins"]') as unknown as SVGElement;
    this.routePath = this.svg.querySelector('[data-hub="route"]') as SVGPathElement;

    this.renderWorldBase();
    this.camera = new MapCamera(this.svg, this.mapStage, { w: WORLD_W, h: WORLD_H }, (v) => this.onCamera(v));
    this.renderStats();
    this.renderPins();
    this.clearSelection();

    this.pinsLayer.addEventListener('click', (e) => {
      if (this.camera.consumeClick()) return;
      const btn = (e.target as Element).closest('[data-iata]') as HTMLElement | null;
      if (!btn) return;
      this.onAirport(btn.dataset.iata!);
    });

    root.querySelector('[data-hub="fly"]')!.addEventListener('click', () => this.fly());
    root.querySelector('[data-hub="unlock"]')?.addEventListener('click', () => this.unlockSelected());
    root.querySelector('[data-hub="clear"]')?.addEventListener('click', () => this.clearSelection());
    root.querySelector('[data-hub="random"]')?.addEventListener('click', () => this.pickRandom());
    root.querySelector('[data-hub="moreMoney"]')?.addEventListener('click', () => void this.moreMoney());
    root.querySelector('[data-hub="hangarOpen"]')?.addEventListener('click', () => this.openHangar());
    root.querySelector('[data-hub="ship"]')?.addEventListener('click', () => this.openHangar());
    root.querySelector('[data-hub="hangarClose"]')?.addEventListener('click', () => this.closeHangar());
    root.querySelector('[data-hub="removeAds"]')?.addEventListener('click', () => void this.buyRemoveAds());
    root.querySelector('[data-hub="careerReset"]')?.addEventListener('click', () => {
      if (this.tour.active) return;
      this.toggleCareerConfirm(true);
    });
    root.querySelector('[data-hub="careerKeep"]')?.addEventListener('click', () => this.toggleCareerConfirm(false));
    root.querySelector('[data-hub="careerErase"]')?.addEventListener('click', () => void this.eraseCareer());
    root.querySelector('[data-hub="careerConfirm"]')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.toggleCareerConfirm(false);
    });
    root.querySelector('[data-hub="boardOpen"]')?.addEventListener('click', () => this.openBoard());
    root.querySelector('[data-hub="boardClose"]')?.addEventListener('click', () => this.closeBoard());
    root.querySelector('[data-hub="zoomIn"]')?.addEventListener('click', () => this.camera.zoomBy(1.6));
    root.querySelector('[data-hub="zoomOut"]')?.addEventListener('click', () => this.camera.zoomBy(1 / 1.6));
    root.querySelector('[data-hub="zoomHome"]')?.addEventListener('click', () => this.focusHome(true));
    this.hangar.addEventListener('click', (e) => {
      if (e.target === this.hangar) this.closeHangar();
    });
    this.board.addEventListener('click', (e) => {
      if (e.target === this.board) this.closeBoard();
    });
    this.tour = new HubTour(root, {
      openSampleRoute: () => this.openTourRoute(),
      clearRoute: () => this.clearSelection(),
      closePanels: () => {
        this.closeHangar();
        this.closeBoard();
        this.toggleCareerConfirm(false);
      },
    });

    this.hangarList.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest('[data-fleet-action]') as HTMLElement | null;
      if (!btn) return;
      const id = btn.dataset.fleetId;
      const action = btn.dataset.fleetAction;
      if (!id || !action) return;
      if (action === 'buy') this.buyFleet(id);
      else if (action === 'buyEuro') void this.buyFleetEuro(id);
      else if (action === 'select') this.selectFleet(id);
    });
    this.syncCareerReset();
  }

  setAirline(name: string): void {
    const el = this.root.querySelector('[data-hub="airline"]');
    if (el) el.textContent = name;
    this.syncCareerReset();
  }

  private syncCareerReset(): void {
    const btn = this.root.querySelector('[data-hub="careerReset"]');
    btn?.classList.toggle('is-hidden', !loadPlayer());
  }

  show(visible: boolean): void {
    this.root.classList.toggle('is-hidden', !visible);
    if (visible) {
      this.progress = loadProgress();
      this.closeHangar();
      this.closeBoard();
      this.toggleCareerConfirm(false);
      this.syncCareerReset();
      this.renderStats();
      this.renderPins();
      // Measure after the hub is laid out, then glide in from the world view.
      requestAnimationFrame(() => {
        this.camera.fitBox(0, 0, WORLD_W, WORLD_H, { animate: false, pad: 0 });
        this.focusHome(true);
        window.setTimeout(() => this.maybeStartTour(), 700);
      });
      // Coming back from a hop: drop the old destination so only the base glows
      // amber and the player picks a new route from scratch.
      this.clearSelection();
    }
  }

  /** True when a playable, in-range destination is selected (Enter can start). */
  canFly(): boolean {
    return (
      this.selected !== null &&
      this.isOpenDestination(this.selected) &&
      this.inRange(this.selected)
    );
  }

  maybeStartTour(): void {
    requestAnimationFrame(() => requestAnimationFrame(() => this.tour.maybeStart()));
  }

  tryFlyFromKeyboard(): boolean {
    if (this.tour.active) return false;
    if (this.selected && this.isOpenDestination(this.selected) && !this.inRange(this.selected)) {
      this.toast(rangeBlockedMessage(this.progress.homeAirport, this.selected, this.progress.activeAircraft));
      return false;
    }
    if (!this.canFly()) {
      this.toast(t('hub.pickAirport'));
      return false;
    }
    this.fly();
    return true;
  }

  /** File the nearest in-range hop so Fly / Clear are on screen for the tour. */
  private openTourRoute(): boolean {
    const home = this.progress.homeAirport;
    const pick = AIRPORTS.find(
      (a) => a.iata !== home && airportStatus(this.progress, a.iata) === 'open' && this.inRange(a.iata),
    );
    if (!pick) return false;
    this.selectDestination(pick.iata);
    return true;
  }

  private pickRandom(): void {
    const open = AIRPORTS.filter(
      (a) => airportStatus(this.progress, a.iata) === 'open' && this.inRange(a.iata),
    );
    if (!open.length) {
      this.toast(t('hub.noDest'));
      return;
    }
    const pick = open[Math.floor(Math.random() * open.length)];
    this.selectDestination(pick.iata);
    this.toast(t('hub.filed', { from: this.progress.homeAirport, to: pick.iata }));
  }

  private async fly(): Promise<void> {
    if (this.tour.active || this.flyBusy) return;
    if (!this.canFly() || !this.selected) return;
    this.flyBusy = true;
    this.root.classList.add('is-departing');
    if (adsAvailable()) this.toast(t('hub.ad.loading'));
    try {
      await this.onFly({ from: this.progress.homeAirport, to: this.selected });
    } finally {
      this.flyBusy = false;
      this.root.classList.remove('is-departing');
    }
  }

  private async moreMoney(): Promise<void> {
    if (this.tour.active || this.rewardBusy) return;
    if (!adsAvailable()) {
      this.toast(t('hub.moreMoney.web'));
      return;
    }
    this.rewardBusy = true;
    this.toast(t('hub.moreMoney.loading'));
    try {
      const watched = await showRewarded();
      if (!watched) {
        this.toast(t('hub.moreMoney.missed'));
        return;
      }
      this.progress = grantAdReward(AD_REWARD_CREDITS);
      this.renderStats();
      this.toast(t('hub.moreMoney.paid', { n: formatCredits(AD_REWARD_CREDITS) }));
    } finally {
      this.rewardBusy = false;
    }
  }

  private onAirport(iata: string): void {
    const status = airportStatus(this.progress, iata);
    const ap = airportByIata(iata);
    if (!ap) return;

    if (status === 'home') {
      this.toast(t('hub.youAreHere', { city: ap.city }));
      return;
    }
    if (!isAirportUnlocked(this.progress, iata)) {
      this.showUnlockOffer(ap);
      return;
    }
    this.selectDestination(iata);
    if (!this.inRange(iata)) {
      this.toast(rangeBlockedMessage(this.progress.homeAirport, iata, this.progress.activeAircraft));
    }
  }

  private showUnlockOffer(ap: Airport, announce = true): void {
    this.unlockTarget = ap.iata;
    this.selected = null;
    this.routePath.setAttribute('d', '');
    this.routePath.classList.remove('is-drawn');
    this.pinsLayer.querySelectorAll('[data-iata]').forEach((el) => {
      el.classList.toggle('is-selected', (el as HTMLElement).dataset.iata === ap.iata);
    });
    this.dock.classList.remove('is-hidden', 'is-out-of-range');
    this.dock.classList.add('is-open');
    this.root.classList.add('has-route');
    this.setText('dockFrom', '—');
    this.setText('dockTo', ap.iata);
    this.setText('dockTitle', t('hub.unlockCity', { city: ap.city }));
    this.setText('dockBrief', this.unlockBrief(ap));
    this.setText('dockMeta', t('hub.tier', { n: ap.tier, region: t(`hub.region.${ap.region}`) }));
    this.setText('dockPay', t('hub.clearance', { n: formatCredits(ap.unlockCost) }));
    this.setText('unlockLabel', t('hub.unlockCost', { n: formatCredits(ap.unlockCost) }));
    this.setText('flyLabel', t('hub.fly'));
    const flyBtn = this.root.querySelector<HTMLButtonElement>('[data-hub="fly"]');
    const unlockBtn = this.root.querySelector<HTMLButtonElement>('[data-hub="unlock"]');
    if (flyBtn) {
      flyBtn.disabled = true;
      flyBtn.classList.add('is-hidden');
    }
    if (unlockBtn) {
      unlockBtn.classList.remove('is-hidden');
      unlockBtn.disabled = this.progress.credits < ap.unlockCost;
    }
    if (announce && this.progress.credits < ap.unlockCost) {
      this.toast(t('hub.needUnlock', { n: formatCredits(ap.unlockCost - this.progress.credits), city: ap.city }));
    }
  }

  private unlockSelected(): void {
    if (!this.unlockTarget) return;
    const iata = this.unlockTarget;
    const result = buyAirportUnlock(this.progress, iata);
    if (!result.ok) {
      this.toast(result.reason);
      return;
    }
    this.progress = result.progress;
    this.renderStats();
    this.renderPins();
    this.toast(t('hub.cleared', { city: airportByIata(iata)?.city ?? iata }));
    this.selectDestination(iata);
  }

  private selectDestination(iata: string): void {
    if (!this.isOpenDestination(iata)) return;
    this.unlockTarget = null;
    this.selected = iata;
    const home = airportByIata(this.progress.homeAirport)!;
    const dest = airportByIata(iata)!;
    const craft = fleetById(this.progress.activeAircraft);
    const reachable = this.inRange(iata);
    this.drawRoute(home, dest);
    this.pinsLayer.querySelectorAll('[data-iata]').forEach((el) => {
      el.classList.toggle('is-selected', (el as HTMLElement).dataset.iata === iata);
    });
    this.dock.classList.remove('is-hidden');
    this.dock.classList.add('is-open');
    this.dock.classList.toggle('is-out-of-range', !reachable);
    this.root.classList.add('has-route');
    this.setText('dockFrom', home.iata);
    this.setText('dockTo', dest.iata);
    this.setText('dockTitle', `${home.city} → ${dest.city}`);
    this.setText('dockBrief', this.routeBrief(home.iata, dest.iata));
    this.setText('dockMeta', this.routeMeta(home, dest));
    if (reachable) {
      const pay = estimatePayout(home.iata, dest.iata, this.progress.activeAircraft);
      this.setText('dockPay', t('hub.charterPay', { n: formatCredits(pay) }));
      this.setText('flyLabel', t('hub.flyTo', { city: dest.city }));
    } else {
      this.setText('dockPay', rangeBlockedMessage(home.iata, dest.iata, craft.id));
      this.setText('flyLabel', t('hub.outOfRange'));
    }
    const flyBtn = this.root.querySelector<HTMLButtonElement>('[data-hub="fly"]');
    const unlockBtn = this.root.querySelector<HTMLButtonElement>('[data-hub="unlock"]');
    if (flyBtn) {
      flyBtn.classList.remove('is-hidden');
      flyBtn.disabled = !reachable;
    }
    if (unlockBtn) unlockBtn.classList.add('is-hidden');
  }

  private clearSelection(): void {
    this.selected = null;
    this.unlockTarget = null;
    this.routePath.setAttribute('d', '');
    this.routePath.classList.remove('is-drawn');
    this.routePath.removeAttribute('style');
    this.pinsLayer.querySelectorAll('[data-iata]').forEach((el) => el.classList.remove('is-selected'));
    this.dock.classList.add('is-hidden');
    this.dock.classList.remove('is-open');
    this.dock.classList.remove('is-out-of-range');
    this.root.classList.remove('has-route');
    const flyBtn = this.root.querySelector<HTMLButtonElement>('[data-hub="fly"]');
    const unlockBtn = this.root.querySelector<HTMLButtonElement>('[data-hub="unlock"]');
    if (flyBtn) {
      flyBtn.disabled = false;
      flyBtn.classList.remove('is-hidden');
    }
    if (unlockBtn) unlockBtn.classList.add('is-hidden');
  }

  private isOpenDestination(iata: string): boolean {
    return airportStatus(this.progress, iata) === 'open';
  }

  private inRange(iata: string): boolean {
    return isWithinRange(this.progress.homeAirport, iata, this.progress.activeAircraft);
  }

  private renderWorldBase(): void {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg.querySelector('[data-hub="land"]')?.setAttribute('d', LAND_PATH);
    this.svg.querySelector('[data-hub="landGlow"]')?.setAttribute('d', LAND_PATH);
    this.svg.querySelector('[data-hub="borders"]')?.setAttribute('d', BORDER_PATH);

    const grid = this.svg.querySelector('[data-hub="grid"]')!;
    grid.innerHTML = '';
    let d = '';
    for (let lon = -180; lon <= 180; lon += 15) {
      const x = projectLonLat(lon, 0).x;
      d += `M${x.toFixed(1)} 0V${WORLD_H.toFixed(1)}`;
    }
    for (let lat = -45; lat <= 75; lat += 15) {
      const y = projectLonLat(0, lat).y;
      d += `M0 ${y.toFixed(1)}H${WORLD_W}`;
    }
    const lines = document.createElementNS(ns, 'path');
    lines.setAttribute('d', d);
    lines.setAttribute('class', 'hub-grid-line');
    grid.appendChild(lines);
    const equator = document.createElementNS(ns, 'path');
    const ey = projectLonLat(0, 0).y.toFixed(1);
    equator.setAttribute('d', `M0 ${ey}H${WORLD_W}`);
    equator.setAttribute('class', 'hub-grid-equator');
    grid.appendChild(equator);
  }

  /** Frame the base, its open hops and nearest neighbours — a regional chart, not a city close-up. */
  private focusHome(animate: boolean): void {
    const home = airportByIata(this.progress.homeAirport);
    if (!home) return;
    const h = this.pinPoint(home);
    const pts = [h];
    const open = AIRPORTS.filter((a) => a.iata !== home.iata && airportStatus(this.progress, a.iata) === 'open' && this.inRange(a.iata));
    const others = AIRPORTS.filter((a) => a.iata !== home.iata)
      .map((a) => ({ a, d: Math.hypot(a.lat - home.lat, a.lon - home.lon) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, HOME_NEIGHBOURS)
      .map((p) => p.a);
    for (const a of new Set([...open, ...others])) pts.push(this.pinPoint(a));
    // Centre on the base so it never ends up at the chart edge.
    let rx = 0;
    let ry = 0;
    for (const p of pts) {
      rx = Math.max(rx, Math.abs(p.x - h.x));
      ry = Math.max(ry, Math.abs(p.y - h.y));
    }
    this.camera.fitBox(h.x - rx, h.y - ry, h.x + rx, h.y + ry, {
      animate,
      pad: 0.4,
      maxScale: this.camera.minScale * HOME_FIT_MAX_ZOOM,
    });
  }

  private pinPoint(ap: Airport): { x: number; y: number } {
    return projectLonLat(ap.lon, ap.lat);
  }

  /** Keep pins, labels and the route a constant on-screen size at every zoom level. */
  private onCamera(v: CameraView): void {
    const inv = 1 / v.scale;
    for (const p of this.pinEls) {
      p.el.setAttribute('transform', `translate(${p.x.toFixed(3)} ${p.y.toFixed(3)}) scale(${inv.toFixed(5)})`);
    }
    this.svg.classList.toggle('hub-svg--far', v.scale < this.camera.minScale * LABEL_ZOOM);
  }

  private drawRoute(from: Airport, to: Airport): void {
    const a = this.pinPoint(from);
    const b = this.pinPoint(to);
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const lift = span * 0.2;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 - lift;
    const d = `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${mx.toFixed(2)} ${my.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    this.routePath.classList.remove('is-drawn');
    this.routePath.setAttribute('d', d);
    this.routePath.setAttribute('pathLength', '1');
    // Restart the draw animation.
    void this.routePath.getBoundingClientRect();
    this.routePath.classList.add('is-drawn');
  }

  private routeBrief(from: string, to: string): string {
    const hop = `route.brief.${from}-${to}`;
    if (hasT(hop)) return t(hop);
    const dest = `airport.brief.${to}`;
    if (hasT(dest)) return t(dest);
    return t('route.brief.generic', { city: airportByIata(to)?.city ?? to });
  }

  private unlockBrief(ap: Airport): string {
    const lock = `airport.lock.${ap.iata}`;
    if (hasT(lock)) return t(lock);
    const dest = `airport.brief.${ap.iata}`;
    if (hasT(dest)) return t(dest);
    return t('airport.lock.generic', { city: ap.city });
  }

  private routeMeta(from: Airport, to: Airport): string {
    const km = distanceKm(from.iata, to.iata);
    const craft = fleetById(this.progress.activeAircraft);
    return `${Math.round(km)} km · ${formatFlightMinutes(km)} · ${craft.shortName}`;
  }

  private renderPins(): void {
    this.pinsLayer.innerHTML = '';
    this.pinEls = [];
    const ns = 'http://www.w3.org/2000/svg';
    // Home last so it draws on top of its neighbours.
    const ordered = [...AIRPORTS].sort(
      (a, b) => Number(a.iata === this.progress.homeAirport) - Number(b.iata === this.progress.homeAirport),
    );
    for (const ap of ordered) {
      const { x, y } = this.pinPoint(ap);
      const nudge = PIN_NUDGE[ap.iata] ?? { x: 0, y: 0 };
      const status = airportStatus(this.progress, ap.iata);
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', `hub-pin hub-pin--${status}`);
      g.setAttribute('data-iata', ap.iata);
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `${ap.iata} ${ap.city}`);

      const inner = document.createElementNS(ns, 'g');
      inner.setAttribute('transform', `translate(${nudge.x} ${nudge.y})`);
      g.appendChild(inner);

      const hit = document.createElementNS(ns, 'circle');
      hit.setAttribute('r', '16');
      hit.setAttribute('class', 'hub-pin-hit');
      inner.appendChild(hit);

      if (status === 'home') {
        const ring = document.createElementNS(ns, 'circle');
        ring.setAttribute('r', '15');
        ring.setAttribute('class', 'hub-pin-ring');
        inner.appendChild(ring);
      }

      if (status !== 'locked') {
        const pulse = document.createElementNS(ns, 'circle');
        pulse.setAttribute('r', status === 'home' ? '10' : '8');
        pulse.setAttribute('class', 'hub-pin-pulse');
        inner.appendChild(pulse);
      }

      const core = document.createElementNS(ns, 'circle');
      core.setAttribute('r', status === 'home' ? '5.5' : status === 'open' ? '4.5' : '3.5');
      core.setAttribute('class', 'hub-pin-core');
      inner.appendChild(core);

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('y', status === 'home' ? '-14' : '-10');
      label.setAttribute('class', 'hub-pin-label');
      label.textContent = ap.iata;
      inner.appendChild(label);

      const city = document.createElementNS(ns, 'text');
      city.setAttribute('y', status === 'home' ? '22' : '18');
      city.setAttribute('class', 'hub-pin-city');
      city.textContent = ap.city;
      inner.appendChild(city);

      this.pinsLayer.appendChild(g);
      this.pinEls.push({ el: g, x, y });
    }
    this.onCamera(this.camera.view);
  }

  private renderStats(): void {
    const fmt = (n: number) => (n > 0 ? String(n) : '—');
    this.setText('statCredits', formatCreditsCompact(this.progress.credits));
    this.setText('statFlights', fmt(this.progress.successfulFlights));
    this.setText('statCrashes', fmt(this.progress.crashes));
    this.setText('statDeaths', fmt(this.progress.deaths));
    this.setText('statHome', this.progress.homeAirport);
    this.renderActiveShip();
  }

  private renderActiveShip(): void {
    const craft = fleetById(this.progress.activeAircraft);
    this.setText('shipName', craft.name);
    const img = this.root.querySelector<HTMLImageElement>('[data-hub="shipArt"]');
    if (img) {
      img.src = aircraftPortraitUrl(craft.id);
      img.alt = craft.name;
    }
    const btn = this.root.querySelector<HTMLButtonElement>('[data-hub="ship"]');
    if (btn) btn.title = t('hub.shipTitle', { name: craft.name });
  }

  private openHangar(): void {
    this.toggleCareerConfirm(false);
    this.closeBoard();
    this.progress = loadProgress();
    this.renderHangar();
    this.hangar.classList.remove('is-hidden');
    this.hangar.setAttribute('aria-hidden', 'false');
    void this.restoreFleet();
  }

  private closeHangar(): void {
    this.hangar.classList.add('is-hidden');
    this.hangar.setAttribute('aria-hidden', 'true');
  }

  private toggleCareerConfirm(open: boolean): void {
    const box = this.root.querySelector('[data-hub="careerConfirm"]');
    box?.classList.toggle('is-hidden', !open);
    box?.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      this.closeHangar();
      this.closeBoard();
    } else {
      this.setCareerError('');
    }
  }

  private setCareerError(message: string): void {
    const el = this.root.querySelector<HTMLElement>('[data-hub="careerError"]');
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
  }

  private async eraseCareer(): Promise<void> {
    if (this.careerBusy || this.tour.active) return;
    this.careerBusy = true;
    this.setCareerError('');
    const erase = this.root.querySelector<HTMLButtonElement>('[data-hub="careerErase"]');
    if (erase) {
      erase.disabled = true;
      erase.textContent = t('hub.career.busy');
    }
    const ok = await deleteCareerPlayer();
    if (!ok) {
      this.careerBusy = false;
      if (erase) {
        erase.disabled = false;
        erase.textContent = t('hub.career.erase');
      }
      this.setCareerError(t('hub.career.fail'));
      return;
    }
    this.progress = resetCareerProgress();
    this.tour.resetForNewCareer();
    this.setAirline(DEFAULT_AIRLINE_TAG);
    this.renderStats();
    this.renderPins();
    this.clearSelection();
    this.focusHome(false);
    this.toggleCareerConfirm(false);
    this.careerBusy = false;
    if (erase) {
      erase.disabled = false;
      erase.textContent = t('hub.career.erase');
    }
    this.onCareerWiped();
  }

  private openBoard(): void {
    this.toggleCareerConfirm(false);
    this.closeHangar();
    this.board.classList.remove('is-hidden');
    this.board.setAttribute('aria-hidden', 'false');
    this.boardList.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'hub-board-empty';
    loading.textContent = t('hub.boardLoad');
    this.boardList.appendChild(loading);
    const req = ++this.boardReq;
    void fetchLeaderboard(20).then((rows) => {
      if (req !== this.boardReq) return;
      this.renderBoard(rows);
    });
  }

  private closeBoard(): void {
    this.boardReq += 1;
    this.board.classList.add('is-hidden');
    this.board.setAttribute('aria-hidden', 'true');
  }

  refreshLang(): void {
    this.tour.refresh();
    this.renderStats();
    if (this.hangarList.childElementCount) this.renderHangar();
    if (!this.board.classList.contains('is-hidden') && this.lastBoard) this.renderBoard(this.lastBoard);
    if (this.unlockTarget) {
      const ap = airportByIata(this.unlockTarget);
      if (ap) this.showUnlockOffer(ap, false);
    } else if (this.selected) this.selectDestination(this.selected);
  }

  private renderBoard(rows: LeaderboardRow[]): void {
    this.lastBoard = rows;
    this.boardList.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'hub-board-empty';
      empty.textContent = t('hub.boardEmpty');
      this.boardList.appendChild(empty);
      return;
    }
    const you = loadPlayer()?.airline;
    rows.forEach((row, i) => {
      const el = document.createElement('div');
      el.className = `hub-board-row${you && row.airline === you ? ' is-you' : ''}`;

      const rank = document.createElement('span');
      rank.className = 'hub-board-rank';
      rank.textContent = String(row.rank ?? i + 1);

      const name = document.createElement('div');
      name.className = 'hub-board-name';
      const title = document.createElement('strong');
      title.textContent = row.airline;
      const meta = document.createElement('small');
      meta.textContent = t('board.rowMeta', {
        cash: formatCreditsCompact(row.cash),
        flights: row.flights,
        crashes: row.crashes,
        losses: row.losses,
      });
      name.append(title, meta);

      const cash = document.createElement('span');
      cash.className = 'hub-board-cash';
      cash.textContent = formatCredits(row.score);

      el.append(rank, name, cash);
      this.boardList.appendChild(el);
    });
  }

  private renderHangar(): void {
    this.setText('hangarCredits', formatCredits(this.progress.credits));
    this.renderAdsPass();
    this.hangarList.innerHTML = '';
    for (const craft of FLEET) {
      const owned = this.progress.ownedAircraft.includes(craft.id);
      const active = this.progress.activeAircraft === craft.id;
      const card = document.createElement('article');
      card.className = `hub-fleet-card${owned ? ' is-owned' : ' is-locked'}${active ? ' is-active' : ''}`;

      const visual = document.createElement('div');
      visual.className = 'hub-fleet-visual';
      const art = document.createElement('img');
      art.src = aircraftPortraitUrl(craft.id);
      art.alt = craft.name;
      visual.appendChild(art);

      const body = document.createElement('div');
      body.className = 'hub-fleet-body';

      const head = document.createElement('div');
      head.className = 'hub-fleet-head';
      const name = document.createElement('strong');
      name.textContent = craft.name;
      const tag = document.createElement('span');
      tag.textContent = active ? t('hangar.active') : owned ? t('hangar.owned') : formatCredits(craft.price);
      head.append(name, tag);

      const cfg = aircraftById(craft.id);
      const type = document.createElement('small');
      type.className = 'hub-fleet-type';
      type.textContent = t('hangar.engines', {
        n: cfg.engineCount,
        prop: t(PROPULSION_KEY[cfg.propulsion]),
        reg: cfg.registration,
      });

      const blurb = document.createElement('p');
      blurb.textContent = t(`hangar.blurb.${craft.id}`);

      const meta = document.createElement('div');
      meta.className = 'hub-fleet-specs';
      const specs: [string, string][] = [
        [t('hangar.spec.seats'), craft.seats.toString()],
        [t('hangar.spec.cruise'), `${cfg.performance.cruiseKmh} km/h`],
        [t('hangar.spec.range'), `${craft.rangeKm.toLocaleString('en-US')} km`],
        [t('hangar.spec.runway'), `${cfg.performance.runwayM.toLocaleString('en-US')} m`],
        [t('hangar.spec.fare'), `×${craft.seatsMult.toFixed(2)}`],
      ];
      for (const [label, value] of specs) {
        const cell = document.createElement('span');
        const l = document.createElement('small');
        l.textContent = label;
        const v = document.createElement('b');
        v.textContent = value;
        cell.append(l, v);
        meta.appendChild(cell);
      }

      const actions = document.createElement('div');
      actions.className = 'hub-fleet-actions';
      if (owned) {
        if (!active) {
          const select = document.createElement('button');
          select.type = 'button';
          select.className = 'hub-fly hub-fleet-btn';
          select.dataset.fleetAction = 'select';
          select.dataset.fleetId = craft.id;
          select.textContent = t('hangar.select');
          actions.appendChild(select);
        } else {
          const note = document.createElement('span');
          note.className = 'hub-fleet-note';
          note.textContent = t('hangar.flying');
          actions.appendChild(note);
        }
      } else {
        const need = craft.price - this.progress.credits;
        const buy = document.createElement('button');
        buy.type = 'button';
        buy.className = 'hub-fly hub-fleet-btn';
        buy.dataset.fleetAction = 'buy';
        buy.dataset.fleetId = craft.id;
        buy.disabled = need > 0;
        buy.textContent = need > 0 ? t('hangar.need', { n: formatCredits(need) }) : t('hangar.buy', { n: formatCredits(craft.price) });
        actions.appendChild(buy);
        const euro = document.createElement('button');
        euro.type = 'button';
        euro.className = 'hub-fly hub-fleet-btn hub-fleet-btn--cash';
        euro.dataset.fleetAction = 'buyEuro';
        euro.dataset.fleetId = craft.id;
        euro.textContent = t('hangar.buyEuro', { n: aircraftPriceLabel(craft.id) });
        actions.appendChild(euro);
      }

      body.append(head, type, blurb, meta, actions);
      card.append(visual, body);
      this.hangarList.appendChild(card);
    }
  }

  private buyFleet(id: string): void {
    const result = buyAircraft(this.progress, id);
    if (!result.ok) {
      this.toast(result.reason);
      return;
    }
    this.onFleetUnlocked(id);
  }

  private renderAdsPass(): void {
    const btn = this.root.querySelector<HTMLButtonElement>('[data-hub="removeAds"]');
    if (!btn) return;
    const owned = adsRemoved();
    btn.classList.toggle('is-owned', owned);
    btn.disabled = owned;
    btn.textContent = owned ? t('hangar.ads.off') : t('hangar.ads.buy', { n: removeAdsPriceLabel() });
    btn.title = t(owned ? 'hangar.ads.offHint' : 'hangar.ads.hint');
  }

  private async buyRemoveAds(): Promise<void> {
    if (adsRemoved()) return;
    if (this.iapBusy) {
      this.toast(t('hangar.iap.busy'));
      return;
    }
    this.iapBusy = true;
    this.toast(t('hangar.iap.opening'));
    try {
      const result = await purchaseRemoveAds();
      if (!result.ok) {
        this.toast(this.iapFailCopy(result.reason));
        return;
      }
      this.renderAdsPass();
      this.toast(t('hangar.ads.bought'));
    } finally {
      this.iapBusy = false;
    }
  }

  private async buyFleetEuro(id: string): Promise<void> {
    if (this.iapBusy) {
      this.toast(t('hangar.iap.busy'));
      return;
    }
    this.iapBusy = true;
    this.toast(t('hangar.iap.opening'));
    try {
      const result = await purchaseAircraft(id);
      if (!result.ok) {
        this.toast(this.iapFailCopy(result.reason));
        return;
      }
      this.onFleetUnlocked(id);
    } finally {
      this.iapBusy = false;
    }
  }

  private async restoreFleet(): Promise<void> {
    if (this.iapRestoreBusy) return;
    this.iapRestoreBusy = true;
    try {
      await restoreAircraftPurchases();
      this.progress = loadProgress();
      this.renderStats();
      this.renderHangar();
      if (this.selected) this.selectDestination(this.selected);
    } finally {
      this.iapRestoreBusy = false;
    }
  }

  private onFleetUnlocked(id: string): void {
    this.progress = loadProgress();
    this.renderStats();
    this.renderHangar();
    if (this.selected) this.selectDestination(this.selected);
    this.toast(t('hub.acquired', { name: fleetById(id).shortName }));
  }

  private iapFailCopy(reason: IapFail): string {
    if (reason === 'web') return t('hangar.iap.web');
    if (reason === 'unavailable') return t('hangar.iap.unavailable');
    if (reason === 'cancelled') return t('hangar.iap.cancel');
    if (reason === 'pending') return t('hangar.iap.pending');
    return t('hangar.iap.fail');
  }

  private selectFleet(id: string): void {
    const result = selectAircraft(this.progress, id);
    if (!result.ok) {
      this.toast(result.reason);
      return;
    }
    this.progress = result.progress;
    this.renderStats();
    this.renderHangar();
    if (this.selected) this.selectDestination(this.selected);
    this.toast(t('hub.activeShip', { name: fleetById(id).shortName }));
  }

  private setText(ref: string, value: string): void {
    const el = this.root.querySelector(`[data-hub="${ref}"]`);
    if (el) el.textContent = value;
  }

  private toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('is-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('is-visible'), 2200);
  }
}

