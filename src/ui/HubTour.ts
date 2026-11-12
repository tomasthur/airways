import { t } from '../i18n';

const KEY = 'airways.hubTour';

type StepId =
  | 'welcome'
  | 'board'
  | 'lang'
  | 'career'
  | 'copilot'
  | 'hangar'
  | 'money'
  | 'ship'
  | 'map'
  | 'zoom'
  | 'surprise'
  | 'city'
  | 'fly'
  | 'clear';

interface Step {
  id: StepId;
  /** CSS selectors; the spotlight covers their combined box. */
  selectors: string[];
  pad?: number;
  radius?: string;
  /** Open a sample route so Fly / Clear exist on screen. */
  dock?: boolean;
}

const STEPS: Step[] = [
  { id: 'welcome', selectors: ['.hub-brand'], pad: 8, radius: '18px' },
  { id: 'board', selectors: ['[data-hub="boardOpen"]'], pad: 6, radius: '16px' },
  { id: 'lang', selectors: ['.hub-corner-lang'], pad: 6, radius: '16px' },
  { id: 'career', selectors: ['.hub-stat'], pad: 6, radius: '16px' },
  { id: 'copilot', selectors: ['.hub-hangar-btn[data-copilot]'], pad: 6, radius: '16px' },
  { id: 'hangar', selectors: ['[data-hub="hangarOpen"]'], pad: 6, radius: '16px' },
  { id: 'money', selectors: ['[data-hub="moreMoney"]'], pad: 6, radius: '16px' },
  { id: 'ship', selectors: ['[data-hub="ship"]'], pad: 6, radius: '16px' },
  { id: 'map', selectors: ['[data-hub="map"]'], pad: 4, radius: '20px' },
  { id: 'zoom', selectors: ['.hub-map-tools'], pad: 8, radius: '16px' },
  { id: 'surprise', selectors: ['.hub-hint'], pad: 6, radius: '14px' },
  { id: 'city', selectors: ['[data-hub="pins"] [data-iata]'], pad: 10, radius: '50%' },
  { id: 'fly', selectors: ['[data-hub="fly"]'], pad: 6, radius: '16px', dock: true },
  { id: 'clear', selectors: ['[data-hub="clear"]'], pad: 6, radius: '16px', dock: true },
];

export interface HubTourHooks {
  openSampleRoute: () => boolean;
  clearRoute: () => void;
  closePanels: () => void;
}

export class HubTour {
  private readonly root: HTMLElement;
  private readonly hub: HTMLElement;
  private readonly spot: HTMLElement;
  private readonly card: HTMLElement;
  private readonly stepEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly hooks: HubTourHooks;
  private index = 0;
  private running = false;
  private readonly onWin = () => this.layout();

  constructor(hub: HTMLElement, hooks: HubTourHooks) {
    this.hub = hub;
    this.hooks = hooks;
    this.root = hub.querySelector('[data-hub="tour"]')!;
    this.spot = hub.querySelector('[data-hub="tourSpot"]')!;
    this.card = hub.querySelector('[data-hub="tourCard"]')!;
    this.stepEl = hub.querySelector('[data-hub="tourStep"]')!;
    this.titleEl = hub.querySelector('[data-hub="tourTitle"]')!;
    this.bodyEl = hub.querySelector('[data-hub="tourBody"]')!;
    this.nextBtn = hub.querySelector('[data-hub="tourNext"]')!;
    this.backBtn = hub.querySelector('[data-hub="tourBack"]')!;
    this.skipBtn = hub.querySelector('[data-hub="tourSkip"]')!;

    this.nextBtn.addEventListener('click', () => this.next());
    this.backBtn.addEventListener('click', () => this.back());
    this.skipBtn.addEventListener('click', () => this.finish());
  }

  get active(): boolean {
    return this.running;
  }

  static seen(): boolean {
    return localStorage.getItem(KEY) === 'done';
  }

  /** New career: show the tour again after the next registration. */
  resetForNewCareer(): void {
    localStorage.removeItem(KEY);
    if (!this.running) return;
    this.running = false;
    this.hooks.clearRoute();
    this.root.classList.add('is-hidden');
    this.root.setAttribute('aria-hidden', 'true');
    window.removeEventListener('resize', this.onWin);
  }

  maybeStart(): void {
    if (this.running || HubTour.seen()) return;
    const register = document.getElementById('register');
    if (register && !register.classList.contains('is-hidden')) return;
    if (this.hub.classList.contains('is-hidden')) return;
    this.running = true;
    this.index = 0;
    this.hooks.closePanels();
    this.root.classList.remove('is-hidden');
    this.root.setAttribute('aria-hidden', 'false');
    window.addEventListener('resize', this.onWin);
    this.render();
    requestAnimationFrame(() => this.layout());
  }

  refresh(): void {
    if (this.running) this.render();
  }

  private next(): void {
    if (this.index >= STEPS.length - 1) {
      this.finish();
      return;
    }
    this.index += 1;
    this.render();
  }

  private back(): void {
    if (this.index <= 0) return;
    this.index -= 1;
    this.render();
  }

  private finish(): void {
    localStorage.setItem(KEY, 'done');
    this.running = false;
    this.hooks.clearRoute();
    this.root.classList.add('is-hidden');
    this.root.setAttribute('aria-hidden', 'true');
    window.removeEventListener('resize', this.onWin);
  }

  private render(): void {
    const step = STEPS[this.index];
    const last = this.index === STEPS.length - 1;
    this.stepEl.textContent = t('tour.step', { n: this.index + 1, total: STEPS.length });
    this.titleEl.textContent = t(`tour.${step.id}.title`);
    this.bodyEl.textContent = t(`tour.${step.id}.body`);
    this.nextBtn.textContent = last ? t('tour.done') : t('tour.next');
    this.skipBtn.textContent = t('tour.skip');
    this.backBtn.textContent = t('tour.back');
    this.backBtn.classList.toggle('is-hidden', this.index === 0);
    this.skipBtn.classList.toggle('is-hidden', last);

    if (step.dock) this.hooks.openSampleRoute();
    else this.hooks.clearRoute();

    this.layout();
    requestAnimationFrame(() => this.layout());
  }

  private layout(): void {
    if (!this.running) return;
    const step = STEPS[this.index];
    const box = this.targetBox(step);
    if (!box) {
      this.spot.classList.add('is-hidden');
      this.card.classList.remove('is-top');
      return;
    }
    this.spot.classList.remove('is-hidden');
    this.spot.style.left = `${box.left}px`;
    this.spot.style.top = `${box.top}px`;
    this.spot.style.width = `${box.width}px`;
    this.spot.style.height = `${box.height}px`;
    this.spot.style.borderRadius = step.radius ?? '14px';
    const mid = box.top + box.height / 2;
    this.card.classList.toggle('is-top', mid > window.innerHeight * 0.48);
  }

  private targetBox(step: Step): { left: number; top: number; width: number; height: number } | null {
    const hubBox = this.hub.getBoundingClientRect();
    const nodes: Element[] = [];
    for (const sel of step.selectors) {
      this.hub.querySelectorAll(sel).forEach((el) => {
        if (el.closest('.is-hidden') && !el.closest('[data-hub="tour"]')) return;
        nodes.push(el);
      });
    }
    let pick = nodes.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    });
    if (step.id === 'city') {
      const home = this.hub.querySelector('[data-hub="statHome"]')?.textContent?.trim();
      const dest =
        pick.find((el) => (el as HTMLElement).dataset.iata && (el as HTMLElement).dataset.iata !== home) ?? pick[0];
      pick = dest ? [dest] : pick.slice(0, 1);
    }
    if (!pick.length) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const el of pick) {
      const r = el.getBoundingClientRect();
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    const pad = step.pad ?? 6;
    return {
      left: left - hubBox.left - pad,
      top: top - hubBox.top - pad,
      width: right - left + pad * 2,
      height: bottom - top + pad * 2,
    };
  }
}
