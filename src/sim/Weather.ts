/**
 * Deterministic weather for one flight: steady wind, turbulence, discrete gusts and thunderstorm cells.
 * Everything is a pure function of (seed, x, y, t), so flights are replayable and testable.
 */

export type StormSeverity = 'light' | 'moderate' | 'severe';

export interface StormCell {
  /** Centre x at t = 0; the cell drifts with `drift` m/s. */
  x0: number;
  drift: number;
  radius: number;
  base: number;
  top: number;
  severity: StormSeverity;
  /** Peak downdraft in the core (m/s). */
  downdraft: number;
  /** Turbulence added inside the cell (multiplier of the base level). */
  turbulence: number;
}

export interface WeatherSample {
  /** Air velocity: + = moving towards +x (tailwind) / upwards. */
  wx: number;
  wy: number;
  /** Rolling-moment coefficient from asymmetric gusts. */
  rollGust: number;
  /** Overall turbulence level at this point (0 = calm, 1 = moderate, 2+ = severe). */
  turbulence: number;
  rain: number;
  /** 0..1, inside storm cloud. */
  cloud: number;
}

export interface WeatherOptions {
  seed: number;
  /** Disable storms (e.g. calm regression flights). */
  storms?: boolean;
  /** Override the base turbulence level. */
  turbulence?: number;
  windKt?: number;
  windDir?: number;
}

const RUNWAY_HEADING = 310;
const KT = 0.5144;

function hash(i: number, seed: number): number {
  let h = Math.imul(i ^ seed, 0x27d4eb2d) ^ 0x165667b1;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 1D value noise in −1..1. */
function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i, seed) * (1 - u) + hash(i + 1, seed) * u) * 2 - 1;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class Weather {
  readonly seed: number;
  readonly storms: StormCell[] = [];
  /** Direction the wind blows from (degrees) and speed (knots), as ATC reports it. */
  readonly windDir: number;
  readonly windKt: number;
  /** Wind component along the route: + = headwind (m/s). */
  readonly headwind: number;
  readonly baseTurbulence: number;

  constructor(opts: WeatherOptions) {
    this.seed = opts.seed;
    const r = mulberry(opts.seed);
    this.windDir = opts.windDir ?? Math.round((270 + r() * 80) / 10) * 10;
    this.windKt = opts.windKt ?? Math.round(4 + r() * 14);
    this.headwind = this.windKt * KT * Math.cos(((this.windDir - RUNWAY_HEADING) * Math.PI) / 180);
    this.baseTurbulence = opts.turbulence ?? 0.35 + r() * 0.35;

    if (opts.storms === false) return;
    const roll = r();
    const count = roll < 0.12 ? 0 : roll < 0.68 ? 1 : 2;
    const slots = count === 2 ? [[4300, 6600], [7600, 9600]] : [[4600, 9200]];
    for (let i = 0; i < count; i++) {
      const [a, b] = slots[i];
      const s = r();
      const severity: StormSeverity = s < 0.3 ? 'light' : s < 0.72 ? 'moderate' : 'severe';
      const k = r();
      const lerp = (lo: number, hi: number) => lo + (hi - lo) * k;
      const cell: StormCell =
        severity === 'light'
          ? { x0: 0, drift: 0, radius: lerp(450, 650), base: lerp(400, 460), top: lerp(650, 800), severity, downdraft: 1.6, turbulence: 0.8 }
          : severity === 'moderate'
            ? { x0: 0, drift: 0, radius: lerp(600, 850), base: lerp(340, 410), top: lerp(850, 1050), severity, downdraft: 3.8, turbulence: 1.5 }
            : { x0: 0, drift: 0, radius: lerp(800, 1050), base: lerp(290, 350), top: lerp(1150, 1350), severity, downdraft: 7.5, turbulence: 2.6 };
      cell.x0 = a + r() * (b - a);
      cell.drift = (r() - 0.5) * 4;
      cell.base = Math.round(cell.base / 10) * 10;
      cell.top = Math.round(cell.top / 10) * 10;
      this.storms.push(cell);
    }
  }

  stormX(c: StormCell, t: number): number {
    return c.x0 + c.drift * t;
  }

  sample(x: number, y: number, t: number, out: WeatherSample): WeatherSample {
    const seed = this.seed;
    const height = Math.max(0, y);

    // Turbulence strength: weaker in the surface layer, fading above ~800 m.
    let level = this.baseTurbulence * (0.35 + 0.65 * smooth(0, 25, height)) * (1 - 0.55 * smooth(800, 1300, height));
    let wy = 0;
    let wx = -this.headwind * (0.55 + 0.45 * smooth(0, 60, height));
    let rain = 0;
    let cloud = 0;
    let rough = 0;

    for (const c of this.storms) {
      const dx = x - this.stormX(c, t);
      const r = Math.abs(dx) / c.radius;
      if (r > 2.2) continue;
      const aboveTop = smooth(c.top - 60, c.top + 120, height);
      // Wider area of rough air around the cell, strongest inside it.
      const near = 1 - smooth(0.6, 2.2, r);
      level += c.turbulence * near * (1 - aboveTop) * (r < 1 ? 1 : 0.35);
      if (r < 1) {
        const inColumn = 1 - aboveTop;
        const core = 1 - smooth(0, 0.5, r);
        const edge = smooth(0.45, 0.65, r) * (1 - smooth(0.8, 1, r));
        // Core downdraft (extends below the base as a rain shaft), updrafts along the edges inside the cloud.
        const belowBase = height < c.base ? 0.75 : 1;
        wy += (-c.downdraft * core * belowBase + 0.6 * c.downdraft * edge * smooth(c.base - 80, c.base + 40, height)) * inColumn;
        rain = Math.max(rain, (1 - smooth(0.7, 1, r)) * (1 - smooth(c.top - 200, c.top, height)) * (c.severity === 'light' ? 0.5 : c.severity === 'moderate' ? 0.8 : 1));
        cloud = Math.max(cloud, (1 - smooth(0.75, 1, r)) * smooth(c.base - 30, c.base + 30, height) * inColumn);
        // Gust loads grow with airspeed: these sharp convective gusts can over-stress a fast aircraft.
        rough = Math.max(rough, c.turbulence * (1 - smooth(0.7, 1, r)) * inColumn);
      }
    }

    // Continuous turbulence: two octaves of noise in space, slowly evolving in time.
    const n1 = noise(x / 85 + t * 0.07, seed);
    const n2 = noise(x / 260 - t * 0.03, seed + 17);
    wy += level * 1.1 * (0.65 * n1 + 0.35 * n2);
    wx += level * 1.2 * noise(x / 140 + t * 0.05, seed + 31);
    if (rough > 0) wy += rough * 3.6 * noise(x / 38 + t * 0.35, seed + 59);

    // Discrete vertical gusts ("1 − cos" shape): the aircraft is suddenly lifted or dropped.
    const seg = Math.floor(x / 380);
    if (hash(seg, seed + 101) < 0.25 + 0.3 * Math.min(1, level)) {
      const len = 70 + hash(seg, seed + 103) * 150;
      const start = seg * 380 + hash(seg, seed + 107) * (380 - len);
      const s = (x - start) / len;
      if (s > 0 && s < 1) {
        const sign = hash(seg, seed + 109) < 0.55 ? -1 : 1;
        const amp = (1.4 + hash(seg, seed + 113) * 2.4) * (0.5 + level);
        wy += sign * amp * 0.5 * (1 - Math.cos(2 * Math.PI * s)) * smooth(0, 15, height);
      }
    }

    // Surface: no vertical air movement through the runway.
    wy *= smooth(0, 12, height);

    out.wx = wx;
    out.wy = wy;
    out.rollGust = level * 0.035 * noise(x / 70 + t * 0.4, seed + 47);
    out.turbulence = level;
    out.rain = rain;
    out.cloud = cloud;
    return out;
  }
}
