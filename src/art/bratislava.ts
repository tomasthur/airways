import type { SpriteSpec } from './Atlas';
import { MID_GROUND } from './countryside';
import {
  circle,
  ellipse,
  fillProfile,
  gothicWindow,
  hgrad,
  line,
  mix,
  pick,
  poly,
  range,
  rect,
  roof,
  shade,
  treeCrown,
  vgrad,
  windows,
  type Ctx,
  type Rand,
} from './paint';

export const RIVER_WATER = '#4d7488';
const STONE = '#efe9db';
const ROOF_RED = '#b4513b';

/** Sprite x offset of the river's left bank inside the SNP bridge sprite. */
export const SNP_RIVER_OFFSET = 80;

export function bratislavaSprites(): SpriteSpec[] {
  return [
    { name: 'snp_bridge', w: 460, h: 104, ppm: 2.5, draw: drawSnpBridge },
    { name: 'bratislava_castle', w: 400, h: 150, ppm: 2.5, draw: drawCastle },
    { name: 'bratislava_oldtown', w: 320, h: 95, ppm: 2.5, draw: drawOldTown },
    { name: 'petrzalka_far', w: 300, h: 52, ppm: 2.5, draw: drawPetrzalkaFar },
    { name: 'kamzik', w: 700, h: 330, ppm: 1.5, draw: drawKamzik },
    { name: 'panelak_a', w: 62, h: 40, ppm: 5, draw: (ctx, r) => drawPanelak(ctx, r, 62, 12, '#e9dcc2', '#e07b39') },
    { name: 'panelak_b', w: 48, h: 31, ppm: 5, draw: (ctx, r) => drawPanelak(ctx, r, 48, 9, '#dfe6e3', '#3e8fa6') },
    { name: 'bts_tower', w: 14, h: 40, ppm: 5, draw: drawBtsTower },
    { name: 'hangar', w: 70, h: 22, ppm: 4, draw: drawHangar },
    { name: 'airliner_generic', w: 34, h: 12, ppm: 6, draw: (ctx) => drawAirliner(ctx, 34, '#1f4e9c', '#ffffff', false) },
  ];
}

function drawSnpBridge(ctx: Ctx, r: Rand): void {
  const W = 460;
  const riverL = SNP_RIVER_OFFSET;
  const riverR = riverL + 300;
  const deckY = 18;
  // Banks and water
  rect(ctx, 0, 0, W, 6, MID_GROUND);
  rect(ctx, riverL, 0, riverR - riverL, 7, vgrad(ctx, 7, 0, [[0, '#6f97a8'], [1, RIVER_WATER]]));
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 40; i++) {
    const x = range(r, riverL + 4, riverR - 30);
    rect(ctx, x, range(r, 1, 6), range(r, 8, 26), 0.35, '#d8e6ec');
  }
  ctx.globalAlpha = 1;
  rect(ctx, riverL - 3, 0, 3, 7.5, '#9a9488');
  rect(ctx, riverR, 0, 3, 7.5, '#9a9488');
  // Park trees on the Petržalka bank, embankment houses on the old-town bank
  for (let i = 0; i < 12; i++) treeCrown(ctx, r, range(r, 2, riverL - 10), range(r, 9, 12), range(r, 3.5, 5.5), '#4f7b3c');
  for (let x = riverR + 6; x < W - 6; x += range(r, 12, 18)) {
    const h = range(r, 10, 16);
    rect(ctx, x, 6, 11, h, pick(r, ['#f0e2c0', '#e7c9a7', '#efe9dc']));
    roof(ctx, x, 6 + h, 11, 4, 1.5, ROOF_RED);
  }

  // Pylon: inclined A-frame leaning away from the main span
  const baseX = riverL + 2;
  const topX = baseX - 22;
  const topY = 84;
  poly(ctx, [baseX - 3, 6, baseX + 4, 6, topX + 5, topY, topX - 1, topY], '#8f9aa2');
  poly(ctx, [baseX - 7, 6, baseX, 6, topX + 1, topY, topX - 5, topY], hgrad(ctx, baseX - 20, baseX, [[0, '#b9c2c8'], [1, '#d8dee2']]));
  rect(ctx, baseX - 10, deckY - 1, 14, 3, '#7d878e');

  // Cables (three pairs to the main span) and back-stays
  const anchors = [riverL + 120, riverL + 205, riverL + 290];
  anchors.forEach((ax, i) => {
    const ty = topY - 4 - i * 6;
    const tx = topX + 3 + i * 1.6;
    line(ctx, tx, ty, ax, deckY + 3, 0.7, '#38414a');
    line(ctx, tx + 0.8, ty - 0.4, ax + 2.5, deckY + 3, 0.5, '#4c5761');
    line(ctx, tx - 1, ty, 6 + i * 7, 6, 0.7, '#38414a');
  });

  // Deck
  rect(ctx, 0, deckY, W, 3.6, '#59636b');
  rect(ctx, 0, deckY + 3.6, W, 0.8, '#c9cfd3');
  rect(ctx, 0, deckY - 1.2, W, 1.2, '#3d454c');
  for (let x = 2; x < W; x += 3) rect(ctx, x, deckY + 4.4, 0.25, 1.1, '#6d777f');
  rect(ctx, 0, deckY + 5.3, W, 0.25, '#6d777f');
  // Right abutment pier
  rect(ctx, riverR - 2, 0, 5, deckY, '#9a9488');

  // The UFO restaurant
  const ux = topX + 2;
  const uy = topY + 5;
  ellipse(ctx, ux, uy - 1.2, 15.5, 3.4, '#8a959d');
  ellipse(ctx, ux, uy + 1.2, 16.5, 3.2, '#d2d9de');
  rect(ctx, ux - 16.5, uy - 0.9, 33, 2, '#2a3540');
  for (let i = -14; i <= 14; i += 2.2) rect(ctx, ux + i, uy - 0.4, 1.1, 0.9, '#f3d58b');
  ellipse(ctx, ux, uy + 3.6, 7, 1.8, '#c5cdd2');
  line(ctx, ux, uy + 5, ux, uy + 12, 0.5, '#9aa4ab');
  circle(ctx, ux, uy + 12.2, 0.6, '#d64a3a');
}

function hillProfile(x: number): number {
  if (x < 60) return 6 + (x / 60) * 6;
  if (x < 140) return 12 + ((x - 60) / 80) ** 1.4 * 46;
  if (x < 270) return 58 + Math.sin(((x - 140) / 130) * Math.PI) * 4;
  if (x < 360) return 58 - ((x - 270) / 90) ** 1.2 * 46;
  return 12 - ((x - 360) / 40) * 6;
}

function drawCastle(ctx: Ctx, r: Rand): void {
  const W = 400;
  rect(ctx, 0, 0, W, 6, MID_GROUND);
  fillProfile(ctx, 0, W, hillProfile, vgrad(ctx, 62, 0, [[0, '#5e8a47'], [1, '#6f9852']]), 2);
  // Woods on the slopes
  for (let i = 0; i < 160; i++) {
    const x = range(r, 10, W - 10);
    const top = hillProfile(x);
    const walled = x > 120 && x < 290;
    const y = walled ? top - 11 - r() * 26 : top - r() * 18 + 2;
    if (y < 7) continue;
    treeCrown(ctx, r, x, y, range(r, 3, 5.5), pick(r, ['#4c7a3b', '#5a8846', '#466f36']));
  }
  // Ramparts hugging the hilltop
  const wall = shade(STONE, -0.2);
  for (let x = 122; x < 290; x += 2) {
    const top = hillProfile(x + 1);
    rect(ctx, x, top - 8, 2.2, 8, hgrad(ctx, x, x + 2.2, [[0, wall], [1, shade(STONE, -0.12)]]));
    rect(ctx, x, top - 0.8, 2.2, 0.8, STONE);
  }
  // Old houses at the foot of the hill (Vydrica)
  for (let x = 300; x < 390; x += range(r, 9, 14)) {
    const base = hillProfile(x + 5) - 6;
    const h = range(r, 7, 11);
    rect(ctx, x, Math.max(5, base - h * 0.4), 9, h, pick(r, ['#f1e3c3', '#ead0b0', '#f4efe4']));
    roof(ctx, x, Math.max(5, base - h * 0.4) + h, 9, 3.4, 1.4, ROOF_RED);
  }

  // Castle: four-towered block with a red hipped roof
  const cx0 = 160;
  const cx1 = 242;
  const base = 62;
  const top = 89;
  rect(ctx, cx0, base, cx1 - cx0, top - base, hgrad(ctx, cx0, cx1, [[0, '#e8e1d0'], [0.5, '#f6f2e8'], [1, '#ece5d4']]));
  windows(ctx, cx0 + 14, base + 3, cx1 - cx0 - 28, top - base - 5, 13, 3, 1.4, 2.4, '#4e5a64');
  rect(ctx, cx0 + 37, base, 8, 6, '#6c5a46');
  poly(ctx, [cx0 + 4, top, cx1 - 4, top, cx1 - 18, top + 11, cx0 + 18, top + 11], ROOF_RED);
  poly(ctx, [(cx0 + cx1) / 2, top, cx1 - 4, top, cx1 - 18, top + 11, (cx0 + cx1) / 2, top + 11], shade(ROOF_RED, -0.12));
  const tower = (x: number, h: number, roofH: number) => {
    rect(ctx, x, base, 14, h, hgrad(ctx, x, x + 14, [[0, '#e3dccb'], [1, '#f7f3ea']]));
    windows(ctx, x + 2, base + 4, 10, h - 7, 2, 4, 1.4, 2.2, '#4e5a64');
    poly(ctx, [x - 1, base + h, x + 15, base + h, x + 7, base + h + roofH], ROOF_RED);
    poly(ctx, [x + 7, base + h, x + 15, base + h, x + 7, base + h + roofH], shade(ROOF_RED, -0.14));
    rect(ctx, x - 1, base + h - 0.6, 16, 0.6, '#c9c0ac');
  };
  tower(cx0 - 6, 33, 13);
  tower(cx1 - 8, 33, 14.5);
  // Flag on the crown tower
  line(ctx, cx1 - 1, base + 47.5, cx1 - 1, base + 55, 0.35, '#666');
  rect(ctx, cx1 - 1, base + 52, 4.5, 1, '#ffffff');
  rect(ctx, cx1 - 1, base + 51, 4.5, 1, '#1d4fa3');
  rect(ctx, cx1 - 1, base + 50, 4.5, 1, '#d32630');
}

function drawOldTown(ctx: Ctx, r: Rand): void {
  const W = 320;
  rect(ctx, 0, 0, W, 5, MID_GROUND);
  // St. Martin's Cathedral: gothic nave and the spire with the gilded crown
  const sand = '#d8ccb1';
  rect(ctx, 30, 4, 62, 22, hgrad(ctx, 30, 92, [[0, '#cbbd9f'], [1, '#e2d7bf']]));
  for (let x = 36; x < 90; x += 8) gothicWindow(ctx, x, 8, 3, 13, '#4a4744');
  poly(ctx, [28, 26, 94, 26, 90, 40, 34, 40], '#5f5853');
  poly(ctx, [62, 26, 94, 26, 90, 40, 62, 40], '#544d48');
  const tx = 14;
  rect(ctx, tx, 4, 16, 46, hgrad(ctx, tx, tx + 16, [[0, '#c9bb9c'], [1, sand]]));
  gothicWindow(ctx, tx + 5, 30, 6, 12, '#3f3c3a');
  gothicWindow(ctx, tx + 6, 14, 4, 9, '#3f3c3a');
  poly(ctx, [tx - 1, 50, tx + 17, 50, tx + 16, 53, tx, 53], '#bfb194');
  poly(ctx, [tx + 1, 53, tx + 15, 53, tx + 8, 82], '#6a7068');
  poly(ctx, [tx + 8, 53, tx + 15, 53, tx + 8, 82], '#5a605a');
  for (let i = 0; i < 6; i++) {
    const y = 57 + i * 4;
    const half = 7 * (1 - (y - 53) / 29);
    circle(ctx, tx + 8 - half - 0.3, y, 0.5, '#7b8178');
    circle(ctx, tx + 8 + half + 0.3, y, 0.5, '#7b8178');
  }
  ellipse(ctx, tx + 8, 83, 2.4, 1.1, '#c9a23c');
  poly(ctx, [tx + 5.8, 83.5, tx + 10.2, 83.5, tx + 10.8, 87, tx + 9.2, 85.6, tx + 8, 87.8, tx + 6.8, 85.6, tx + 5.2, 87], '#e0b84a');
  line(ctx, tx + 8, 87.8, tx + 8, 90, 0.35, '#e0b84a');

  // Baroque old town
  let x = 98;
  while (x < W - 4) {
    const w = range(r, 12, 20);
    const h = range(r, 12, 19);
    const wall = pick(r, ['#f1d9a6', '#ecc8b0', '#f3efe3', '#dfe3c8', '#f2e2b8', '#e9d2c4']);
    rect(ctx, x, 4, w, h, wall);
    rect(ctx, x, 4 + h - 0.8, w, 0.8, shade(wall, -0.15));
    windows(ctx, x + 1, 6, w - 2, h - 4, Math.max(2, Math.floor(w / 3.4)), Math.max(2, Math.floor(h / 4.5)), 1.1, 1.8, '#4f5a63');
    roof(ctx, x, 4 + h, w, range(r, 4, 7), 2, mix(ROOF_RED, '#8a3f30', r()));
    x += w;
  }
  // St. Michael's Gate tower with its copper top and statue
  const mx = 180;
  rect(ctx, mx, 4, 10, 34, hgrad(ctx, mx, mx + 10, [[0, '#e2d7c0'], [1, '#f4eee2']]));
  rect(ctx, mx + 3.5, 6, 3, 5, '#5a4a3a');
  windows(ctx, mx + 2, 20, 6, 14, 2, 3, 1, 1.8, '#4f5a63');
  ellipse(ctx, mx + 5, 40, 6.5, 2.4, '#5f9480');
  rect(ctx, mx + 2.5, 41, 5, 4, '#e9e2d0');
  ellipse(ctx, mx + 5, 46.5, 4.2, 2.4, '#5f9480');
  rect(ctx, mx + 3.6, 48, 2.8, 2.6, '#e9e2d0');
  ellipse(ctx, mx + 5, 51.5, 2.6, 2, '#6aa08a');
  poly(ctx, [mx + 3.6, 52.6, mx + 6.4, 52.6, mx + 5, 58], '#5f9480');
  line(ctx, mx + 5, 58, mx + 5, 61, 0.6, '#c9a23c');
  // Old Town Hall tower
  const hx = 252;
  rect(ctx, hx, 4, 11, 40, hgrad(ctx, hx, hx + 11, [[0, '#d9cfb8'], [1, '#efe8d9']]));
  windows(ctx, hx + 2, 24, 7, 15, 2, 3, 1.2, 2, '#4f5a63');
  circle(ctx, hx + 5.5, 41, 2, '#f7f2e4');
  circle(ctx, hx + 5.5, 41, 1.6, '#35424d');
  ellipse(ctx, hx + 5.5, 46, 6.5, 2.5, '#4a4f55');
  rect(ctx, hx + 3.5, 47, 4, 3, '#efe8d9');
  poly(ctx, [hx + 3, 50, hx + 8, 50, hx + 5.5, 57], '#4a4f55');
}

function drawPetrzalkaFar(ctx: Ctx, r: Rand): void {
  const W = 300;
  rect(ctx, 0, 0, W, 5, MID_GROUND);
  let x = 2;
  while (x < W - 30) {
    const floors = 8 + Math.floor(r() * 5);
    const h = floors * 2.9;
    const w = range(r, 26, 60);
    const color = pick(r, ['#e9dcc2', '#dfe6e3', '#f0d6b8', '#d9e2ea', '#e8e1cf']);
    const accent = pick(r, ['#e07b39', '#3e8fa6', '#9cbf4a', '#d9534f', '#6c7fb8']);
    rect(ctx, x, 4, w, h, hgrad(ctx, x, x + w, [[0, shade(color, -0.08)], [1, color]]));
    for (let f = 0; f < floors; f++) rect(ctx, x + 1, 5.2 + f * 2.9, w - 2, 1.1, '#5b6670');
    rect(ctx, x + w * 0.62, 4, w * 0.12, h, accent);
    rect(ctx, x, 4 + h, w, 1, shade(color, -0.25));
    x += w + range(r, 6, 22);
  }
  for (let i = 0; i < 26; i++) treeCrown(ctx, r, range(r, 2, W - 2), range(r, 6, 9), range(r, 3, 5), '#4f7b3c');
}

function drawKamzik(ctx: Ctx, r: Rand): void {
  const W = 700;
  const hill = (x: number) => {
    const t = x / W;
    return 4 + Math.sin(t * Math.PI) ** 1.6 * 118 + Math.sin(t * Math.PI * 5) * 4;
  };
  fillProfile(ctx, 0, W, hill, vgrad(ctx, 125, 0, [[0, '#46693f'], [1, '#5f8650']]), 2);
  for (let i = 0; i < 700; i++) {
    const x = range(r, 0, W);
    const y = hill(x) - r() * r() * 110 + 2;
    treeCrown(ctx, r, x, y, range(r, 4, 7), pick(r, ['#43663b', '#4f7444', '#3d5e36', '#5a7f4b']));
  }
  rect(ctx, 0, 0, W, 3, '#7e9c50');

  // Kamzík TV tower
  const cx = 360;
  const base = hill(cx) - 6;
  const shaftTop = base + 112;
  poly(ctx, [cx - 6, base, cx + 6, base, cx + 3.6, shaftTop, cx - 3.6, shaftTop], hgrad(ctx, cx - 6, cx + 6, [[0, '#b9bfc3'], [0.6, '#eef1f2'], [1, '#d3d8db']]));
  const cab = shaftTop;
  rect(ctx, cx - 10, cab, 20, 22, hgrad(ctx, cx - 10, cx + 10, [[0, '#bfc6ca'], [0.6, '#f2f4f5'], [1, '#d4d9dc']]));
  for (let i = 0; i < 4; i++) rect(ctx, cx - 10, cab + 3 + i * 4.8, 20, 2.2, '#3c4a57');
  rect(ctx, cx - 11, cab + 22, 22, 1.6, '#e7eaec');
  rect(ctx, cx - 5, cab + 23.6, 10, 12, hgrad(ctx, cx - 5, cx + 5, [[0, '#c3c9cc'], [1, '#eef0f1']]));
  rect(ctx, cx - 5, cab + 28, 10, 1.5, '#53606b');
  const mastBase = cab + 35.6;
  const mastTop = base + 194;
  const seg = (mastTop - mastBase) / 8;
  for (let i = 0; i < 8; i++) {
    const w0 = 2.4 - (i / 8) * 1.4;
    const w1 = 2.4 - ((i + 1) / 8) * 1.4;
    poly(ctx, [cx - w0, mastBase + i * seg, cx + w0, mastBase + i * seg, cx + w1, mastBase + (i + 1) * seg, cx - w1, mastBase + (i + 1) * seg], i % 2 ? '#f2f2f2' : '#d4483b');
  }
}

function drawPanelak(ctx: Ctx, r: Rand, W: number, floors: number, color: string, accent: string): void {
  const fh = 3;
  const H = floors * fh + 1;
  rect(ctx, 1, 0, W - 2, H, hgrad(ctx, 0, W, [[0, shade(color, -0.1)], [1, color]]));
  const cols = Math.floor((W - 4) / 3.6);
  for (let f = 0; f < floors; f++) {
    const y = 1.2 + f * fh;
    for (let c = 0; c < cols; c++) {
      const lit = r() < 0.08;
      rect(ctx, 3 + c * 3.6, y, 2.2, 1.6, lit ? '#f1d38c' : '#56636e');
    }
    rect(ctx, 1, y - 0.5, W - 2, 0.25, shade(color, -0.18));
  }
  // Loggia stripe and stairwell in accent colour
  rect(ctx, W * 0.42, 0, 4, H, accent);
  for (let f = 0; f < floors; f++) rect(ctx, W * 0.42 + 0.8, 1.4 + f * fh, 2.4, 1.2, shade(accent, -0.35));
  rect(ctx, W * 0.75, 0, W * 0.12, H, shade(accent, 0.45));
  rect(ctx, 0.5, H, W - 1, 1.2, shade(color, -0.35));
  rect(ctx, 1, 0, W - 2, 1, '#8b8a82');
}

function drawBtsTower(ctx: Ctx): void {
  rect(ctx, 5.5, 0, 3, 30, hgrad(ctx, 5.5, 8.5, [[0, '#c9cfd2'], [1, '#f1f3f4']]));
  for (let y = 3; y < 28; y += 4.2) rect(ctx, 5.75, y, 2.5, 1.5, '#6d8594');
  poly(ctx, [2.5, 30, 11.5, 30, 12.5, 35, 1.5, 35], vgrad(ctx, 35, 30, [[0, '#6a90a6'], [1, '#2c4152']]));
  for (let x = 2.5; x < 12.5; x += 1.8) rect(ctx, x, 30, 0.25, 5, '#d8dee2');
  rect(ctx, 1, 35, 12, 1.2, '#f2f4f5');
  line(ctx, 7, 36, 7, 39.5, 0.25, '#9aa3a8');
  circle(ctx, 7, 39.6, 0.35, '#d64a3a');
}

function drawHangar(ctx: Ctx): void {
  rect(ctx, 2, 0, 66, 14, hgrad(ctx, 2, 68, [[0, '#a7adb1'], [1, '#c9ced1']]));
  ctx.beginPath();
  ctx.moveTo(1, 14);
  ctx.quadraticCurveTo(35, 26, 69, 14);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, 26, 14, [
    [0, '#d4d9dc'],
    [1, '#8a9297'],
  ]);
  ctx.fill();
  for (let x = 8; x < 64; x += 14) {
    rect(ctx, x, 1.2, 10, 11.4, '#5c6368');
    rect(ctx, x + 0.6, 1.8, 4, 10.2, '#4a5055');
    rect(ctx, x + 5.4, 1.8, 4, 10.2, '#6a7176');
  }
  for (let x = 6; x < 66; x += 4) rect(ctx, x, 0, 0.3, 13, '#8e959a');
  rect(ctx, 2, 13.6, 66, 0.6, '#7b8287');
}

export function drawAirliner(ctx: Ctx, L: number, tail: string, stripe: string, austrian: boolean): void {
  const s = L / 34;
  const y = 3.2 * s;
  const R = 1.9 * s;
  // Far-side engine & wing
  ellipse(ctx, 17 * s, y - 1.6 * s, 2.6 * s, 0.9 * s, '#9aa1a6');
  // Fuselage
  ctx.beginPath();
  ctx.moveTo(2 * s, y + R * 0.6);
  ctx.lineTo(28 * s, y + R);
  ctx.quadraticCurveTo(33.6 * s, y + R * 0.9, 33.8 * s, y - 0.2 * s);
  ctx.quadraticCurveTo(33 * s, y - R, 29 * s, y - R);
  ctx.lineTo(7 * s, y - R);
  ctx.lineTo(1 * s, y + R * 0.2);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, y + R, y - R, [[0, '#ffffff'], [0.6, '#eef1f3'], [1, '#c7ccd0']]);
  ctx.fill();
  // Tail fin
  poly(ctx, [2 * s, y + R * 0.6, 7.5 * s, y + R * 0.9, 4.2 * s, y + 9 * s, 1 * s, y + 9 * s], tail);
  if (austrian) {
    poly(ctx, [2.9 * s, y + 3.7 * s, 6 * s, y + 3.7 * s, 5.2 * s, y + 5.6 * s, 2.2 * s, y + 5.6 * s], stripe);
  } else {
    poly(ctx, [1.6 * s, y + 6 * s, 5 * s, y + 6 * s, 4.6 * s, y + 7 * s, 1.4 * s, y + 7 * s], stripe);
  }
  poly(ctx, [0.6 * s, y + 1.7 * s, 5 * s, y + 1.6 * s, 4.4 * s, y + 2.1 * s, 0.2 * s, y + 2.3 * s], '#d4d8db');
  // Windows and door
  for (let x = 8; x < 27; x += 0.85) rect(ctx, x * s, y + 0.5 * s, 0.38 * s, 0.5 * s, '#3b4752');
  rect(ctx, 28.6 * s, y - 0.3 * s, 0.9 * s, 1.9 * s, '#c4cacd');
  poly(ctx, [31 * s, y + 0.8 * s, 32.9 * s, y + 0.6 * s, 32.6 * s, y + 0.1 * s, 31 * s, y + 0.2 * s], '#2f3b46');
  rect(ctx, 6 * s, y - 0.6 * s, 22 * s, 0.35 * s, austrian ? '#d12a2f' : tail);
  // Near wing, engine, gear
  poly(ctx, [12 * s, y - 0.9 * s, 22 * s, y - 0.9 * s, 15 * s, y - 2.1 * s], '#b8bec2');
  ellipse(ctx, 18.5 * s, y - 2.1 * s, 2.8 * s, 1.05 * s, '#d9dde0');
  rect(ctx, 20.8 * s, y - 3.05 * s, 0.6 * s, 1.9 * s, '#3c4248');
  line(ctx, 15 * s, y - R, 15 * s, 0.7 * s, 0.35 * s, '#7c838a');
  line(ctx, 30 * s, y - R, 30 * s, 0.6 * s, 0.3 * s, '#7c838a');
  circle(ctx, 15 * s, 0.65 * s, 0.65 * s, '#23272b');
  circle(ctx, 30 * s, 0.55 * s, 0.55 * s, '#23272b');
}
