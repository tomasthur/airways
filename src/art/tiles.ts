import { paintTile } from './Atlas';
import {
  rng,
  circle,
  fillProfile,
  mix,
  periodicNoise,
  pick,
  poly,
  poplar,
  range,
  rect,
  roof,
  shade,
  tree,
  treeCrown,
  vgrad,
  type Ctx,
  type Rand,
} from './paint';

export interface TileSpec {
  canvas: HTMLCanvasElement;
  /** World size of one repeat in metres. */
  w: number;
  h: number;
}

/** Draws f at x and its wrapped copies so objects crossing the tile edge stay seamless. */
function wrapped(W: number, x: number, margin: number, r: Rand, f: (x: number, rr: Rand) => void): void {
  const seed = Math.floor(r() * 4294967296);
  f(x, rng(seed));
  if (x < margin) f(x + W, rng(seed));
  if (x > W - margin) f(x - W, rng(seed));
}

export function paintMountainTile(): TileSpec {
  const W = 2048;
  const H = 512;
  const canvas = paintTile(W, H, 1, 11, (ctx, r) => {
    const far = periodicNoise(r, W, [[1, 50], [2, 38], [3, 26], [5, 18], [7, 12], [11, 7], [17, 4], [29, 2]], true);
    const mid = periodicNoise(r, W, [[1, 30], [2, 34], [4, 20], [6, 12], [9, 8], [14, 5], [23, 3], [41, 1.5]], true);
    const near = periodicNoise(r, W, [[2, 22], [3, 18], [5, 12], [8, 7], [13, 4], [37, 1.6], [61, 1]]);

    // Low, rounded ranges (Little Carpathians / Leitha hills), not alpine peaks
    const farH = (x: number) => 175 + far(x) * 0.5;
    const midH = (x: number) => 135 + mid(x) * 0.5;
    fillProfile(ctx, 0, W, farH, vgrad(ctx, 280, 0, [[0, '#6f8aa8'], [0.6, '#8aa1ba'], [1, '#a7b8c9']]), 2);
    fillProfile(ctx, 0, W, midH, vgrad(ctx, 200, 0, [[0, '#56708e'], [0.55, '#6f88a3'], [1, '#97aabd']]), 2);
    // Sunlit ridge highlights on the mid range
    ctx.globalAlpha = 0.2;
    for (let x = 0; x < W; x += 3) {
      const h = midH(x);
      const slope = midH(x + 3) - h;
      if (slope < -0.25) rect(ctx, x, h - 16, 3, 15, '#c2d0de');
    }
    ctx.globalAlpha = 1;
    fillProfile(ctx, 0, W, (x) => 95 + near(x) * 0.8, vgrad(ctx, 140, 0, [[0, '#4b6a74'], [0.5, '#5e7c84'], [1, '#8fa6b0']]), 2);
    // Forest texture on the nearest ridge
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 1400; i++) {
      const x = r() * W;
      const top = 95 + near(x) * 0.8;
      const y = top - r() * 50;
      wrapped(W, x, 6, r, (xx, rr) => circle(ctx, xx, y, range(rr, 2, 5), rr() < 0.5 ? '#3f5d63' : '#56767a'));
    }
    ctx.globalAlpha = 1;
    // Valley mist
    rect(ctx, 0, 0, W, 90, vgrad(ctx, 90, 0, [[0, 'rgba(176,196,212,0)'], [1, 'rgba(176,196,212,0.85)']]));
    rect(ctx, 0, 0, W, 8, '#a2b6c6');
  });
  return { canvas, w: W, h: H };
}

const FIELD_COLORS = ['#9bb85a', '#b6c46a', '#d9c477', '#7fa24c', '#c9b25e', '#e3d35a', '#8fae58', '#a88f5c', '#6f9a4a'];

/** Soft, low-contrast canopy blob used for distant woodland. */
function canopy(ctx: Ctx, x: number, y: number, rad: number, base: string): void {
  circle(ctx, x, y - rad * 0.2, rad, shade(base, -0.12));
  circle(ctx, x + rad * 0.18, y + rad * 0.05, rad * 0.72, base);
  circle(ctx, x + rad * 0.32, y + rad * 0.3, rad * 0.32, shade(base, 0.1));
}

export function paintHillsTile(): TileSpec {
  const W = 1200;
  const H = 300;
  const canvas = paintTile(W, H, 2048 / W, 23, (ctx, r) => {
    const back = periodicNoise(r, W, [[1, 16], [2, 14], [3, 9], [5, 6], [8, 3.5], [13, 1.8], [21, 1]]);
    const front = periodicNoise(r, W, [[1, 9], [2, 11], [3, 6], [4, 5], [7, 2.5], [11, 1.2]]);
    const backH = (x: number) => 104 + back(x);
    const frontH = (x: number) => 62 + front(x);

    // Distant forested hills
    fillProfile(ctx, 0, W, backH, vgrad(ctx, 140, 40, [[0, '#577a51'], [1, '#6c8d5d']]), 2);
    for (let i = 0; i < 2600; i++) {
      const x = r() * W;
      const y = backH(x) - r() * r() * 55 + 0.5;
      wrapped(W, x, 6, r, (xx, rr) => canopy(ctx, xx, y, range(rr, 1.4, 2.6), rr() < 0.5 ? '#4f7349' : '#5b7f51'));
    }
    // Clearings with hamlets on the back hills
    for (let i = 0; i < 6; i++) {
      const x = r() * W;
      const y = backH(x) - range(r, 25, 40);
      wrapped(W, x, 30, r, (xx, rr) => {
        poly(ctx, [xx - 22, y - 6, xx + 22, y - 7, xx + 19, y + 4, xx - 19, y + 6], '#9fb26a');
        for (let k = 0; k < 4; k++) {
          const hx = xx - 13 + k * 7 + rr() * 3;
          rect(ctx, hx, y - 1.5, 4, 2.6, '#e8e0cf');
          poly(ctx, [hx - 0.4, y + 1.1, hx + 4.4, y + 1.1, hx + 2, y + 3], '#b5523b');
        }
      });
    }

    // Front hills: patchwork of fields
    fillProfile(ctx, 0, W, frontH, '#86a456', 2);
    const bands = [0, 6, 13, 21, 31, 43, 62];
    for (let b = 0; b < bands.length - 1; b++) {
      let x = 0;
      while (x < W) {
        const fw = Math.min(range(r, 40, 140), W - x);
        const color = mix(pick(r, FIELD_COLORS), '#8aa65a', 0.25);
        const d0 = bands[b];
        const d1 = bands[b + 1];
        ctx.beginPath();
        for (let xx = x; xx <= x + fw; xx += 4) ctx.lineTo(Math.min(xx, x + fw), frontH(Math.min(xx, x + fw)) - d0);
        for (let xx = x + fw; xx >= x; xx -= 4) ctx.lineTo(Math.max(xx, x), frontH(Math.max(xx, x)) - d1);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 0.12;
        for (let s = x + 3; s < x + fw; s += 5) {
          const y0 = frontH(s) - d0;
          poly(ctx, [s, y0, s + 1.5, y0, s + 2, y0 - (d1 - d0), s + 0.5, y0 - (d1 - d0)], shade(color, -0.3));
        }
        ctx.globalAlpha = 1;
        x += fw;
      }
    }
    // Hedgerows along field contours and woodland patches
    for (let i = 0; i < 700; i++) {
      const x = r() * W;
      const y = frontH(x) - pick(r, bands.slice(1)) + 1;
      wrapped(W, x, 6, r, (xx, rr) => canopy(ctx, xx, y, range(rr, 1.2, 2.2), '#527c40'));
    }
    for (let i = 0; i < 7; i++) {
      const cx = r() * W;
      const n = 90 + Math.floor(r() * 90);
      for (let k = 0; k < n; k++) {
        const x = cx + range(r, -35, 35);
        const y = frontH(x) - r() * 22 + 2;
        wrapped(W, x, 8, r, (xx, rr) => canopy(ctx, xx, y, range(rr, 1.6, 3), rr() < 0.5 ? '#4a733c' : '#5a8446'));
      }
    }
    // Small farmsteads
    for (let i = 0; i < 8; i++) {
      const x = r() * W;
      const y = frontH(x) - range(r, 5, 30);
      wrapped(W, x, 10, r, (xx) => {
        rect(ctx, xx, y, 6.5, 3.6, '#efe7d6');
        roof(ctx, xx, y + 3.6, 6.5, 2.4, 1, '#b4553a');
      });
    }
    rect(ctx, 0, 0, W, 3, '#7e9c50');
  });
  return { canvas, w: W, h: H };
}

/** Sandy ridges for desert / Gulf hops. */
export function paintDesertTile(): TileSpec {
  const W = 1200;
  const H = 280;
  const canvas = paintTile(W, H, 2048 / W, 41, (ctx, r) => {
    const back = periodicNoise(r, W, [[1, 18], [2, 12], [3, 8], [5, 5], [8, 3]]);
    const front = periodicNoise(r, W, [[1, 10], [2, 8], [4, 5], [7, 2.5]]);
    const backH = (x: number) => 88 + back(x);
    const frontH = (x: number) => 42 + front(x);
    fillProfile(ctx, 0, W, backH, vgrad(ctx, 140, 30, [[0, '#c4a06a'], [1, '#e2c48a']]), 2);
    fillProfile(ctx, 0, W, frontH, vgrad(ctx, 80, 10, [[0, '#d4b07a'], [1, '#edcf96']]), 2);
    ctx.globalAlpha = 0.18;
    for (let x = 0; x < W; x += 4) {
      const h = frontH(x);
      if (frontH(x + 4) - h < -0.2) rect(ctx, x, h - 10, 4, 10, '#fff3d0');
    }
    ctx.globalAlpha = 1;
    rect(ctx, 0, 0, W, 4, '#c9a66a');
  });
  return { canvas, w: W, h: H };
}

/** Near countryside strip: tree lines, poplars, farms. Transparent sky above. */
export function paintCountryTile(): TileSpec {
  const W = 820;
  const H = 205;
  const canvas = paintTile(W, H, 2048 / W, 37, (ctx, r) => {
    drawCountryStrip(ctx, r, W);
  });
  return { canvas, w: W, h: H };
}

function drawCountryStrip(ctx: Ctx, r: Rand, W: number): void {
  const groundTop = 12;
  // Distant field bands seen at a grazing angle
  const bandYs = [0, 2.5, 4.5, 6.5, 8.5, 10.5, groundTop];
  for (let b = 0; b < bandYs.length - 1; b++) {
    let x = 0;
    while (x < W) {
      const fw = Math.min(range(r, 30, 110), W - x);
      rect(ctx, x, bandYs[b], fw, bandYs[b + 1] - bandYs[b] + 0.2, mix(pick(r, FIELD_COLORS), '#88a85a', 0.3));
      x += fw;
    }
  }

  // Tree lines along the horizon with gaps
  let x = 0;
  while (x < W) {
    const len = range(r, 40, 160);
    const gap = range(r, 15, 70);
    for (let t = x; t < Math.min(x + len, W); t += range(r, 4, 8)) {
      const h = range(r, 10, 20);
      const base = pick(r, ['#4c7a3a', '#5a8743', '#4a6f37', '#628d48']);
      wrapped(W, t, 10, r, (xx, rr) => tree(ctx, rr, xx, groundTop - 1, h, base));
    }
    x += len + gap;
  }
  // Poplar rows
  for (let i = 0; i < 4; i++) {
    const px = r() * W;
    for (let k = 0; k < 8; k++) {
      wrapped(W, px + k * 6, 8, r, (xx, rr) => poplar(ctx, xx, groundTop - 1, range(rr, 20, 26), '#5f8c45'));
    }
  }
  // Farms with barns
  for (let i = 0; i < 4; i++) {
    const fx = r() * W;
    wrapped(W, fx, 40, r, (xx, rr) => {
      rect(ctx, xx, groundTop - 1, 16, 7, '#f0e8d8');
      roof(ctx, xx, groundTop + 6, 16, 5, 2.5, '#b65a3c');
      rect(ctx, xx + 19, groundTop - 1, 20, 8, '#a2836a');
      roof(ctx, xx + 19, groundTop + 7, 20, 4, 1.5, '#6f6359');
      treeCrown(ctx, rr, xx - 6, groundTop + 8, 6, '#557f3f');
    });
  }
  // Haystacks
  for (let i = 0; i < 10; i++) {
    const hx = r() * W;
    wrapped(W, hx, 4, r, (xx) => {
      circle(ctx, xx, groundTop - 2, 1.6, '#cfae5f');
      circle(ctx, xx + 0.4, groundTop - 1.6, 1.0, '#e2c57a');
    });
  }
  rect(ctx, 0, 0, W, 2, '#86a55a');
}
