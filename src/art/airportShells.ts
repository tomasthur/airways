/**
 * Distinct airport terminal shells — same silhouette family, different massing,
 * painted with a per-destination title so every hop feels named.
 */
import type { SpriteSpec } from './Atlas';
import { circle, hgrad, line, poly, rect, shade, text, vgrad, type Ctx, type Rand } from './paint';
import { AIRPORTS, FLYABLE_IATAS, type AirportShellId } from '../meta/airports';

const W = 360;
const H = 32;

function titleSize(title: string): number {
  if (title.length > 30) return 2.6;
  if (title.length > 24) return 2.9;
  return 3.3;
}

function paintTitle(ctx: Ctx, title: string, y: number, color = '#ffffff'): void {
  const size = titleSize(title);
  const w = Math.min(W - 24, title.length * size * 0.62 + 10);
  ctx.globalAlpha = 0.22;
  rect(ctx, (W - w) / 2, y - size * 0.2, w, size * 1.15, '#061018');
  ctx.globalAlpha = 1;
  text(ctx, title, W / 2, y, size, color, 'center', 700);
}

function glass(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  rect(
    ctx,
    x,
    y,
    w,
    h,
    vgrad(ctx, y + h, y, [
      [0, '#d7ebf6'],
      [0.38, '#7ea4bd'],
      [0.72, '#3a5a72'],
      [1, '#1f3344'],
    ]),
  );
  ctx.globalAlpha = 0.26;
  rect(ctx, x, y + h * 0.52, w, h * 0.22, '#f3fbff');
  ctx.globalAlpha = 1;
  ctx.globalAlpha = 0.2;
  rect(ctx, x + 2, y + 1.2, w - 4, Math.max(1.4, h * 0.2), '#efd7a0');
  ctx.globalAlpha = 1;
  for (let i = x + 3; i < x + w - 1; i += 5.4) rect(ctx, i, y, 0.42, h, 'rgba(236,244,248,0.55)');
  rect(ctx, x, y + h * 0.4, w, 0.38, 'rgba(236,244,248,0.45)');
}

function roofCap(ctx: Ctx, x: number, y: number, w: number, thick = 2.5, color = '#eef1f3'): void {
  rect(ctx, x, y - 0.45, w, 0.45, shade('#6d757c', 0.05));
  rect(ctx, x, y, w, thick, color);
  rect(ctx, x, y + thick - 0.5, w, 0.5, '#f7f9fa');
}

function plinth(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  rect(ctx, x, y, w, h, vgrad(ctx, y + h, y, [[0, '#a4aaae'], [1, '#6e7479']]));
  rect(ctx, x, y + h - 0.4, w, 0.4, '#c5cacd');
}

function doors(ctx: Ctx, xs: number[], y: number, h: number): void {
  for (const x of xs) {
    rect(ctx, x, y, 9, h, '#1a252c');
    rect(ctx, x + 0.55, y + 0.5, 3.6, h - 1, '#c8dcea');
    rect(ctx, x + 4.85, y + 0.5, 3.6, h - 1, '#c8dcea');
  }
}

function columns(ctx: Ctx, xs: number[], y: number, h: number): void {
  for (const x of xs) {
    rect(ctx, x, y, 1.1, h, '#c5ccd1');
    rect(ctx, x + 0.15, y, 0.35, h, '#f4f6f7');
  }
}

/** Long glass curtain wall with flat white roof. */
function shellGlassBar(ctx: Ctx, _r: Rand, title: string): void {
  plinth(ctx, 2, 0, W - 4, 4.2);
  glass(ctx, 6, 4.2, W - 12, 17.4);
  doors(ctx, [28, 88, 168, 248, 318], 0.4, 5.6);
  roofCap(ctx, 0, 21.4, W, 2.8);
  columns(ctx, [40, 100, 180, 260, 330], 0, 21.4);
  paintTitle(ctx, title, 16.4);
}

/** Compact curved canopy (Bratislava-style). */
function shellCanopy(ctx: Ctx, r: Rand, title: string): void {
  plinth(ctx, 12, 0, W - 24, 3.4);
  glass(ctx, 16, 3.4, W - 32, 12.2);
  doors(ctx, [48, 140, 232, 300], 0.3, 4.8);
  ctx.beginPath();
  ctx.moveTo(4, 16);
  ctx.quadraticCurveTo(W / 2, 25.5, W - 4, 16);
  ctx.lineTo(W - 4, 18.2);
  ctx.quadraticCurveTo(W / 2, 27.8, 4, 18.2);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, 27, 16, [
    [0, '#f7f8f7'],
    [1, '#cfd4d6'],
  ]);
  ctx.fill();
  rect(ctx, 6, 16.1, W - 12, 0.45, '#b7bec2');
  columns(ctx, [36, 96, 168, 240, 312], 0, 16.4);
  paintTitle(ctx, title, 11.4, '#f6f8f9');
  for (let i = 0; i < 5; i++) rect(ctx, 40 + i * 55 + r() * 4, 18.2, 0.7, 2.4, '#7a8186');
}

/** Twin pier halls with a central tower block. */
function shellTwinPier(ctx: Ctx, _r: Rand, title: string): void {
  glass(ctx, 8, 0, 130, 19);
  glass(ctx, W - 138, 0, 130, 19);
  rect(ctx, W / 2 - 38, 0, 76, 25, vgrad(ctx, 25, 0, [[0, '#e4edf3'], [1, '#3d586c']]));
  for (let x = W / 2 - 32; x < W / 2 + 32; x += 6) rect(ctx, x, 3, 0.5, 19, 'rgba(236,244,248,0.55)');
  rect(ctx, W / 2 - 38, 12, 76, 0.4, 'rgba(236,244,248,0.4)');
  doors(ctx, [24, 70, W / 2 - 10, W - 90, W - 44], 0.3, 5.4);
  roofCap(ctx, 0, 25.2, W, 2.6);
  paintTitle(ctx, title, 18.2);
}

/** Stepped modern terminals rising to a glass atrium. */
function shellStepped(ctx: Ctx, _r: Rand, title: string): void {
  rect(ctx, 18, 0, 82, 12, vgrad(ctx, 12, 0, [[0, '#9aafbb'], [1, '#5a717e']]));
  for (let x = 24; x < 94; x += 6) rect(ctx, x, 2, 0.4, 8, 'rgba(230,238,242,0.5)');
  rect(ctx, 88, 0, 96, 17.5, vgrad(ctx, 17.5, 0, [[0, '#a8c0ce'], [1, '#4e6a7c']]));
  for (let x = 94; x < 178; x += 6) rect(ctx, x, 2, 0.4, 13, 'rgba(230,238,242,0.5)');
  glass(ctx, 178, 0, 116, 23);
  rect(ctx, 288, 0, 52, 14, vgrad(ctx, 14, 0, [[0, '#9aafbb'], [1, '#5a717e']]));
  for (let x = 294; x < 334; x += 6) rect(ctx, x, 2, 0.4, 10, 'rgba(230,238,242,0.5)');
  doors(ctx, [36, 120, 210, 300], 0.3, 5.2);
  roofCap(ctx, 16, 12, 86, 1.6, '#e4e8ea');
  roofCap(ctx, 86, 17.5, 100, 1.8, '#e8ecee');
  roofCap(ctx, 176, 23, 120, 2.6);
  roofCap(ctx, 286, 14, 56, 1.7, '#e4e8ea');
  paintTitle(ctx, title, 14.4);
}

/** Low cargo/hangar wing + short passenger hall. */
function shellCargoWing(ctx: Ctx, r: Rand, title: string): void {
  rect(ctx, 4, 0, 142, 17, hgrad(ctx, 4, 146, [[0, '#9aa0a4'], [1, '#c9ced2']]));
  for (let i = 0; i < 4; i++) {
    const x = 14 + i * 32;
    rect(ctx, x, 1.4, 24, 13.4, shadeDoor(r));
    rect(ctx, x + 1, 2.4, 10.5, 11.4, shade('#4a5054', r() * 0.08));
    rect(ctx, x + 12.5, 2.4, 10.5, 11.4, shade('#5a6064', r() * 0.08));
  }
  glass(ctx, 150, 0, W - 158, 20.5);
  doors(ctx, [176, 240, 310], 0.3, 5.4);
  roofCap(ctx, 2, 17, 146, 2.2, '#d6dbde');
  roofCap(ctx, 148, 20.5, W - 150, 2.6);
  paintTitle(ctx, title, 14.2);
}

function shadeDoor(r: Rand): string {
  return r() < 0.5 ? '#5a6064' : '#6a7074';
}

/** Arched roof hall (regional / older international). */
function shellArchHall(ctx: Ctx, _r: Rand, title: string): void {
  rect(ctx, 28, 0, W - 56, 15.5, vgrad(ctx, 15.5, 0, [[0, '#e2d4b6'], [1, '#8a7658']]));
  for (let x = 36; x < W - 36; x += 11) {
    rect(ctx, x, 1.6, 7, 12.2, '#2f3c46');
    rect(ctx, x + 0.9, 2.6, 5.2, 10.2, vgrad(ctx, 12.8, 2.6, [[0, '#d7e4ec'], [1, '#6a8aa0']]));
  }
  doors(ctx, [70, 170, 270], 0.3, 5);
  ctx.beginPath();
  ctx.moveTo(14, 15.5);
  ctx.quadraticCurveTo(W / 2, 30.4, W - 14, 15.5);
  ctx.lineTo(W - 14, 17.6);
  ctx.quadraticCurveTo(W / 2, 32.4, 14, 17.6);
  ctx.closePath();
  ctx.fillStyle = vgrad(ctx, 32, 15.5, [
    [0, '#f3ead8'],
    [1, '#c4b496'],
  ]);
  ctx.fill();
  line(ctx, 18, 16.2, W - 18, 16.2, 0.5, '#a89878');
  paintTitle(ctx, title, 11.2, '#2a3034');
}

/** Satellite finger with round connectors. */
function shellSatellite(ctx: Ctx, _r: Rand, title: string): void {
  glass(ctx, 22, 6.5, W - 44, 11);
  for (const cx of [60, 140, 220, 300]) {
    circle(ctx, cx, 12, 14.4, '#c5d8e6');
    circle(ctx, cx, 12, 13.2, vgrad(ctx, 25, 0, [[0, '#d8ecf6'], [1, '#456578']]));
    for (let a = 0; a < 8; a++) rect(ctx, cx - 7 + a * 1.85, 5.5, 0.4, 13, 'rgba(236,244,248,0.55)');
    circle(ctx, cx, 12, 3.2, '#eef4f7');
  }
  doors(ctx, [52, 132, 212, 292], 0.2, 4.6);
  roofCap(ctx, 0, 23.6, W, 2.6);
  paintTitle(ctx, title, 18.2);
}

/** Tall control-tower-attached terminal. */
function shellTowerHall(ctx: Ctx, _r: Rand, title: string): void {
  glass(ctx, 38, 0, W - 102, 19.5);
  doors(ctx, [56, 140, 230], 0.3, 5.4);
  poly(ctx, [W - 62, 0, W - 40, 0, W - 42, 23, W - 60, 23], hgrad(ctx, W - 62, W - 40, [[0, '#c5ccd1'], [1, '#eef1f3']]));
  rect(ctx, W - 66, 23, 30, 5.4, vgrad(ctx, 28.4, 23, [[0, '#6d92a8'], [1, '#2c4454']]));
  for (let x = W - 64; x < W - 38; x += 3.2) rect(ctx, x, 23.4, 0.4, 4.6, '#dce6ec');
  rect(ctx, W - 68, 28.2, 34, 1.4, '#f3f5f6');
  line(ctx, W - 51, 29.6, W - 51, 31.6, 0.3, '#9aa3a8');
  circle(ctx, W - 51, 31.7, 0.4, '#d64a3a');
  roofCap(ctx, 0, 19.5, W - 52, 2.5);
  paintTitle(ctx, title, 12.2);
}

const SHELL_DRAWERS: Record<AirportShellId, (ctx: Ctx, r: Rand, title: string) => void> = {
  0: shellCanopy,
  1: shellGlassBar,
  2: shellTwinPier,
  3: shellStepped,
  4: shellArchHall,
  5: shellSatellite,
  6: shellCargoWing,
  7: shellTowerHall,
};

export function terminalSpriteName(iata: string): string {
  return `terminal_${iata}`;
}

/** One named terminal sprite per flyable airport. */
export function airportTerminalSprites(): SpriteSpec[] {
  const flyable = new Set<string>(FLYABLE_IATAS);
  return AIRPORTS.filter((a) => flyable.has(a.iata) && a.terminalTitle).map((a) => ({
    name: terminalSpriteName(a.iata),
    w: W,
    h: H,
    ppm: 4,
    draw: (ctx: Ctx, r: Rand) => {
      SHELL_DRAWERS[a.shell ?? 1](ctx, r, a.terminalTitle!);
    },
  }));
}
