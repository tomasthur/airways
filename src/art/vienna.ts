import type { SpriteSpec } from './Atlas';
import { drawAirliner } from './bratislava';
import { MID_GROUND } from './countryside';
import {
  circle,
  ellipse,
  fillProfile,
  gothicWindow,
  hgrad,
  line,
  pick,
  poly,
  range,
  rect,
  roof,
  shade,
  text,
  treeCrown,
  vgrad,
  windows,
  type Ctx,
  type Rand,
} from './paint';

const HILLS_GROUND = '#7e9c50';
const COPPER = '#6a9c8a';

export function viennaSprites(): SpriteSpec[] {
  return [
    { name: 'stephansdom', w: 130, h: 140, ppm: 3, draw: drawStephansdom },
    { name: 'riesenrad', w: 76, h: 70, ppm: 3, draw: drawRiesenrad },
    { name: 'karlskirche', w: 90, h: 72, ppm: 3, draw: drawKarlskirche },
    { name: 'votivkirche', w: 62, h: 102, ppm: 3, draw: drawVotivkirche },
    { name: 'vienna_block_a', w: 220, h: 42, ppm: 2.5, draw: (ctx, r) => drawViennaBlock(ctx, r, 220, true) },
    { name: 'vienna_block_b', w: 220, h: 42, ppm: 2.5, draw: (ctx, r) => drawViennaBlock(ctx, r, 220, false) },
    { name: 'dc_tower', w: 44, h: 256, ppm: 1.5, draw: drawDcTower },
    { name: 'millennium_tower', w: 44, h: 206, ppm: 1.5, draw: drawMillennium },
    { name: 'donauturm', w: 40, h: 258, ppm: 1.5, draw: drawDonauturm },
    { name: 'kahlenberg', w: 900, h: 230, ppm: 1.5, draw: drawKahlenberg },
    { name: 'vienna_far', w: 520, h: 64, ppm: 1.5, draw: drawViennaFar },
    { name: 'vienna_house_a', w: 28, h: 26, ppm: 5, draw: (ctx, r) => drawGrunderzeit(ctx, r, '#efe2c2', '#6f7c86') },
    { name: 'vienna_house_b', w: 28, h: 26, ppm: 5, draw: (ctx, r) => drawGrunderzeit(ctx, r, '#f0d78a', '#a9533d') },
    { name: 'vienna_house_c', w: 28, h: 26, ppm: 5, draw: (ctx, r) => drawGrunderzeit(ctx, r, '#e9b9a0', '#6f7c86') },
    { name: 'canal_bridge', w: 70, h: 14, ppm: 5, draw: drawCanalBridge },
    { name: 'vie_terminal', w: 380, h: 32, ppm: 4, draw: (ctx, r) => drawAirportTerminal(ctx, r, 'VIENNA INTERNATIONAL AIRPORT') },
    { name: 'bud_terminal', w: 380, h: 32, ppm: 4, draw: (ctx, r) => drawAirportTerminal(ctx, r, 'BUDAPEST FERENC LISZT') },
    { name: 'vie_tower', w: 26, h: 110, ppm: 4, draw: drawVieTower },
    { name: 'airliner_austrian', w: 38, h: 13.5, ppm: 6, draw: (ctx) => drawAirliner(ctx, 38, '#d12a2f', '#ffffff', true) },
  ];
}

function drawStephansdom(ctx: Ctx): void {
  const W = 130;
  rect(ctx, 0, 0, W, 3.5, MID_GROUND);
  const stone = '#c4b391';
  const dark = '#8a7b63';

  // Unfinished north tower with its Renaissance cap, behind the nave
  rect(ctx, 40, 30, 14, 31, hgrad(ctx, 40, 54, [[0, dark], [1, '#a8987b']]));
  ellipse(ctx, 47, 62, 6.5, 3.6, '#5d7a6c');
  rect(ctx, 45.5, 64, 3, 3, '#9a8c72');
  ellipse(ctx, 47, 67.5, 2, 1.6, '#5d7a6c');
  line(ctx, 47, 69, 47, 71, 0.4, '#c9a23c');

  // Nave walls with buttresses and pinnacles
  rect(ctx, 18, 3, 96, 28, hgrad(ctx, 18, 114, [[0, '#b7a685'], [0.5, stone], [1, '#cfbf9e']]));
  for (let x = 22; x < 112; x += 9) {
    gothicWindow(ctx, x + 2.2, 9, 3.6, 16, '#40393a');
    rect(ctx, x - 0.8, 3, 2.2, 29, shade(stone, 0.12));
    poly(ctx, [x - 0.8, 32, x + 1.4, 32, x + 0.3, 36], shade(stone, 0.05));
  }
  // The famous steep roof with zig-zag glazed tiles
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(15, 30.5);
  ctx.lineTo(117, 30.5);
  ctx.lineTo(108, 58);
  ctx.lineTo(96, 58);
  ctx.lineTo(95, 61);
  ctx.lineTo(24, 61);
  ctx.closePath();
  ctx.clip();
  rect(ctx, 0, 30, W, 32, '#2c2b2d');
  const bandColors = ['#d7b13f', '#3f7d5b', '#e9e3cf', '#d7b13f', '#2c2b2d', '#3f7d5b'];
  for (let b = 0; b < 12; b++) {
    const y0 = 30.5 + b * 2.6;
    ctx.beginPath();
    for (let x = 10; x <= 120; x += 3) ctx.lineTo(x, y0 + (((x - 10) / 3) % 2 === 0 ? 0 : 1.3));
    for (let x = 120; x >= 10; x -= 3) ctx.lineTo(x, y0 + 1.3 + (((x - 10) / 3) % 2 === 0 ? 0 : 1.3));
    ctx.closePath();
    ctx.fillStyle = bandColors[b % bandColors.length];
    ctx.fill();
  }
  // Diamond pattern over the bands
  ctx.globalAlpha = 0.35;
  for (let x = 14; x < 118; x += 8) {
    for (let y = 33; y < 60; y += 8) poly(ctx, [x, y, x + 2, y + 2.4, x, y + 4.8, x - 2, y + 2.4], '#2c2b2d');
  }
  ctx.globalAlpha = 1;
  rect(ctx, 0, 30, W, 32, hgrad(ctx, 15, 117, [[0, 'rgba(0,0,0,0.18)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.12)']]));
  ctx.restore();

  // West front with the Heathen Towers
  rect(ctx, 10, 3, 10, 54, hgrad(ctx, 10, 20, [[0, dark], [1, stone]]));
  gothicWindow(ctx, 13, 20, 4, 14, '#40393a');
  poly(ctx, [10, 57, 20, 57, 18.5, 62, 11.5, 62], '#9c8c70');
  poly(ctx, [11.5, 62, 18.5, 62, 15, 72], '#6c6152');

  // South tower ("Steffl"): tapering stages, gables and a needle spire
  const cx = 74;
  const stages: [number, number, number][] = [
    [3, 40, 21],
    [40, 62, 17],
    [62, 80, 13],
  ];
  for (const [y0, y1, w] of stages) {
    rect(ctx, cx - w / 2, y0, w, y1 - y0, hgrad(ctx, cx - w / 2, cx + w / 2, [[0, '#7d705c'], [0.55, '#a7977a'], [1, '#93856b']]));
    gothicWindow(ctx, cx - 1.8, y0 + 4, 3.6, (y1 - y0) * 0.6, '#3a3434');
    for (const side of [-1, 1]) {
      const px = cx + (side * w) / 2;
      poly(ctx, [px - 1, y1, px + 1, y1, px, y1 + 6], '#8c7e66');
    }
    poly(ctx, [cx - w / 2 + 2, y1, cx, y1 + 5, cx + w / 2 - 2, y1], '#8c7e66');
  }
  poly(ctx, [cx - 6.5, 80, cx + 6.5, 80, cx + 0.5, 134, cx - 0.5, 134], hgrad(ctx, cx - 6, cx + 6, [[0, '#6f6352'], [0.6, '#9b8c72'], [1, '#85785f']]));
  for (let y = 84; y < 132; y += 3.2) {
    const half = 6.5 * (1 - (y - 80) / 54);
    circle(ctx, cx - half - 0.4, y, 0.55, '#857861');
    circle(ctx, cx + half + 0.4, y, 0.55, '#857861');
    rect(ctx, cx - half * 0.5, y, half, 0.35, 'rgba(60,50,40,0.5)');
  }
  line(ctx, cx, 134, cx, 139, 0.5, '#c9a23c');
  line(ctx, cx - 1.4, 137.5, cx + 1.4, 137.5, 0.45, '#c9a23c');

  // Choir end
  rect(ctx, 110, 3, 10, 22, hgrad(ctx, 110, 120, [[0, stone], [1, '#d6c7a6']]));
  gothicWindow(ctx, 113.2, 8, 3.4, 13, '#40393a');
}

function drawRiesenrad(ctx: Ctx): void {
  const cx = 38;
  const cy = 37;
  const R = 30;
  rect(ctx, 0, 0, 76, 2.5, MID_GROUND);
  // Support legs
  poly(ctx, [18, 2, 21, 2, cx + 0.6, cy, cx - 0.6, cy], '#5b2d29');
  poly(ctx, [55, 2, 58, 2, cx + 0.6, cy, cx - 0.6, cy], '#6b3530');
  line(ctx, 25, 14, 51, 14, 0.5, '#5b2d29');
  // Rim and spokes
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = '#6b2f2a';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1.6, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    line(ctx, cx + Math.cos(a) * (R - 1.6), cy + Math.sin(a) * (R - 1.6), cx + Math.cos(a) * R, cy + Math.sin(a) * R, 0.25, '#6b2f2a');
  }
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    line(ctx, cx, cy, cx + Math.cos(a) * (R - 1.6), cy + Math.sin(a) * (R - 1.6), 0.18, '#7a3a33');
  }
  circle(ctx, cx, cy, 1.6, '#4a2421');
  // Red gondolas
  for (let i = 0; i < 15; i++) {
    const a = (i / 15) * Math.PI * 2 + 0.1;
    const gx = cx + Math.cos(a) * R;
    const gy = cy + Math.sin(a) * R;
    rect(ctx, gx - 1.7, gy - 2.6, 3.4, 2.2, '#c3362b');
    rect(ctx, gx - 1.9, gy - 0.5, 3.8, 0.5, '#f1ece2');
    rect(ctx, gx - 1.3, gy - 2, 2.6, 0.8, '#f6e4b0');
  }
  // Entrance pavilion
  rect(ctx, 28, 2, 20, 5, '#efe8d6');
  roof(ctx, 28, 7, 20, 2.4, 1.4, '#5e8a73');
}

function drawKarlskirche(ctx: Ctx): void {
  const cream = '#efe3c6';
  rect(ctx, 0, 0, 90, 3, MID_GROUND);
  // Bell pavilions
  for (const x of [3, 75]) {
    rect(ctx, x, 3, 12, 20, hgrad(ctx, x, x + 12, [[0, '#ddd0b0'], [1, cream]]));
    windows(ctx, x + 2, 8, 8, 12, 2, 2, 1.6, 3, '#57606a');
    poly(ctx, [x - 0.5, 23, x + 12.5, 23, x + 9, 27, x + 3, 27], '#6c8f80');
  }
  // Main body, drum and great copper dome
  rect(ctx, 22, 3, 46, 26, hgrad(ctx, 22, 68, [[0, '#ddd0b0'], [1, cream]]));
  rect(ctx, 32, 29, 26, 12, hgrad(ctx, 32, 58, [[0, '#d8caa8'], [1, cream]]));
  windows(ctx, 33, 31, 24, 8, 5, 1, 1.8, 5, '#56606a');
  ctx.beginPath();
  ctx.ellipse(45, 41, 14, 17, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = hgrad(ctx, 31, 59, [[0, '#4f8573'], [0.6, '#79ad99'], [1, '#5f927f']]);
  ctx.fill();
  for (let i = 1; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    line(ctx, 45, 58, 45 + Math.cos(a) * 14, 41 + Math.sin(a) * 2, 0.35, '#9bc4b4');
  }
  rect(ctx, 43, 57, 4, 5, cream);
  ellipse(ctx, 45, 62.5, 2.6, 1.6, COPPER);
  line(ctx, 45, 64, 45, 67.5, 0.45, '#c9a23c');
  line(ctx, 43.8, 66.4, 46.2, 66.4, 0.4, '#c9a23c');
  // Temple portico
  rect(ctx, 35, 3, 20, 2, '#d9ccad');
  for (let i = 0; i < 6; i++) rect(ctx, 36 + i * 3.4, 5, 1.4, 15, '#f6efdc');
  rect(ctx, 34.5, 20, 21, 2, '#e6dbbf');
  poly(ctx, [34, 22, 56, 22, 45, 28], '#f2e9d2');
  poly(ctx, [36.5, 22.6, 53.5, 22.6, 45, 26.8], '#ddd0b0');
  // Triumphal columns with spiral reliefs
  for (const x of [18, 67]) {
    rect(ctx, x, 3, 5, 3, '#d9ccad');
    rect(ctx, x + 0.4, 6, 4.2, 36, hgrad(ctx, x, x + 5, [[0, '#d5c8a8'], [1, '#f3ead6']]));
    for (let y = 7; y < 41; y += 2.6) poly(ctx, [x + 0.4, y, x + 4.6, y + 1.4, x + 4.6, y + 2.1, x + 0.4, y + 0.7], 'rgba(150,130,100,0.45)');
    rect(ctx, x - 0.4, 42, 5.8, 1.6, '#e8dcc0');
    rect(ctx, x + 1, 43.6, 3, 3, '#e8dcc0');
    ellipse(ctx, x + 2.5, 47.6, 1.8, 1.2, '#6c8f80');
    circle(ctx, x + 2.5, 49.2, 0.6, '#c9a23c');
  }
}

function drawVotivkirche(ctx: Ctx): void {
  const stone = '#d6cfbf';
  rect(ctx, 0, 0, 62, 3, MID_GROUND);
  rect(ctx, 8, 3, 46, 28, hgrad(ctx, 8, 54, [[0, '#bdb5a3'], [1, stone]]));
  poly(ctx, [7, 31, 55, 31, 49, 46, 13, 46], '#5d6b78');
  for (const x of [12, 40]) {
    rect(ctx, x, 3, 10, 54, hgrad(ctx, x, x + 10, [[0, '#b8b09e'], [0.6, '#e0dacb'], [1, '#cbc3b1']]));
    gothicWindow(ctx, x + 3, 30, 4, 18, '#3e3c3d');
    gothicWindow(ctx, x + 3.4, 10, 3.2, 12, '#3e3c3d');
    poly(ctx, [x - 0.5, 57, x + 10.5, 57, x + 5, 99], hgrad(ctx, x, x + 10, [[0, '#b8b09e'], [0.6, '#e5dfd1'], [1, '#c8c0ae']]));
    for (let y = 61; y < 92; y += 4) {
      const half = 5.5 * (1 - (y - 57) / 42);
      rect(ctx, x + 5 - half * 0.45, y, half * 0.9, 1.6, '#4a4848');
    }
    line(ctx, x + 5, 99, x + 5, 101.5, 0.4, '#c9a23c');
  }
  gothicWindow(ctx, 27, 12, 8, 22, '#3e3c3d');
  circle(ctx, 31, 39, 3.2, '#3e3c3d');
}

function drawViennaBlock(ctx: Ctx, r: Rand, W: number, withDome: boolean): void {
  rect(ctx, 0, 0, W, 4, MID_GROUND);
  let x = 0;
  while (x < W - 2) {
    const w = Math.min(range(r, 14, 26), W - x);
    const h = range(r, 17, 25);
    const wall = pick(r, ['#efe2c2', '#f0d78a', '#e9b9a0', '#f4f0e6', '#dcd6c6', '#eed4b4']);
    rect(ctx, x, 3.5, w, h, hgrad(ctx, x, x + w, [[0, shade(wall, -0.06)], [1, wall]]));
    windows(ctx, x + 1, 6, w - 2, h - 5, Math.max(2, Math.floor(w / 3.2)), 5, 1.1, 2, '#4f5961');
    rect(ctx, x, 3.5 + h - 1, w, 1, shade(wall, 0.2));
    const roofColor = r() < 0.5 ? '#6f7c86' : '#a9533d';
    roof(ctx, x, 3.5 + h, w, range(r, 3, 5), 1.2, roofColor);
    x += w;
  }
  if (withDome) {
    const dx = W * 0.35;
    rect(ctx, dx - 7, 26, 14, 6, '#efe2c2');
    ctx.beginPath();
    ctx.ellipse(dx, 32, 8, 7, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = hgrad(ctx, dx - 8, dx + 8, [[0, '#4f8573'], [1, '#7aae9a']]);
    ctx.fill();
    rect(ctx, dx - 1, 38.5, 2, 2, '#efe2c2');
    line(ctx, dx, 40.5, dx, 41.8, 0.35, '#c9a23c');
  }
  const sx = W * (withDome ? 0.78 : 0.55);
  rect(ctx, sx - 3, 20, 6, 12, '#d9cdb0');
  poly(ctx, [sx - 3.4, 32, sx + 3.4, 32, sx, 41.5], '#5d7a6c');
}

function drawDcTower(ctx: Ctx): void {
  rect(ctx, 0, 0, 44, 3, HILLS_GROUND);
  rect(ctx, 5, 2, 34, 248, hgrad(ctx, 5, 39, [[0, '#2b323a'], [0.55, '#3f4b57'], [1, '#56636f']]));
  for (let y = 4; y < 250; y += 3.6) rect(ctx, 5, y, 34, 0.4, 'rgba(160,180,200,0.25)');
  // Pleated "folded" facade
  for (let y = 2; y < 248; y += 12) {
    poly(ctx, [30, y, 39, y + 6, 39, y + 12, 30, y + 6], 'rgba(200,215,230,0.35)');
  }
  rect(ctx, 5, 250, 34, 2.5, '#20262c');
}

function drawMillennium(ctx: Ctx): void {
  rect(ctx, 0, 0, 44, 3, HILLS_GROUND);
  rect(ctx, 6, 2, 32, 166, hgrad(ctx, 6, 38, [[0, '#4b6378'], [0.4, '#8eaac2'], [0.75, '#6b879f'], [1, '#55708a']]));
  for (let y = 5; y < 168; y += 3.4) rect(ctx, 6, y, 32, 0.45, 'rgba(30,45,60,0.45)');
  rect(ctx, 21, 2, 1, 166, 'rgba(255,255,255,0.25)');
  poly(ctx, [10, 168, 34, 168, 30, 176, 14, 176], '#cdd6dd');
  poly(ctx, [21, 176, 23, 176, 22.3, 204, 21.7, 204], '#c9d0d6');
}

function drawDonauturm(ctx: Ctx): void {
  rect(ctx, 0, 0, 40, 3, HILLS_GROUND);
  poly(ctx, [14, 2, 26, 2, 22.6, 14, 17.4, 14], '#c9cfd3');
  poly(ctx, [17.4, 14, 22.6, 14, 22, 150, 18, 150], hgrad(ctx, 17, 23, [[0, '#bfc6ca'], [0.6, '#eef1f2'], [1, '#d3d8db']]));
  poly(ctx, [6, 150, 34, 150, 35, 158, 5, 158], hgrad(ctx, 5, 35, [[0, '#c7cdd1'], [1, '#f1f3f4']]));
  rect(ctx, 5, 152.5, 30, 3, '#35424e');
  poly(ctx, [7, 158, 33, 158, 31, 166, 9, 166], hgrad(ctx, 7, 33, [[0, '#bcc3c7'], [1, '#e9ecee']]));
  rect(ctx, 8, 160.5, 24, 2.6, '#35424e');
  rect(ctx, 10, 166, 20, 1.6, '#f3f5f6');
  const seg = (252 - 168) / 8;
  for (let i = 0; i < 8; i++) {
    const w0 = 1.6 - i * 0.12;
    rect(ctx, 20 - w0 / 2, 168 + i * seg, w0, seg, i % 2 ? '#f2f2f2' : '#d4483b');
  }
}

function drawKahlenberg(ctx: Ctx, r: Rand): void {
  const W = 900;
  const hill = (x: number) => {
    const a = Math.exp(-(((x - 250) / 150) ** 2)) * 150;
    const b = Math.exp(-(((x - 600) / 220) ** 2)) * 175;
    return 5 + Math.max(a, b) + Math.sin(x / 23) * 3;
  };
  fillProfile(ctx, 0, W, hill, vgrad(ctx, 185, 0, [[0, '#4d6b4c'], [1, '#64835a']]), 2);
  for (let i = 0; i < 900; i++) {
    const x = range(r, 0, W);
    const y = hill(x) - r() * r() * 150 + 2;
    if (y < 6) continue;
    treeCrown(ctx, r, x, y, range(r, 4, 7), pick(r, ['#45633f', '#506f47', '#3f5b3a', '#5d7c4f']));
  }
  // Vineyards on the lower slopes (Grinzing)
  ctx.globalAlpha = 0.5;
  for (let y = 10; y < 46; y += 3) rect(ctx, 380, y, 160 - y, 1, '#8aa760');
  ctx.globalAlpha = 1;
  rect(ctx, 0, 0, W, 3, HILLS_GROUND);
  // Leopoldsberg church
  const lx = 250;
  const ly = hill(lx) - 4;
  rect(ctx, lx - 10, ly, 20, 9, '#efe8d8');
  ellipse(ctx, lx, ly + 11, 5, 4, '#5f8a78');
  // Kahlenberg transmitter mast
  const mx = 610;
  const my = hill(mx) - 4;
  const seg = 165 / 8;
  for (let i = 0; i < 8; i++) {
    const w0 = 3 - i * 0.28;
    rect(ctx, mx - w0 / 2, my + i * seg, w0, seg, i % 2 ? '#f2f2f2' : '#d4483b');
  }
  rect(ctx, mx - 5, my + 70, 10, 3, '#e6e6e6');
}

function drawViennaFar(ctx: Ctx, r: Rand): void {
  const W = 520;
  rect(ctx, 0, 0, W, 4, HILLS_GROUND);
  let x = 0;
  while (x < W) {
    const w = range(r, 8, 22);
    const h = range(r, 10, 26);
    rect(ctx, x, 3, w, h, pick(r, ['#d9d2c0', '#cfc8b5', '#e2dccb', '#c4c9cc', '#d6cbb0']));
    rect(ctx, x, 3 + h, w, 1.4, pick(r, ['#8c6a5a', '#7b8a92', '#946553']));
    x += w;
  }
  for (let i = 0; i < 7; i++) {
    const sx = range(r, 10, W - 10);
    const h = range(r, 30, 52);
    rect(ctx, sx - 2.2, 3, 4.4, h - 10, '#cfc6b0');
    poly(ctx, [sx - 2.6, h - 7, sx + 2.6, h - 7, sx, h + 2], '#5e7a6c');
  }
  for (let i = 0; i < 3; i++) {
    const dx = range(r, 20, W - 20);
    ellipse(ctx, dx, 28, 7, 6, '#6c9c88');
    rect(ctx, dx - 7, 20, 14, 8, '#ddd4bf');
  }
  // Construction cranes and a gasometer
  for (let i = 0; i < 2; i++) {
    const cx = range(r, 40, W - 40);
    rect(ctx, cx, 3, 1.2, 50, '#d9a43c');
    rect(ctx, cx - 10, 50, 30, 1, '#d9a43c');
  }
  const gx = W * 0.82;
  rect(ctx, gx - 12, 3, 24, 30, '#b9785e');
  ellipse(ctx, gx, 33, 12, 3, '#8c8f92');
}

function drawGrunderzeit(ctx: Ctx, r: Rand, wall: string, roofColor: string): void {
  const W = 28;
  rect(ctx, 0.5, 0, W - 1, 4.4, shade(wall, -0.22));
  for (let i = 0; i < 4; i++) rect(ctx, 2 + i * 6.5, 0.4, 4.2, 3.2, '#3d4a55');
  rect(ctx, 0.5, 4.4, W - 1, 15.6, hgrad(ctx, 0, W, [[0, shade(wall, -0.05)], [1, wall]]));
  for (let f = 0; f < 4; f++) {
    const y = 5.6 + f * 3.8;
    for (let c = 0; c < 6; c++) {
      const wx = 2 + c * 4.3;
      rect(ctx, wx, y, 1.8, 2.5, r() < 0.1 ? '#f2d899' : '#47535d');
      if (f === 1) poly(ctx, [wx - 0.4, y + 2.7, wx + 2.2, y + 2.7, wx + 0.9, y + 3.4], shade(wall, 0.25));
      else rect(ctx, wx - 0.3, y + 2.7, 2.4, 0.35, shade(wall, 0.25));
    }
    rect(ctx, 0.5, y - 0.5, W - 1, 0.25, shade(wall, -0.12));
  }
  rect(ctx, 0, 20, W, 1, shade(wall, 0.3));
  poly(ctx, [0.5, 21, W - 0.5, 21, W - 2.5, 25.5, 2.5, 25.5], roofColor);
  for (let i = 0; i < 4; i++) {
    const dx = 4 + i * 6.2;
    rect(ctx, dx, 21.6, 1.6, 2.2, '#e9e4d8');
    rect(ctx, dx + 0.3, 21.9, 1, 1.4, '#47535d');
  }
}

function drawCanalBridge(ctx: Ctx): void {
  rect(ctx, 0, 0, 12, 7.5, '#9a958b');
  rect(ctx, 58, 0, 12, 7.5, '#9a958b');
  ctx.beginPath();
  ctx.moveTo(12, 7.5);
  ctx.quadraticCurveTo(35, 2, 58, 7.5);
  ctx.lineTo(58, 6.2);
  ctx.quadraticCurveTo(35, 0.6, 12, 6.2);
  ctx.closePath();
  ctx.fillStyle = '#4b5a54';
  ctx.fill();
  rect(ctx, 0, 7.5, 70, 1.4, '#5a6b64');
  for (let x = 1; x < 70; x += 1.6) rect(ctx, x, 8.9, 0.25, 1.5, '#3f4c47');
  rect(ctx, 0, 10.4, 70, 0.35, '#3f4c47');
  for (const x of [13, 35, 57]) {
    rect(ctx, x, 8.9, 0.4, 4.4, '#2f3a36');
    circle(ctx, x + 0.2, 13.4, 0.6, '#f4e2a8');
  }
}

function drawAirportTerminal(ctx: Ctx, r: Rand, title: string): void {
  const W = 380;
  rect(ctx, 4, 0, W - 8, 4, '#8f9497');
  rect(ctx, 6, 4, W - 12, 18, vgrad(ctx, 22, 4, [[0, '#b7cde0'], [0.45, '#7d9bb6'], [1, '#3f5a74']]));
  for (let x = 8; x < W - 6; x += 6) rect(ctx, x, 4, 0.5, 18, '#e6ecf0');
  rect(ctx, 6, 13, W - 12, 0.5, '#e6ecf0');
  rect(ctx, 0, 22, W, 2.6, '#f4f6f7');
  rect(ctx, 0, 21.4, W, 0.6, '#b9c1c6');
  const size = title.length > 26 ? 3.0 : 3.4;
  text(ctx, title, W / 2, 16.2, size, '#ffffff', 'center', 700);
  // Jet bridges
  for (let i = 0; i < 4; i++) {
    const bx = 40 + i * 90 + r() * 6;
    rect(ctx, bx, 6, 26, 3.2, '#d8dde0');
    rect(ctx, bx + 24, 0, 1, 6, '#6f777c');
    rect(ctx, bx + 2, 6.6, 22, 0.8, '#9fb4c4');
  }
  // Rooftop technical boxes
  for (let i = 0; i < 6; i++) rect(ctx, 20 + i * 60 + r() * 20, 24.6, 10, 2.4, '#d0d5d8');
}

function drawVieTower(ctx: Ctx): void {
  const cx = 13;
  poly(ctx, [cx - 3.6, 0, cx + 3.6, 0, cx + 3, 80, cx - 3, 80], hgrad(ctx, cx - 4, cx + 4, [[0, '#bfc6ca'], [0.6, '#f2f4f5'], [1, '#d3d8db']]));
  for (let y = 6; y < 80; y += 6) rect(ctx, cx - 3.4, y, 6.8, 0.35, 'rgba(120,135,145,0.5)');
  poly(ctx, [cx - 3, 80, cx + 3, 80, cx + 9, 90, cx - 9, 90], hgrad(ctx, cx - 9, cx + 9, [[0, '#c9cfd2'], [1, '#f1f3f4']]));
  poly(ctx, [cx - 9, 90, cx + 9, 90, cx + 10.5, 99, cx - 10.5, 99], vgrad(ctx, 99, 90, [[0, '#2d4a52'], [1, '#5d8590']]));
  for (let x = -9; x <= 9; x += 2.2) rect(ctx, cx + x, 90, 0.3, 9, '#cfd8dc');
  poly(ctx, [cx - 11.5, 99, cx + 11.5, 99, cx + 9, 102, cx - 9, 102], '#f3f5f6');
  line(ctx, cx, 102, cx, 109.5, 0.4, '#9aa3a8');
  circle(ctx, cx, 109.6, 0.5, '#d64a3a');
}
