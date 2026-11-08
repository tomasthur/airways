import { fullThrust, type AircraftConfig, type AircraftVisual, type FlapDetent, type Propulsion } from './AircraftConfig.ts';

const G = 9.81;
const RHO = 1.225;

/**
 * High-level description of a type. {@link defineAircraft} derives the aerodynamic and handling
 * coefficients from it, so every aircraft reaches its game cruise speed at a sensible power
 * setting and has stall / rotation / approach speeds consistent with its wing loading.
 */
export interface AircraftSpec {
  id: string;
  name: string;
  registration: string;
  propulsion: Propulsion;
  engineCount: number;

  emptyKg: number;
  mtowKg: number;
  maxPassengers: number;
  maxBaggageKg: number;
  /** Fuel capacity used by the game's load planning (not the brochure maximum). */
  maxFuelKg: number;
  personKg?: number;

  wingAreaM2: number;
  spanM: number;
  /** Mean aerodynamic chord. */
  chordM: number;
  tailStrikeDeg: number;
  clMaxClean: number;
  /** Flap detents after "up": deflection, gain in maximum lift, placard speed. */
  flaps: [deg: number, dClMax: number, vfeKmh: number][];
  flapRateDegPerS: number;
  gearTransitS: number;

  /** Total installed shaft power (props) as delivered thrust power. */
  maxPowerW?: number;
  /** Total static thrust. */
  staticThrustN: number;
  spoolTimeS: number;
  startTimeS: number;

  cruiseKmh: number;
  cruiseAltM: number;
  runwayM: number;
  padTimeS: number;
  /** Full-power level-flight speed as a multiple of cruise (sets the drag). */
  vmaxFactor?: number;
  vneKmh: number;
  maxTouchdownVsMs: number;
  limitLoadG: number;

  /** 0 = nimble light aircraft, 1 = heavy widebody (pitch / roll authority and rates). */
  heft: number;
  /** Hold-to-deploy flight spoilers for types that need help bleeding cruise speed. */
  speedBrake?: boolean;
  visual: AircraftVisual;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function stallKmh(massKg: number, s: AircraftSpec, clMax: number): number {
  return Math.sqrt((2 * massKg * G) / (RHO * s.wingAreaM2 * clMax)) * 3.6;
}

export function defineAircraft(s: AircraftSpec): AircraftConfig {
  const personKg = s.personKg ?? 84;
  const payload = 0.75 * s.maxPassengers * personKg + Math.min(s.maxBaggageKg, 15 * s.maxPassengers);
  const cruiseMass = s.emptyKg + personKg + payload + 0.6 * s.maxFuelKg;
  const landingMass = s.emptyKg + personKg + payload + 0.4 * s.maxFuelKg;
  const takeoffMass = Math.min(s.mtowKg, s.emptyKg + personKg + payload + 0.8 * s.maxFuelKg);

  const ar = (s.spanM * s.spanM) / s.wingAreaM2;
  const inducedK = 1 / (Math.PI * 0.8 * ar);
  const maxPowerW = s.maxPowerW ?? s.staticThrustN * 200;
  const engine = { maxPowerW, staticThrustN: s.staticThrustN, spoolTimeS: s.spoolTimeS, startTimeS: s.startTimeS, leverRatePerS: 0.45 };

  // Parasite drag chosen so full power in level flight tops out at vmaxFactor × cruise.
  const vmax = (s.cruiseKmh * (s.vmaxFactor ?? 1.15)) / 3.6;
  const qS = 0.5 * RHO * vmax * vmax * s.wingAreaM2;
  const clAtVmax = (cruiseMass * G) / qS;
  const cd0 = Math.max(0.018, fullThrust(s.propulsion, engine, vmax) / qS - inducedK * clAtVmax * clAtVmax);

  const detents: FlapDetent[] = [{ deg: 0, dCl: 0, dClMax: 0, dCd: 0, dCm: 0, vfeKmh: Infinity }];
  for (const [deg, dClMax, vfeKmh] of s.flaps) {
    detents.push({ deg, dCl: dClMax, dClMax, dCd: 0.05 * (deg / 30) ** 1.6, dCm: 0, vfeKmh });
  }
  const full = detents[detents.length - 1];
  const vs0 = stallKmh(landingMass, s, s.clMaxClean + full.dClMax);
  const vs1 = stallKmh(landingMass, s, s.clMaxClean);
  const vsTakeoff = stallKmh(takeoffMass, s, s.clMaxClean + detents[1].dClMax);

  const length = s.visual.lengthM;
  const h = s.heft;
  return {
    id: s.id,
    name: s.name,
    registration: s.registration,
    propulsion: s.propulsion,
    engineCount: s.engineCount,
    performance: { cruiseKmh: s.cruiseKmh, cruiseAltM: s.cruiseAltM, runwayM: s.runwayM, padTimeS: s.padTimeS },
    visual: s.visual,
    mass: {
      emptyKg: s.emptyKg,
      mtowKg: s.mtowKg,
      seats: s.maxPassengers + 1,
      maxPassengers: s.maxPassengers,
      maxBaggageKg: s.maxBaggageKg,
      maxFuelKg: s.maxFuelKg,
      personKg,
    },
    geometry: {
      wingAreaM2: s.wingAreaM2,
      chordM: s.chordM,
      cgAheadOfMainGearM: 0.042 * length,
      tailStrikePitch: (s.tailStrikeDeg * Math.PI) / 180,
    },
    inertia: {
      iyyKgM2: 0.024 * cruiseMass * length * length,
      ixxKgM2: 0.0095 * cruiseMass * s.spanM * s.spanM,
    },
    roll: {
      wingSpanM: s.spanM,
      clP: -0.47,
      clAileron: 0.11,
      maxRollRate: lerp(0.5, 0.24, h),
      maxBank: 1.05,
    },
    aero: {
      cl0: 0.25,
      clAlpha: lerp(5.2, 4.8, h),
      clMaxClean: s.clMaxClean,
      minLinearAlpha: -0.22,
      postStallSlope: 7.5,
      postStallFloor: 0.22,
      cd0,
      inducedK,
      groundEffectHeightM: 0.6 * s.spanM,
      groundEffectLiftGain: 0.07,
      cm0: 0,
      cmAlpha: -1.2,
      cmQ: -20,
      cmElevator: 0.45,
      cmStall: -1.7,
    },
    flaps: { detents, rateDegPerS: s.flapRateDegPerS },
    gear: { retractable: true, transitTimeS: s.gearTransitS, cd: 0.016 },
    engine,
    controls: {
      maxPitchRate: lerp(0.32, 0.15, h),
      elevatorRatePerS: lerp(4, 2.6, h),
      pitchHoldGain: lerp(6, 4, h),
    },
    ground: { rollFriction: s.propulsion === 'jet' ? 0.02 : 0.025, brakeFriction: 0.42, bellyFriction: 0.6 },
    ...(s.speedBrake
      ? {
          speedBrake: {
            // Jets need more plate area than a turboprop to bleed Mach-ish cruise speeds.
            cd: (s.propulsion === 'jet' ? 0.06 : 0.04) + (s.propulsion === 'jet' ? 0.07 : 0.04) * h,
            dCl: -0.08 - 0.05 * h,
            deployS: 0.55 + 0.35 * h,
          },
        }
      : {}),
    limits: {
      vs0Kmh: Math.round(vs0),
      vs1Kmh: Math.round(vs1),
      vrKmh: Math.round(vsTakeoff * 1.12),
      vrefKmh: Math.round(vs0 * 1.3),
      vnoKmh: Math.round(s.vneKmh * 0.9),
      vneKmh: s.vneKmh,
      maxTouchdownVsMs: s.maxTouchdownVsMs,
      limitLoadG: s.limitLoadG,
      ultimateLoadG: s.limitLoadG * 1.5,
      overspeedToleranceS: 5,
    },
  };
}
