import { AIRPORTS, airportByIata, type Airport } from '../meta/airports';
import {
  buyAircraft,
  buyAirportUnlock,
  distanceKm,
  estimatePayout,
  FLEET,
  fleetById,
  formatCredits,
  isWithinRange,
  rangeBlockedMessage,
  selectAircraft,
} from '../meta/economy';
import { formatFlightMinutes } from '../meta/flightLength';
import {
  airportStatus,
  isAirportUnlocked,
  loadProgress,
  noRouteHint,
  type Progress,
} from '../meta/progress';
import { getRoute } from '../meta/routes';
import { BORDER_PATH, LAND_PATH, WORLD_H, WORLD_W, projectLonLat } from '../meta/worldMap';
import { aircraftById } from '../sim/aircraft';
import type { Propulsion } from '../sim/aircraft/AircraftConfig';
import { MapCamera, type CameraView } from './MapCamera';

const PROPULSION_LABEL: Record<Propulsion, string> = { piston: 'piston prop', turboprop: 'turboprop', jet: 'turbofan' };

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
  private readonly svg: SVGSVGElement;
  private readonly camera: MapCamera;
  private progress: Progress;
  private selected: string | null = null;
  /** Locked airport offered for purchase in the dock. */
  private unlockTarget: string | null = null;
  private toastTimer = 0;
  private readonly onFly: (req: HubFlyRequest) => void;
  private pinEls: { el: SVGGElement; x: number; y: number }[] = [];

  constructor(root: HTMLElement, onFly: (req: HubFlyRequest) => void) {
    this.root = root;
    this.onFly = onFly;
    this.progress = loadProgress();

    this.mapStage = root.querySelector('[data-hub="map"]')!;
    this.dock = root.querySelector('[data-hub="dock"]')!;
    this.toastEl = root.querySelector('[data-hub="toast"]')!;
    this.hangar = root.querySelector('[data-hub="hangar"]')!;
    this.hangarList = root.querySelector('[data-hub="hangarList"]')!;

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
    root.querySelector('[data-hub="hangarOpen"]')?.addEventListener('click', () => this.openHangar());
    root.querySelector('[data-hub="hangarClose"]')?.addEventListener('click', () => this.closeHangar());
    root.querySelector('[data-hub="zoomIn"]')?.addEventListener('click', () => this.camera.zoomBy(1.6));
    root.querySelector('[data-hub="zoomOut"]')?.addEventListener('click', () => this.camera.zoomBy(1 / 1.6));
    root.querySelector('[data-hub="zoomHome"]')?.addEventListener('click', () => this.focusHome(true));
    this.hangar.addEventListener('click', (e) => {
      if (e.target === this.hangar) this.closeHangar();
    });
    this.hangarList.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest('[data-fleet-action]') as HTMLElement | null;
      if (!btn) return;
      const id = btn.dataset.fleetId;
      const action = btn.dataset.fleetAction;
      if (!id || !action) return;
      if (action === 'buy') this.buyFleet(id);
      else if (action === 'select') this.selectFleet(id);
    });
  }

  show(visible: boolean): void {
    this.root.classList.toggle('is-hidden', !visible);
    if (visible) {
      this.progress = loadProgress();
      this.closeHangar();
      this.renderStats();
      this.renderPins();
      // Measure after the hub is laid out, then glide in from the world view.
      requestAnimationFrame(() => {
        this.camera.fitBox(0, 0, WORLD_W, WORLD_H, { animate: false, pad: 0 });
        this.focusHome(true);
      });
      if (this.selected) this.selectDestination(this.selected);
      else this.clearSelection();
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

  tryFlyFromKeyboard(): boolean {
    if (this.selected && this.isOpenDestination(this.selected) && !this.inRange(this.selected)) {
      this.toast(rangeBlockedMessage(this.progress.homeAirport, this.selected, this.progress.activeAircraft));
      return false;
    }
    if (!this.canFly()) {
      this.toast('Pick an open airport on the map — or tap Surprise me');
      return false;
    }
    this.fly();
    return true;
  }

  private pickRandom(): void {
    const open = AIRPORTS.filter(
      (a) => airportStatus(this.progress, a.iata) === 'open' && this.inRange(a.iata),
    );
    if (!open.length) {
      this.toast('No in-range destinations for this aircraft');
      return;
    }
    const pick = open[Math.floor(Math.random() * open.length)];
    this.selectDestination(pick.iata);
    this.toast(`Filed at random · ${this.progress.homeAirport} → ${pick.iata}`);
  }

  private fly(): void {
    if (!this.canFly() || !this.selected) return;
    this.onFly({ from: this.progress.homeAirport, to: this.selected });
  }

  private onAirport(iata: string): void {
    const status = airportStatus(this.progress, iata);
    const ap = airportByIata(iata);
    if (!ap) return;

    if (status === 'home') {
      this.toast(`You are here · ${ap.city}`);
      return;
    }
    if (!isAirportUnlocked(this.progress, iata)) {
      this.showUnlockOffer(ap);
      return;
    }
    if (status === 'locked') {
      // Cleared, but no direct hop from the current base.
      this.toast(noRouteHint(this.progress.homeAirport, iata));
      return;
    }
    this.selectDestination(iata);
    if (!this.inRange(iata)) {
      this.toast(rangeBlockedMessage(this.progress.homeAirport, iata, this.progress.activeAircraft));
    }
  }

  private showUnlockOffer(ap: Airport): void {
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
    this.setText('dockTitle', `Unlock ${ap.city}`);
    this.setText('dockBrief', ap.lockHint ?? ap.brief ?? '');
    this.setText('dockMeta', `Tier ${ap.tier} · ${ap.region}`);
    this.setText('dockPay', `Clearance ${formatCredits(ap.unlockCost)}`);
    this.setText('unlockLabel', `Unlock ${formatCredits(ap.unlockCost)}`);
    this.setText('flyLabel', 'Fly');
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
    if (this.progress.credits < ap.unlockCost) {
      this.toast(`Need ${formatCredits(ap.unlockCost - this.progress.credits)} more for ${ap.city}`);
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
    this.toast(`Cleared · ${airportByIata(iata)?.city ?? iata}`);
    const status = airportStatus(this.progress, iata);
    if (status === 'open') this.selectDestination(iata);
    else {
      this.clearSelection();
      this.toast(noRouteHint(this.progress.homeAirport, iata));
    }
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
    const route = getRoute(home.iata, dest.iata);
    this.setText('dockTitle', `${home.city} → ${dest.city}`);
    this.setText('dockBrief', route?.brief ?? dest.brief ?? '');
    this.setText('dockMeta', this.routeMeta(home, dest));
    if (reachable) {
      const pay = estimatePayout(home.iata, dest.iata, this.progress.activeAircraft);
      this.setText('dockPay', `Charter ~${formatCredits(pay)}`);
      this.setText('flyLabel', `Fly to ${dest.city}`);
    } else {
      this.setText('dockPay', rangeBlockedMessage(home.iata, dest.iata, craft.id));
      this.setText('flyLabel', 'Out of range');
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
    this.setText('statCredits', formatCredits(this.progress.credits));
    this.setText('statFlights', fmt(this.progress.successfulFlights));
    this.setText('statCrashes', fmt(this.progress.crashes));
    this.setText('statDeaths', fmt(this.progress.deaths));
    this.setText('statHome', this.progress.homeAirport);
  }

  private openHangar(): void {
    this.progress = loadProgress();
    this.renderHangar();
    this.hangar.classList.remove('is-hidden');
    this.hangar.setAttribute('aria-hidden', 'false');
  }

  private closeHangar(): void {
    this.hangar.classList.add('is-hidden');
    this.hangar.setAttribute('aria-hidden', 'true');
  }

  private renderHangar(): void {
    this.setText('hangarCredits', formatCredits(this.progress.credits));
    this.hangarList.innerHTML = '';
    for (const craft of FLEET) {
      const owned = this.progress.ownedAircraft.includes(craft.id);
      const active = this.progress.activeAircraft === craft.id;
      const card = document.createElement('article');
      card.className = `hub-fleet-card${owned ? ' is-owned' : ' is-locked'}${active ? ' is-active' : ''}`;

      const head = document.createElement('div');
      head.className = 'hub-fleet-head';
      const name = document.createElement('strong');
      name.textContent = craft.name;
      const tag = document.createElement('span');
      tag.textContent = active ? 'Active' : owned ? 'Owned' : formatCredits(craft.price);
      head.append(name, tag);

      const cfg = aircraftById(craft.id);
      const type = document.createElement('small');
      type.className = 'hub-fleet-type';
      type.textContent = `${cfg.engineCount}× ${PROPULSION_LABEL[cfg.propulsion]} · ${cfg.registration}`;

      const blurb = document.createElement('p');
      blurb.textContent = craft.blurb;

      const meta = document.createElement('div');
      meta.className = 'hub-fleet-specs';
      const specs: [string, string][] = [
        ['Seats', craft.seats.toString()],
        ['Cruise', `${cfg.performance.cruiseKmh} km/h`],
        ['Range', `${craft.rangeKm.toLocaleString('en-US')} km`],
        ['Runway', `${cfg.performance.runwayM.toLocaleString('en-US')} m`],
        ['Fare', `×${craft.seatsMult.toFixed(2)}`],
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
          select.textContent = 'Select';
          actions.appendChild(select);
        } else {
          const note = document.createElement('span');
          note.className = 'hub-fleet-note';
          note.textContent = 'Flying this ship';
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
        buy.textContent = need > 0 ? `Need ${formatCredits(need)} more` : `Buy ${formatCredits(craft.price)}`;
        actions.appendChild(buy);
      }

      card.append(head, type, blurb, meta, actions);
      this.hangarList.appendChild(card);
    }
  }

  private buyFleet(id: string): void {
    const result = buyAircraft(this.progress, id);
    if (!result.ok) {
      this.toast(result.reason);
      return;
    }
    this.progress = result.progress;
    this.renderStats();
    this.renderHangar();
    if (this.selected) this.selectDestination(this.selected);
    this.toast(`Acquired · ${fleetById(id).shortName}`);
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
    this.toast(`Active · ${fleetById(id).shortName}`);
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

