import type { AircraftConfig } from './AircraftConfig.ts';

/**
 * Cessna 172RG Cutlass (OM-BTV).
 * Mass, speed and flap limits are typical published 172RG figures and still need checking
 * against the POH. Aerodynamic coefficients are tuned for the game, carried over from Prototype 01.
 */
export const C172RG: AircraftConfig = {
  id: 'c172rg',
  name: 'Cessna 172RG Cutlass',

  mass: {
    emptyKg: 780,
    mtowKg: 1202,
    seats: 4,
    maxPassengers: 3,
    maxBaggageKg: 91,
    maxFuelKg: 168,
    personKg: 80,
  },

  geometry: {
    wingAreaM2: 16.2,
    chordM: 1.49,
    cgAheadOfMainGearM: 0.35,
    tailStrikePitch: 0.21,
  },

  inertia: {
    iyyKgM2: 1825,
    ixxKgM2: 1285,
  },

  roll: {
    wingSpanM: 11.1,
    clP: -0.47,
    clAileron: 0.11,
    maxRollRate: 0.55,
    maxBank: 1.05,
  },

  aero: {
    cl0: 0.28,
    clAlpha: 5.2,
    clMaxClean: 1.55,
    minLinearAlpha: -0.22,
    postStallSlope: 7.5,
    postStallFloor: 0.22,
    cd0: 0.03,
    inducedK: 0.055,
    groundEffectHeightM: 7,
    groundEffectLiftGain: 0.07,
    cm0: 0,
    cmAlpha: -1.2,
    cmQ: -20,
    cmElevator: 0.45,
    cmStall: -1.7,
  },

  flaps: {
    detents: [
      { deg: 0, dCl: 0, dClMax: 0, dCd: 0, dCm: 0, vfeKmh: Infinity },
      { deg: 10, dCl: 0.2, dClMax: 0.2, dCd: 0.008, dCm: 0, vfeKmh: 204 },
      { deg: 20, dCl: 0.38, dClMax: 0.38, dCd: 0.022, dCm: 0, vfeKmh: 157 },
      { deg: 30, dCl: 0.5, dClMax: 0.5, dCd: 0.045, dCm: 0, vfeKmh: 157 },
    ],
    rateDegPerS: 6,
  },

  gear: {
    retractable: true,
    transitTimeS: 3.6,
    cd: 0.014,
  },

  engine: {
    maxPowerW: 108000,
    staticThrustN: 3400,
    spoolTimeS: 0.6,
    startTimeS: 2.5,
    leverRatePerS: 0.45,
  },

  controls: {
    maxPitchRate: 0.36,
    elevatorRatePerS: 4,
    pitchHoldGain: 6,
  },

  ground: {
    rollFriction: 0.028,
    brakeFriction: 0.42,
    bellyFriction: 0.6,
  },

  limits: {
    vs0Kmh: 78,
    vs1Kmh: 93,
    vrKmh: 100,
    vrefKmh: 120,
    vnoKmh: 269,
    vneKmh: 304,
    maxTouchdownVsMs: 4.5,
    limitLoadG: 3.8,
    ultimateLoadG: 5.7,
    overspeedToleranceS: 5,
  },
};
