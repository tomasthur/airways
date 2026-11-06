/**
 * Canvas2D painting helpers. Sprite painters draw in metres with the origin at the
 * bottom-left of the sprite and +y pointing up.
 */

export type Ctx = CanvasRenderingContext2D;

export type Rand = () => number;

export function rng(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (r: Rand, a: number, b: number) => a + (b - a) * r();
export const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
}

/** Positive amount lightens towards white, negative darkens towards black. */
export function shade(hex: string, amount: number): string {
  return amount >= 0 ? mix(hex, '#ffffff', amount) : mix(hex, '#000000', -amount);
}

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string | CanvasGradient): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

export function poly(ctx: Ctx, pts: number[], fill: string | CanvasGradient): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function circle(ctx: Ctx, x: number, y: number, r: number, fill: string | CanvasGradient): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

export function vgrad(ctx: Ctx, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

export function hgrad(ctx: Ctx, x0: number, x1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

/** Periodic 1D noise over [0, period): sum of sines with integer frequencies. */
export function periodicNoise(r: Rand, period: number, terms: [number, number][], ridged = false): (x: number) => number {
  const phases = terms.map(() => r() * Math.PI * 2);
  return (x: number) => {
    let v = 0;
    for (let i = 0; i < terms.length; i++) {
      const [k, amp] = terms[i];
      const s = Math.sin((Math.PI * 2 * k * x) / period + phases[i]);
      v += ridged ? amp * (1 - 2 * Math.abs(s)) : amp * s;
    }
    return v;
  };
}

/** Fills the area under a height function from y=0. */
export function fillProfile(ctx: Ctx, x0: number, x1: number, f: (x: number) => number, fill: string | CanvasGradient, step = 1): void {
  ctx.beginPath();
  ctx.moveTo(x0, -1);
  for (let x = x0; x <= x1 + step; x += step) ctx.lineTo(Math.min(x, x1), f(Math.min(x, x1)));
  ctx.lineTo(x1, -1);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A rounded deciduous tree crown with simple top-right lighting. */
export function treeCrown(ctx: Ctx, r: Rand, x: number, y: number, radius: number, base: string): void {
  const dark = shade(base, -0.28);
  const light = shade(base, 0.18);
  const blobs = 5 + Math.floor(r() * 4);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + r();
    const d = radius * range(r, 0.25, 0.55);
    circle(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, radius * range(r, 0.45, 0.65), dark);
  }
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + r();
    const d = radius * range(r, 0.15, 0.4);
    circle(ctx, x + Math.cos(a) * d + radius * 0.08, y + Math.sin(a) * d * 0.8 + radius * 0.1, radius * range(r, 0.35, 0.5), base);
  }
  for (let i = 0; i < 3; i++) {
    circle(ctx, x + radius * range(r, 0.05, 0.4), y + radius * range(r, 0.25, 0.5), radius * range(r, 0.18, 0.3), light);
  }
}

export function tree(ctx: Ctx, r: Rand, x: number, ground: number, height: number, base: string): void {
  const crownR = height * 0.36;
  rect(ctx, x - height * 0.035, ground, height * 0.07, height * 0.5, '#4a3b2c');
  treeCrown(ctx, r, x, ground + height - crownR, crownR, base);
}

export function poplar(ctx: Ctx, x: number, ground: number, height: number, base: string): void {
  rect(ctx, x - height * 0.02, ground, height * 0.04, height * 0.2, '#4a3b2c');
  ellipse(ctx, x, ground + height * 0.55, height * 0.11, height * 0.45, shade(base, -0.2));
  ellipse(ctx, x + height * 0.025, ground + height * 0.6, height * 0.07, height * 0.36, base);
}

/** Grid of windows inside a rectangle. */
export function windows(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  cols: number,
  rows: number,
  ww: number,
  wh: number,
  color: string,
  r?: Rand,
  lit?: string,
): void {
  const sx = w / cols;
  const sy = h / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const c = r && lit && r() < 0.12 ? lit : color;
      rect(ctx, x + i * sx + (sx - ww) / 2, y + j * sy + (sy - wh) / 2, ww, wh, c);
    }
  }
}

/** Upright text in a y-up painter. Size in metres. */
export function text(ctx: Ctx, str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 600): void {
  ctx.save();
  ctx.scale(1, -1);
  ctx.font = `${weight} ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(str, x, -y);
  ctx.restore();
}

/** Pointed gothic window. */
export function gothicWindow(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h - w * 0.6);
  ctx.quadraticCurveTo(x, y + h - w * 0.1, x + w / 2, y + h);
  ctx.quadraticCurveTo(x + w, y + h - w * 0.1, x + w, y + h - w * 0.6);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Gable/hipped roof seen from the long side. */
export function roof(ctx: Ctx, x: number, y: number, w: number, h: number, inset: number, color: string): void {
  poly(ctx, [x - 0.4, y, x + w + 0.4, y, x + w - inset, y + h, x + inset, y + h], color);
  poly(ctx, [x + w * 0.55, y, x + w + 0.4, y, x + w - inset, y + h, x + w * 0.55 - inset * 0.2, y + h], shade(color, -0.12));
}
