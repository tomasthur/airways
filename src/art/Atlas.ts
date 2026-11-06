import * as THREE from 'three';
import { rng, type Ctx, type Rand } from './paint';

export interface SpriteSpec {
  name: string;
  /** Size in metres. */
  w: number;
  h: number;
  /** Texture pixels per metre. */
  ppm: number;
  draw: (ctx: Ctx, r: Rand) => void;
}

export interface SpriteFrame {
  page: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
}

const PAGE_W = 2048;
const MAX_PAGE_H = 2048;
const PAD = 4;

interface Placed {
  spec: SpriteSpec;
  pw: number;
  ph: number;
  x: number;
  y: number;
  page: number;
}

/** Packs procedurally painted sprites into a few large canvas textures (shelf packing). */
export class Atlas {
  private specs: SpriteSpec[] = [];

  add(...specs: SpriteSpec[]): void {
    this.specs.push(...specs);
  }

  build(anisotropy: number): { pages: THREE.Texture[]; frames: Map<string, SpriteFrame> } {
    const items: Placed[] = this.specs.map((spec) => ({
      spec,
      pw: Math.ceil(spec.w * spec.ppm) + PAD * 2,
      ph: Math.ceil(spec.h * spec.ppm) + PAD * 2,
      x: 0,
      y: 0,
      page: 0,
    }));
    items.sort((a, b) => b.ph - a.ph);

    const pageHeights: number[] = [];
    let page = 0;
    let shelfY = 0;
    let shelfH = 0;
    let cursorX = 0;
    for (const it of items) {
      if (it.pw > PAGE_W) throw new Error(`Sprite ${it.spec.name} too wide`);
      if (cursorX + it.pw > PAGE_W) {
        shelfY += shelfH;
        cursorX = 0;
        shelfH = 0;
      }
      if (shelfY + it.ph > MAX_PAGE_H) {
        pageHeights[page] = shelfY;
        page++;
        shelfY = 0;
        cursorX = 0;
        shelfH = 0;
      }
      it.x = cursorX;
      it.y = shelfY;
      it.page = page;
      cursorX += it.pw;
      shelfH = Math.max(shelfH, it.ph);
    }
    pageHeights[page] = shelfY + shelfH;

    const canvases = pageHeights.map((h) => {
      const c = document.createElement('canvas');
      c.width = PAGE_W;
      c.height = Math.max(256, 2 ** Math.ceil(Math.log2(h)));
      return c;
    });

    const frames = new Map<string, SpriteFrame>();
    for (const it of items) {
      const canvas = canvases[it.page];
      const ctx = canvas.getContext('2d')!;
      const { spec } = it;
      const wpx = it.pw - PAD * 2;
      const hpx = it.ph - PAD * 2;
      ctx.save();
      ctx.setTransform(spec.ppm, 0, 0, -spec.ppm, it.x + PAD, it.y + PAD + hpx);
      ctx.beginPath();
      ctx.rect(0, 0, spec.w, spec.h);
      ctx.clip();
      spec.draw(ctx, rng(hashString(spec.name)));
      ctx.restore();
      // Extrude the bottom row into the padding so skirts and mipmaps stay solid.
      ctx.drawImage(canvas, it.x + PAD, it.y + PAD + hpx - 1, wpx, 1, it.x + PAD, it.y + PAD + hpx, wpx, PAD);

      const W = canvas.width;
      const H = canvas.height;
      frames.set(spec.name, {
        page: it.page,
        u0: (it.x + PAD + 0.5) / W,
        u1: (it.x + PAD + wpx - 0.5) / W,
        v0: 1 - (it.y + PAD + hpx - 1.5) / H,
        v1: 1 - (it.y + PAD + 0.5) / H,
        w: spec.w,
        h: spec.h,
      });
    }

    const pages = canvases.map((c) => makeCanvasTexture(c, anisotropy, false));
    return { pages, frames };
  }
}

export function makeCanvasTexture(canvas: HTMLCanvasElement, anisotropy: number, repeat: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  tex.anisotropy = anisotropy;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  if (repeat) tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Paints a seamless horizontally repeating tile in metres (y up). */
export function paintTile(wMetres: number, hMetres: number, ppm: number, seed: number, draw: (ctx: Ctx, r: Rand) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(wMetres * ppm);
  canvas.height = Math.round(hMetres * ppm);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ppm, 0, 0, -ppm, 0, canvas.height);
  draw(ctx, rng(seed));
  return canvas;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
