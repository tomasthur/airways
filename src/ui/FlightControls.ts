/**
 * Touch flight controls: an absolute throttle lever, a detented flap lever,
 * and a yoke (drag down/up = pull/push, drag sideways = roll). The yoke springs
 * back to centre when released.
 */

import { flapGateLabel } from '../sim/aircraft/AircraftConfig.ts';

const YOKE_TRAVEL_PX = 52;
const DEAD_ZONE = 0.08;
/** Flap gate inset as a fraction of track height so UP / FULL stay on the scale. */
const FLAP_INSET = 0.1;

const shape = (v: number) => {
  const a = Math.abs(v);
  if (a < DEAD_ZONE) return 0;
  const t = (a - DEAD_ZONE) / (1 - DEAD_ZONE);
  // Mild expo: fine control near centre, full deflection at the end of travel.
  return Math.sign(v) * (0.45 * t + 0.55 * t * t);
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class FlightControls {
  private readonly track: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly value: HTMLElement;
  private readonly wheel: HTMLElement;
  private readonly flapLever: HTMLElement;
  private readonly flapTrack: HTMLElement;
  private readonly flapKnob: HTMLElement;
  private readonly flapGates: HTMLElement;
  private readonly flapVal: HTMLElement;
  private lever = 0;
  private draggingLever = false;
  private shownLever = -1;
  private flapCount = 0;
  private flapIndex = 0;
  private draggingFlaps = false;
  private shownFlap = -1;

  constructor(
    root: HTMLElement,
    onLever: (v: number) => void,
    onYoke: (pitch: number, roll: number) => void,
    onFlaps: (index: number) => void,
  ) {
    const q = (ref: string) => {
      const el = root.querySelector<HTMLElement>(`[data-ref="${ref}"]`);
      if (!el) throw new Error(`Missing control ${ref}`);
      return el;
    };
    this.track = q('throttleTrack');
    this.knob = q('throttleKnob');
    this.fill = q('throttleFill');
    this.value = q('throttleVal');
    this.flapLever = q('flapLever');
    this.flapTrack = q('flapTrack');
    this.flapKnob = q('flapKnob');
    this.flapGates = q('flapGates');
    this.flapVal = q('flapVal');
    const yoke = q('yoke');
    this.wheel = q('yokeWheel');

    const leverFrom = (e: PointerEvent) => {
      const r = this.track.getBoundingClientRect();
      const v = 1 - (e.clientY - r.top) / r.height;
      this.lever = clamp01(v);
      onLever(this.lever);
      this.render(this.lever);
    };
    this.track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.track.setPointerCapture(e.pointerId);
      this.draggingLever = true;
      this.track.classList.add('active');
      leverFrom(e);
    });
    this.track.addEventListener('pointermove', (e) => {
      if (this.draggingLever) leverFrom(e);
    });
    const endLever = () => {
      this.draggingLever = false;
      this.track.classList.remove('active');
    };
    this.track.addEventListener('pointerup', endLever);
    this.track.addEventListener('pointercancel', endLever);
    this.track.addEventListener('lostpointercapture', endLever);

    const flapsFrom = (e: PointerEvent) => {
      const next = this.indexFromPointer(e.clientY);
      if (next === this.flapIndex) return;
      this.flapIndex = next;
      onFlaps(next);
      this.renderFlaps(next);
    };
    this.flapTrack.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.flapTrack.setPointerCapture(e.pointerId);
      this.draggingFlaps = true;
      this.flapTrack.classList.add('active');
      flapsFrom(e);
    });
    this.flapTrack.addEventListener('pointermove', (e) => {
      if (this.draggingFlaps) flapsFrom(e);
    });
    const endFlaps = () => {
      this.draggingFlaps = false;
      this.flapTrack.classList.remove('active');
    };
    this.flapTrack.addEventListener('pointerup', endFlaps);
    this.flapTrack.addEventListener('pointercancel', endFlaps);
    this.flapTrack.addEventListener('lostpointercapture', endFlaps);

    let originX = 0;
    let originY = 0;
    let yokeId = -1;
    const setYoke = (dx: number, dy: number) => {
      const rx = Math.max(-1, Math.min(1, dx / YOKE_TRAVEL_PX));
      const ry = Math.max(-1, Math.min(1, dy / YOKE_TRAVEL_PX));
      this.wheel.style.transform = `translate(0px, ${(ry * 16).toFixed(1)}px) rotate(${(rx * 38).toFixed(1)}deg)`;
      onYoke(shape(ry), shape(rx));
    };
    yoke.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (yokeId !== -1) return;
      yokeId = e.pointerId;
      yoke.setPointerCapture(e.pointerId);
      originX = e.clientX;
      originY = e.clientY;
      yoke.classList.add('active');
    });
    yoke.addEventListener('pointermove', (e) => {
      if (e.pointerId === yokeId) setYoke(e.clientX - originX, e.clientY - originY);
    });
    const endYoke = (e: PointerEvent) => {
      if (e.pointerId !== yokeId) return;
      yokeId = -1;
      yoke.classList.remove('active');
      setYoke(0, 0);
    };
    yoke.addEventListener('pointerup', endYoke);
    yoke.addEventListener('pointercancel', endYoke);
    yoke.addEventListener('lostpointercapture', endYoke);
    for (const el of [this.track, this.flapTrack, yoke]) el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Rebuilds the labelled gates when the flown type changes. */
  setFlapGates(count: number): void {
    const n = Math.max(2, Math.round(count));
    if (n === this.flapCount) {
      this.renderFlaps(this.flapIndex);
      return;
    }
    this.flapCount = n;
    this.flapGates.replaceChildren();
    for (let i = 0; i < n; i++) {
      const li = document.createElement('li');
      li.className = 'flap-gate';
      li.dataset.flapIndex = String(i);
      const name = document.createElement('span');
      name.className = 'flap-gate-name';
      name.textContent = flapGateLabel(i, n);
      li.appendChild(name);
      if (i === 1) {
        const to = document.createElement('span');
        to.className = 'flap-gate-to';
        to.textContent = 'TO';
        li.appendChild(to);
      }
      const t = n <= 1 ? 0 : i / (n - 1);
      li.style.top = `${(FLAP_INSET + t * (1 - 2 * FLAP_INSET)) * 100}%`;
      this.flapGates.appendChild(li);
    }
    this.flapTrack.setAttribute('role', 'slider');
    this.flapTrack.setAttribute('aria-valuemin', '0');
    this.flapTrack.setAttribute('aria-valuemax', String(n - 1));
    this.shownFlap = -1;
    this.renderFlaps(this.flapIndex);
  }

  /** Keeps the lever in sync when the throttle is moved by keyboard or reset. */
  sync(lever: number): void {
    if (this.draggingLever) return;
    this.lever = lever;
    this.render(lever);
  }

  /** Keeps the flap handle on the selected detent (keyboard / checklist / reset). */
  syncFlaps(index: number): void {
    if (this.draggingFlaps) return;
    this.flapIndex = index;
    this.renderFlaps(index);
  }

  private indexFromPointer(clientY: number): number {
    const n = Math.max(2, this.flapCount);
    const r = this.flapTrack.getBoundingClientRect();
    const y = (clientY - r.top) / Math.max(1, r.height);
    const t = clamp01((y - FLAP_INSET) / (1 - 2 * FLAP_INSET));
    return Math.round(t * (n - 1));
  }

  private render(v: number): void {
    const rounded = Math.round(v * 200) / 200;
    if (rounded === this.shownLever) return;
    this.shownLever = rounded;
    const inset = 0.05;
    const y = inset + rounded * (1 - 2 * inset);
    this.knob.style.bottom = `${(y * 100).toFixed(1)}%`;
    this.fill.style.height = `${(rounded * 100).toFixed(1)}%`;
    this.value.textContent = `${Math.round(rounded * 100)}%`;
  }

  private renderFlaps(index: number): void {
    const n = Math.max(2, this.flapCount);
    const i = Math.max(0, Math.min(n - 1, Math.round(index)));
    if (i === this.shownFlap && this.flapGates.childElementCount === n) {
      return;
    }
    this.shownFlap = i;
    const t = n <= 1 ? 0 : i / (n - 1);
    this.flapKnob.style.bottom = `${(FLAP_INSET + (1 - t) * (1 - 2 * FLAP_INSET)) * 100}%`;
    this.flapLever.classList.toggle('is-extended', i > 0);
    this.flapTrack.setAttribute('aria-valuenow', String(i));
    const gate = flapGateLabel(i, n);
    this.flapVal.textContent = i === 1 ? `${gate} TO` : gate;
    this.flapTrack.setAttribute('aria-valuetext', i === 1 ? `${gate} take-off` : gate);
    this.flapGates.querySelectorAll<HTMLElement>('.flap-gate').forEach((el) => {
      el.classList.toggle('is-on', Number(el.dataset.flapIndex) === i);
    });
  }
}
