/**
 * Over-water corridor sprites — Channel whitecaps, Atlantic swell, Med haze, ships.
 */
import type { SpriteSpec } from './Atlas';
import { circle, ellipse, hgrad, poly, rect, shade, vgrad, type Ctx, type Rand } from './paint';

export function seaSprites(): SpriteSpec[] {
  return [
    { name: 'channel_cliffs', w: 220, h: 56, ppm: 2.2, draw: drawChannelCliffs },
    { name: 'ferry', w: 90, h: 28, ppm: 3.5, draw: drawFerry },
    { name: 'cargo_ship', w: 120, h: 32, ppm: 3, draw: drawCargoShip },
    { name: 'atlantic_swell', w: 640, h: 48, ppm: 1.4, draw: drawAtlanticSwell },
    { name: 'sea_stack', w: 40, h: 52, ppm: 3, draw: drawSeaStack },
    { name: 'med_isle', w: 160, h: 40, ppm: 2.5, draw: drawMedIsle },
  ];
}

function drawChannelCliffs(ctx: Ctx): void {
  const W = 220;
  rect(ctx, 0, 0, W, 8, '#3a6b8c');
  poly(ctx, [0, 8, 40, 42, 70, 28, 110, 48, 150, 30, 190, 46, W, 22, W, 8], '#e8e0c8');
  poly(ctx, [0, 8, 40, 42, 70, 28, 110, 48, 150, 30, 190, 46, W, 22, W, 8], hgrad(ctx, 0, W, [[0, 'rgba(255,255,255,0.15)'], [1, 'rgba(0,0,0,0.12)']]));
  // Green top
  poly(ctx, [0, 42, 40, 48, 70, 34, 110, 52, 150, 36, 190, 50, W, 28, W, 56, 0, 56], '#5f7a45');
  for (let x = 10; x < W; x += 28) {
    rect(ctx, x, 4, 14, 3, 'rgba(255,255,255,0.35)');
  }
}

function drawFerry(ctx: Ctx, _r: Rand): void {
  const W = 90;
  rect(ctx, 4, 0, W - 8, 6, '#2a4a62');
  poly(ctx, [2, 6, W - 2, 6, W - 10, 14, 10, 14], '#f2f4f6');
  rect(ctx, 18, 14, 54, 8, '#dfe6ec');
  for (let x = 22; x < 68; x += 8) rect(ctx, x, 15.5, 4, 4, '#6a90b0');
  rect(ctx, 40, 22, 10, 5, '#c0392b');
  ellipse(ctx, 12, 4, 8, 2.5, 'rgba(255,255,255,0.45)');
  ellipse(ctx, 70, 3, 10, 2, 'rgba(255,255,255,0.35)');
}

function drawCargoShip(ctx: Ctx): void {
  const W = 120;
  rect(ctx, 6, 0, W - 12, 7, '#1f3a4d');
  poly(ctx, [4, 7, W - 4, 7, W - 14, 16, 14, 16], '#6b7278');
  for (let x = 18; x < 90; x += 14) {
    rect(ctx, x, 16, 12, 10, shade('#c45c26', (x % 28) / 80));
  }
  rect(ctx, 92, 16, 16, 14, '#d8dde2');
  rect(ctx, 96, 30, 6, 2, '#2c3e50');
}

function drawAtlanticSwell(ctx: Ctx, r: Rand): void {
  const W = 640;
  rect(ctx, 0, 0, W, 48, vgrad(ctx, 0, 48, [[0, '#1a3d55'], [0.55, '#2a5f7a'], [1, '#3d7a96']]));
  for (let i = 0; i < 18; i++) {
    const y = 6 + r() * 28;
    const x0 = r() * W;
    ctx.globalAlpha = 0.2 + r() * 0.25;
    ellipse(ctx, x0, y, 40 + r() * 60, 3 + r() * 4, '#e8f4fa');
  }
  ctx.globalAlpha = 1;
}

function drawSeaStack(ctx: Ctx): void {
  poly(ctx, [8, 0, 32, 0, 28, 40, 20, 52, 12, 40], '#7a7264');
  poly(ctx, [8, 0, 32, 0, 28, 40, 20, 52, 12, 40], hgrad(ctx, 8, 32, [[0, 'rgba(0,0,0,0.2)'], [1, 'rgba(255,255,255,0.1)']]));
  ellipse(ctx, 20, 4, 14, 3, '#3a6b8c');
}

function drawMedIsle(ctx: Ctx): void {
  const W = 160;
  rect(ctx, 0, 0, W, 10, '#3a7a9a');
  ellipse(ctx, 80, 12, 70, 10, '#c2b280');
  poly(ctx, [20, 14, 50, 34, 90, 28, 130, 36, 150, 18, 150, 14, 20, 14], '#6a8a4a');
  circle(ctx, 70, 30, 3, '#c4a574');
  circle(ctx, 100, 32, 2.5, '#c4a574');
}
