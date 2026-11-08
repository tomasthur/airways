/**
 * Side-view flight model: x, y and pitch with aerodynamic pitching moments, plus bank (roll) and
 * flight through moving air (wind, turbulence, storms). Driven entirely by an AircraftConfig.
 * Pure TypeScript with no dependencies so it can be simulated headless.
 */
import { flapEffect, maxFlapDeg, type AircraftConfig } from './aircraft/AircraftConfig.ts';
import { C172RG } from './aircraft/c172rg.ts';
import { Engine } from './Engine.ts';
import { computeLoadSheet, DEFAULT_LOAD, plannedLoad, type Load } from './LoadSheet.ts';
import type { Weather, WeatherSample } from './Weather.ts';

const G = 9.81;
const RHO = 1.225;
const FIXED_DT = 1 / 120;

export interface ControlInput {
  /** -1 (nose down) .. +1 (nose up) */
  pitch: number;
  /** -1 (left wing down) .. +1 (right wing down) */
  roll: number;
  /** Throttle lever movement: -1 (pull back) .. +1 (push forward). */
  throttle: number;
  /** Wheel brakes 0..1. */
  brake: number;
  /** Speed brake / spoilers hold 0..1 (ignored when the type has none). */
  speedBrake?: number;
}

export interface Assists {
  /** Stick commands a pitch rate and centred stick holds the attitude (released in a stall). */
  pitchHold: boolean;
  /** Centred stick slowly rolls the wings level. */
  wingLeveler: boolean;
  /** Full brakes on the ground whenever the throttle lever is at idle. */
  autoBrakeAtIdle: boolean;
}

export interface Touchdown {
  x: number;
  verticalSpeed: number;
  groundSpeed: number;
  /** Air-relative speed at the moment of touchdown (m/s). */
  airspeed: number;
  pitch: number;
  roll: number;
  gear: number;
  flaps: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const approach = (v: number, target: number, step: number) =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

export class FlightModel {
  config: AircraftConfig;
  engine: Engine;
  readonly assists: Assists = { pitchHold: true, wingLeveler: true, autoBrakeAtIdle: true };
  mass: number;
  /** Weather the aircraft flies through; null = calm air. */
  weather: Weather | null = null;
  readonly air: WeatherSample = { wx: 0, wy: 0, rollGust: 0, turbulence: 0, rain: 0, cloud: 0 };
  time = 0;

  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  pitch = 0;
  pitchRate = 0;
  /** Bank angle (rad), + = right wing down. */
  roll = 0;
  rollRate = 0;
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
  /** Flight spoilers 0..1 (actual position). */
  speedBrake = 0;
  /** Commanded spoilers 0..1. */
  speedBrakeTarget = 0;
  onGround = true;
  /** Elevator deflection −1..1 (+ = nose up), including trim. */
  elevator = 0;
  aileron = 0;
  /** Manual trim −1..1, used when the pitch-hold assist is off. */
  trim = 0;

  aoa = 0;
  stallMargin = 1;
  stalled = false;
  braking = false;
  tailStrike = false;
  overspeed = false;
  flapOverspeed = false;
  /** Load factor (g) felt by the airframe. */
  loadFactor = 1;
  maxLoadFactor = 1;
  /** Accumulated airframe damage 0..1; 1 = structural failure. */
  damage = 0;
  structuralFailure: string | null = null;
  overspeedTime = 0;
  maxAltitude = 0;

  /** Set when the aircraft touches the ground after being airborne; cleared by the consumer. */
  touchdown: Touchdown | null = null;
  private readonly touchdownData: Touchdown = { x: 0, verticalSpeed: 0, groundSpeed: 0, airspeed: 0, pitch: 0, roll: 0, gear: 0, flaps: 0 };
  private readonly flap = { dCl: 0, dClMax: 0, dCd: 0, dCm: 0 };
  private accumulator = 0;
  private wingDrop = 0;

  constructor(config: AircraftConfig = C172RG, load: Load = DEFAULT_LOAD) {
    this.config = config;
    this.engine = new Engine(config);
    this.mass = computeLoadSheet(config, load).massKg;
  }

  /** Swaps the aircraft type (call {@link reset} and {@link setLoad} afterwards). */
  setAircraft(config: AircraftConfig): void {
    if (config === this.config) return;
    this.config = config;
    this.engine = new Engine(config);
    this.mass = computeLoadSheet(config, plannedLoad(config, 0.75)).massKg;
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
    this.roll = 0;
    this.rollRate = 0;
    this.time = 0;
    this.throttleLever = 0;
    this.throttle = 0;
    this.engine.reset(engineRunning);
    this.flapDeg = 0;
    this.flapIndex = 0;
    this.flaps = 0;
    this.flapsTarget = 0;
    this.gear = 1;
    this.gearTarget = 1;
    this.speedBrake = 0;
    this.speedBrakeTarget = 0;
    this.onGround = true;
    this.elevator = 0;
    this.aileron = 0;
    this.trim = 0;
    this.aoa = 0;
    this.stallMargin = 1;
    this.stalled = false;
    this.braking = false;
    this.tailStrike = false;
    this.overspeed = false;
    this.flapOverspeed = false;
    this.loadFactor = 1;
    this.maxLoadFactor = 1;
    this.damage = 0;
    this.structuralFailure = null;
    this.overspeedTime = 0;
    this.maxAltitude = 0;
    this.touchdown = null;
    this.accumulator = 0;
    this.wingDrop = 0;
    this.air.wx = this.air.wy = this.air.rollGust = this.air.turbulence = this.air.rain = this.air.cloud = 0;
  }

  /** True airspeed relative to the surrounding air. */
  get airspeed(): number {
    return Math.hypot(this.vx - this.air.wx, this.vy - this.air.wy);
  }

  get groundSpeed(): number {
    return this.vx;
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

  /** Hold-to-deploy speed brake; no-op on types without spoilers. */
  setSpeedBrake(held: boolean): void {
    this.speedBrakeTarget = this.config.speedBrake && held ? 1 : 0;
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
    this.time += dt;

    this.throttleLever = clamp(this.throttleLever + input.throttle * C.engine.leverRatePerS * dt, 0, 1);
    this.flapDeg = approach(this.flapDeg, this.flapTargetDeg, C.flaps.rateDegPerS * dt);
    this.flaps = this.flapDeg / maxFlapDeg(C);
    this.gear = approach(this.gear, this.gearTarget, dt / C.gear.transitTimeS);
    this.speedBrakeTarget = C.speedBrake && (input.speedBrake ?? 0) > 0.5 ? 1 : 0;
    if (C.speedBrake) this.speedBrake = approach(this.speedBrake, this.speedBrakeTarget, dt / C.speedBrake.deployS);
    else this.speedBrake = 0;

    const air = this.air;
    if (this.weather) this.weather.sample(this.x, this.y, this.time, air);

    // Air-relative velocity: wind and gusts change airspeed and angle of attack.
    const ux = this.vx - air.wx;
    const uy = this.vy - air.wy;
    const V = Math.hypot(ux, uy);
    this.engine.step(dt, this.throttleLever, V);
    // HUD power shows delivered thrust fraction (includes soft CHT derate).
    this.throttle = this.engine.power * this.engine.thrustFactor();
    const gamma = V > 1 ? Math.atan2(uy, ux) : 0;
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
    const sb = C.speedBrake;
    const sbPos = sb ? this.speedBrake : 0;
    if (sb) cl += sb.dCl * sbPos;
    const ge = this.y < A.groundEffectHeightM ? 1 + A.groundEffectLiftGain * (1 - this.y / A.groundEffectHeightM) : 1;
    cl *= ge;
    this.stallMargin = (stallAlpha - alpha) / stallAlpha;
    const wasStalled = this.stalled;
    this.stalled = !this.onGround && alpha > stallAlpha;
    if (this.stalled && !wasStalled) this.wingDrop = (air.rollGust >= 0 ? 1 : -1) * (1.1 + 0.6 * Math.min(1, Math.abs(alpha - stallAlpha) * 10));
    if (!this.stalled) this.wingDrop = 0;

    const cd = A.cd0 + (A.inducedK * cl * cl) / ge + f.dCd + C.gear.cd * this.gear + (sb ? sb.cd * sbPos : 0);
    const qbar = 0.5 * RHO * V * V;
    const S = C.geometry.wingAreaM2;
    const lift = qbar * S * cl;
    const drag = qbar * S * cd;
    const thrust = this.engine.thrust(V);
    this.loadFactor = lift / (m * G);
    // Banked wings tilt the lift vector: only the vertical part holds the aircraft up.
    const liftV = lift * Math.cos(this.roll);

    const cg = Math.cos(gamma);
    const sg = Math.sin(gamma);
    let fx = thrust * Math.cos(this.pitch) - drag * cg - liftV * sg;
    let fy = thrust * Math.sin(this.pitch) - drag * sg + liftV * cg - m * G;

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

    // Roll: aileron, roll damping, gusts and the wing drop of a stall. The leveler does not know
    // about gusts, so turbulence visibly rocks the wings.
    const R = C.roll;
    const span = R.wingSpanM;
    const qSb = qbar * S * span;
    const rollStick = clamp(input.roll, -1, 1);
    if (this.onGround) {
      this.roll = 0;
      this.rollRate = 0;
      this.aileron = rollStick;
    } else {
      let ail = rollStick;
      // In a stall the wings do not level themselves – the dropped wing stays down.
      // Leveler is soft so clear-air bumps still need a hand on the yoke.
      if (this.assists.wingLeveler && !this.stalled && Math.abs(rollStick) < 0.05) ail = clamp(-0.85 * this.roll - 0.7 * this.rollRate, -0.4, 0.4);
      else if (Math.abs(rollStick) >= 0.05) ail = clamp((rollStick * R.maxRollRate - this.rollRate) * 2.5, -1, 1);
      this.aileron = approach(this.aileron, ail, C.controls.elevatorRatePerS * dt);
      const pHat = (this.rollRate * span) / (2 * Math.max(V, 5));
      const clRoll = R.clAileron * this.aileron + R.clP * pHat + air.rollGust + this.wingDrop * 0.055;
      this.rollRate += ((qSb * clRoll) / C.inertia.ixxKgM2) * dt;
      this.roll += this.rollRate * dt;
      if (Math.abs(this.roll) > R.maxBank) {
        this.roll = Math.sign(this.roll) * R.maxBank;
        this.rollRate = 0;
      }
    }

    if (!this.onGround && this.y <= 0) {
      const td = this.touchdownData;
      td.x = this.x;
      td.verticalSpeed = this.vy;
      td.groundSpeed = this.vx;
      td.airspeed = V;
      td.pitch = this.pitch;
      td.roll = this.roll;
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

    // Airframe limits: overspeed and excessive g damage the structure.
    const kmh = V * 3.6;
    const L = C.limits;
    this.overspeed = kmh > L.vneKmh;
    this.flapOverspeed = this.flapDeg > 0.5 && kmh > this.vfeAt(this.flapDeg);
    if (!this.onGround) {
      const n = this.loadFactor;
      if (n > this.maxLoadFactor) this.maxLoadFactor = n;
      if (this.overspeed) {
        this.overspeedTime += dt;
        this.damage += dt / L.overspeedToleranceS;
      }
      if (n > L.limitLoadG) this.damage += ((n - L.limitLoadG) / (L.ultimateLoadG - L.limitLoadG)) * dt * 4;
      if (n >= L.ultimateLoadG || kmh > L.vneKmh * 1.12) this.damage = 1;
      if (this.damage >= 1 && !this.structuralFailure) {
        this.structuralFailure = this.overspeed
          ? `The airframe failed at ${Math.round(kmh)} km/h – far beyond the never-exceed speed of ${L.vneKmh} km/h.`
          : `The airframe failed under ${n.toFixed(1)} g – the limit is ${L.limitLoadG} g. Slow down in turbulence and pull out gently.`;
      }
    }

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
