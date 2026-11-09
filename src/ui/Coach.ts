/** Highlights the control the player should use and parks a short tip next to it. */

export type CoachId =
  | 'door'
  | 'boarding'
  | 'lights'
  | 'flapsTakeoff'
  | 'beltsCl'
  | 'engine'
  | 'belts'
  | 'gear'
  | 'flapsDown'
  | 'flapsUp'
  | 'throttle'
  | 'yoke'
  | 'brake'
  | 'speedBrake'
  | 'relight'
  | 'atc';

export interface CoachCue {
  id: CoachId;
  text: string;
}

const SELECTOR: Record<CoachId, string> = {
  door: '[data-ref="clDoorBtn"]',
  boarding: '[data-cl="boarding"]',
  lights: '[data-ref="clLightsBtn"]',
  flapsTakeoff: '[data-action="flapsTakeoff"]',
  beltsCl: '[data-ref="clBeltsBtn"]',
  engine: '[data-ref="clEngineBtn"]',
  belts: '[data-ref="beltsBtn"]',
  gear: '.ctl[data-action="gear"]',
  flapsDown: '.ctl[data-action="flapsDown"]',
  flapsUp: '.ctl[data-action="flapsUp"]',
  throttle: '[data-ref="throttleTrack"]',
  yoke: '[data-ref="yoke"]',
  brake: '[data-ref="brakePedal"]',
  speedBrake: '[data-ref="speedBrakePedal"]',
  relight: '[data-ref="cabinStart"]',
  atc: '[data-ref="atcReply1"]',
};

export class Coach {
  private readonly root: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly msg: HTMLElement;
  private last = '';

  constructor(app: HTMLElement) {
    this.root = document.getElementById('coach') ?? this.mount(app);
    this.ring = this.root.querySelector('.coach-ring')!;
    this.tip = this.root.querySelector('.coach-tip')!;
    this.msg = this.root.querySelector('.coach-msg')!;
  }

  private mount(app: HTMLElement): HTMLElement {
    const el = document.createElement('div');
    el.id = 'coach';
    el.className = 'coach is-hidden';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="coach-ring"></div><div class="coach-tip"><span class="coach-msg"></span></div>';
    app.appendChild(el);
    return el;
  }

  clear(): void {
    this.last = '';
    this.root.classList.add('is-hidden');
  }

  show(app: HTMLElement, cue: CoachCue | null): void {
    if (!cue) {
      this.clear();
      return;
    }
    const el = app.querySelector<HTMLElement>(SELECTOR[cue.id]);
    if (!el || el.classList.contains('is-hidden') || el.closest('.is-hidden')) {
      this.clear();
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) {
      this.clear();
      return;
    }
    const pad = cue.id === 'throttle' || cue.id === 'yoke' ? 8 : 5;
    const left = r.left - pad;
    const top = r.top - pad;
    const width = r.width + pad * 2;
    const height = r.height + pad * 2;
    const key = `${cue.id}|${cue.text}|${left.toFixed(0)}|${top.toFixed(0)}|${width.toFixed(0)}|${height.toFixed(0)}`;
    this.ring.style.left = `${left}px`;
    this.ring.style.top = `${top}px`;
    this.ring.style.width = `${width}px`;
    this.ring.style.height = `${height}px`;
    this.ring.style.borderRadius = cue.id === 'yoke' ? '20px' : cue.id === 'throttle' ? '16px' : '12px';
    if (this.last !== key) {
      this.msg.textContent = cue.text;
      this.last = key;
    }
    this.root.classList.remove('is-hidden');
    this.placeTip(left, top, width, height);
  }

  private placeTip(x: number, y: number, w: number, h: number): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 8;
    const gap = 10;
    const tw = this.tip.offsetWidth || 200;
    const th = this.tip.offsetHeight || 48;
    const fits = (left: number, top: number) => left >= m && top >= m && left + tw <= vw - m && top + th <= vh - m;
    const midY = y + (h - th) / 2;
    const endX = x + w - tw;
    const startX = x;
    const candidates = [
      { left: x - gap - tw, top: midY },
      { left: x + w + gap, top: midY },
      { left: endX, top: y - gap - th },
      { left: startX, top: y - gap - th },
      { left: endX, top: y + h + gap },
      { left: startX, top: y + h + gap },
    ];
    const pick = candidates.find((c) => fits(c.left, c.top)) ?? candidates[0];
    this.tip.style.left = `${Math.min(vw - tw - m, Math.max(m, pick.left))}px`;
    this.tip.style.top = `${Math.min(vh - th - m, Math.max(m, pick.top))}px`;
  }
}
