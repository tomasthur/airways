import type { Touchdown } from './FlightModel';
import type { Runway } from '../config';

export interface ScoreItem {
  label: string;
  value: string;
  score: number;
  max: number;
}

export interface LandingReport {
  success: boolean;
  title: string;
  message: string;
  total: number;
  grade: string;
  items: ScoreItem[];
}

export interface TouchdownVerdict {
  crash: string | null;
  items: ScoreItem[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

export function onRunway(x: number, rw: Runway): boolean {
  return x >= rw.x0 && x <= rw.x1;
}

/** Evaluates a touchdown on the destination runway. Returns a crash reason or the score breakdown. */
export function evaluateTouchdown(td: Touchdown, rw: Runway): TouchdownVerdict {
  const vs = -td.verticalSpeed;
  const kmh = td.groundSpeed * 3.6;
  const dist = td.x - rw.x0;

  if (vs > 4.5) return { crash: `Touchdown at ${vs.toFixed(1)} m/s was too hard – the landing gear collapsed.`, items: [] };
  if (td.gear < 0.95) return { crash: 'Gear-up landing! The aircraft slid down the runway on its belly.', items: [] };
  if (td.pitch < -0.05 && vs > 1.5) return { crash: 'Nose-first touchdown – the nose gear collapsed.', items: [] };

  let vsScore: number;
  if (vs <= 0.8) vsScore = 40;
  else if (vs <= 1.5) vsScore = lerp(40, 30, (vs - 0.8) / 0.7);
  else if (vs <= 3) vsScore = lerp(30, 8, (vs - 1.5) / 1.5);
  else vsScore = lerp(8, 0, (vs - 3) / 1.5);

  let speedScore: number;
  if (kmh >= 85 && kmh <= 115) speedScore = 25;
  else if (kmh > 115) speedScore = lerp(25, 0, (kmh - 115) / 55);
  else speedScore = lerp(25, 0, (85 - kmh) / 20);

  let alignScore: number;
  if (dist >= 150 && dist <= 600) alignScore = 25;
  else if (dist < 150) alignScore = lerp(15, 25, dist / 150);
  else if (dist <= 1200) alignScore = lerp(25, 8, (dist - 600) / 600);
  else alignScore = 4;

  return {
    crash: null,
    items: [
      { label: 'Touchdown rate', value: `${vs.toFixed(2)} m/s`, score: Math.round(vsScore), max: 40 },
      { label: 'Touchdown speed', value: `${kmh.toFixed(0)} km/h`, score: Math.round(speedScore), max: 25 },
      { label: 'Runway alignment', value: `${dist.toFixed(0)} m past threshold`, score: Math.round(alignScore), max: 25 },
      { label: 'Landing gear', value: 'Down & locked', score: 10, max: 10 },
    ],
  };
}

export function buildReport(items: ScoreItem[], overran: boolean, tailStrike: boolean): LandingReport {
  const list = items.slice();
  if (overran) list.push({ label: 'Runway excursion', value: 'Rolled past the runway end', score: -15, max: 0 });
  if (tailStrike) list.push({ label: 'Tail strike', value: 'Nose too high at touchdown', score: -10, max: 0 });
  const total = Math.max(0, Math.min(100, list.reduce((s, i) => s + i.score, 0)));
  let grade: string;
  if (total >= 90) grade = 'Butter! Captain material.';
  else if (total >= 75) grade = 'Smooth landing.';
  else if (total >= 55) grade = 'Firm, but safe.';
  else if (total >= 35) grade = 'Hard landing – passengers noticed.';
  else grade = 'Everyone walked away. Barely.';
  return {
    success: true,
    title: 'Welcome to Vienna',
    message: 'Flight OM-BTV has landed at Vienna International Airport.',
    total,
    grade,
    items: list,
  };
}

export function failureReport(title: string, message: string): LandingReport {
  return { success: false, title, message, total: 0, grade: '', items: [] };
}
