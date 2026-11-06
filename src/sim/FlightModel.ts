/**
 * Longitudinal (side-view) flight model: x, y and pitch with aerodynamic pitching moments.
 * Driven entirely by an AircraftConfig. Pure TypeScript with no dependencies so it can be
 * simulated headless.
 */
import { flapEffect, maxFlapDeg, type AircraftConfig } from './aircraft/AircraftConfig.ts';
import { C172RG } from './aircraft/c172rg.ts';
import { Engine } from './Engine.ts';
import { computeLoadSheet, DEFAULT_LOAD, type Load } from './LoadSheet.ts';

const G = 9.81;
const RHO = 1.225;
const FIXED_DT = 1 / 120;

export interface ControlInput {
  /** -1 (nose down) .. +1 (nose up) */
  pitch: number;
  /** Throttle lever movement: -1 (pull back) .. +1 (push forward). */
  throttle: number;
  /** Wheel brakes 0..1. */
  brake: number;
}

export interface Assists {
  /** Stick commands a pitch rate and centred stick holds the attitude (released in a stall). */
  pitchHold: boolean;
  /** Full brakes on the ground whenever the throttle lever is at idle. */
  autoBrakeAtIdle: boolean;
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
  readonly config: AircraftConfig;
  readonly engine: Engine;
  readonly assists: Assists = { pitchHold: true, autoBrakeAtIdle: true };
  mass: number;

  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  pitch = 0;
  pitchRate = 0;
  /** Throttle lever position 0..1. */
  throttleLever = 0;
  /** Engine power actually produced, 0..1 (lags the lever). */
  throttle = 0;
  flapDeg = 0;
  flapIndex = 0;
  /** Flap deflection as a fraction of full flaps (0..1), for rendering and the HUD. */
  flaps = 0;
  flapsTarget = 0;
  gear = 1;
  gearTarget = 1;
  onGround = true;
  /** Elevator deflection −1..1 (+ = nose up), including trim. */
  elevator = 0;
  /** Manual trim −1..1, used when the pitch-hold assist is off. */
  trim = 0;

  aoa = 0;
  stallMargin = 1;
  stalled = false;
  braking = false;
  tailStrike = false;
  overspeed = false;
  flapOverspeed = false;
  maxAltitude = 0;

  /** Set when the aircraft touches the ground after being airborne; cleared by the consumer. */
  touchdown: Touchdown | null = null;
  private readonly touchdownData: Touchdown = { x: 0, verticalSpeed: 0, groundSpeed: 0, pitch: 0, gear: 0, flaps: 0 };
  private readonly flap = { dCl: 0, dClMax: 0, dCd: 0, dCm: 0 };
  private accumulator = 0;

  constructor(config: AircraftConfig = C172RG, load: Load = DEFAULT_LOAD) {
    this.config = config;
    this.engine = new Engine(config);
    this.mass = computeLoadSheet(config, load).massKg;
  }

  /** Applies a load; returns the problems that make it illegal (the mass is set either way). */
  setLoad(load: Load): string[] {
    const sheet = computeLoadSheet(this.config, load);
    this.mass = sheet.massKg;
    return sheet.problems;
  }

  reset(x: number, engineRunning = true): void {
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.pitch = 0;
    this.pitchRate = 0;
    this.throttleLever = 0;
    this.throttle = 0;
    this.engine.reset(engineRunning);
    this.flapDeg = 0;
    this.flapIndex = 0;
    this.flaps = 0;
    this.flapsTarget = 0;
    this.gear = 1;
    this.gearTarget = 1;
    this.onGround = true;
    this.elevator = 0;
    this.trim = 0;
    this.aoa = 0;
    this.stallMargin = 1;
    this.stalled = false;
    this.braking = false;
    this.tailStrike = false;
    this.overspeed = false;
    this.flapOverspeed = false;
    this.maxAltitude = 0;
    this.touchdown = null;
    this.accumulator = 0;
  }

  get airspeed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  get flapTargetDeg(): number {
    return this.config.flaps.detents[this.flapIndex].deg;
  }

  setFlapIndex(i: number): void {
    this.flapIndex = clamp(Math.round(i), 0, this.config.flaps.detents.length - 1);
    this.flapsTarget = this.flapTargetDeg / maxFlapDeg(this.config);
  }

  flapsDown(): boolean {
    if (this.flapIndex >= this.config.flaps.detents.length - 1) return false;
    this.setFlapIndex(this.flapIndex + 1);
    return true;
  }

  flapsUp(): boolean {
    if (this.flapIndex <= 0) return false;
    this.setFlapIndex(this.flapIndex - 1);
    return true;
  }

  /** Single-button flap control: one notch down per press, back to up after full flaps. */
  cycleFlaps(): void {
    if (!this.flapsDown()) this.setFlapIndex(0);
  }

  /** Returns false when the gear cannot move (weight on wheels or fixed gear). */
  toggleGear(): boolean {
    if (this.onGround || !this.config.gear.retractable) return false;
    this.gearTarget = this.gearTarget > 0.5 ? 0 : 1;
    return true;
  }

  setThrottleLever(v: number): void {
    this.throttleLever = clamp(v, 0, 1);
  }

  update(dt: number, input: ControlInput): void {
    this.accumulator = Math.min(this.accumulator + dt, 0.25);
    while (this.accumulator >= FIXED_DT) {
      this.step(FIXED_DT, input);
      this.accumulator -= FIXED_DT;
    }
  }

  step(dt: number, input: ControlInput): void {
    const C = this.config;
    const A = C.aero;
    const m = this.mass;

    this.throttleLever = clamp(this.throttleLever + input.throttle * C.engine.leverRatePerS * dt, 0, 1);
    this.engine.step(dt, this.throttleLever);
    this.throttle = this.engine.power;
    this.flapDeg = approach(this.flapDeg, this.flapTargetDeg, C.flaps.rateDegPerS * dt);
    this.flaps = this.flapDeg / maxFlapDeg(C);
    this.gear = approach(this.gear, this.gearTarget, dt / C.gear.transitTimeS);

    const V = this.airspeed;
    const gamma = V > 1 ? Math.atan2(this.vy, this.vx) : 0;
    const alpha = this.pitch - gamma;
    this.aoa = alpha;

    // Lift coefficient with flaps, ground effect and stall break.
    const f = this.flap;
    flapEffect(C, this.flapDeg, f);
    const clMax = A.clMaxClean + f.dClMax;
    const clBase = A.cl0 + f.dCl;
    const stallAlpha = (clMax - clBase) / A.clAlpha;
    let cl: number;
    if (alpha > stallAlpha) cl = Math.max(clMax * A.postStallFloor, clMax - (alpha - stallAlpha) * A.postStallSlope);
    else cl = clBase + A.clAlpha * Math.max(alpha, A.minLinearAlpha);
    const ge = this.y < A.groundEffectHeightM ? 1 + A.groundEffectLiftGain * (1 - this.y / A.groundEffectHeightM) : 1;
    cl *= ge;
    this.stallMargin = (stallAlpha - alpha) / stallAlpha;
    this.stalled = !this.onGround && alpha > stallAlpha;

    const cd = A.cd0 + (A.inducedK * cl * cl) / ge + f.dCd + C.gear.cd * this.gear;
    const qbar = 0.5 * RHO * V * V;
    const S = C.geometry.wingAreaM2;
    const lift = qbar * S * cl;
    const drag = qbar * S * cd;
    const thrust = this.engine.thrust(V);

    const cg = Math.cos(gamma);
    const sg = Math.sin(gamma);
    let fx = thrust * Math.cos(this.pitch) - drag * cg - lift * sg;
    let fy = thrust * Math.sin(this.pitch) - drag * sg + lift * cg - m * G;

    // Ground contact: wheels carry what the wing does not; rolling, braking or belly friction.
    let weightOnWheels = 0;
    this.braking = false;
    if (this.onGround) {
      if (fy <= 0) {
        weightOnWheels = -fy;
        fy = 0;
        let mu = C.ground.rollFriction;
        if (this.gear < 0.95) mu = C.ground.bellyFriction;
        else {
          const brake = Math.max(input.brake, this.assists.autoBrakeAtIdle && this.throttleLever < 0.05 ? 1 : 0);
          mu += (C.ground.brakeFriction - mu) * clamp(brake, 0, 1);
          this.braking = brake > 0.05 && this.vx > 0.5;
        }
        const friction = mu * weightOnWheels;
        const maxStop = (Math.abs(this.vx) * m) / dt;
        fx -= Math.sign(this.vx) * Math.min(friction, maxStop);
        if (Math.abs(this.vx) < 0.01 && Math.abs(fx) < friction) fx = 0;
      } else {
        this.onGround = false;
      }
    }

    this.vx += (fx / m) * dt;
    this.vy += (fy / m) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Pitch: aerodynamic moments, elevator and (on the ground) the weight acting ahead of the main wheels.
    const qSc = qbar * S * C.geometry.chordM;
    const qHat = (this.pitchRate * C.geometry.chordM) / (2 * Math.max(V, 5));
    let cmFree = A.cm0 + A.cmAlpha * alpha + A.cmQ * qHat + f.dCm;
    if (alpha > stallAlpha) cmFree += A.cmStall * (alpha - stallAlpha);
    const groundMoment = -weightOnWheels * C.geometry.cgAheadOfMainGearM;

    let elevatorCmd: number;
    const stick = clamp(input.pitch, -1, 1);
    const holdActive = this.assists.pitchHold && !this.stalled && (!this.onGround || stick > 0.05) && qSc > 50;
    if (holdActive) {
      const wanted = C.inertia.iyyKgM2 * C.controls.pitchHoldGain * (stick * C.controls.maxPitchRate - this.pitchRate);
      elevatorCmd = (wanted - groundMoment - qSc * cmFree) / (qSc * A.cmElevator);
    } else {
      elevatorCmd = stick + (this.assists.pitchHold ? 0 : this.trim);
    }
    this.elevator = approach(this.elevator, clamp(elevatorCmd, -1, 1), C.controls.elevatorRatePerS * dt);

    const moment = qSc * (cmFree + A.cmElevator * this.elevator) + groundMoment;
    this.pitchRate += (moment / C.inertia.iyyKgM2) * dt;
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
      const limit = C.geometry.tailStrikePitch;
      this.tailStrike = this.pitch > limit;
      if (this.pitch < 0) {
        this.pitch = 0;
        if (this.pitchRate < 0) this.pitchRate = 0;
      } else if (this.pitch > limit) {
        this.pitch = limit;
        if (this.pitchRate > 0) this.pitchRate = 0;
      }
    }

    const kmh = V * 3.6;
    this.overspeed = kmh > C.limits.vneKmh;
    this.flapOverspeed = this.flapDeg > 0.5 && kmh > this.vfeAt(this.flapDeg);

    if (this.y > this.maxAltitude) this.maxAltitude = this.y;
  }

  /** Flap-extended speed limit for the given deflection (the strictest detent at or below it). */
  vfeAt(deg: number): number {
    let vfe = Infinity;
    for (const d of this.config.flaps.detents) if (d.deg > 0 && d.deg <= deg + 0.5) vfe = Math.min(vfe, d.vfeKmh);
    if (vfe === Infinity) vfe = this.config.flaps.detents[1]?.vfeKmh ?? Infinity;
    return vfe;
  }
}
