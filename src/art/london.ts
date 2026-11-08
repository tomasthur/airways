/**
 * London landmark billboards — Thames, Bridge, Big Ben, Eye, Shard, far skyline.
 */
import type { SpriteSpec } from './Atlas';
import {
  circle,
  ellipse,
  hgrad,
  line,
  poly,
  rect,
  shade,
  vgrad,
  windows,
  type Ctx,
  type Rand,
} from './paint';
import { MID_GROUND } from './countryside';

export function londonSprites(): SpriteSpec[] {
  return [
    { name: 'big_ben', w: 48, h: 160, ppm: 2.4, draw: drawBigBen },
    { name: 'tower_bridge', w: 200, h: 90, ppm: 2.6, draw: drawTowerBridge },
    { name: 'london_eye', w: 90, h: 90, ppm: 2.8, draw: drawLondonEye },
    { name: 'the_shard', w: 50, h: 220, ppm: 1.8, draw: drawShard },
    { name: 'st_pauls', w: 100, h: 90, ppm: 2.5, draw: drawStPauls },
    { name: 'london_far', w: 560, h: 70, ppm: 1.5, draw: drawLondonFar },
    { name: 'london_block', w: 200, h: 40, ppm: 2.5, draw: (ctx, r) => drawLondonBlock(ctx, r) },
  ];
}

function drawBigBen(ctx: Ctx): void {
  const stone = '#c9b896';
  rect(ctx, 0, 0, 48, 3, MID_GROUND);
  rect(ctx, 14, 3, 20, 95, hgrad(ctx, 14, 34, [[0, shade(stone, -0.1)], [1, stone]]));
  // Clock faces
  rect(ctx, 10, 98, 28, 28, shade(stone, 0.05));
  circle(ctx, 24, 112, 10, '#f4efe2');
  line(ctx, 24, 112, 24, 118, 1.2, '#2a2a2a');
  line(ctx, 24, 112, 30, 112, 1.2, '#2a2a2a');
  // Spire
  poly(ctx, [12, 126, 36, 126, 24, 158], '#8a7a5c');
  rect(ctx, 22, 150, 4, 8, '#5a4a32');
  windows(ctx, 16, 20, 16, 70, 2, 8, 3, 5, '#3a3530');
}

function drawTowerBridge(ctx: Ctx): void {
  const W = 200;
  rect(ctx, 0, 0, W, 6, '#3a6b8c');
  // Towers
  for (const x of [40, 140]) {
    rect(ctx, x, 6, 22, 55, hgrad(ctx, x, x + 22, [[0, '#6a7580'], [1, '#9aa4ae']]));
    rect(ctx, x - 2, 55, 26, 8, '#c9b896');
    poly(ctx, [x - 2, 63, x + 24, 63, x + 11, 78], '#8a7a5c');
    windows(ctx, x + 4, 16, 14, 36, 2, 5, 3, 4, '#2a3038');
  }
  // High walkways
  rect(ctx, 62, 58, 78, 4, '#7a858f');
  rect(ctx, 62, 48, 78, 3, '#7a858f');
  // Bascules
  rect(ctx, 62, 20, 78, 5, '#5a6570');
  // Cables hint
  line(ctx, 51, 55, 100, 22, 1.2, '#4a5560');
  line(ctx, 151, 55, 100, 22, 1.2, '#4a5560');
}

function drawLondonEye(ctx: Ctx): void {
  const cx = 45;
  const cy = 48;
  circle(ctx, cx, cy, 40, 'rgba(200,210,220,0.15)');
  ctx.strokeStyle = '#b0bcc8';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 38, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    line(ctx, cx, cy, cx + Math.cos(a) * 38, cy + Math.sin(a) * 38, 1, '#9aa8b4');
    circle(ctx, cx + Math.cos(a) * 38, cy + Math.sin(a) * 38, 3.2, '#dfe6ec');
  }
  // Legs
  line(ctx, cx, cy, 20, 4, 3, '#8a96a0');
  line(ctx, cx, cy, 70, 4, 3, '#8a96a0');
  rect(ctx, 10, 0, 70, 4, MID_GROUND);
}

function drawShard(ctx: Ctx): void {
  poly(ctx, [25, 0, 40, 0, 48, 200, 25, 215, 2, 200], vgrad(ctx, 0, 215, [[0, '#8fa4b8'], [0.5, '#c5d2de'], [1, '#e8eef4']]));
  line(ctx, 25, 10, 25, 200, 0.8, 'rgba(255,255,255,0.35)');
  for (let y = 20; y < 190; y += 14) {
    line(ctx, 8 + y * 0.05, y, 42 - y * 0.02, y, 0.4, 'rgba(40,50,60,0.25)');
  }
}

function drawStPauls(ctx: Ctx): void {
  const stone = '#d2c6a8';
  rect(ctx, 10, 0, 80, 4, MID_GROUND);
  rect(ctx, 18, 4, 64, 28, stone);
  // Dome
  ellipse(ctx, 50, 48, 28, 22, shade(stone, 0.08));
  rect(ctx, 44, 64, 12, 14, stone);
  ellipse(ctx, 50, 80, 8, 6, shade(stone, 0.05));
  poly(ctx, [46, 84, 54, 84, 50, 92], '#8a7a5c');
  windows(ctx, 24, 10, 52, 18, 5, 2, 4, 5, '#3a3530');
}

function drawLondonFar(ctx: Ctx, r: Rand): void {
  const W = 560;
  rect(ctx, 0, 0, W, 8, '#5a6a4a');
  for (let i = 0; i < 40; i++) {
    const x = r() * (W - 20);
    const h = 12 + r() * 48;
    const w = 6 + r() * 18;
    rect(ctx, x, 8, w, h, shade(r() < 0.5 ? '#6a7a88' : '#8a96a4', r() * 0.15 - 0.05));
  }
  // Shard spike hint
  poly(ctx, [420, 8, 432, 8, 436, 70, 426, 72], '#b0c0d0');
}

function drawLondonBlock(ctx: Ctx, r: Rand): void {
  const W = 200;
  rect(ctx, 0, 0, W, 4, MID_GROUND);
  rect(ctx, 0, 4, W, 32, hgrad(ctx, 0, W, [[0, '#6a7580'], [1, '#8a96a0']]));
  windows(ctx, 6, 10, 188, 22, 12, 3, 4, 4, r() < 0.5 ? '#c9d6e2' : '#3a4048');
}
