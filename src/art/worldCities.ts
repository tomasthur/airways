/**
 * Iconic approach silhouettes for every hub that doesn't already have a dedicated art file.
 * Drawn as billboards so Prague, Dubai, Tokyo etc. read the way SNP does in Bratislava.
 */
import type { SpriteSpec } from './Atlas';
import {
  ellipse,
  hgrad,
  line,
  poly,
  rect,
  shade,
  windows,
  type Ctx,
  type Rand,
} from './paint';
import { MID_GROUND } from './countryside';

const ground = (ctx: Ctx, w: number, c = MID_GROUND) => rect(ctx, 0, 0, w, 4, c);

export function worldCitySprites(): SpriteSpec[] {
  return [
    { name: 'prague_castle', w: 220, h: 90, ppm: 2.4, draw: drawPragueCastle },
    { name: 'charles_bridge', w: 240, h: 55, ppm: 2.5, draw: drawCharlesBridge },
    { name: 'prague_far', w: 520, h: 64, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 520, '#c4b89a', '#8a7a62', 8) },
    { name: 'budapest_parliament', w: 200, h: 90, ppm: 2.4, draw: drawParliament },
    { name: 'chain_bridge', w: 220, h: 50, ppm: 2.6, draw: drawChainBridge },
    { name: 'wawel', w: 180, h: 80, ppm: 2.5, draw: drawWawel },
    { name: 'krakow_far', w: 480, h: 58, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 480, '#c8bca4', '#7a6854', 6) },
    { name: 'pkin', w: 70, h: 200, ppm: 1.8, draw: drawPkin },
    { name: 'warsaw_far', w: 520, h: 70, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 520, '#b0bcc8', '#6a7888', 10) },
    { name: 'frauenkirche', w: 90, h: 110, ppm: 2.4, draw: drawFrauenkirche },
    { name: 'munich_far', w: 500, h: 58, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 500, '#c6b8a0', '#8a7058', 7) },
    { name: 'brandenburg', w: 140, h: 70, ppm: 2.6, draw: drawBrandenburg },
    { name: 'tv_tower', w: 36, h: 220, ppm: 1.7, draw: drawTvTower },
    { name: 'berlin_far', w: 540, h: 68, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 540, '#a8b4c0', '#5a6878', 9) },
    { name: 'canal_house', w: 160, h: 50, ppm: 2.8, draw: drawCanalHouses },
    { name: 'windmill', w: 70, h: 80, ppm: 2.6, draw: drawWindmill },
    { name: 'ams_far', w: 500, h: 52, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 500, '#c8b090', '#6a5848', 8) },
    { name: 'palacio_real', w: 160, h: 70, ppm: 2.5, draw: drawPalacio },
    { name: 'madrid_far', w: 500, h: 64, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 500, '#d2c4a8', '#8a7060', 7) },
    { name: 'duomo_milan', w: 140, h: 110, ppm: 2.4, draw: drawDuomo },
    { name: 'milan_far', w: 500, h: 60, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 500, '#c0c4c8', '#6a7078', 8) },
    { name: 'grossmunster', w: 80, h: 90, ppm: 2.5, draw: drawGrossmunster },
    { name: 'zurich_far', w: 480, h: 56, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 480, '#b8c0b0', '#5a7068', 6) },
    { name: 'hagia_sophia', w: 160, h: 100, ppm: 2.3, draw: drawHagia },
    { name: 'blue_mosque', w: 150, h: 95, ppm: 2.3, draw: drawBlueMosque },
    { name: 'istanbul_far', w: 540, h: 64, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 540, '#c8bca8', '#6a5a48', 8) },
    { name: 'parthenon', w: 140, h: 60, ppm: 2.6, draw: drawParthenon },
    { name: 'athens_far', w: 480, h: 54, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 480, '#d0c8b0', '#8a8068', 5) },
    { name: 'abril_bridge', w: 260, h: 70, ppm: 2.3, draw: drawAbrilBridge },
    { name: 'belem_tower', w: 70, h: 55, ppm: 2.8, draw: drawBelem },
    { name: 'lisbon_far', w: 500, h: 58, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 500, '#d8c4a0', '#8a7058', 7) },
    { name: 'dublin_spire', w: 24, h: 180, ppm: 1.8, draw: drawSpire },
    { name: 'dublin_far', w: 480, h: 54, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 480, '#b0b8b0', '#586860', 6) },
    { name: 'art_deco', w: 180, h: 70, ppm: 2.5, draw: drawArtDeco },
    { name: 'miami_far', w: 520, h: 62, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 520, '#e8c8b0', '#88a0b8', 8) },
    { name: 'burj_khalifa', w: 50, h: 280, ppm: 1.5, draw: drawBurj },
    { name: 'dubai_far', w: 560, h: 80, ppm: 1.4, draw: (ctx, r) => drawFar(ctx, r, 560, '#d8c8a8', '#c4a060', 12) },
    { name: 'pyramids', w: 220, h: 80, ppm: 2.2, draw: drawPyramids },
    { name: 'cairo_far', w: 500, h: 50, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 500, '#d4c090', '#a08050', 5) },
    { name: 'hollywood', w: 180, h: 36, ppm: 2.4, draw: drawHollywood },
    { name: 'lax_far', w: 540, h: 64, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 540, '#d0c8c0', '#88a0b0', 9) },
    { name: 'golden_gate', w: 280, h: 90, ppm: 2.2, draw: drawGoldenGate },
    { name: 'sfo_far', w: 520, h: 60, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 520, '#c0c8c8', '#6a8088', 8) },
    { name: 'skytree', w: 40, h: 260, ppm: 1.6, draw: drawSkytree },
    { name: 'tokyo_tower', w: 48, h: 160, ppm: 2.0, draw: drawTokyoTower },
    { name: 'tokyo_far', w: 560, h: 78, ppm: 1.4, draw: (ctx, r) => drawFar(ctx, r, 560, '#a8b0c0', '#4a5870', 14) },
    { name: 'marina_bay', w: 180, h: 90, ppm: 2.3, draw: drawMarinaBay },
    { name: 'singapore_far', w: 520, h: 70, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 520, '#c8d0d0', '#4a6878', 10) },
    { name: 'opera_house', w: 160, h: 70, ppm: 2.5, draw: drawOpera },
    { name: 'harbour_bridge', w: 260, h: 80, ppm: 2.2, draw: drawHarbourBridge },
    { name: 'sydney_far', w: 520, h: 58, ppm: 1.5, draw: (ctx, r) => drawFar(ctx, r, 520, '#c8d0c8', '#6a8888', 7) },
    { name: 'ifc_tower', w: 44, h: 220, ppm: 1.7, draw: drawIfc },
    { name: 'hongkong_far', w: 560, h: 86, ppm: 1.4, draw: (ctx, r) => drawFar(ctx, r, 560, '#b0bcc8', '#3a5068', 14) },
  ];
}

function drawFar(ctx: Ctx, r: Rand, W: number, wall: string, roof: string, n: number): void {
  ground(ctx, W, '#6a8a9a');
  for (let i = 0; i < n; i++) {
    const x = 8 + (i * (W - 16)) / n + r() * 6;
    const w = 18 + r() * 28;
    const h = 18 + r() * 36;
    rect(ctx, x, 4, w, h, shade(wall, r() * 0.12 - 0.06));
    windows(ctx, x + 2, 8, w - 4, h - 8, Math.max(2, Math.floor(w / 7)), Math.max(2, Math.floor(h / 8)), 2, 3, '#2a3038');
    if (r() < 0.35) rect(ctx, x, 4 + h, w, 3, roof);
  }
}

function drawPragueCastle(ctx: Ctx): void {
  ground(ctx, 220);
  rect(ctx, 10, 4, 200, 28, '#c8bca4');
  for (let x = 18; x < 200; x += 22) rect(ctx, x, 10, 6, 16, '#3a3028');
  poly(ctx, [70, 32, 150, 32, 140, 58, 80, 58], '#8a3a3a');
  rect(ctx, 20, 28, 22, 36, '#b8ac94');
  poly(ctx, [16, 64, 46, 64, 31, 88], '#6a3040');
  rect(ctx, 170, 28, 18, 40, '#b8ac94');
  poly(ctx, [166, 68, 192, 68, 179, 88], '#6a3040');
}

function drawCharlesBridge(ctx: Ctx): void {
  ground(ctx, 240, '#3a6b8c');
  rect(ctx, 0, 14, 240, 6, '#b8a888');
  for (let x = 16; x < 230; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x - 14, 14);
    ctx.quadraticCurveTo(x, 2, x + 14, 14);
    ctx.fillStyle = '#9a8a70';
    ctx.fill();
    rect(ctx, x - 3, 20, 6, 10, '#c4b49a');
  }
}

function drawParliament(ctx: Ctx): void {
  ground(ctx, 200, '#3a6b8c');
  rect(ctx, 8, 4, 184, 32, '#d8d0c0');
  windows(ctx, 12, 8, 176, 24, 18, 2, 4, 8, '#2a3850');
  rect(ctx, 86, 36, 28, 22, '#d8d0c0');
  ellipse(ctx, 100, 62, 18, 14, '#c8c0b0');
  rect(ctx, 98, 74, 4, 14, '#8a7a60');
  for (const x of [20, 50, 150, 178]) {
    rect(ctx, x, 36, 8, 28, '#d0c8b8');
    poly(ctx, [x - 2, 64, x + 10, 64, x + 4, 78], '#8a3040');
  }
}

function drawChainBridge(ctx: Ctx): void {
  ground(ctx, 220, '#3a6b8c');
  rect(ctx, 40, 4, 18, 40, '#c4b898');
  rect(ctx, 162, 4, 18, 40, '#c4b898');
  line(ctx, 8, 28, 212, 28, 3, '#4a4038');
  line(ctx, 49, 44, 8, 28, 2, '#4a4038');
  line(ctx, 171, 44, 212, 28, 2, '#4a4038');
}

function drawWawel(ctx: Ctx): void {
  ground(ctx, 180);
  rect(ctx, 16, 4, 148, 30, '#c8b090');
  rect(ctx, 30, 34, 24, 22, '#c0a880');
  poly(ctx, [26, 56, 58, 56, 42, 76], '#8a3a40');
  rect(ctx, 110, 34, 20, 28, '#c0a880');
  ellipse(ctx, 120, 66, 12, 10, '#6a8a6a');
}

function drawPkin(ctx: Ctx): void {
  ground(ctx, 70);
  rect(ctx, 8, 4, 54, 70, hgrad(ctx, 8, 62, [[0, '#8a96a4'], [1, '#c0c8d0']]));
  windows(ctx, 12, 10, 46, 60, 4, 8, 6, 5, '#2a3440');
  rect(ctx, 18, 74, 34, 50, '#b0bcc8');
  windows(ctx, 22, 78, 26, 42, 3, 6, 5, 4, '#2a3440');
  rect(ctx, 26, 124, 18, 40, '#c8d0d8');
  poly(ctx, [20, 164, 50, 164, 35, 196], '#d0d8e0');
}

function drawFrauenkirche(ctx: Ctx): void {
  ground(ctx, 90);
  rect(ctx, 8, 4, 74, 48, '#c4bca8');
  rect(ctx, 14, 52, 22, 36, '#c4bca8');
  rect(ctx, 54, 52, 22, 36, '#c4bca8');
  ellipse(ctx, 25, 92, 12, 10, '#4a4a52');
  ellipse(ctx, 65, 92, 12, 10, '#4a4a52');
}

function drawBrandenburg(ctx: Ctx): void {
  ground(ctx, 140);
  for (const x of [12, 36, 60, 84, 108]) rect(ctx, x, 4, 14, 48, '#e0d8c8');
  rect(ctx, 8, 52, 124, 10, '#e8e0d0');
  poly(ctx, [56, 62, 84, 62, 70, 78], '#d8d0c0');
}

function drawTvTower(ctx: Ctx): void {
  ground(ctx, 36);
  rect(ctx, 16, 4, 4, 140, '#c8d0d8');
  ellipse(ctx, 18, 150, 14, 16, '#e8eef2');
  rect(ctx, 16, 166, 4, 48, '#c8d0d8');
  ellipse(ctx, 18, 216, 3, 4, '#c0392b');
}

function drawCanalHouses(ctx: Ctx, r: Rand): void {
  ground(ctx, 160, '#3a6b8c');
  const colors = ['#c45a3a', '#d8c070', '#6a8a6a', '#4a6a8a', '#c8b090'];
  let x = 6;
  for (let i = 0; i < 6; i++) {
    const w = 22 + r() * 6;
    const h = 28 + r() * 14;
    rect(ctx, x, 8, w, h, colors[i % colors.length]);
    windows(ctx, x + 3, 12, w - 6, h - 10, 2, 3, 4, 5, '#2a2420');
    poly(ctx, [x - 1, 8 + h, x + w + 1, 8 + h, x + w / 2, 8 + h + 10], shade(colors[i % colors.length], -0.15));
    x += w + 2;
  }
}

function drawWindmill(ctx: Ctx): void {
  ground(ctx, 70);
  rect(ctx, 28, 4, 14, 36, '#c8b898');
  poly(ctx, [24, 40, 46, 40, 35, 58], '#8a4030');
  line(ctx, 12, 28, 58, 52, 3, '#4a3a28');
  line(ctx, 12, 52, 58, 28, 3, '#4a3a28');
}

function drawPalacio(ctx: Ctx): void {
  ground(ctx, 160);
  rect(ctx, 8, 4, 144, 40, '#e8dcc0');
  windows(ctx, 14, 10, 132, 28, 12, 2, 5, 8, '#3a4050');
  rect(ctx, 8, 44, 28, 18, '#e8dcc0');
  rect(ctx, 124, 44, 28, 18, '#e8dcc0');
  poly(ctx, [70, 44, 90, 44, 80, 62], '#c8b090');
}

function drawDuomo(ctx: Ctx): void {
  ground(ctx, 140);
  rect(ctx, 10, 4, 120, 36, '#d8d4cc');
  for (let x = 16; x < 124; x += 10) poly(ctx, [x, 40, x + 6, 40, x + 3, 52], '#e8e4dc');
  rect(ctx, 58, 36, 24, 40, '#d8d4cc');
  poly(ctx, [54, 76, 86, 76, 70, 108], '#e8e4dc');
}

function drawGrossmunster(ctx: Ctx): void {
  ground(ctx, 80);
  rect(ctx, 10, 4, 28, 56, '#c8bca8');
  rect(ctx, 42, 4, 28, 56, '#c8bca8');
  rect(ctx, 16, 60, 16, 18, '#c8bca8');
  rect(ctx, 48, 60, 16, 18, '#c8bca8');
}

function drawHagia(ctx: Ctx): void {
  ground(ctx, 160);
  rect(ctx, 20, 4, 120, 36, '#d8d0c0');
  ellipse(ctx, 80, 52, 40, 28, '#c8c0b0');
  ellipse(ctx, 80, 78, 18, 16, '#c8c0b0');
  for (const x of [12, 40, 120, 148]) {
    rect(ctx, x, 4, 6, 70, '#d0c8b8');
    poly(ctx, [x - 4, 74, x + 10, 74, x + 3, 92], '#8a6a40');
  }
}

function drawBlueMosque(ctx: Ctx): void {
  ground(ctx, 150);
  rect(ctx, 18, 4, 114, 32, '#c8d0d8');
  ellipse(ctx, 75, 46, 36, 24, '#b8c8d4');
  for (const x of [8, 36, 108, 136]) {
    rect(ctx, x, 4, 5, 72, '#c0c8d0');
    poly(ctx, [x - 3, 76, x + 8, 76, x + 2.5, 94], '#8a6a48');
  }
}

function drawParthenon(ctx: Ctx): void {
  ground(ctx, 140);
  rect(ctx, 8, 4, 124, 8, '#e0d8c4');
  for (let x = 14; x < 126; x += 12) rect(ctx, x, 12, 7, 32, '#e8e0cc');
  poly(ctx, [6, 44, 134, 44, 70, 58], '#e0d8c4');
}

function drawAbrilBridge(ctx: Ctx): void {
  ground(ctx, 260, '#3a6b8c');
  rect(ctx, 70, 4, 10, 62, '#c45a28');
  rect(ctx, 180, 4, 10, 62, '#c45a28');
  line(ctx, 8, 40, 252, 40, 4, '#c45a28');
  line(ctx, 75, 66, 8, 40, 2, '#8a3a18');
  line(ctx, 185, 66, 252, 40, 2, '#8a3a18');
}

function drawBelem(ctx: Ctx): void {
  ground(ctx, 70, '#3a6b8c');
  rect(ctx, 14, 8, 42, 28, '#d8c8a8');
  rect(ctx, 22, 36, 14, 14, '#d8c8a8');
  windows(ctx, 18, 12, 34, 20, 4, 2, 4, 6, '#3a3028');
}

function drawSpire(ctx: Ctx): void {
  ground(ctx, 24);
  poly(ctx, [10, 4, 14, 4, 12, 178], '#c8d0d8');
}

function drawArtDeco(ctx: Ctx): void {
  ground(ctx, 180, '#3a8aaa');
  const cols = ['#f2c8c0', '#f8e0b0', '#c8e0e8', '#e8c0d0'];
  let x = 8;
  for (let i = 0; i < 5; i++) {
    const w = 28;
    const h = 28 + (i % 3) * 10;
    rect(ctx, x, 6, w, h, cols[i % cols.length]);
    windows(ctx, x + 3, 10, w - 6, h - 8, 3, 3, 4, 5, '#3a4058');
    x += 34;
  }
}

function drawBurj(ctx: Ctx): void {
  ground(ctx, 50, '#c9a66a');
  poly(ctx, [8, 4, 42, 4, 28, 270], hgrad(ctx, 8, 42, [[0, '#8aa0b8'], [1, '#d8e4f0']]));
  rect(ctx, 24, 250, 4, 28, '#c8d4e0');
}

function drawPyramids(ctx: Ctx): void {
  ground(ctx, 220, '#c9a66a');
  poly(ctx, [20, 4, 100, 4, 60, 72], '#d8c090');
  poly(ctx, [80, 4, 150, 4, 115, 52], '#c8b078');
  poly(ctx, [140, 4, 200, 4, 170, 36], '#d0b888');
}

function drawHollywood(ctx: Ctx): void {
  ground(ctx, 180, '#8a9a6a');
  rect(ctx, 10, 8, 160, 22, '#f4f0e8');
  ctx.save();
  ctx.scale(1, -1);
  ctx.font = '700 14px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#2a2a28';
  ctx.fillText('HOLLYWOOD', 90, -14);
  ctx.restore();
}

function drawGoldenGate(ctx: Ctx): void {
  ground(ctx, 280, '#3a6b8c');
  rect(ctx, 70, 4, 12, 80, '#c45a28');
  rect(ctx, 198, 4, 12, 80, '#c45a28');
  line(ctx, 8, 48, 272, 48, 4, '#c45a28');
  line(ctx, 76, 84, 8, 48, 2.5, '#a04420');
  line(ctx, 204, 84, 272, 48, 2.5, '#a04420');
  for (let x = 86; x < 198; x += 14) line(ctx, x, 48, x, 62 + Math.sin((x - 76) * 0.04) * 10, 1.4, '#a04420');
}

function drawSkytree(ctx: Ctx): void {
  ground(ctx, 40);
  poly(ctx, [6, 4, 34, 4, 22, 220], '#48a0c8');
  ellipse(ctx, 20, 150, 12, 10, '#d0e8f4');
  rect(ctx, 18, 220, 4, 36, '#48a0c8');
}

function drawTokyoTower(ctx: Ctx): void {
  ground(ctx, 48);
  line(ctx, 8, 4, 24, 150, 4, '#c0392b');
  line(ctx, 40, 4, 24, 150, 4, '#c0392b');
  rect(ctx, 14, 50, 20, 6, '#f4e0a0');
  rect(ctx, 16, 100, 16, 5, '#f4e0a0');
}

function drawMarinaBay(ctx: Ctx): void {
  ground(ctx, 180, '#3a6b8c');
  rect(ctx, 20, 4, 28, 64, '#d8e0e8');
  rect(ctx, 62, 4, 28, 70, '#d8e0e8');
  rect(ctx, 104, 4, 28, 60, '#d8e0e8');
  poly(ctx, [16, 68, 136, 64, 136, 78, 16, 82], '#c8d4e0');
}

function drawOpera(ctx: Ctx): void {
  ground(ctx, 160, '#3a6b8c');
  ellipse(ctx, 50, 18, 36, 22, '#f4f0e8');
  ellipse(ctx, 90, 24, 40, 28, '#f8f4ec');
  ellipse(ctx, 128, 16, 24, 16, '#f0ece4');
}

function drawHarbourBridge(ctx: Ctx): void {
  ground(ctx, 260, '#3a6b8c');
  ctx.beginPath();
  ctx.moveTo(20, 16);
  ctx.quadraticCurveTo(130, 78, 240, 16);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#4a4a52';
  ctx.stroke();
  rect(ctx, 16, 4, 228, 12, '#5a5a62');
}

function drawIfc(ctx: Ctx): void {
  ground(ctx, 44);
  rect(ctx, 8, 4, 28, 200, hgrad(ctx, 8, 36, [[0, '#6a8098'], [1, '#d0dce8']]));
  windows(ctx, 12, 10, 20, 188, 2, 16, 6, 8, '#2a3848');
}
