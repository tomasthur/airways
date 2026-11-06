import { AIRPORTS, airportByIata, type Airport } from '../meta/airports';
import { airportStatus, loadProgress, type Progress } from '../meta/progress';
import { getRoute } from '../meta/routes';

/** Geographic frame for the Central Europe SVG (lon west→east, lat south→north). */
const LON0 = 10.2;
const LON1 = 21.6;
const LAT0 = 45.6;
const LAT1 = 52.5;
const VW = 1000;
const VH = 620;
/** Tiny screen-space nudges so neighbouring airports stay tappable. */
const PIN_NUDGE: Record<string, { x: number; y: number }> = {
  BTS: { x: -14, y: 10 },
  VIE: { x: 18, y: -8 },
  BUD: { x: 8, y: 6 },
};

/** Simplified Central Europe land silhouette in viewBox coordinates. */
const LAND =
  'M 118 470 C 130 510 168 545 230 555 C 290 565 340 540 390 525 C 430 545 480 570 545 560 C 610 548 660 500 700 455 C 745 470 800 455 845 410 C 890 365 920 300 910 245 C 900 190 850 155 790 145 C 740 138 700 160 660 150 C 620 120 560 95 500 105 C 440 115 400 150 360 145 C 310 138 270 115 220 130 C 170 148 140 190 125 240 C 108 300 100 370 118 470 Z';

export interface HubFlyRequest {
  from: string;
  to: string;
}

/**
 * Full-screen map hub: Central Europe network, route pick, Fly into the existing mission.
 */
export class HubMenu {
  private readonly root: HTMLElement;
  private readonly mapStage: HTMLElement;
  private readonly pinsLayer: SVGElement;
  private readonly routePath: SVGPathElement;
  private readonly dock: HTMLElement;
  private readonly toastEl: HTMLElement;
  private progress: Progress;
  private selected: string | null = null;
  private toastTimer = 0;
  private readonly onFly: (req: HubFlyRequest) => void;

  constructor(root: HTMLElement, onFly: (req: HubFlyRequest) => void) {
    this.root = root;
    this.onFly = onFly;
    this.progress = loadProgress();

    this.mapStage = root.querySelector('[data-hub="map"]')!;
    this.dock = root.querySelector('[data-hub="dock"]')!;
    this.toastEl = root.querySelector('[data-hub="toast"]')!;

    const svg = this.mapStage.querySelector('svg')!;
    this.pinsLayer = svg.querySelector('[data-hub="pins"]') as unknown as SVGElement;
    this.routePath = svg.querySelector('[data-hub="route"]') as SVGPathElement;

    this.renderStats();
    this.renderPins();
    this.clearSelection();

    this.pinsLayer.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest('[data-iata]') as HTMLElement | null;
      if (!btn) return;
      this.onAirport(btn.dataset.iata!);
    });

    root.querySelector('[data-hub="fly"]')!.addEventListener('click', () => this.fly());
    root.querySelector('[data-hub="clear"]')?.addEventListener('click', () => this.clearSelection());
    root.querySelector('[data-hub="random"]')?.addEventListener('click', () => this.pickRandom());
  }

  show(visible: boolean): void {
    this.root.classList.toggle('is-hidden', !visible);
    if (visible) {
      this.progress = loadProgress();
      this.renderStats();
      this.renderPins();
      if (this.selected) this.selectDestination(this.selected);
      else this.clearSelection();
    }
  }

  /** True when a playable destination is selected (Enter can start). */
  canFly(): boolean {
    return this.selected !== null && this.isOpenDestination(this.selected);
  }

  tryFlyFromKeyboard(): boolean {
    if (!this.canFly()) {
      this.toast('Pick an open airport on the map — or tap Surprise me');
      return false;
    }
    this.fly();
    return true;
  }

  private pickRandom(): void {
    const open = AIRPORTS.filter((a) => airportStatus(this.progress, a.iata) === 'open');
    if (!open.length) {
      this.toast('No open destinations from this base');
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
    if (status === 'locked') {
      this.toast(ap.lockHint ?? 'Not cleared yet');
      return;
    }
    this.selectDestination(iata);
  }

  private selectDestination(iata: string): void {
    if (!this.isOpenDestination(iata)) return;
    this.selected = iata;
    const home = airportByIata(this.progress.homeAirport)!;
    const dest = airportByIata(iata)!;
    this.drawRoute(home, dest);
    this.pinsLayer.querySelectorAll('[data-iata]').forEach((el) => {
      el.classList.toggle('is-selected', (el as HTMLElement).dataset.iata === iata);
    });
    this.dock.classList.remove('is-hidden');
    this.dock.classList.add('is-open');
    this.root.classList.add('has-route');
    this.setText('dockFrom', home.iata);
    this.setText('dockTo', dest.iata);
    const route = getRoute(home.iata, dest.iata);
    this.setText('dockTitle', `${home.city} → ${dest.city}`);
    this.setText('dockBrief', route?.brief ?? dest.brief ?? '');
    this.setText('dockMeta', this.routeMeta(home, dest));
    this.setText('flyLabel', `Fly to ${dest.city}`);
  }

  private clearSelection(): void {
    this.selected = null;
    this.routePath.setAttribute('d', '');
    this.routePath.classList.remove('is-drawn');
    this.pinsLayer.querySelectorAll('[data-iata]').forEach((el) => el.classList.remove('is-selected'));
    this.dock.classList.add('is-hidden');
    this.dock.classList.remove('is-open');
    this.root.classList.remove('has-route');
  }

  private isOpenDestination(iata: string): boolean {
    return airportStatus(this.progress, iata) === 'open';
  }

  private project(lat: number, lon: number): { x: number; y: number } {
    return {
      x: ((lon - LON0) / (LON1 - LON0)) * VW,
      y: ((LAT1 - lat) / (LAT1 - LAT0)) * VH,
    };
  }

  private pinPoint(ap: Airport): { x: number; y: number } {
    const p = this.project(ap.lat, ap.lon);
    const nudge = PIN_NUDGE[ap.iata] ?? { x: 0, y: 0 };
    return { x: p.x + nudge.x, y: p.y + nudge.y };
  }

  private drawRoute(from: Airport, to: Airport): void {
    const a = this.pinPoint(from);
    const b = this.pinPoint(to);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.28;
    const d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    this.routePath.classList.remove('is-drawn');
    this.routePath.setAttribute('d', d);
    // Restart the draw animation.
    void this.routePath.getBoundingClientRect();
    this.routePath.classList.add('is-drawn');
  }

  private routeMeta(from: Airport, to: Airport): string {
    const km =
      111.32 *
      Math.sqrt((to.lat - from.lat) ** 2 + ((to.lon - from.lon) * Math.cos((((from.lat + to.lat) / 2) * Math.PI) / 180)) ** 2);
    return `${Math.round(km)} km · visual flight · day or night`;
  }

  private renderPins(): void {
    this.pinsLayer.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    for (const ap of AIRPORTS) {
      const p = this.project(ap.lat, ap.lon);
      const nudge = PIN_NUDGE[ap.iata] ?? { x: 0, y: 0 };
      const x = p.x + nudge.x;
      const y = p.y + nudge.y;
      const status = airportStatus(this.progress, ap.iata);
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', `hub-pin hub-pin--${status}`);
      g.setAttribute('data-iata', ap.iata);
      g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `${ap.iata} ${ap.city}`);

      if (status === 'home') {
        const ring = document.createElementNS(ns, 'circle');
        ring.setAttribute('r', '22');
        ring.setAttribute('class', 'hub-pin-ring');
        g.appendChild(ring);
      }

      const pulse = document.createElementNS(ns, 'circle');
      pulse.setAttribute('r', status === 'open' ? '14' : '10');
      pulse.setAttribute('class', 'hub-pin-pulse');
      g.appendChild(pulse);

      const core = document.createElementNS(ns, 'circle');
      core.setAttribute('r', status === 'home' ? '7' : '5.5');
      core.setAttribute('class', 'hub-pin-core');
      g.appendChild(core);

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('y', status === 'home' ? '36' : '24');
      label.setAttribute('class', 'hub-pin-label');
      label.textContent = ap.iata;
      g.appendChild(label);

      if (status === 'locked') {
        const lock = document.createElementNS(ns, 'text');
        lock.setAttribute('y', '-12');
        lock.setAttribute('class', 'hub-pin-lock');
        lock.textContent = '✕';
        g.appendChild(lock);
      }

      if (status === 'home') {
        const ac = document.createElementNS(ns, 'path');
        ac.setAttribute('d', 'M -7 0 L 8 0 M 2 -4 L 8 0 L 2 4 M -3 -3 L -1 0 L -3 3');
        ac.setAttribute('class', 'hub-pin-plane');
        g.appendChild(ac);
      }

      this.pinsLayer.appendChild(g);
    }
  }

  private renderStats(): void {
    const fmt = (n: number) => (n > 0 ? String(n) : '—');
    this.setText('statFlights', fmt(this.progress.successfulFlights));
    this.setText('statCrashes', fmt(this.progress.crashes));
    this.setText('statDeaths', fmt(this.progress.deaths));
    this.setText('statHome', this.progress.homeAirport);
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

/** Static land path exported for the SVG markup builder if needed. */
export const HUB_LAND_PATH = LAND;
export const HUB_VIEWBOX = `0 0 ${VW} ${VH}`;
