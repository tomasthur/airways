import type { AircraftConfig } from './aircraft/AircraftConfig.ts';

export type EngineState = 'off' | 'starting' | 'running';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Yellow caution / red limit for normalised CHT. */
export const CHT_YELLOW = 0.78;
export const CHT_RED = 0.9;

/** Piston engine: start sequence, power lag, and a light CHT model for cruise management. */
export class Engine {
  state: EngineState = 'off';
  /** Produced power as a fraction of maximum (0..1), before heat derate. */
  power = 0;
  /**
   * Cylinder-head temperature, normalised 0..1.
   * Comfortable cruise ≈ 0.45–0.55; yellow from {@link CHT_YELLOW}; red from {@link CHT_RED}.
   */
  cht = 0.22;
  /** Seconds spent at or above red CHT while producing power. */
  chtHotTime = 0;
  private startTimer = 0;
  private readonly config: AircraftConfig;

  constructor(config: AircraftConfig) {
    this.config = config;
  }

  reset(running: boolean): void {
    this.state = running ? 'running' : 'off';
    this.power = 0;
    this.startTimer = 0;
    this.cht = 0.22;
    this.chtHotTime = 0;
  }

  /** Returns false when the engine is not off. */
  start(): boolean {
    if (this.state !== 'off') return false;
    this.state = 'starting';
    this.startTimer = 0;
    return true;
  }

  stop(): void {
    this.state = 'off';
  }

  /**
   * Advance spool and CHT.
   * @param airspeedMps true airspeed for ram-air cooling.
   */
  step(dt: number, lever: number, airspeedMps = 0): void {
    const e = this.config.engine;
    if (this.state === 'starting') {
      this.startTimer += dt;
      if (this.startTimer >= e.startTimeS) this.state = 'running';
    }
    const target = this.state === 'running' ? lever : 0;
    this.power += (target - this.power) * (1 - Math.exp(-dt / e.spoolTimeS));
    this.stepCht(dt, airspeedMps);
  }

  private stepCht(dt: number, airspeedMps: number): void {
    // ~50 m/s (≈180 km/h) is healthy cruise cooling; slow climbs cook the cylinders.
    const ias = clamp(airspeedMps / 50, 0, 1.4);
    const p = this.power;
    let target: number;
    if (this.state !== 'running' || p < 0.04) {
      target = 0.18;
    } else {
      // Heat from power; strong extra heat when slow. ~75% / cruise IAS settles mid-green.
      // Full power in level flight drifts into yellow/red unless the nose comes down.
      target = 0.12 + p * 0.95 + p * p * 0.22 - ias * (0.22 + 0.18 * p);
      target = clamp(target, 0.18, 1.08);
    }
    // Warm on a climb-length timescale; cool faster once power is reduced.
    const heating = target > this.cht;
    const tau = heating ? 16 : 11;
    this.cht += (target - this.cht) * (1 - Math.exp(-dt / tau));
    this.cht = clamp(this.cht, 0, 1);

    if (this.cht >= CHT_RED && p > 0.1) this.chtHotTime += dt;
  }

  /** Soft thrust derate once CHT is in the yellow/red — never kills the engine on short hops. */
  thrustFactor(): number {
    if (this.cht < CHT_YELLOW) return 1;
    return 1 - 0.25 * smooth(CHT_YELLOW, 1, this.cht);
  }

  thrust(airspeed: number): number {
    const e = this.config.engine;
    return this.power * this.thrustFactor() * Math.min(e.staticThrustN, e.maxPowerW / Math.max(airspeed, 1));
  }
}
