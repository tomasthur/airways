/**
 * Touch flight controls: an absolute throttle lever and a yoke (drag down/up = pull/push,
 * drag sideways = roll). The yoke springs back to centre when released.
 */

const YOKE_TRAVEL_PX = 52;
const DEAD_ZONE = 0.08;

const shape = (v: number) => {
  const a = Math.abs(v);
  if (a < DEAD_ZONE) return 0;
  const t = (a - DEAD_ZONE) / (1 - DEAD_ZONE);
  // Mild expo: fine control near centre, full deflection at the end of travel.
  return Math.sign(v) * (0.45 * t + 0.55 * t * t);
};

export class FlightControls {
  private readonly track: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly value: HTMLElement;
  private readonly wheel: HTMLElement;
  private lever = 0;
  private draggingLever = false;
  private shownLever = -1;

  constructor(root: HTMLElement, onLever: (v: number) => void, onYoke: (pitch: number, roll: number) => void) {
    const q = (ref: string) => {
      const el = root.querySelector<HTMLElement>(`[data-ref="${ref}"]`);
      if (!el) throw new Error(`Missing control ${ref}`);
      return el;
    };
    this.track = q('throttleTrack');
    this.knob = q('throttleKnob');
    this.fill = q('throttleFill');
    this.value = q('throttleVal');
    const yoke = q('yoke');
    this.wheel = q('yokeWheel');

    const leverFrom = (e: PointerEvent) => {
      const r = this.track.getBoundingClientRect();
      const v = 1 - (e.clientY - r.top) / r.height;
      this.lever = Math.max(0, Math.min(1, v));
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
    for (const el of [this.track, yoke]) el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Keeps the lever in sync when the throttle is moved by keyboard or reset. */
  sync(lever: number): void {
    if (this.draggingLever) return;
    this.lever = lever;
    this.render(lever);
  }

  private render(v: number): void {
    const rounded = Math.round(v * 200) / 200;
    if (rounded === this.shownLever) return;
    this.shownLever = rounded;
    const pct = (rounded * 100).toFixed(1);
    this.knob.style.bottom = `${pct}%`;
    this.fill.style.height = `${pct}%`;
    this.value.textContent = `${Math.round(rounded * 100)}%`;
  }
}
