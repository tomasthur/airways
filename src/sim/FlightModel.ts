/**
 * Simplified 2D (side-view) flight model for a Cessna-172-class aircraft.
 * Pure TypeScript with no dependencies so it can be simulated headless.
 */

export const AIRCRAFT = {
  mass: 1100,
  wingArea: 16.2,
  cl0: 0.28,
  clAlpha: 5.2,
  clMaxClean: 1.55,
  flapCl: 0.5,
  flapClMax: 0.5,
  cd0: 0.03,
  inducedK: 0.055,
  flapCd: 0.045,
  gearCd: 0.014,
  powerWatts: 108000,
  staticThrust: 3400,
  throttleRate: 0.45,
  flapRate: 0.35,
  gearRate: 0.28,
  maxPitchRate: 0.36,
  maxGroundPitch: 0.21,
  maxAirPitch: 0.6,
  rollFriction: 0.028,
  brakeFriction: 0.42,
  bellyFriction: 0.6,
};

const G = 9.81;
const RHO = 1.225;
const FIXED_DT = 1 / 120;

export interface ControlInput {
  /** -1 (nose down) .. +1 (nose up) */
  pitch: number;
  /** -1 (reduce power) .. +1 (add power) */
  throttle: number;
}

export interface Touchdown {
  x: number;
  verticalSpeed: number;
  groundSpeed: number;
  pitch: number;
  gear: number;
  flaps: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const approach = (v: number, target: number, step: number) =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

export class FlightModel {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  pitch = 0;
  pitchRate = 0;
  throttle = 0;
  flaps = 0;
  flapsTarget = 0;
  gear = 1;
  gearTarget = 1;
  onGround = true;

  aoa = 0;
  stallMargin = 1;
  stalled = false;
  braking = false;
  tailStrike = false;
  maxAltitude = 0;
  elevator = 0;

  /** Set when the aircraft touches the ground after being airborne; cleared by the consumer. */
  touchdown: Touchdown | null = null;
  private readonly touchdownData: Touchdown = { x: 0, verticalSpeed: 0, groundSpeed: 0, pitch: 0, gear: 0, flaps: 0 };
  private accumulator = 0;

  reset(x: number): void {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.pitch = 0;
    this.pitchRate = 0;
    this.throttle = 0;
    this.flaps = 0;
    this.flapsTarget = 0;
    this.gear = 1;
    this.gearTarget = 1;
    this.onGround = true;
    this.aoa = 0;
    this.stallMargin = 1;
    this.stalled = false;
    this.braking = false;
    this.tailStrike = false;
    this.maxAltitude = 0;
    this.elevator = 0;
    this.touchdown = null;
    this.accumulator = 0;
  }

  get airspeed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  toggleFlaps(): void {
    this.flapsTarget = this.flapsTarget > 0.5 ? 0 : 1;
  }

  /** Returns false when the gear cannot move (weight on wheels). */
  toggleGear(): boolean {
    if (this.onGround) return false;
    this.gearTarget = this.gearTarget > 0.5 ? 0 : 1;
    return true;
  }

  update(dt: number, input: ControlInput): void {
    this.accumulator = Math.min(this.accumulator + dt, 0.25);
    while (this.accumulator >= FIXED_DT) {
      this.step(FIXED_DT, input);
      this.accumulator -= FIXED_DT;
    }
  }

  step(dt: number, input: ControlInput): void {
    const A = AIRCRAFT;
    this.throttle = clamp(this.throttle + input.throttle * A.throttleRate * dt, 0, 1);
    this.flaps = approach(this.flaps, this.flapsTarget, A.flapRate * dt);
    this.gear = approach(this.gear, this.gearTarget, A.gearRate * dt);
    this.elevator += (input.pitch - this.elevator) * Math.min(1, dt * 8);

    const V = this.airspeed;
    const gamma = V > 1 ? Math.atan2(this.vy, this.vx) : 0;
    const alpha = this.pitch - gamma;
    this.aoa = alpha;

    // Lift coefficient with flaps, ground effect and stall break.
    const clMax = A.clMaxClean + A.flapClMax * this.flaps;
    const clBase = A.cl0 + A.flapCl * this.flaps;
    const stallAlpha = (clMax - clBase) / A.clAlpha;
    let cl: number;
    if (alpha > stallAlpha) {
      cl = Math.max(clMax * 0.55, clMax - (alpha - stallAlpha) * 5);
    } else if (alpha < -0.22) {
      cl = clBase + A.clAlpha * -0.22;
    } else {
      cl = clBase + A.clAlpha * alpha;
    }
    const groundEffect = this.y < 8 ? 1 + 0.12 * (1 - this.y / 8) : 1;
    cl *= groundEffect;
    this.stallMargin = (stallAlpha - alpha) / stallAlpha;
    this.stalled = !this.onGround && alpha > stallAlpha;

    const cd =
      A.cd0 + (A.inducedK * cl * cl) / groundEffect + A.flapCd * this.flaps + A.gearCd * this.gear;
    const q = 0.5 * RHO * V * V;
    const lift = q * A.wingArea * cl;
    const drag = q * A.wingArea * cd;
    const thrust = this.throttle * Math.min(A.staticThrust, A.powerWatts / Math.max(V, 1));

    const cg = Math.cos(gamma);
    const sg = Math.sin(gamma);
    let fx = thrust * Math.cos(this.pitch) - drag * cg - lift * sg;
    let fy = thrust * Math.sin(this.pitch) - drag * sg + lift * cg - A.mass * G;

    this.braking = false;
    if (this.onGround) {
      if (fy <= 0) {
        const normal = -fy;
        fy = 0;
        let mu = A.rollFriction;
        if (this.gear < 0.95) mu = A.bellyFriction;
        else if (this.throttle < 0.05) {
          mu = A.brakeFriction;
          this.braking = this.vx > 0.5;
        }
        const friction = mu * normal;
        const maxStop = (Math.abs(this.vx) * A.mass) / dt;
        fx -= Math.sign(this.vx) * Math.min(friction, maxStop);
        if (Math.abs(this.vx) < 0.01 && Math.abs(fx) < friction) fx = 0;
      } else {
        this.onGround = false;
      }
    }

    this.vx += (fx / A.mass) * dt;
    this.vy += (fy / A.mass) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Pitch: rate command with airspeed-dependent elevator authority.
    const authority = clamp((V - 8) / 22, 0, 1);
    let targetRate = this.elevator * A.maxPitchRate * authority;
    if (this.onGround) {
      if (this.elevator <= 0.05 || authority < 0.6) targetRate -= 0.25 * (1 - authority * 0.7);
    } else if (alpha > stallAlpha) {
      targetRate -= 1.6 * (alpha - stallAlpha + 0.04);
    }
    this.pitchRate += (targetRate - this.pitchRate) * Math.min(1, dt * 6);
    this.pitch += this.pitchRate * dt;

    if (!this.onGround && this.y <= 0) {
      const td = this.touchdownData;
      td.x = this.x;
      td.verticalSpeed = this.vy;
      td.groundSpeed = this.vx;
      td.pitch = this.pitch;
      td.gear = this.gear;
      td.flaps = this.flaps;
      this.touchdown = td;
      this.onGround = true;
    }

    if (this.onGround) {
      this.y = 0;
      if (this.vy < 0) this.vy = 0;
      this.tailStrike = this.pitch > A.maxGroundPitch;
      if (this.pitch < 0) {
        this.pitch = 0;
        if (this.pitchRate < 0) this.pitchRate = 0;
      } else if (this.pitch > A.maxGroundPitch) {
        this.pitch = A.maxGroundPitch;
        if (this.pitchRate > 0) this.pitchRate = 0;
      }
    } else {
      this.pitch = clamp(this.pitch, -A.maxAirPitch, A.maxAirPitch);
    }

    if (this.y > this.maxAltitude) this.maxAltitude = this.y;
  }
}
