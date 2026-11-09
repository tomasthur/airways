/**
 * Quick headless check: large jet on a short hop + speed-brake bleed-off.
 *   node scripts/jet-short-hop.mjs
 */
import { FlightModel } from '../src/sim/FlightModel.ts';
import { buildReport, evaluateTouchdown } from '../src/sim/Landing.ts';
import { A320 } from '../src/sim/aircraft/a320.ts';
import { A388 } from '../src/sim/aircraft/a388.ts';
import { B777 } from '../src/sim/aircraft/b777.ts';
import { plannedLoad } from '../src/sim/LoadSheet.ts';
import { corridorLayout, aimPointX } from '../src/meta/flightLength.ts';

/** Short hop used in the game (BTS↔VIE ≈ 49–56 km GC). */
const SHORT_HOP_KM = 55;

const FRAME_DT = 1 / 60;
const DEG = Math.PI / 180;
const KMH = 3.6;
const SLOPE = Math.tan(3.5 * DEG);

const r = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function pilot(fm, input) {
  return {
    pitchTo(target) {
      input.pitch = Math.max(-1, Math.min(1, (target - fm.pitch) * 5 - fm.pitchRate * 1.4));
    },
    throttleTo(target) {
      input.throttle = Math.max(-1, Math.min(1, (target - fm.throttleLever) * 6));
    },
  };
}

function flapsNow(fm, index) {
  fm.setFlapIndex(index);
  fm.flapDeg = fm.flapTargetDeg;
  fm.flaps = fm.flapsTarget;
}

function powerNow(fm, v) {
  fm.setThrottleLever(v);
  fm.engine.power = fm.throttle = v;
}

function airborneAt(fm, x, alt, speedMs, opts = {}) {
  fm.reset(x);
  fm.y = alt;
  fm.vx = speedMs;
  fm.onGround = false;
  fm.gear = fm.gearTarget = opts.gear ?? 0;
  flapsNow(fm, opts.flaps ?? 0);
  powerNow(fm, opts.throttle ?? 0.7);
  fm.pitch = opts.pitch ?? 0.02;
  fm.speedBrake = fm.speedBrakeTarget = 0;
}

/** Level-flight deceleration with/without speed brake. */
function decelTest(cfg, fromKmh, toKmh) {
  const fm = new FlightModel(cfg, plannedLoad(cfg, 0.6));
  const from = fromKmh / KMH;
  const to = toKmh / KMH;
  const run = (useSb) => {
    airborneAt(fm, 0, 800, from, { throttle: 0, gear: 0, flaps: 0 });
    const input = { pitch: 0, roll: 0, throttle: 0, brake: 0, speedBrake: useSb ? 1 : 0 };
    const p = pilot(fm, input);
    const x0 = fm.x;
    let t = 0;
    while (t < 180 && fm.airspeed > to) {
      p.throttleTo(0);
      input.speedBrake = useSb ? 1 : 0;
      p.pitchTo((800 - fm.y) * 0.003 - fm.vy * 0.02);
      fm.update(FRAME_DT, input);
      t += FRAME_DT;
    }
    return {
      ok: fm.airspeed <= to + 0.5,
      timeS: r(t, 1),
      distM: r(fm.x - x0, 0),
      endKmh: r(fm.airspeed * KMH, 0),
      meanDecelMs2: r((from ** 2 - fm.airspeed ** 2) / (2 * Math.max(1, fm.x - x0)), 2),
    };
  };
  return { clean: run(false), withSpeedBrake: run(true), hasSpeedBrake: !!cfg.speedBrake };
}

/** Full short-hop mission for a jet using the live corridor layout. */
function shortHop(cfg, fromIata, toIata, km = SHORT_HOP_KM) {
  const layout = corridorLayout(km, cfg.performance);
  const aim = aimPointX(layout);
  const dest = { code: toIata, designator: '29', x0: layout.destX0, x1: layout.destX1 };
  const lim = cfg.limits;
  const maxFlap = cfg.flaps.detents.length - 1;
  const vApp = lim.vrefKmh * 1.3;
  const cruiseAlt = layout.cruiseAltM;

  const fm = new FlightModel(cfg, plannedLoad(cfg, 0.55));
  fm.reset(0);
  flapsNow(fm, 1);

  const input = { pitch: 0, roll: 0, throttle: 0, brake: 0, speedBrake: 0 };
  const p = pilot(fm, input);

  let phase = 'takeoff';
  let t = 0;
  let td = null;
  let liftoffX = null;
  let maxAlt = 0;
  let usedSpeedBrake = false;
  let decelStart = null;
  let notes = [];

  const logNote = (msg) => notes.push(`${r(t, 0)}s ${msg}`);

  const holdAlt = (alt) => {
    // Jets are heavy / slow to pitch — use a stronger altitude tracker than the C172 script.
    const err = alt - fm.y;
    const targetPitch = Math.max(-4 * DEG, Math.min(8 * DEG, err * 0.012 - fm.vy * 0.035 + 1.2 * DEG));
    p.pitchTo(targetPitch);
  };

  while (t < 900) {
    const V = fm.airspeed;
    const kmh = V * KMH;
    const toAim = aim - fm.x;
    const pathAlt = Math.max(0, toAim * SLOPE);
    const onPath = fm.y + 40 >= pathAlt;
    maxAlt = Math.max(maxAlt, fm.y);

    if (phase === 'takeoff') {
      p.throttleTo(1);
      input.speedBrake = 0;
      if (kmh > lim.vrKmh) p.pitchTo(12 * DEG);
      else input.pitch = 0;
      if (!fm.onGround && fm.y > 5) {
        liftoffX = fm.x;
        phase = 'climb';
        logNote(`liftoff ${r(kmh, 0)} km/h`);
      }
    } else if (phase === 'climb') {
      p.throttleTo(1);
      input.speedBrake = 0;
      p.pitchTo(9 * DEG);
      if (fm.y > 25 && fm.gearTarget > 0.5) {
        fm.toggleGear();
        logNote('gear up');
      }
      if (fm.y > 100 && fm.flapIndex > 0) flapsNow(fm, 0);
      if (fm.y >= cruiseAlt - 25) {
        phase = 'cruise';
        logNote(`cruise ${cruiseAlt} m @ ${r(kmh, 0)} km/h`);
      }
    } else if (phase === 'cruise') {
      const slowDist = Math.max(0, (V ** 2 - (vApp / KMH) ** 2) / (2 * 0.85));
      const glideFromCruise = cruiseAlt / SLOPE;
      // Bleed speed in level flight before the 3.5° path, same idea as the in-game tip.
      if (kmh > vApp + 15 && toAim < glideFromCruise + slowDist + 2500) {
        phase = 'decel';
        decelStart = { t, kmh, x: fm.x, y: fm.y };
        logNote(`decel start ${r(kmh, 0)} km/h → ${r(vApp, 0)} (toAim ${r(toAim, 0)} m)`);
      } else {
        p.throttleTo(0.7);
        input.speedBrake = 0;
        holdAlt(cruiseAlt);
      }
    } else if (phase === 'decel') {
      p.throttleTo(0);
      // Drop the boards if we sink — lift first, then drag.
      const sinking = fm.y < cruiseAlt - 50 || fm.vy < -3;
      input.speedBrake = sinking ? 0 : 1;
      if (input.speedBrake) usedSpeedBrake = true;
      holdAlt(cruiseAlt);
      if (kmh <= vApp + 8) {
        phase = 'level';
        logNote(
          `decel done ${r(kmh, 0)} km/h in ${r(t - decelStart.t, 0)}s / ${r(fm.x - decelStart.x, 0)} m  alt ${r(fm.y, 0)} m`,
        );
      }
    } else if (phase === 'level') {
      // Stay level until we intercept the glide path from cruise altitude.
      const glideFromCruise = cruiseAlt / SLOPE;
      input.speedBrake = kmh > vApp + 20 ? 1 : 0;
      if (input.speedBrake) usedSpeedBrake = true;
      p.throttleTo(kmh < vApp - 15 ? 0.45 : 0.25);
      holdAlt(cruiseAlt);
      // Start down a little early so heavy jets aren't still at cruise height over the numbers.
      if (toAim <= glideFromCruise + 1200) {
        phase = 'descent';
        logNote(`TOD alt ${r(fm.y, 0)} m  toAim ${r(toAim, 0)} m`);
      }
    } else if (phase === 'descent') {
      // Once past the threshold, stop holding a fake 10 m shelf — go down to the runway.
      const overThreshold = fm.x >= dest.x0;
      // Bias slightly below the geometric path so we arrive lower over the threshold.
      const targetAlt = overThreshold ? Math.max(0, 14 - (fm.x - dest.x0) * 0.025) : Math.max(8, pathAlt * 0.92);
      const targetVs = overThreshold ? -1.6 : -Math.max(0.5, fm.vx) * SLOPE * 1.05;
      const pitchCmd = (targetAlt + (overThreshold ? 0 : 4) - fm.y) * 0.014 + (targetVs - fm.vy) * 0.06 + 1.5 * DEG;
      p.pitchTo(Math.max(-5 * DEG, Math.min(9 * DEG, pitchCmd)));
      const target = overThreshold || toAim < 3200 ? lim.vrefKmh * 1.05 : toAim < 5500 ? lim.vrefKmh * 1.18 : vApp;
      input.speedBrake = 0;
      if (!overThreshold && kmh > target + 40 && fm.y > targetAlt + 40) {
        p.throttleTo(0);
        input.speedBrake = 1;
        usedSpeedBrake = true;
      } else if (kmh < target - 12) {
        p.throttleTo(Math.min(0.8, 0.52 + ((target / KMH - V) * 0.15)));
      } else {
        p.throttleTo(overThreshold ? 0.18 : Math.max(0.28, Math.min(0.62, 0.45 + ((target / KMH - V) * 0.12))));
      }
      if (toAim < 5500 && fm.gearTarget < 0.5) {
        fm.toggleGear();
        logNote('gear down');
      }
      if (toAim < 4500 && fm.flapIndex < Math.min(2, maxFlap)) flapsNow(fm, Math.min(2, maxFlap));
      if (toAim < 3000 && fm.flapIndex < maxFlap) flapsNow(fm, maxFlap);
      if (fm.y < 25 && (toAim < 450 || overThreshold)) {
        phase = 'flare';
        logNote(`flare ${r(kmh, 0)} km/h  vs ${r(fm.vy, 2)} x=${r(fm.x - dest.x0, 0)}`);
      }
    } else if (phase === 'flare') {
      input.speedBrake = 0;
      p.throttleTo(fm.y > 8 ? 0.1 : 0);
      if (fm.vy < -2.4) p.pitchTo(7.5 * DEG);
      else if (fm.y > 14) p.pitchTo(3.5 * DEG);
      else p.pitchTo(5.5 * DEG);
      if (fm.x > aim + 350) p.pitchTo(Math.min(3 * DEG, fm.pitch + 0.02));
    } else if (phase === 'rollout') {
      p.throttleTo(0);
      input.pitch = -0.5;
      input.brake = 1;
      input.speedBrake = 0;
      if (V < 0.4) break;
    }

    fm.update(FRAME_DT, input);
    t += FRAME_DT;

    if (fm.touchdown) {
      td = { ...fm.touchdown };
      fm.touchdown = null;
      phase = 'rollout';
      logNote(`touchdown vs=${r(-td.verticalSpeed, 2)} m/s @ ${r(td.x - dest.x0, 0)} m past threshold`);
    }
    if (fm.structuralFailure) {
      notes.push(`FAIL ${fm.structuralFailure}`);
      break;
    }
    // Belly hit short of the airport — abort with context.
    if (!td && fm.onGround && phase !== 'takeoff' && phase !== 'rollout' && fm.x < dest.x0 - 50) {
      notes.push(`EARTH ${r(fm.x, 0)} m (dest ${dest.x0}) alt sunk in ${phase}`);
      break;
    }
  }

  const verdict = td ? evaluateTouchdown(td, dest, cfg) : { crash: 'No touchdown', items: [] };
  const overshoot = td ? td.x > dest.x1 : false;
  const onRunway = td ? td.x >= dest.x0 && td.x <= dest.x1 : false;
  const report = !verdict.crash && td ? buildReport(verdict.items, overshoot || fm.x > dest.x1, td.pitch > 0.23) : null;
  const ok = !!td && !verdict.crash && onRunway;

  return {
    aircraft: cfg.name,
    route: `${fromIata}→${toIata}`,
    km: r(km, 0),
    corridorKm: r((layout.destX0 - layout.originEnd) / 1000, 1),
    cruiseAltM: cruiseAlt,
    runwayM: layout.originEnd,
    liftoffX: liftoffX && r(liftoffX, 0),
    maxAltM: r(maxAlt, 0),
    usedSpeedBrake,
    touchdown: !!td,
    onRunway,
    pastThresholdM: td ? r(td.x - dest.x0, 0) : null,
    vsMs: td ? r(-td.verticalSpeed, 2) : null,
    tdKmh: td ? r(td.groundSpeed * KMH, 0) : null,
    stopped: phase === 'rollout' && fm.airspeed < 0.5,
    stoppedOnRunway: td ? fm.x >= dest.x0 && fm.x <= dest.x1 && fm.airspeed < 0.5 : false,
    crash: verdict.crash,
    score: report?.total ?? null,
    grade: report?.grade ?? null,
    timeS: r(t, 0),
    ok,
    notes,
  };
}

const craft = [
  ['A320', A320],
  ['B777', B777],
  ['A380', A388],
];

console.log('=== Speed-brake level decel (800 m, cruise→approach) ===');
for (const [label, cfg] of craft) {
  const from = cfg.performance.cruiseKmh;
  const to = Math.round(cfg.limits.vrefKmh * 1.3);
  const d = decelTest(cfg, from, to);
  console.log(
    `\n${label}  ${from}→${to} km/h  sb=${d.hasSpeedBrake}`,
  );
  console.log(`  clean:        ${d.clean.ok ? 'ok' : 'FAIL'}  ${d.clean.timeS}s  ${d.clean.distM} m  a=${d.clean.meanDecelMs2} m/s²`);
  console.log(`  speed brake:  ${d.withSpeedBrake.ok ? 'ok' : 'FAIL'}  ${d.withSpeedBrake.timeS}s  ${d.withSpeedBrake.distM} m  a=${d.withSpeedBrake.meanDecelMs2} m/s²`);
  const ratio = d.clean.distM / Math.max(1, d.withSpeedBrake.distM);
  console.log(`  brake helps ×${r(ratio, 2)} shorter`);
}

console.log('\n=== Short-hop landings (BTS→VIE) ===');
const results = [];
for (const [label, cfg] of craft) {
  const m = shortHop(cfg, 'BTS', 'VIE');
  results.push(m);
  console.log(
    `\n${label} ${m.route} ${m.km} km  cruise ${m.cruiseAltM} m  corridor ${m.corridorKm} km`,
  );
  console.log(
    `  ${m.ok ? 'PASS' : 'FAIL'}  onRw=${m.onRunway} crash=${m.crash ?? 'none'} grade=${m.grade ?? '—'} score=${m.score ?? '—'}`,
  );
  console.log(
    `  liftoff@${m.liftoffX}m  maxAlt ${m.maxAltM}m  vs ${m.vsMs} m/s  ${m.tdKmh} km/h  +${m.pastThresholdM}m/${m.runwayM}m  sb=${m.usedSpeedBrake}  t=${m.timeS}s`,
  );
  for (const n of m.notes) console.log(`    · ${n}`);
}

const failed = results.filter((m) => !m.ok);
console.log(`\n${failed.length ? `${failed.length} landing(s) failed` : 'All short-hop jet landings OK'}`);
process.exitCode = failed.length ? 1 : 0;
