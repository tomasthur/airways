import type { LandingReport } from '../sim/Landing';
import type { HoldAction, Input, PressAction } from '../game/Input';

export interface HudData {
  speedKmh: number;
  altitude: number;
  verticalSpeed: number;
  power: number;
  /** Normalised cylinder-head temperature 0..1. */
  cht: number;
  flapsDeg: number;
  flapsTargetDeg: number;
  gear: number;
  gearTarget: number;
  progress: number;
  distanceKm: number;
  phase: string;
  destCode: string;
  destRunway: string;
}

export interface ChecklistView {
  load: string;
  door: string;
  doorButton: string;
  doorEnabled: boolean;
  boarding: string;
  lights: boolean;
  flaps: string;
  belts: boolean;
  engine: string;
  engineEnabled: boolean;
  done: { door: boolean; boarding: boolean; lights: boolean; flaps: boolean; belts: boolean; engine: boolean };
  next: keyof ChecklistView['done'] | null;
}

export type WarningKey = 'stall' | 'overspeed' | 'gear' | 'sink' | 'flaps' | 'terrain' | 'cht';

/** DOM HUD. Writes to the DOM only when values change. */
export class Hud {
  private readonly refs = new Map<string, HTMLElement>();
  private readonly cache = new Map<string, string>();
  private readonly warnEls = new Map<WarningKey, HTMLElement>();
  private readonly papiLights: HTMLElement[];
  private landmarkKey = '';

  private readonly root: HTMLElement;

  constructor(root: HTMLElement, input: Input) {
    this.root = root;
    root.querySelectorAll<HTMLElement>('[data-ref]').forEach((el) => this.refs.set(el.dataset.ref!, el));
    root.querySelectorAll<HTMLElement>('[data-warn]').forEach((el) => this.warnEls.set(el.dataset.warn as WarningKey, el));
    this.papiLights = Array.from(root.querySelectorAll<HTMLElement>('.papi-lights i'));

    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        input.emit(btn.dataset.action as PressAction);
        btn.blur();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach((btn) => {
      const action = btn.dataset.hold as HoldAction;
      const set = (down: boolean) => {
        input.setPointer(action, down);
        btn.classList.toggle('active', down);
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        set(true);
      });
      btn.addEventListener('pointerup', () => set(false));
      btn.addEventListener('pointercancel', () => set(false));
      btn.addEventListener('lostpointercapture', () => set(false));
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  private ref(name: string): HTMLElement {
    const el = this.refs.get(name);
    if (!el) throw new Error(`Missing HUD element ${name}`);
    return el;
  }

  private text(name: string, value: string): void {
    if (this.cache.get(name) === value) return;
    this.cache.set(name, value);
    this.ref(name).textContent = value;
  }

  private style(name: string, prop: 'transform' | 'width' | 'left', value: string): void {
    const key = `${name}.${prop}`;
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    this.ref(name).style[prop] = value;
  }

  private cls(el: HTMLElement, key: string, value: string): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    el.className = value;
  }

  show(id: 'hud' | 'menu' | 'pause' | 'report' | 'loading', visible: boolean): void {
    document.getElementById(id)?.classList.toggle('is-hidden', !visible);
  }

  update(d: HudData): void {
    this.text('speed', Math.round(d.speedKmh).toString());
    this.style('speedBar', 'width', `${Math.min(100, (d.speedKmh / 320) * 100).toFixed(1)}%`);
    this.text('alt', Math.round(d.altitude).toString());
    const vs = Math.abs(d.verticalSpeed) < 0.05 ? 0 : d.verticalSpeed;
    this.text('vs', `${vs > 0 ? '+' : ''}${vs.toFixed(1)}`);
    const needle = Math.max(-1, Math.min(1, d.verticalSpeed / 8));
    this.style('vsNeedle', 'left', `${(50 + needle * 50).toFixed(1)}%`);
    this.text('power', Math.round(d.power * 100).toString());
    this.style('powerBar', 'transform', `scaleX(${d.power.toFixed(3)})`);

    const cht = Math.max(0, Math.min(1, d.cht));
    this.text('cht', Math.round(cht * 100).toString());
    this.style('chtBar', 'transform', `scaleX(${cht.toFixed(3)})`);
    const chtFill = this.ref('chtBar');
    const chtTone = cht >= 0.9 ? 'hot' : cht >= 0.78 ? 'caution' : '';
    this.cls(chtFill, 'chtFill', `bar-fill cht${chtTone ? ` ${chtTone}` : ''}`);

    const flapsMoving = Math.abs(d.flapsDeg - d.flapsTargetDeg) > 0.3;
    const flapsDown = d.flapsTargetDeg > 0;
    this.text('flaps', flapsMoving ? `${d.flapsTargetDeg > d.flapsDeg ? 'EXT' : 'RET'} ${d.flapsTargetDeg}°` : flapsDown ? `DOWN ${d.flapsTargetDeg}°` : 'UP');
    this.cls(this.ref('flaps'), 'flapsCls', `state-val${flapsMoving ? ' transit' : flapsDown ? ' on' : ''}`);
    const gearMoving = Math.abs(d.gear - d.gearTarget) > 0.01;
    this.text('gear', gearMoving ? 'TRANSIT' : d.gear > 0.5 ? 'DOWN' : 'UP');
    this.cls(this.ref('gear'), 'gearCls', `state-val${gearMoving ? ' transit' : d.gear > 0.5 ? ' on' : ''}`);

    const p = Math.max(0, Math.min(1, d.progress));
    this.style('trackFill', 'width', `${(p * 100).toFixed(2)}%`);
    this.style('trackPlane', 'left', `${(p * 100).toFixed(2)}%`);
    this.text(
      'distance',
      d.distanceKm > 0.05 ? `${d.destCode} ${d.distanceKm.toFixed(1)} km` : `${d.destCode} runway ${d.destRunway}`,
    );
    this.text('phase', d.phase);
  }

  setMissionRoute(fromCode: string, fromCity: string, toCode: string, toCity: string): void {
    this.text('routeFromCode', fromCode);
    this.text('routeFromCity', fromCity.toUpperCase());
    this.text('routeToCity', toCity.toUpperCase());
    this.text('routeToCode', toCode);
  }

  setFps(fps: number): void {
    this.text('fps', `${Math.round(fps)} fps`);
  }

  setQuality(label: string): void {
    this.text('quality', `Quality: ${label}`);
  }

  setMuted(muted: boolean): void {
    this.text('mute', muted ? 'Sound off' : 'Sound on');
  }

  setHint(text: string): void {
    this.text('hint', text);
  }

  setWarnings(active: Record<WarningKey, boolean>, chtHot = false): void {
    for (const [key, el] of this.warnEls) {
      const amber = el.classList.contains('amber') || key === 'cht';
      const hot = key === 'cht' && active.cht && chtHot;
      this.cls(
        el,
        `warn.${key}`,
        `warn${amber && !hot ? ' amber' : ''}${hot ? ' hot' : ''}${active[key] ? ' on' : ''}`,
      );
    }
  }

  /** whites < 0 hides the indicator. */
  setPapi(whites: number): void {
    const panel = this.ref('papi');
    const visible = whites >= 0;
    this.cls(panel, 'papiCls', `panel papi${visible ? '' : ' is-hidden'}`);
    if (!visible) return;
    this.papiLights.forEach((el, i) => this.cls(el, `papi${i}`, i < whites ? 'white' : ''));
    const label = whites >= 4 ? 'TOO HIGH' : whites === 3 ? 'SLIGHTLY HIGH' : whites === 2 ? 'ON GLIDE PATH' : whites === 1 ? 'SLIGHTLY LOW' : 'TOO LOW';
    this.text('papiLabel', label);
  }

  setLandmark(title: string, subtitle: string): void {
    const key = title;
    if (key === this.landmarkKey) return;
    this.landmarkKey = key;
    const el = this.ref('landmark');
    if (!title) {
      el.classList.remove('show');
      return;
    }
    this.ref('lmTitle').textContent = title;
    this.ref('lmSub').textContent = subtitle;
    el.classList.add('show');
  }

  /** Storm cells on the route track: start/end as route fractions. */
  setRouteStorms(storms: { from: number; to: number; severity: string }[]): void {
    this.ref('trackStorms').innerHTML = storms
      .map((s) => `<span class="${s.severity}" style="left:${(s.from * 100).toFixed(1)}%;width:${((s.to - s.from) * 100).toFixed(1)}%"></span>`)
      .join('');
  }

  setAltitudeNote(text: string): void {
    this.text('altSub', text);
  }

  /** Shows an ATC message (null hides the panel). */
  setAtc(station: string | null, text = '', replies: string[] = []): void {
    const panel = this.ref('atc');
    this.cls(panel, 'atcCls', `atc${station ? '' : ' is-hidden'}`);
    if (!station) return;
    this.text('atcStation', station);
    this.text('atcText', text);
    const buttons = [this.ref('atcReply1'), this.ref('atcReply2')];
    buttons.forEach((b, i) => {
      const label = replies[i];
      this.cls(b, `atcReply${i}`, label ? '' : 'is-hidden');
      const html = label ? `${label} <small>${i + 1}</small>` : '';
      if (this.cache.get(`atcReplyHtml${i}`) !== html) {
        this.cache.set(`atcReplyHtml${i}`, html);
        b.innerHTML = html;
      }
    });
  }

  /** Pre-flight checklist; null hides it. */
  setChecklist(c: ChecklistView | null): void {
    const panel = this.ref('checklist');
    this.cls(panel, 'clCls', `panel checklist${c ? '' : ' is-hidden'}`);
    if (!c) return;
    this.text('clLoad', c.load);
    this.text('clDoor', c.door);
    this.text('clDoorBtn', c.doorButton);
    this.text('clBoarding', c.boarding);
    this.text('clLights', c.lights ? 'ON' : 'OFF');
    this.text('clLightsBtn', c.lights ? 'Off' : 'On');
    this.text('clFlaps', c.flaps);
    this.text('clBelts', c.belts ? 'ON' : 'OFF');
    this.text('clBeltsBtn', c.belts ? 'Off' : 'On');
    this.text('clEngine', c.engine);
    (this.ref('clDoorBtn') as HTMLButtonElement).disabled = !c.doorEnabled;
    (this.ref('clEngineBtn') as HTMLButtonElement).disabled = !c.engineEnabled;
    panel.querySelectorAll<HTMLElement>('.cl-row').forEach((row) => {
      const key = row.dataset.cl as keyof ChecklistView['done'];
      this.cls(row, `cl.${key}`, `cl-row${c.done[key] ? ' done' : ''}${c.next === key ? ' next' : ''}`);
    });
  }

  setBrakeLit(lit: boolean): void {
    const el = this.ref('brakePedal');
    if (this.cache.get('brakeLit') === String(lit)) return;
    this.cache.set('brakeLit', String(lit));
    el.classList.toggle('lit', lit);
  }

  setControlLit(action: 'flapsDown' | 'gear', lit: boolean): void {
    const btn = this.root.querySelector<HTMLElement>(`.ctl[data-action="${action}"]`);
    if (btn) this.cls(btn, `ctl.${action}`, `ctl wide${lit ? ' lit' : ''}`);
  }

  showReport(r: LandingReport, stats: string): void {
    this.ref('reportEyebrow').textContent = r.success ? 'Landing report' : 'Flight ended';
    this.ref('reportTitle').textContent = r.title;
    this.ref('reportMsg').textContent = r.message;
    this.ref('reportScoreWrap').classList.toggle('is-hidden', !r.success);
    this.ref('reportScore').textContent = r.total.toString();
    this.ref('reportGrade').textContent = r.grade;
    const table = this.ref('reportItems') as HTMLTableElement;
    table.innerHTML = '';
    for (const item of r.items) {
      const tr = table.insertRow();
      tr.insertCell().textContent = item.label;
      tr.insertCell().textContent = item.value;
      const c = tr.insertCell();
      c.textContent = item.max > 0 ? `${item.score} / ${item.max}` : `${item.score}`;
      if (item.score < 0) c.className = 'neg';
    }
    table.classList.toggle('is-hidden', r.items.length === 0);
    this.ref('reportStats').textContent = stats;
    this.ref('reportButton').innerHTML = 'Back to map <small>R</small>';
    this.show('report', true);
  }
}
