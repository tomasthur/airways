import { fullThrust, type AircraftConfig } from './aircraft/AircraftConfig.ts';

export type EngineState = 'off' | 'starting' | 'running';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Yellow caution / red limit for the normalised engine temperature. */
export const CHT_YELLOW = 0.78;
export const CHT_RED = 0.9;

/** Gauge label for the engine temperature of each propulsion type. */
export function tempGaugeLabel(c: AircraftConfig): string {
  return c.propulsion === 'piston' ? 'CHT' : c.propulsion === 'turboprop' ? 'ITT' : 'EGT';
}

/**
 * Engine(s) of one aircraft: start sequence, power lag and a light temperature model.
 * Pistons heat with power and cool with airspeed (CHT); turbines heat with power almost
 * regardless of speed (ITT / EGT), so sustained take-off power is what overheats them.
 */
export class Engine {
  state: EngineState = 'off';
  /** Produced power / thrust as a fraction of maximum (0..1), before heat derate. */
  power = 0;
  /**
   * Engine temperature (CHT, ITT or EGT), normalised 0..1.
   * Comfortable cruise ≈ 0.45–0.65; yellow from {@link CHT_YELLOW}; red from {@link CHT_RED}.
   */
  cht = 0.22;
  /** Seconds spent at or above red temperature while producing power. */
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

  /** 0..1 progress of the start sequence (1 once running). */
  get startProgress(): number {
    if (this.state === 'running') return 1;
    if (this.state === 'off') return 0;
    return Math.min(1, this.startTimer / this.config.engine.startTimeS);
  }

  /**
   * Advance spool and temperature.
   * @param airspeedMps true airspeed for ram-air cooling.
   */
  step(dt: number, lever: number, airspeedMps = 0): void {
    const e = this.config.engine;
    if (this.state === 'starting') {
      this.startTimer += dt;
      if (this.startTimer >= e.startTimeS) this.state = 'running';
    }
    const target = this.state === 'running' ? lever : 0;
    let tau = e.spoolTimeS;
    // Turbofans spool up slowly from idle and quicker once the core is turning.
    if (this.config.propulsion === 'jet' && target > this.power) tau *= 1.4 - 0.8 * this.power;
    this.power += (target - this.power) * (1 - Math.exp(-dt / tau));
    this.stepTemp(dt, airspeedMps);
  }

  private stepTemp(dt: number, airspeedMps: number): void {
    const p = this.power;
    const kind = this.config.propulsion;
    let target: number;
    let tauUp: number;
    let tauDown: number;
    if (this.state !== 'running' || p < 0.04) {
      target = 0.18;
      tauUp = 16;
      tauDown = 11;
    } else if (kind === 'piston') {
      // ~50 m/s (≈180 km/h) is healthy cruise cooling; slow climbs cook the cylinders.
      // Full power in level flight drifts into yellow/red unless the nose comes down.
      const ias = clamp(airspeedMps / 50, 0, 1.4);
      target = 0.12 + p * 0.95 + p * p * 0.22 - ias * (0.22 + 0.18 * p);
      tauUp = 16;
      tauDown = 11;
    } else if (kind === 'turboprop') {
      // ITT tracks torque: take-off power is fine for a climb (~3 min), not for a whole cruise.
      target = 0.2 + 0.44 * p + 0.28 * p * p;
      tauUp = 50;
      tauDown = 14;
    } else {
      // EGT: climb thrust is fine, holding take-off thrust for minutes is not.
      target = 0.22 + 0.4 * p + 0.3 * p * p * p;
      tauUp = 60;
      tauDown = 18;
    }
    target = clamp(target, 0.18, 1.08);
    const tau = target > this.cht ? tauUp : tauDown;
    this.cht += (target - this.cht) * (1 - Math.exp(-dt / tau));
    this.cht = clamp(this.cht, 0, 1);

    if (this.cht >= CHT_RED && p > 0.1) this.chtHotTime += dt;
  }

  /** Soft thrust derate once the temperature is in the yellow/red — never kills the engine on short hops. */
  thrustFactor(): number {
    if (this.cht < CHT_YELLOW) return 1;
    return 1 - 0.25 * smooth(CHT_YELLOW, 1, this.cht);
  }

  thrust(airspeed: number): number {
    const t = this.power * this.thrustFactor() * fullThrust(this.config.propulsion, this.config.engine, airspeed);
    return t - this.propDiscDrag(airspeed);
  }

  /** Turboprops at flight idle: the big fine-pitch discs act as airbrakes, which is how they slow down on approach. */
  private propDiscDrag(V: number): number {
    const c = this.config;
    const d = c.visual?.engines.propDiaM;
    if (c.propulsion !== 'turboprop' || !d || this.state !== 'running') return 0;
    const idle = 1 - Math.min(1, this.power / 0.3);
    if (idle <= 0) return 0;
    const area = c.engineCount * Math.PI * (d / 2) ** 2;
    return idle * 0.5 * 1.225 * V * V * 0.1 * area;
  }
}
