/**
 * Headless flight check: flies a scripted pilot from BTS to VIE with the real flight model
 * and prints key events. Run with: npm run simulate
 */
import { FlightModel } from '../src/sim/FlightModel.ts';

const VIE_X0 = 11500;
const AIM = VIE_X0 + 300;
const SLOPE = Math.tan((3.5 * Math.PI) / 180);

const fm = new FlightModel();
fm.reset(140);
const input = { pitch: 0, throttle: 0, brake: 0 };
let t = 0;
let phase = 'takeoff';
let lastLog = -10;
let liftoffX = 0;
const dt = 1 / 60;

const log = (msg: string) =>
  console.log(
    `${t.toFixed(1).padStart(6)}s x=${fm.x.toFixed(0).padStart(6)} alt=${fm.y.toFixed(1).padStart(6)} ` +
      `V=${(fm.airspeed * 3.6).toFixed(0).padStart(4)}km/h vs=${fm.vy.toFixed(2).padStart(6)} ` +
      `pitch=${((fm.pitch * 180) / Math.PI).toFixed(1).padStart(5)} aoa=${((fm.aoa * 180) / Math.PI).toFixed(1).padStart(5)} ` +
      `thr=${(fm.throttle * 100).toFixed(0).padStart(3)}% ${phase} ${msg}`,
  );

const pitchTo = (target: number) => {
  const err = target - fm.pitch;
  input.pitch = Math.max(-1, Math.min(1, err * 6 - fm.pitchRate * 1.5));
};
const throttleTo = (target: number) => {
  input.throttle = Math.max(-1, Math.min(1, (target - fm.throttleLever) * 8));
};

while (t < 600) {
  const V = fm.airspeed;
  const deg = Math.PI / 180;
  if (phase === 'takeoff') {
    throttleTo(1);
    if (V > 28) pitchTo(9 * deg);
    else input.pitch = 0;
    if (!fm.onGround && fm.y > 3) {
      liftoffX = fm.x;
      phase = 'climb';
      log('LIFTOFF');
    }
  } else if (phase === 'climb') {
    throttleTo(1);
    pitchTo(8 * deg);
    if (fm.y > 15 && fm.gearTarget > 0.5) fm.toggleGear();
    if (fm.y > 330) phase = 'cruise';
  } else if (phase === 'cruise') {
    throttleTo(0.7);
    pitchTo((350 - fm.y) * 0.002 - fm.vy * 0.01 + 0.5 * deg);
    if ((AIM - fm.x) * SLOPE < fm.y) phase = 'descent';
  } else if (phase === 'descent') {
    const targetAlt = (AIM - fm.x) * SLOPE;
    const targetVs = -fm.vx * SLOPE;
    pitchTo((targetAlt - fm.y) * 0.004 + (targetVs - fm.vy) * 0.02 + 1 * deg);
    const targetSpeed = AIM - fm.x < 3000 ? 32 : 45;
    throttleTo(0.35 + (targetSpeed - V) * 0.08);
    if (AIM - fm.x < 4500 && fm.gearTarget < 0.5) {
      fm.toggleGear();
      log('GEAR DOWN');
    }
    if (AIM - fm.x < 3200 && fm.flapIndex < 3) {
      fm.setFlapIndex(3);
      log('FLAPS DOWN');
    }
    if (fm.y < 7) phase = 'flare';
  } else if (phase === 'flare') {
    throttleTo(0);
    pitchTo(6 * deg);
  } else if (phase === 'rollout') {
    throttleTo(0);
    input.pitch = -1;
    if (V < 0.5) {
      log('STOPPED');
      break;
    }
  }

  fm.update(dt, input);
  t += dt;

  if (fm.touchdown) {
    const td = fm.touchdown;
    fm.touchdown = null;
    log(
      `TOUCHDOWN at ${(td.x - VIE_X0).toFixed(0)} m past threshold, vs=${td.verticalSpeed.toFixed(2)} m/s, ` +
        `gs=${(td.groundSpeed * 3.6).toFixed(0)} km/h`,
    );
    phase = 'rollout';
  }
  if (fm.stalled) log('STALL');
  if (t - lastLog > 10) {
    lastLog = t;
    log('');
  }
}
console.log(`Liftoff at x=${liftoffX.toFixed(0)} (runway start 0, end 2000). Max alt ${fm.maxAltitude.toFixed(0)} m`);
