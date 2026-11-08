/** Paris landmarks — Eiffel Tower, Notre-Dame, Arc, Haussmann blocks, far skyline. */
import type { SpriteSpec } from './Atlas';
import { circle, hgrad, line, poly, rect, shade, windows, type Ctx, type Rand } from './paint';
import { MID_GROUND } from './countryside';

export function parisSprites(): SpriteSpec[] {
  return [
    { name: 'eiffel', w: 70, h: 200, ppm: 2.2, draw: drawEiffel },
    { name: 'notre_dame', w: 120, h: 90, ppm: 2.5, draw: drawNotreDame },
    { name: 'arc_triomphe', w: 70, h: 70, ppm: 2.8, draw: drawArc },
    { name: 'paris_far', w: 540, h: 60, ppm: 1.5, draw: drawParisFar },
    { name: 'paris_block', w: 200, h: 38, ppm: 2.5, draw: (ctx, r) => drawParisBlock(ctx, r) },
  ];
}

function drawEiffel(ctx: Ctx): void {
  const iron = '#6a5040';
  // Legs
  line(ctx, 8, 4, 28, 70, 3, iron);
  line(ctx, 62, 4, 42, 70, 3, iron);
  line(ctx, 8, 4, 62, 4, 2, iron);
  // Mid platforms
  rect(ctx, 22, 68, 26, 4, iron);
  line(ctx, 28, 72, 22, 120, 2.5, iron);
  line(ctx, 42, 72, 48, 120, 2.5, iron);
  rect(ctx, 24, 118, 22, 3, iron);
  // Spire
  line(ctx, 28, 120, 35, 195, 2, iron);
  line(ctx, 42, 120, 35, 195, 2, iron);
  // Lattice hint
  for (let y = 20; y < 180; y += 16) {
    line(ctx, 18 + y * 0.05, y, 52 - y * 0.05, y, 0.7, shade(iron, 0.15));
  }
  rect(ctx, 0, 0, 70, 4, MID_GROUND);
}

function drawNotreDame(ctx: Ctx): void {
  const stone = '#c4b9a0';
  rect(ctx, 10, 0, 100, 4, MID_GROUND);
  rect(ctx, 20, 4, 80, 40, stone);
  // Twin towers
  rect(ctx, 24, 44, 22, 36, stone);
  rect(ctx, 74, 44, 22, 36, stone);
  for (const x of [28, 78]) {
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#3a3530';
      ctx.beginPath();
      ctx.moveTo(x + i * 6, 50);
      ctx.lineTo(x + i * 6, 70);
      ctx.quadraticCurveTo(x + i * 6 + 2, 74, x + i * 6 + 4, 70);
      ctx.lineTo(x + i * 6 + 4, 50);
      ctx.fill();
    }
  }
  // Rose window
  circle(ctx, 60, 28, 10, '#3a4050');
  circle(ctx, 60, 28, 6, '#5a7088');
  poly(ctx, [30, 44, 90, 44, 60, 58], shade(stone, -0.05));
}

function drawArc(ctx: Ctx): void {
  const stone = '#d2c6a8';
  rect(ctx, 5, 0, 60, 4, MID_GROUND);
  rect(ctx, 8, 4, 54, 55, stone);
  // Arch opening
  ctx.fillStyle = '#2a3038';
  ctx.beginPath();
  ctx.moveTo(20, 4);
  ctx.lineTo(20, 35);
  ctx.quadraticCurveTo(35, 52, 50, 35);
  ctx.lineTo(50, 4);
  ctx.fill();
  rect(ctx, 8, 55, 54, 8, shade(stone, 0.08));
  // Attic sculpture band
  windows(ctx, 12, 58, 46, 4, 8, 1, 2, 2, shade(stone, -0.2));
}

function drawParisFar(ctx: Ctx, r: Rand): void {
  const W = 540;
  rect(ctx, 0, 0, W, 8, '#6a7a50');
  for (let i = 0; i < 35; i++) {
    const x = r() * (W - 14);
    rect(ctx, x, 8, 10 + r() * 18, 12 + r() * 32, shade('#c4a882', r() * 0.12));
  }
  // Eiffel spike
  line(ctx, 400, 8, 410, 58, 1.5, '#6a5040');
  line(ctx, 420, 8, 410, 58, 1.5, '#6a5040');
}

function drawParisBlock(ctx: Ctx, r: Rand): void {
  const W = 200;
  const cream = r() < 0.5 ? '#e8dcc0' : '#d4c4a0';
  rect(ctx, 0, 0, W, 4, MID_GROUND);
  rect(ctx, 0, 4, W, 28, hgrad(ctx, 0, W, [[0, shade(cream, -0.05)], [1, cream]]));
  rect(ctx, 0, 30, W, 6, '#6a5040'); // zinc roof hint
  windows(ctx, 6, 8, W - 12, 18, 10, 2, 4, 5, '#5a7088');
}
