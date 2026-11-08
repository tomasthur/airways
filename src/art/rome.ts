/** Rome landmarks — Colosseum, St Peter's dome, Pantheon, Tiber cue. */
import type { SpriteSpec } from './Atlas';
import { circle, ellipse, hgrad, poly, rect, shade, windows, type Ctx, type Rand } from './paint';
import { MID_GROUND } from './countryside';

export function romeSprites(): SpriteSpec[] {
  return [
    { name: 'colosseum', w: 160, h: 70, ppm: 2.8, draw: drawColosseum },
    { name: 'st_peters', w: 110, h: 120, ppm: 2.4, draw: drawStPeters },
    { name: 'pantheon', w: 90, h: 60, ppm: 2.8, draw: drawPantheon },
    { name: 'rome_far', w: 520, h: 64, ppm: 1.5, draw: drawRomeFar },
  ];
}

function drawColosseum(ctx: Ctx): void {
  const W = 160;
  rect(ctx, 0, 0, W, 4, MID_GROUND);
  ellipse(ctx, 80, 18, 72, 16, '#3a6b8c');
  // Outer wall arc
  rect(ctx, 8, 8, W - 16, 42, hgrad(ctx, 8, W - 8, [[0, '#a89070'], [0.5, '#c4a882'], [1, '#8a7358']]));
  for (let tier = 0; tier < 3; tier++) {
    const y = 14 + tier * 12;
    for (let x = 16; x < W - 16; x += 10) {
      ctx.fillStyle = '#3a3028';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 8);
      ctx.quadraticCurveTo(x + 3.5, y + 11, x + 7, y + 8);
      ctx.lineTo(x + 7, y);
      ctx.fill();
    }
  }
  // Broken rim on right
  poly(ctx, [120, 50, W - 8, 50, W - 8, 30, 140, 42], 'rgba(40,30,20,0.35)');
}

function drawStPeters(ctx: Ctx): void {
  const stone = '#d8cbb0';
  rect(ctx, 10, 0, 90, 4, MID_GROUND);
  rect(ctx, 15, 4, 80, 36, stone);
  ellipse(ctx, 55, 56, 36, 28, shade(stone, 0.08));
  rect(ctx, 48, 78, 14, 18, stone);
  ellipse(ctx, 55, 98, 9, 7, shade(stone, 0.05));
  poly(ctx, [51, 104, 59, 104, 55, 116], '#8a7a5c');
  // Colonnade hint
  for (let x = 18; x < 92; x += 6) rect(ctx, x, 4, 2, 14, shade(stone, -0.08));
  windows(ctx, 25, 20, 60, 14, 6, 1, 4, 8, '#3a3530');
}

function drawPantheon(ctx: Ctx): void {
  const stone = '#cfc3a8';
  rect(ctx, 5, 0, 80, 4, MID_GROUND);
  rect(ctx, 10, 4, 70, 22, stone);
  // Portico columns
  for (let x = 14; x < 76; x += 9) rect(ctx, x, 4, 3.5, 22, shade(stone, -0.1));
  // Pediment
  poly(ctx, [8, 26, 82, 26, 45, 40], shade(stone, 0.05));
  // Dome behind
  ellipse(ctx, 45, 42, 28, 16, shade(stone, 0.08));
  circle(ctx, 45, 52, 4, '#2a2520');
}

function drawRomeFar(ctx: Ctx, r: Rand): void {
  const W = 520;
  rect(ctx, 0, 0, W, 8, '#6a7a50');
  for (let i = 0; i < 28; i++) {
    const x = r() * (W - 16);
    rect(ctx, x, 8, 8 + r() * 20, 10 + r() * 36, shade('#b8a888', r() * 0.15 - 0.05));
  }
  ellipse(ctx, 260, 48, 30, 20, '#d0c4a8');
}
