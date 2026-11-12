/**
 * Smooth pan / zoom camera for an SVG world chart.
 * The viewBox always matches the element's aspect, so 1 screen px maps uniformly to world units.
 */

export interface WorldBounds {
  w: number;
  h: number;
}

export interface CameraView {
  cx: number;
  cy: number;
  /** Screen pixels per world unit. */
  scale: number;
}

const DRAG_THRESHOLD_PX = 5;
/** Exponential approach rate toward the target view (per second). */
const EASE_RATE = 7;

export class MapCamera {
  private readonly svg: SVGSVGElement;
  private readonly stage: HTMLElement;
  private readonly world: WorldBounds;
  private readonly onChange: (view: CameraView) => void;

  private cur: CameraView = { cx: 500, cy: 300, scale: 1 };
  private target: CameraView = { cx: 500, cy: 300, scale: 1 };
  private size = { w: 1, h: 1 };
  private raf = 0;
  private lastT = 0;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private pinch: { dist: number; scale: number } | null = null;
  private suppressNextClick = false;

  constructor(svg: SVGSVGElement, stage: HTMLElement, world: WorldBounds, onChange: (view: CameraView) => void) {
    this.svg = svg;
    this.stage = stage;
    this.world = world;
    this.onChange = onChange;
    this.measure();
    new ResizeObserver(() => {
      this.measure();
      this.clamp(this.target);
      this.clamp(this.cur);
      this.apply();
    }).observe(stage);
    this.bind();
  }

  get view(): CameraView {
    return this.cur;
  }

  /** Smallest scale at which the whole world fits the stage. */
  get minScale(): number {
    return Math.min(this.size.w / this.world.w, this.size.h / this.world.h);
  }

  get maxScale(): number {
    return this.minScale * 60;
  }

  /** Swallow the click that ends a drag so pins are not tapped by accident. */
  consumeClick(): boolean {
    if (!this.suppressNextClick) return false;
    this.suppressNextClick = false;
    return true;
  }

  /** Frame a world-space box (with padding), optionally animated. */
  fitBox(x0: number, y0: number, x1: number, y1: number, opts: { animate: boolean; pad?: number; maxScale?: number }): void {
    this.measure();
    const pad = opts.pad ?? 0.3;
    const bw = Math.max(1e-3, x1 - x0) * (1 + pad * 2);
    const bh = Math.max(1e-3, y1 - y0) * (1 + pad * 2);
    let scale = Math.min(this.size.w / bw, this.size.h / bh);
    scale = Math.min(scale, opts.maxScale ?? this.maxScale);
    const v: CameraView = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: this.clampScale(scale) };
    this.clamp(v);
    this.target = v;
    if (!opts.animate) this.cur = { ...v };
    this.kick();
  }

  zoomBy(factor: number, anchor?: { x: number; y: number }): void {
    const t = this.target;
    const next = this.clampScale(t.scale * factor);
    const a = anchor ?? { x: t.cx, y: t.cy };
    const ratio = t.scale / next;
    t.cx = a.x + (t.cx - a.x) * ratio;
    t.cy = a.y + (t.cy - a.y) * ratio;
    t.scale = next;
    this.clamp(t);
    this.kick();
  }

  clientToWorld(clientX: number, clientY: number, v: CameraView = this.cur): { x: number; y: number } {
    const r = this.svg.getBoundingClientRect();
    return {
      x: v.cx + (clientX - r.left - r.width / 2) / v.scale,
      y: v.cy + (clientY - r.top - r.height / 2) / v.scale,
    };
  }

  private bind(): void {
    this.stage.addEventListener(
      'wheel',
      (e) => {
        if ((e.target as Element).closest('.hub-dock, .hub-map-tools')) return;
        e.preventDefault();
        // Gentle, continuous zoom: trackpads send many small deltas, wheels a few big ones.
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        const factor = Math.exp(-delta * 0.0016);
        this.zoomBy(factor, this.clientToWorld(e.clientX, e.clientY, this.target));
      },
      { passive: false },
    );

    this.stage.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('.hub-map-tools, .hub-dock')) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.dragging = false;
      } else if (this.pointers.size === 2) {
        this.pinch = { dist: this.pointerDistance(), scale: this.target.scale };
        this.dragging = true;
      }
    });

    this.stage.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const now = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, now);

      if (this.pointers.size >= 2 && this.pinch) {
        const mid = this.pointerMid();
        const anchor = this.clientToWorld(mid.x, mid.y, this.target);
        const want = this.pinch.scale * (this.pointerDistance() / Math.max(1, this.pinch.dist));
        this.zoomBy(want / this.target.scale, anchor);
        this.snap();
        return;
      }

      if (!this.dragStart) return;
      if (!this.dragging) {
        if (Math.hypot(now.x - this.dragStart.x, now.y - this.dragStart.y) < DRAG_THRESHOLD_PX) return;
        this.dragging = true;
        this.stage.classList.add('is-panning');
        // Capture only once a real drag starts, so plain taps still reach the pins.
        this.stage.setPointerCapture(e.pointerId);
      }
      const t = this.target;
      t.cx -= (now.x - prev.x) / t.scale;
      t.cy -= (now.y - prev.y) / t.scale;
      this.clamp(t);
      this.snap();
    });

    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) {
        if (this.dragging) this.suppressNextClick = true;
        this.dragging = false;
        this.dragStart = null;
        this.stage.classList.remove('is-panning');
      } else if (this.pointers.size === 1) {
        const [p] = this.pointers.values();
        this.dragStart = { ...p };
      }
      if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
    };
    this.stage.addEventListener('pointerup', end);
    this.stage.addEventListener('pointercancel', end);
  }

  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pointerMid(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private measure(): void {
    const r = this.svg.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) this.size = { w: r.width, h: r.height };
  }

  private clampScale(s: number): number {
    return Math.min(this.maxScale, Math.max(this.minScale, s));
  }

  private clamp(v: CameraView): void {
    v.scale = this.clampScale(v.scale);
    const halfW = this.size.w / v.scale / 2;
    const halfH = this.size.h / v.scale / 2;
    v.cx = halfW * 2 >= this.world.w ? this.world.w / 2 : Math.min(this.world.w - halfW, Math.max(halfW, v.cx));
    v.cy = halfH * 2 >= this.world.h ? this.world.h / 2 : Math.min(this.world.h - halfH, Math.max(halfH, v.cy));
  }

  /** Direct manipulation (drag / pinch) follows the finger without easing lag. */
  private snap(): void {
    this.cur = { ...this.target };
    this.apply();
  }

  private kick(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (t: number): void => {
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    const k = 1 - Math.exp(-EASE_RATE * dt);
    const c = this.cur;
    const g = this.target;
    // Interpolate scale in log space so zooming feels even at every level.
    const ls = Math.log(c.scale) + (Math.log(g.scale) - Math.log(c.scale)) * k;
    c.scale = Math.exp(ls);
    c.cx += (g.cx - c.cx) * k;
    c.cy += (g.cy - c.cy) * k;
    this.apply();
    const done =
      Math.abs(Math.log(g.scale / c.scale)) < 1e-3 &&
      Math.abs(g.cx - c.cx) * c.scale < 0.3 &&
      Math.abs(g.cy - c.cy) * c.scale < 0.3;
    if (done) {
      this.cur = { ...g };
      this.apply();
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private apply(): void {
    const v = this.cur;
    const w = this.size.w / v.scale;
    const h = this.size.h / v.scale;
    this.svg.setAttribute('viewBox', `${(v.cx - w / 2).toFixed(3)} ${(v.cy - h / 2).toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}`);
    this.onChange(v);
  }
}
