/**
 * Headless regression flights for the flight model and landing scoring.
 *
 *   npm run test:flight            compare against scripts/regression/baseline.json
 *   npm run test:flight -- --update   re-record the baseline (after an intentional physics change)
 *
 * Runs the real src/sim modules (Node type stripping), stepping them with the same
 * 60 Hz frame dt the game uses. Every scenario is deterministic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlightModel } from '../../src/sim/FlightModel.ts';
import { buildReport, evaluateTouchdown } from '../../src/sim/Landing.ts';
import { C172RG } from '../../src/sim/aircraft/c172rg.ts';
import { computeLoadSheet, DEFAULT_LOAD } from '../../src/sim/LoadSheet.ts';
import { Weather } from '../../src/sim/Weather.ts';
import { AIM_POINT_X, BTS_RUNWAY, GLIDE_SLOPE_DEG, START_X, VIE_RUNWAY } from '../../src/config.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = path.join(HERE, 'baseline.json');
const FRAME_DT = 1 / 60;
const DEG = Math.PI / 180;
const KMH = 3.6;
const SLOPE = Math.tan(GLIDE_SLOPE_DEG * DEG);

const r = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Simple pilot helpers producing analog inputs in the model's -1..1 range. */
const pilot = (fm, input) => ({
  pitchTo(target) {
    input.pitch = Math.max(-1, Math.min(1, (target - fm.pitch) * 6 - fm.pitchRate * 1.5));
  },
  throttleTo(target) {
    input.throttle = Math.max(-1, Math.min(1, (target - fm.throttleLever) * 8));
  },
});

/** Steps the model until `tick` returns true or maxTime elapses. */
function fly(fm, maxTime, tick) {
  const input = { pitch: 0, roll: 0, throttle: 0, brake: 0 };
  const p = pilot(fm, input);
  let t = 0;
  while (t < maxTime) {
    if (tick(t, input, p)) break;
    fm.update(FRAME_DT, input);
    t += FRAME_DT;
  }
  return t;
}

/** Puts flaps at a detent instantly (no transit). */
function flapsNow(fm, index) {
  fm.setFlapIndex(index);
  fm.flapDeg = fm.flapTargetDeg;
  fm.flaps = fm.flapsTarget;
}

/** Sets lever and engine power instantly (no spool-up). */
function powerNow(fm, v) {
  fm.setThrottleLever(v);
  fm.engine.power = fm.throttle = v;
}

function airborneAt(fm, x, alt, speed, opts = {}) {
  fm.reset(x);
  fm.y = alt;
  fm.vx = speed;
  fm.onGround = false;
  fm.gear = fm.gearTarget = opts.gear ?? 0;
  flapsNow(fm, opts.flaps ?? 0);
  powerNow(fm, opts.throttle ?? 0.7);
  fm.pitch = opts.pitch ?? 0.02;
}

// ------------------------------------------------------------------ scenarios

const scenarios = {
  /** Full-power takeoff from the runway start, rotating at ~100 km/h. */
  takeoff() {
    const fm = new FlightModel();
    fm.reset(START_X);
    let liftoff = null;
    let x15 = null;
    const t = fly(fm, 90, (t, input, p) => {
      p.throttleTo(1);
      if (fm.airspeed > 28) p.pitchTo(9 * DEG);
      else input.pitch = 0;
      if (!liftoff && !fm.onGround && fm.y > 0.3) liftoff = { t, x: fm.x, v: fm.airspeed };
      if (fm.y >= 15) {
        x15 = fm.x;
        return true;
      }
      return false;
    });
    return {
      liftoffGroundRollM: r(liftoff.x - START_X, 1),
      liftoffSpeedKmh: r(liftoff.v * KMH, 1),
      liftoffTimeS: r(liftoff.t, 2),
      distanceTo15mM: r(x15 - START_X, 1),
      timeTo15mS: r(t, 2),
      runwayRemainingAt15mM: r(BTS_RUNWAY.x1 - x15, 1),
    };
  },

  /** Full-power climb at 8° pitch, gear up, from 50 m to 300 m. */
  climb() {
    const fm = new FlightModel();
    airborneAt(fm, 1000, 50, 45, { throttle: 1, pitch: 8 * DEG });
    let t50 = null;
    let speeds = 0;
    let n = 0;
    const t = fly(fm, 240, (t, input, p) => {
      p.throttleTo(1);
      p.pitchTo(8 * DEG);
      if (t50 === null && t > 5) t50 = { t, y: fm.y };
      if (t50) {
        speeds += fm.airspeed;
        n++;
      }
      return fm.y >= 300;
    });
    return {
      climbRateMs: r((fm.y - t50.y) / (t - t50.t), 2),
      climbSpeedKmh: r((speeds / n) * KMH, 1),
      timeTo300mS: r(t, 1),
    };
  },

  /** Level cruise at 350 m with 70 % power; values after 90 s of settling. */
  cruise() {
    const fm = new FlightModel();
    airborneAt(fm, 3000, 350, 55, { throttle: 0.7 });
    fly(fm, 120, (t, input, p) => {
      p.throttleTo(0.7);
      p.pitchTo((350 - fm.y) * 0.002 - fm.vy * 0.01 + 0.5 * DEG);
      return false;
    });
    return {
      speedKmh: r(fm.airspeed * KMH, 1),
      pitchDeg: r(fm.pitch / DEG, 2),
      aoaDeg: r(fm.aoa / DEG, 2),
      altitudeM: r(fm.y, 1),
      verticalSpeedMs: r(fm.vy, 2),
    };
  },

  /** Idle power, full nose-up, clean: first stall and altitude lost. */
  stallClean() {
    return stall(0);
  },

  /** Same with full flaps. */
  stallFlaps() {
    return stall(3);
  },

  /** Nose down at full power: speed builds past Vne and the overspeed flag must trip. */
  dive() {
    const fm = new FlightModel();
    airborneAt(fm, 3000, 900, 55, { throttle: 1 });
    let vmax = 0;
    let overspeedAt = null;
    fly(fm, 25, (t, input, p) => {
      p.throttleTo(1);
      p.pitchTo(-20 * DEG);
      vmax = Math.max(vmax, fm.airspeed);
      if (overspeedAt === null && fm.overspeed) overspeedAt = { t, v: fm.airspeed };
      return fm.y < 50;
    });
    return {
      maxSpeedKmh: r(vmax * KMH, 1),
      altitudeLostM: r(900 - fm.y, 1),
      overspeedAfterS: overspeedAt && r(overspeedAt.t, 2),
      overspeedAtKmh: overspeedAt && r(overspeedAt.v * KMH, 1),
    };
  },

  /** Takeoff mass matters: empty-ish vs. near MTOW. */
  takeoffLight() {
    return takeoffRun({ passengers: 0, baggageKg: 0, fuelKg: 60 });
  },
  takeoffHeavy() {
    return takeoffRun({ passengers: 2, baggageKg: 20, fuelKg: 160 });
  },

  /** Default load with 10° flaps: shorter ground roll. */
  takeoffFlaps10() {
    return takeoffRun(DEFAULT_LOAD, 1);
  },

  /** Lowest speed at which full aft stick lifts the nose wheel (elevator authority vs. weight). */
  rotation() {
    const fm = new FlightModel();
    fm.reset(START_X);
    let noseUp = null;
    fly(fm, 60, (t, input, p) => {
      p.throttleTo(1);
      input.pitch = fm.airspeed > 10 ? 1 : 0;
      if (fm.pitch > 0.01) noseUp = fm.airspeed;
      return noseUp !== null;
    });
    return { noseWheelLiftsAtKmh: r(noseUp * KMH, 1) };
  },

  /** Load sheet: limits are enforced. */
  loadSheet() {
    const ok = computeLoadSheet(C172RG, DEFAULT_LOAD);
    const full = computeLoadSheet(C172RG, { passengers: 3, baggageKg: 40, fuelKg: 168 });
    const tooMany = computeLoadSheet(C172RG, { passengers: 4, baggageKg: 0, fuelKg: 50 });
    return {
      defaultMassKg: ok.massKg,
      defaultProblems: ok.problems.length,
      fullCabinFullFuelKg: full.massKg,
      fullCabinFullFuelProblems: full.problems.join(' '),
      fourPassengersProblems: tooMany.problems.length,
    };
  },

  /** Engine: start time and power following the lever. */
  engine() {
    const fm = new FlightModel();
    fm.reset(START_X, false);
    fm.engine.start();
    let running = null;
    let p90 = null;
    fly(fm, 20, (t, input) => {
      input.brake = 1;
      if (running === null && fm.engine.state === 'running') {
        running = t;
        fm.setThrottleLever(1);
      }
      if (running !== null && p90 === null && fm.throttle >= 0.9) p90 = t - running;
      return p90 !== null;
    });
    return { startTimeS: r(running, 2), idleTo90PercentS: r(p90, 2), movedWhileBraked: fm.x - START_X > 0.5 };
  },

  /** Scripted BTS → VIE mission (same pilot as scripts/simulate.ts), scored with Landing.ts. */
  mission() {
    return mission();
  },

  /** Steep final at −5 m/s with gear down: must be a crash verdict. */
  hardLanding() {
    return forcedTouchdown({ vy: -5, gear: 1 });
  },

  /** Normal descent rate but gear up: must be a crash verdict. */
  gearUpLanding() {
    return forcedTouchdown({ vy: -1, gear: 0 });
  },

  /** Ground roll from 100 km/h at idle (auto-brake): stopping distance. */
  braking() {
    const fm = new FlightModel();
    fm.reset(VIE_RUNWAY.x0 + 300);
    fm.vx = 100 / KMH;
    flapsNow(fm, 3);
    const x0 = fm.x;
    const t = fly(fm, 60, (t, input, p) => {
      p.throttleTo(0);
      input.pitch = -1;
      return fm.airspeed < 0.3;
    });
    return { stopDistanceM: r(fm.x - x0, 1), stopTimeS: r(t, 2) };
  },

  /** Full right stick for 2 s, then release: bank reached and wing-leveler recovery. */
  roll() {
    const fm = new FlightModel();
    airborneAt(fm, 3000, 350, 55, { throttle: 0.7 });
    let bankAt2s = null;
    let leveledAt = null;
    fly(fm, 20, (t, input, p) => {
      p.pitchTo(0.5 * DEG);
      input.roll = t < 2 ? 1 : 0;
      if (t >= 2 && bankAt2s === null) bankAt2s = fm.roll;
      if (t > 2 && leveledAt === null && Math.abs(fm.roll) < 2 * DEG) leveledAt = t - 2;
      return leveledAt !== null;
    });
    return { bankAt2sDeg: r(bankAt2s / DEG, 1), levelAfterReleaseS: r(leveledAt, 2) };
  },

  /** 120 s level cruise in moderate gusty air (no storms): how much the aircraft is thrown around. */
  gusts() {
    const fm = new FlightModel();
    fm.weather = new Weather({ seed: 4242, storms: false, turbulence: 0.6, windKt: 12, windDir: 310 });
    airborneAt(fm, 3000, 350, 55, { throttle: 0.7 });
    let minY = Infinity;
    let maxY = -Infinity;
    let maxRoll = 0;
    let maxVs = 0;
    fly(fm, 120, (t, input, p) => {
      p.throttleTo(0.7);
      p.pitchTo((350 - fm.y) * 0.002 - fm.vy * 0.01 + 0.5 * DEG);
      if (t > 10) {
        minY = Math.min(minY, fm.y);
        maxY = Math.max(maxY, fm.y);
        maxRoll = Math.max(maxRoll, Math.abs(fm.roll));
        maxVs = Math.max(maxVs, Math.abs(fm.vy));
      }
      return false;
    });
    return {
      altitudeBandM: r(maxY - minY, 1),
      maxBankDeg: r(maxRoll / DEG, 1),
      maxVerticalSpeedMs: r(maxVs, 2),
      maxLoadFactor: r(fm.maxLoadFactor, 2),
      groundSpeedKmh: r(fm.groundSpeed * KMH, 1),
    };
  },

  /** Level flight at 350 m straight through a severe cell, fast and slowed down. */
  stormFast() {
    return stormPenetration(61);
  },
  stormSlow() {
    return stormPenetration(44);
  },

  /** 280 km/h, then full aft stick: over-g must damage or break the airframe. */
  pullout() {
    const fm = new FlightModel();
    airborneAt(fm, 3000, 800, 280 / KMH, { throttle: 0.7, pitch: -0.1 });
    const t = fly(fm, 8, (t, input) => {
      input.pitch = 1;
      return fm.structuralFailure !== null;
    });
    return {
      maxLoadFactor: r(fm.maxLoadFactor, 2),
      damage: r(fm.damage, 2),
      failed: fm.structuralFailure !== null,
      timeS: r(t, 2),
    };
  },
};

function stormPenetration(speed) {
  const fm = new FlightModel();
  const w = new Weather({ seed: 99, storms: false, turbulence: 0.4, windKt: 6, windDir: 310 });
  w.storms.push({ x0: 5000, drift: 0, radius: 950, base: 320, top: 1250, severity: 'severe', downdraft: 7.5, turbulence: 2.6 });
  fm.weather = w;
  const power = speed > 50 ? 0.95 : 0.45;
  airborneAt(fm, 3200, 350, speed, { throttle: power });
  let minY = Infinity;
  let maxV = 0;
  fly(fm, 120, (t, input, p) => {
    p.throttleTo(power);
    p.pitchTo((350 - fm.y) * 0.002 - fm.vy * 0.01 + 1 * DEG);
    minY = Math.min(minY, fm.y);
    maxV = Math.max(maxV, fm.airspeed);
    return fm.x > 6800 || fm.structuralFailure !== null;
  });
  return {
    altitudeLostM: r(350 - minY, 1),
    maxLoadFactor: r(fm.maxLoadFactor, 2),
    maxAirspeedKmh: r(maxV * KMH, 1),
    damage: r(fm.damage, 2),
    failure: fm.structuralFailure,
  };
}

/**
 * 1 g stall: idle power, hold altitude until the wing stalls, keep full aft stick for 3 s,
 * then release the stick (the nose must drop on its own), add full power and climb away.
 */
function stall(flapIndex) {
  const fm = new FlightModel();
  airborneAt(fm, 3000, 600, 45, { throttle: 0, flaps: flapIndex, pitch: 0.05 });
  let entry = null;
  let releasedAt = null;
  let unstalledAt = null;
  let stalledAfterHold = null;
  let lowest = Infinity;
  const t = fly(fm, 90, (t, input, p) => {
    if (!entry) {
      p.throttleTo(0);
      input.pitch = Math.max(-1, Math.min(1, -fm.vy * 0.8 - fm.pitchRate));
      if (fm.stalled) entry = { t, v: fm.airspeed, y: fm.y };
      return false;
    }
    lowest = Math.min(lowest, fm.y);
    if (releasedAt === null) {
      input.pitch = 1;
      if (t >= entry.t + 3) {
        stalledAfterHold = fm.stalled;
        releasedAt = t;
      }
      return false;
    }
    if (unstalledAt === null) {
      input.pitch = 0;
      if (!fm.stalled) unstalledAt = t;
      return t > releasedAt + 10;
    }
    p.throttleTo(1);
    p.pitchTo(5 * DEG);
    return fm.vy > 0 && t > unstalledAt + 1;
  });
  return {
    stallSpeedKmh: r(entry.v * KMH, 1),
    stalledAfter3sFullAft: stalledAfterHold,
    unstallsWithNeutralStickS: unstalledAt === null ? null : r(unstalledAt - releasedAt, 2),
    altitudeLostM: r(entry.y - lowest, 1),
    recoveryTimeS: r(t - entry.t, 1),
  };
}

/** Full-power takeoff roll with a given load and flap setting; rotation at 100 km/h. */
function takeoffRun(load, flapIndex = 0) {
  const fm = new FlightModel(C172RG, load);
  fm.reset(START_X);
  flapsNow(fm, flapIndex);
  let liftoff = null;
  let x15 = null;
  fly(fm, 120, (t, input, p) => {
    p.throttleTo(1);
    if (fm.airspeed * KMH > C172RG.limits.vrKmh) p.pitchTo(9 * DEG);
    else input.pitch = 0;
    if (!liftoff && !fm.onGround && fm.y > 0.3) liftoff = { x: fm.x, v: fm.airspeed };
    if (fm.y >= 15) x15 = fm.x;
    return x15 !== null;
  });
  return {
    massKg: fm.mass,
    groundRollM: r(liftoff.x - START_X, 1),
    liftoffSpeedKmh: r(liftoff.v * KMH, 1),
    distanceTo15mM: r(x15 - START_X, 1),
  };
}

function forcedTouchdown({ vy, gear }) {
  const fm = new FlightModel();
  airborneAt(fm, VIE_RUNWAY.x0 + 350, 0.15, 32, { gear, flaps: 3, throttle: 0, pitch: 0.06 });
  fm.vy = vy;
  let td = null;
  fly(fm, 10, (t, input, p) => {
    p.throttleTo(0);
    input.pitch = 0;
    if (fm.touchdown) {
      td = fm.touchdown;
      return true;
    }
    return false;
  });
  const verdict = evaluateTouchdown(td, VIE_RUNWAY);
  return { touchdownVsMs: r(-td.verticalSpeed, 2), crash: verdict.crash !== null, verdict: verdict.crash ?? 'landed' };
}

function mission() {
  const fm = new FlightModel();
  fm.reset(START_X);
  let phase = 'takeoff';
  let td = null;
  let liftoffX = 0;
  let maxAlt = 0;
  const events = [];
  const t = fly(fm, 600, (t, input, p) => {
    const V = fm.airspeed;
    if (phase === 'takeoff') {
      p.throttleTo(1);
      if (V > 28) p.pitchTo(9 * DEG);
      else input.pitch = 0;
      if (!fm.onGround && fm.y > 3) {
        liftoffX = fm.x;
        phase = 'climb';
      }
    } else if (phase === 'climb') {
      p.throttleTo(1);
      p.pitchTo(8 * DEG);
      if (fm.y > 15 && fm.gearTarget > 0.5) fm.toggleGear();
      if (fm.y > 330) phase = 'cruise';
    } else if (phase === 'cruise') {
      p.throttleTo(0.7);
      p.pitchTo((350 - fm.y) * 0.002 - fm.vy * 0.01 + 0.5 * DEG);
      if ((AIM_POINT_X - fm.x) * SLOPE < fm.y) {
        phase = 'descent';
        events.push(['descent', r(fm.x, 0)]);
      }
    } else if (phase === 'descent') {
      const targetAlt = (AIM_POINT_X - fm.x) * SLOPE;
      const targetVs = -fm.vx * SLOPE;
      p.pitchTo((targetAlt - fm.y) * 0.004 + (targetVs - fm.vy) * 0.02 + 1 * DEG);
      const targetSpeed = AIM_POINT_X - fm.x < 3000 ? 32 : 45;
      p.throttleTo(0.35 + (targetSpeed - V) * 0.08);
      if (AIM_POINT_X - fm.x < 4500 && fm.gearTarget < 0.5) fm.toggleGear();
      if (AIM_POINT_X - fm.x < 3200 && fm.flapIndex < 3) fm.setFlapIndex(3);
      if (fm.y < 7) phase = 'flare';
    } else if (phase === 'flare') {
      p.throttleTo(0);
      p.pitchTo(6 * DEG);
    } else if (phase === 'rollout') {
      p.throttleTo(0);
      input.pitch = -1;
      if (V < 0.3) return true;
    }
    maxAlt = Math.max(maxAlt, fm.y);
    if (fm.touchdown) {
      td = { ...fm.touchdown };
      fm.touchdown = null;
      phase = 'rollout';
    }
    return false;
  });
  const verdict = evaluateTouchdown(td, VIE_RUNWAY);
  const report = verdict.crash ? null : buildReport(verdict.items, fm.x > VIE_RUNWAY.x1, td.pitch > 0.23);
  return {
    liftoffX: r(liftoffX, 0),
    maxAltitudeM: r(maxAlt, 0),
    topOfDescentX: events[0]?.[1] ?? null,
    touchdownPastThresholdM: r(td.x - VIE_RUNWAY.x0, 0),
    touchdownVsMs: r(-td.verticalSpeed, 2),
    touchdownSpeedKmh: r(td.groundSpeed * KMH, 1),
    rolloutM: r(fm.x - td.x, 0),
    stoppedX: r(fm.x, 0),
    totalTimeS: r(t, 1),
    crash: verdict.crash,
    score: report?.total ?? 0,
    grade: report?.grade ?? '',
  };
}

// ------------------------------------------------------------------ runner

const results = {};
for (const [name, run] of Object.entries(scenarios)) results[name] = run();

// Determinism: the mission must reproduce bit-for-bit.
const again = mission();
const deterministic = JSON.stringify(again) === JSON.stringify(results.mission);

const update = process.argv.includes('--update');
const meta = { recordedWith: 'FlightModel (Phase 2: weather, storms, roll axis, structural limits)', frameDt: FRAME_DT };

if (update || !fs.existsSync(BASELINE_FILE)) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({ meta, results }, null, 2) + '\n');
  console.log(`Baseline written to ${path.relative(process.cwd(), BASELINE_FILE)}`);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).results;
let failures = 0;
const REL_TOL = 0.005;
const ABS_TOL = 0.011;

for (const [name, metrics] of Object.entries(results)) {
  console.log(`\n${name}`);
  for (const [key, value] of Object.entries(metrics)) {
    const expected = baseline[name]?.[key];
    let ok;
    if (typeof value === 'number' && typeof expected === 'number') {
      ok = Math.abs(value - expected) <= Math.max(ABS_TOL, Math.abs(expected) * REL_TOL);
    } else {
      ok = JSON.stringify(value) === JSON.stringify(expected);
    }
    if (!ok) failures++;
    const shown = typeof value === 'string' && value.length > 60 ? value.slice(0, 57) + '…' : value;
    console.log(`  ${ok ? 'ok  ' : 'DIFF'} ${key.padEnd(26)} ${String(shown).padStart(12)}${ok ? '' : `   (baseline ${expected})`}`);
  }
}

console.log(`\ndeterministic mission replay: ${deterministic ? 'yes' : 'NO'}`);
if (!deterministic) failures++;
console.log(failures ? `\n${failures} metric(s) differ from the baseline.` : '\nAll metrics match the baseline.');
process.exitCode = failures ? 1 : 0;
