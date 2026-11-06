import type { AircraftConfig } from './aircraft/AircraftConfig.ts';

export type EngineState = 'off' | 'starting' | 'running';

/** Piston engine: start sequence and power lagging behind the throttle lever. */
export class Engine {
  state: EngineState = 'off';
  /** Produced power as a fraction of maximum (0..1). */
  power = 0;
  private startTimer = 0;
  private readonly config: AircraftConfig;

  constructor(config: AircraftConfig) {
    this.config = config;
  }

  reset(running: boolean): void {
    this.state = running ? 'running' : 'off';
    this.power = 0;
    this.startTimer = 0;
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

  step(dt: number, lever: number): void {
    const e = this.config.engine;
    if (this.state === 'starting') {
      this.startTimer += dt;
      if (this.startTimer >= e.startTimeS) this.state = 'running';
    }
    const target = this.state === 'running' ? lever : 0;
    this.power += (target - this.power) * (1 - Math.exp(-dt / e.spoolTimeS));
  }

  thrust(airspeed: number): number {
    const e = this.config.engine;
    return this.power * Math.min(e.staticThrustN, e.maxPowerW / Math.max(airspeed, 1));
  }
}
