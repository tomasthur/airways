/**
 * Data that fully describes one aircraft type. The flight model reads only this,
 * so a new aircraft is a new data file (plus a model in render/).
 *
 * Units: SI (kg, m, s, N, W, rad) unless the field name says otherwise.
 */

export interface FlapDetent {
  deg: number;
  /** Lift coefficient added at this deflection. */
  dCl: number;
  /** Increase of the maximum lift coefficient. */
  dClMax: number;
  /** Drag coefficient added. */
  dCd: number;
  /** Pitching-moment coefficient added (+ = nose up). */
  dCm: number;
  /** Maximum flap-extended speed for this setting. */
  vfeKmh: number;
}

export type Propulsion = 'piston' | 'turboprop' | 'jet';

/** Shape description for the parametric 3D model (render/ParametricAirplane). Metres, nose towards +x. */
export interface AircraftVisual {
  lengthM: number;
  /** Fuselage cross-section (height ≈ width for airliners). */
  fuselageHeightM: number;
  fuselageWidthM: number;
  /** Two full passenger decks (A380). */
  doubleDeck?: boolean;
  /** Height of the fuselage belly above the ground with the gear down. */
  bellyHeightM: number;
  wing: {
    /** Root leading edge, as a fraction of the length from the nose. */
    rootXFrac: number;
    rootChordM: number;
    tipChordM: number;
    sweepDeg: number;
    dihedralDeg: number;
    mount: 'high' | 'low';
    tip: 'plain' | 'winglet' | 'sharklet' | 'raked' | 'fence';
  };
  tail: {
    type: 'conventional' | 't';
    finHeightM: number;
    finChordM: number;
    stabSpanM: number;
    stabChordM: number;
    sweepDeg: number;
  };
  engines: {
    kind: 'wing-prop' | 'turbofan';
    /** Spanwise positions as fractions of the half-span (one entry per engine pair). */
    spanFrac: number[];
    nacelleLengthM: number;
    nacelleDiaM: number;
    /** Propeller diameter (wing-prop only). */
    propDiaM?: number;
    blades?: number;
  };
  gear: {
    /** Wheels per main gear leg. */
    mainWheels: 1 | 2 | 4 | 6;
    wheelDiaM: number;
    /** Extra pair of body gear legs (A380, 747). */
    bodyGear?: boolean;
  };
  /** Cabin windows per side (painted). */
  windows: number;
  livery: { body: string; belly: string; stripe: string; accent: string; tail: string; engine: string };
}

export interface AircraftConfig {
  id: string;
  name: string;
  /** Painted on the airframe and used as the ATC callsign. */
  registration: string;
  propulsion: Propulsion;
  engineCount: number;

  /** Game-scale mission performance: sizes the corridor and drives guidance copy. */
  performance: {
    cruiseKmh: number;
    cruiseAltM: number;
    /** Runway length this type is given at both ends of the corridor. */
    runwayM: number;
    /** Seconds of the target flight time spent on take-off, climb, approach and landing. */
    padTimeS: number;
  };

  /** Parametric model description; absent = hand-built model (C172). */
  visual?: AircraftVisual;

  mass: {
    emptyKg: number;
    mtowKg: number;
    /** Seats including the pilot. */
    seats: number;
    maxPassengers: number;
    maxBaggageKg: number;
    /** Usable fuel. */
    maxFuelKg: number;
    /** Standard mass per person (incl. carry-on). */
    personKg: number;
  };

  geometry: {
    wingAreaM2: number;
    /** Mean aerodynamic chord. */
    chordM: number;
    /** Horizontal distance from the main wheels forward to the centre of gravity. */
    cgAheadOfMainGearM: number;
    /** Pitch at which the tail touches the runway. */
    tailStrikePitch: number;
  };

  inertia: {
    /** Pitch moment of inertia. */
    iyyKgM2: number;
    /** Roll moment of inertia. */
    ixxKgM2: number;
  };

  roll: {
    wingSpanM: number;
    /** Roll damping derivative (per p·b/2V). */
    clP: number;
    /** Rolling moment per unit aileron (δa in −1..1, + = right wing down). */
    clAileron: number;
    /** Roll rate commanded by full stick/yoke. */
    maxRollRate: number;
    maxBank: number;
  };

  aero: {
    cl0: number;
    /** Lift slope per radian. */
    clAlpha: number;
    clMaxClean: number;
    /** Most negative angle of attack the linear lift curve is used for. */
    minLinearAlpha: number;
    /** Post-stall lift falls with this slope per radian… */
    postStallSlope: number;
    /** …but not below this fraction of the maximum. */
    postStallFloor: number;
    cd0: number;
    inducedK: number;
    groundEffectHeightM: number;
    groundEffectLiftGain: number;
    /** Pitching moment: Cm = cm0 + cmAlpha·α + cmQ·(q·c/2V) + cmElevator·δe + flap dCm + cmStall·(α − α_stall)+ */
    cm0: number;
    cmAlpha: number;
    cmQ: number;
    /** Moment per unit elevator deflection (δe in −1..1, + = trailing edge up / nose up). */
    cmElevator: number;
    cmStall: number;
  };

  flaps: {
    /** Detents in ascending order, first must be 0°. */
    detents: FlapDetent[];
    rateDegPerS: number;
  };

  gear: {
    retractable: boolean;
    transitTimeS: number;
    cd: number;
  };

  engine: {
    maxPowerW: number;
    staticThrustN: number;
    /** Time constant for engine power to follow the throttle lever. */
    spoolTimeS: number;
    startTimeS: number;
    /** Lever travel per second while a power key/button is held. */
    leverRatePerS: number;
  };

  controls: {
    /** Pitch rate commanded by full stick with the pitch-hold assist on. */
    maxPitchRate: number;
    /** Elevator servo speed (full travel = 2). */
    elevatorRatePerS: number;
    /** How quickly the pitch-hold assist closes the pitch-rate error (1/s). */
    pitchHoldGain: number;
  };

  ground: {
    rollFriction: number;
    brakeFriction: number;
    bellyFriction: number;
  };

  limits: {
    vs0Kmh: number;
    vs1Kmh: number;
    vrKmh: number;
    vrefKmh: number;
    vnoKmh: number;
    vneKmh: number;
    maxTouchdownVsMs: number;
    /** Limit load factor: above it the airframe accumulates damage. */
    limitLoadG: number;
    /** Ultimate load factor: immediate structural failure. */
    ultimateLoadG: number;
    /** Seconds above Vne the airframe tolerates. */
    overspeedToleranceS: number;
  };
}

/**
 * Full-power thrust at true airspeed V (m/s). Propellers are power-limited (P/V);
 * turbofans keep most of their static thrust and lose a little with speed (ram drag).
 */
export function fullThrust(propulsion: Propulsion, e: AircraftConfig['engine'], V: number): number {
  if (propulsion === 'jet') return e.staticThrustN * Math.max(0.3, 1 - (0.3 * V) / 340);
  return Math.min(e.staticThrustN, e.maxPowerW / Math.max(V, 1));
}

/** Flap deflection (deg) of the largest detent. */
export function maxFlapDeg(c: AircraftConfig): number {
  return c.flaps.detents[c.flaps.detents.length - 1].deg;
}

/** Linearly interpolated flap effect at an arbitrary deflection (flaps move continuously between detents). */
export function flapEffect(c: AircraftConfig, deg: number, out: Omit<FlapDetent, 'deg' | 'vfeKmh'>): void {
  const d = c.flaps.detents;
  let i = 0;
  while (i < d.length - 2 && deg > d[i + 1].deg) i++;
  const a = d[i];
  const b = d[i + 1] ?? a;
  const t = b.deg > a.deg ? Math.max(0, Math.min(1, (deg - a.deg) / (b.deg - a.deg))) : 0;
  out.dCl = a.dCl + (b.dCl - a.dCl) * t;
  out.dClMax = a.dClMax + (b.dClMax - a.dClMax) * t;
  out.dCd = a.dCd + (b.dCd - a.dCd) * t;
  out.dCm = a.dCm + (b.dCm - a.dCm) * t;
}
