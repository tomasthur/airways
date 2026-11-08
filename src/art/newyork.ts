/**
 * New York landmarks — Statue of Liberty, Manhattan towers, Brooklyn Bridge, skyline strip.
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

export function newyorkSprites(): SpriteSpec[] {
  return [
    { name: 'statue_liberty', w: 70, h: 140, ppm: 2.4, draw: drawLiberty },
    { name: 'empire_state', w: 44, h: 240, ppm: 1.7, draw: drawEmpire },
    { name: 'chrysler', w: 40, h: 200, ppm: 1.8, draw: drawChrysler },
    { name: 'brooklyn_bridge', w: 240, h: 80, ppm: 2.4, draw: drawBrooklynBridge },
    { name: 'manhattan_far', w: 600, h: 90, ppm: 1.45, draw: drawManhattanFar },
    { name: 'nyc_block', w: 180, h: 48, ppm: 2.4, draw: (ctx, r) => drawNycBlock(ctx, r) },
    { name: 'one_wtc', w: 36, h: 260, ppm: 1.6, draw: drawOneWtc },
  ];
}

function drawLiberty(ctx: Ctx): void {
  // Pedestal
  rect(ctx, 18, 0, 34, 28, '#8a8580');
  rect(ctx, 14, 28, 42, 8, '#9a9590');
  // Robe
  poly(ctx, [22, 36, 48, 36, 52, 90, 35, 100, 18, 90], '#4a8a6a');
  // Arm + torch
  rect(ctx, 48, 78, 6, 28, '#4a8a6a');
  rect(ctx, 46, 104, 10, 8, '#d4a017');
  circle(ctx, 51, 116, 5, '#f0d060');
  // Head + crown
  circle(ctx, 35, 108, 8, '#6aaa7a');
  for (let i = -2; i <= 2; i++) {
    poly(ctx, [35 + i * 5, 114, 35 + i * 5 + 2, 114, 35 + i * 3, 126], '#6aaa7a');
  }
  ellipse(ctx, 35, 4, 28, 4, '#3a6b8c');
}

function drawEmpire(ctx: Ctx): void {
  const body = '#9aa4b0';
  rect(ctx, 8, 0, 28, 160, hgrad(ctx, 8, 36, [[0, shade(body, -0.1)], [1, body]]));
  rect(ctx, 12, 160, 20, 40, shade(body, 0.05));
  rect(ctx, 16, 200, 12, 28, shade(body, 0.1));
  rect(ctx, 20, 228, 4, 12, '#d0d8e0');
  windows(ctx, 10, 10, 24, 140, 3, 16, 3, 5, '#2a3038');
  windows(ctx, 14, 168, 16, 28, 2, 4, 3, 4, '#2a3038');
}

function drawChrysler(ctx: Ctx): void {
  const body = '#b8c0c8';
  rect(ctx, 8, 0, 24, 130, body);
  // Famous crown arches
  for (let i = 0; i < 6; i++) {
    const y = 130 + i * 8;
    const inset = i * 1.5;
    rect(ctx, 8 + inset, y, 24 - inset * 2, 7, shade(body, 0.08 + i * 0.02));
    // sunburst lines
    for (let x = 10 + inset; x < 30 - inset; x += 3) {
      line(ctx, x, y + 1, x, y + 6, 0.6, '#e8eef4');
    }
  }
  rect(ctx, 18, 178, 4, 20, '#d0d8e0');
  windows(ctx, 10, 8, 20, 110, 3, 14, 3, 5, '#2a3038');
}

function drawOneWtc(ctx: Ctx): void {
  poly(ctx, [4, 0, 32, 0, 34, 230, 18, 255, 2, 230], vgrad(ctx, 0, 255, [[0, '#6a7a88'], [0.6, '#a8b4c0'], [1, '#d8e0e8']]));
  for (let y = 12; y < 220; y += 10) line(ctx, 6, y, 30, y, 0.35, 'rgba(255,255,255,0.2)');
}

function drawBrooklynBridge(ctx: Ctx): void {
  const W = 240;
  rect(ctx, 0, 0, W, 6, '#3a6b8c');
  // Stone towers
  for (const x of [50, 160]) {
    rect(ctx, x, 6, 28, 50, '#8a8580');
    // Gothic arches
    ctx.fillStyle = '#3a6b8c';
    ctx.beginPath();
    ctx.moveTo(x + 4, 6);
    ctx.lineTo(x + 4, 28);
    ctx.quadraticCurveTo(x + 14, 42, x + 24, 28);
    ctx.lineTo(x + 24, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 4, 30);
    ctx.lineTo(x + 4, 48);
    ctx.quadraticCurveTo(x + 14, 58, x + 24, 48);
    ctx.lineTo(x + 24, 30);
    ctx.fill();
  }
  // Deck
  rect(ctx, 20, 28, 200, 5, '#5a5550');
  // Cables
  for (const [x0, x1] of [
    [64, 10],
    [64, 120],
    [174, 120],
    [174, 230],
  ] as const) {
    line(ctx, x0, 56, x1, 30, 1.1, '#4a4540');
  }
  // Suspenders
  for (let x = 70; x < 160; x += 8) line(ctx, x, 30, x, 48 - Math.abs(x - 115) * 0.12, 0.5, '#5a5550');
}

function drawManhattanFar(ctx: Ctx, r: Rand): void {
  const W = 600;
  rect(ctx, 0, 0, W, 10, '#3a6b8c');
  // Dense midtown massing
  for (let i = 0; i < 55; i++) {
    const x = 20 + r() * (W - 40);
    const h = 18 + r() * 70;
    const w = 5 + r() * 16;
    rect(ctx, x, 10, w, h, shade(r() < 0.4 ? '#5a6570' : '#8a96a4', r() * 0.12 - 0.04));
  }
  // Iconic spikes
  poly(ctx, [280, 10, 292, 10, 296, 95, 286, 98], '#a0aab4');
  poly(ctx, [340, 10, 350, 10, 352, 88, 344, 90], '#b0b8c0');
  poly(ctx, [200, 10, 214, 10, 216, 110, 207, 112], '#909aa4');
}

function drawNycBlock(ctx: Ctx, r: Rand): void {
  const W = 180;
  rect(ctx, 0, 0, W, 4, MID_GROUND);
  const h = 28 + r() * 16;
  rect(ctx, 0, 4, W, h, hgrad(ctx, 0, W, [[0, '#4a5560'], [1, '#6a7580']]));
  windows(ctx, 4, 10, W - 8, h - 8, 10, 4, 4, 5, '#c9d6e2');
  rect(ctx, 0, 4 + h, W, 2, '#2a3038');
}
