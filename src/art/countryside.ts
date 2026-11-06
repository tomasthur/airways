import type { SpriteSpec } from './Atlas';
import { circle, ellipse, line, mix, poly, poplar, range, rect, roof, tree, treeCrown, vgrad, windows } from './paint';

/** Bottom colour shared by the mid-distance layer so sprite skirts blend with the tile. */
export const MID_GROUND = '#86a55a';

const TREE_GREENS = ['#4f7f3c', '#5c8a44', '#46733a'];

export function countrySprites(): SpriteSpec[] {
  const list: SpriteSpec[] = [];

  TREE_GREENS.forEach((g, i) =>
    list.push({
      name: `tree_${i}`,
      w: 12,
      h: 15,
      ppm: 6,
      draw: (ctx, r) => tree(ctx, r, 6, 0, 14.5, g),
    }),
  );
  list.push({ name: 'poplar', w: 6, h: 22, ppm: 6, draw: (ctx) => poplar(ctx, 3, 0, 21.5, '#5a8a42') });
  list.push({
    name: 'bush',
    w: 9,
    h: 5,
    ppm: 6,
    draw: (ctx, r) => {
      treeCrown(ctx, r, 3, 2.2, 2.2, '#557f3e');
      treeCrown(ctx, r, 6, 2, 2.4, '#4c7639');
    },
  });

  list.push({
    name: 'house_a',
    w: 15,
    h: 11,
    ppm: 6,
    draw: (ctx) => {
      rect(ctx, 0.5, 0, 14, 6, '#efe6d2');
      rect(ctx, 0.5, 0, 14, 0.6, '#b8ab92');
      roof(ctx, 0.5, 6, 14, 4.2, 2.2, '#b5513a');
      rect(ctx, 10.5, 8, 1, 2.6, '#8d4a36');
      windows(ctx, 1.5, 1.5, 12, 3, 4, 1, 1.2, 1.5, '#4a5560');
      rect(ctx, 6.8, 0, 1.4, 2.6, '#6b4a33');
    },
  });
  list.push({
    name: 'house_b',
    w: 19,
    h: 12,
    ppm: 6,
    draw: (ctx) => {
      rect(ctx, 0.5, 0, 18, 7, '#e8cf8f');
      roof(ctx, 0.5, 7, 18, 4.6, 2.5, '#8f4936');
      windows(ctx, 1.5, 1.2, 16, 5, 5, 2, 1.2, 1.4, '#4a5560');
      rect(ctx, 0.5, 0, 18, 0.5, '#a89060');
    },
  });

  list.push({
    name: 'village',
    w: 240,
    h: 48,
    ppm: 2.5,
    draw: (ctx, r) => {
      rect(ctx, 0, 0, 240, 4, MID_GROUND);
      // Church with onion dome
      const cx = 118;
      rect(ctx, cx - 9, 4, 18, 14, '#f1ead8');
      roof(ctx, cx - 9, 18, 18, 5, 1, '#9b4a36');
      rect(ctx, cx + 9, 4, 22, 10, '#ece3cf');
      roof(ctx, cx + 9, 14, 22, 6, 1, '#a24e38');
      rect(ctx, cx - 4, 18, 8, 12, '#f4eee0');
      ellipse(ctx, cx, 33, 4.5, 3.6, '#4f6d5a');
      ellipse(ctx, cx + 1, 34, 2.6, 2, '#6e8d77');
      poly(ctx, [cx - 1.4, 36, cx + 1.4, 36, cx, 41], '#4f6d5a');
      line(ctx, cx, 41, cx, 44.5, 0.4, '#c9a640');
      line(ctx, cx - 1.2, 43.2, cx + 1.2, 43.2, 0.4, '#c9a640');
      rect(ctx, cx - 1, 25, 2, 2.5, '#3b4148');
      // Houses around
      let x = 4;
      while (x < 230) {
        if (Math.abs(x - cx) < 34) {
          x += 6;
          continue;
        }
        const w = range(r, 9, 16);
        const h = range(r, 5, 8);
        const wall = ['#f2ead8', '#ead39a', '#f0dcc4', '#e4e0d0'][Math.floor(r() * 4)];
        rect(ctx, x, 3.5, w, h, wall);
        roof(ctx, x, 3.5 + h, w, range(r, 3, 5), 1.5, mix('#b1523a', '#7f3f30', r()));
        windows(ctx, x + 1, 4.5, w - 2, h - 2, Math.max(1, Math.floor(w / 4)), 1, 1, 1.4, '#55606b');
        if (r() < 0.45) treeCrown(ctx, r, x + w + 3, 8 + r() * 3, range(r, 3.5, 5), '#517c3f');
        x += w + range(r, 1, 9);
      }
    },
  });

  list.push({
    name: 'turbine_tower',
    w: 10,
    h: 100,
    ppm: 2.5,
    draw: (ctx) => {
      poly(ctx, [3.4, 0, 6.6, 0, 5.7, 94, 4.3, 94], vgradTower(ctx));
      rect(ctx, 2.5, 93, 6.5, 3.4, '#e9edf0');
      rect(ctx, 2.5, 93, 6.5, 0.9, '#c3c9cf');
    },
  });
  list.push({
    name: 'turbine_blades',
    w: 96,
    h: 96,
    ppm: 2.5,
    draw: (ctx) => {
      const c = 48;
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const px = -sa;
        const py = ca;
        poly(
          ctx,
          [
            c + px * 1.6, c + py * 1.6,
            c + ca * 12 + px * 2.2, c + sa * 12 + py * 2.2,
            c + ca * 46 + px * 0.5, c + sa * 46 + py * 0.5,
            c + ca * 46 - px * 0.3, c + sa * 46 - py * 0.3,
            c - px * 1.0, c - py * 1.0,
          ],
          '#f1f3f5',
        );
      }
      circle(ctx, c, c, 2.2, '#dfe3e7');
    },
  });

  for (let i = 0; i < 5; i++) list.push(cloudSprite(`cloud_${i}`, i));
  return list;
}

function vgradTower(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(3.4, 0, 6.6, 0);
  g.addColorStop(0, '#c9d0d6');
  g.addColorStop(0.6, '#f4f6f8');
  g.addColorStop(1, '#e1e6ea');
  return g;
}

function cloudSprite(name: string, variant: number): SpriteSpec {
  const W = 260;
  const H = 110;
  return {
    name,
    w: W,
    h: H,
    ppm: 1.6,
    draw: (ctx, r) => {
      const puffs: [number, number, number][] = [];
      const count = 9 + variant * 2;
      const span = range(r, 150, 220);
      const x0 = (W - span) / 2;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const x = x0 + t * span + range(r, -10, 10);
        const bell = Math.sin(t * Math.PI);
        const rad = range(r, 16, 24) + bell * range(r, 14, 26);
        const y = 22 + rad * 0.55 + bell * range(r, 6, 20);
        puffs.push([x, y, rad]);
      }
      // Soft shadowed base
      for (const [x, y, rad] of puffs) {
        const g = ctx.createRadialGradient(x, y - rad * 0.2, rad * 0.2, x, y, rad * 1.05);
        g.addColorStop(0, 'rgba(176,190,210,0.95)');
        g.addColorStop(0.75, 'rgba(176,190,210,0.85)');
        g.addColorStop(1, 'rgba(176,190,210,0)');
        circle(ctx, x, y, rad * 1.05, g);
      }
      // Sunlit tops
      for (const [x, y, rad] of puffs) {
        const g = ctx.createRadialGradient(x + rad * 0.25, y + rad * 0.45, rad * 0.1, x + rad * 0.1, y + rad * 0.2, rad * 0.95);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.6, 'rgba(246,248,252,0.9)');
        g.addColorStop(1, 'rgba(236,241,248,0)');
        circle(ctx, x + rad * 0.08, y + rad * 0.18, rad * 0.95, g);
      }
      // Flat-ish bottom fade
      ctx.globalCompositeOperation = 'destination-out';
      rect(ctx, 0, 0, W, 30, vgrad(ctx, 30, 0, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']]));
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}
