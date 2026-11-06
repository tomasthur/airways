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
    input.throttle = Math.max(-1, Math.min(1, (target - fm.throttle) * 8));
  },
});

/** Steps the model until `tick` returns true or maxTime elapses. */
function fly(fm, maxTime, tick) {
  const input = { pitch: 0, throttle: 0 };
  const p = pilot(fm, input);
  let t = 0;
  while (t < maxTime) {
    if (tick(t, input, p)) break;
    fm.update(FRAME_DT, input);
    t += FRAME_DT;
  }
  return t;
}

function airborneAt(fm, x, alt, speed, opts = {}) {
  fm.reset(x);
  fm.y = alt;
  fm.vx = speed;
  fm.onGround = false;
  fm.gear = fm.gearTarget = opts.gear ?? 0;
  fm.flaps = fm.flapsTarget = opts.flaps ?? 0;
  fm.throttle = opts.throttle ?? 0.7;
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
    return stall(1);
  },

  /** Nose down at full power for 25 s: shows there is no overspeed limit today. */
  dive() {
    const fm = new FlightModel();
    airborneAt(fm, 3000, 900, 55, { throttle: 1 });
    let vmax = 0;
    fly(fm, 25, (t, input, p) => {
      p.throttleTo(1);
      p.pitchTo(-20 * DEG);
      vmax = Math.max(vmax, fm.airspeed);
      return fm.y < 50;
    });
    return { maxSpeedKmh: r(vmax * KMH, 1), altitudeLostM: r(900 - fm.y, 1) };
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
    fm.flaps = fm.flapsTarget = 1;
    const x0 = fm.x;
    const t = fly(fm, 60, (t, input, p) => {
      p.throttleTo(0);
      input.pitch = -1;
      return fm.airspeed < 0.3;
    });
    return { stopDistanceM: r(fm.x - x0, 1), stopTimeS: r(t, 2) };
  },
};

function stall(flaps) {
  const fm = new FlightModel();
  airborneAt(fm, 3000, 600, 45, { throttle: 0, flaps });
  let first = null;
  fly(fm, 60, (t, input, p) => {
    p.throttleTo(0);
    input.pitch = 1;
    if (!first && fm.stalled) first = { t, v: fm.airspeed, y: fm.y };
    return first !== null && t > first.t + 10;
  });
  return {
    stallSpeedKmh: r(first.v * KMH, 1),
    timeToStallS: r(first.t, 2),
    altitudeLost10sAfterM: r(first.y - fm.y, 1),
    stalledAfter10s: fm.stalled,
  };
}

function forcedTouchdown({ vy, gear }) {
  const fm = new FlightModel();
  airborneAt(fm, VIE_RUNWAY.x0 + 350, 0.15, 32, { gear, flaps: 1, throttle: 0, pitch: 0.06 });
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
      if (AIM_POINT_X - fm.x < 3200 && fm.flapsTarget < 0.5) fm.toggleFlaps();
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
const meta = { recordedWith: 'FlightModel (Prototype 01, 2D)', frameDt: FRAME_DT };

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
