/**
 * Distinct airport terminal shells — same silhouette family, different massing,
 * painted with a per-destination title so every hop feels named.
 */
import type { SpriteSpec } from './Atlas';
import { circle, hgrad, rect, text, vgrad, type Ctx, type Rand } from './paint';
import { AIRPORTS, FLYABLE_IATAS, type AirportShellId } from '../meta/airports';

const W = 360;
const H = 32;

function titleSize(title: string): number {
  if (title.length > 30) return 2.6;
  if (title.length > 24) return 2.9;
  return 3.3;
}

function paintTitle(ctx: Ctx, title: string, y: number, color = '#ffffff'): void {
  text(ctx, title, W / 2, y, titleSize(title), color, 'center', 700);
}

/** Long glass curtain wall with flat white roof. */
function shellGlassBar(ctx: Ctx, _r: Rand, title: string): void {
  rect(ctx, 4, 0, W - 8, 4, '#8f9497');
  rect(ctx, 6, 4, W - 12, 18, vgrad(ctx, 22, 4, [[0, '#b7cde0'], [0.45, '#7d9bb6'], [1, '#3f5a74']]));
  for (let x = 8; x < W - 6; x += 6) rect(ctx, x, 4, 0.5, 18, '#e6ecf0');
  rect(ctx, 6, 13, W - 12, 0.5, '#e6ecf0');
  rect(ctx, 0, 22, W, 2.6, '#f4f6f7');
  rect(ctx, 0, 21.4, W, 0.6, '#b9c1c6');
  paintTitle(ctx, title, 16.2);
}

/** Compact curved canopy (Bratislava-style). */
function shellCanopy(ctx: Ctx, r: Rand, title: string): void {
  rect(ctx, 10, 0, W - 20, 3, '#9ea3a6');
  rect(ctx, 14, 3, W - 28, 13, vgrad(ctx, 16, 3, [[0, '#a9c3d6'], [0.5, '#6f8ea8'], [1, '#3e5870']]));
  for (let x = 16; x < W - 14; x += 5) rect(ctx, x, 3, 0.4, 13, '#dfe6ea');
  rect(ctx, 14, 9.2, W - 28, 0.4, '#dfe6ea');
  ctx.beginPath();
  ctx.moveTo(4, 16);
  ctx.quadraticCurveTo(W / 2, 24, W - 4, 16);
  ctx.lineTo(W - 4, 17.8);
  ctx.quadraticCurveTo(W / 2, 26, 4, 17.8);
  ctx.closePath();
  ctx.fillStyle = '#f4f5f4';
  ctx.fill();
  paintTitle(ctx, title, 11.2, '#f6f8f9');
  for (let i = 0; i < 5; i++) rect(ctx, 40 + i * 55 + r() * 4, 0, 0.6, 3, '#6b7176');
}

/** Twin pier halls with a central tower block. */
function shellTwinPier(ctx: Ctx, _r: Rand, title: string): void {
  rect(ctx, 8, 0, 130, 20, hgrad(ctx, 8, 138, [[0, '#9eb4c4'], [1, '#5a758c']]));
  rect(ctx, W - 138, 0, 130, 20, hgrad(ctx, W - 138, W - 8, [[0, '#5a758c'], [1, '#9eb4c4']]));
  rect(ctx, W / 2 - 36, 0, 72, 26, vgrad(ctx, 26, 0, [[0, '#d8e2ea'], [1, '#4a6578']]));
  for (let x = 12; x < 130; x += 8) rect(ctx, x, 4, 0.4, 14, '#e8eef2');
  for (let x = W - 130; x < W - 12; x += 8) rect(ctx, x, 4, 0.4, 14, '#e8eef2');
  rect(ctx, 0, 26, W, 2.4, '#eef1f3');
  paintTitle(ctx, title, 18);
}

/** Stepped modern terminals rising to a glass atrium. */
function shellStepped(ctx: Ctx, _r: Rand, title: string): void {
  rect(ctx, 20, 0, 80, 12, '#7a929f');
  rect(ctx, 90, 0, 100, 18, '#8aa3b2');
  rect(ctx, 180, 0, 120, 24, vgrad(ctx, 24, 0, [[0, '#c5d8e6'], [1, '#3d5a6e']]));
  rect(ctx, 290, 0, 50, 14, '#7a929f');
  for (let x = 186; x < 292; x += 5) rect(ctx, x, 2, 0.45, 20, '#eaf0f4');
  rect(ctx, 0, 24, W, 2.8, '#f2f4f5');
  paintTitle(ctx, title, 14);
}

/** Low cargo/hangar wing + short passenger hall. */
function shellCargoWing(ctx: Ctx, r: Rand, title: string): void {
  rect(ctx, 4, 0, 140, 18, hgrad(ctx, 4, 144, [[0, '#a8adb0'], [1, '#c5cacd']]));
  for (let i = 0; i < 4; i++) {
    rect(ctx, 16 + i * 32, 2, 22, 14, shadeDoor(r));
  }
  rect(ctx, 150, 0, W - 158, 22, vgrad(ctx, 22, 0, [[0, '#b0c8d8'], [1, '#456278']]));
  for (let x = 156; x < W - 12; x += 7) rect(ctx, x, 3, 0.5, 16, '#e4ecf0');
  rect(ctx, 0, 22, W, 2.6, '#eceeef');
  paintTitle(ctx, title, 14);
}

function shadeDoor(r: Rand): string {
  return r() < 0.5 ? '#5a6064' : '#6a7074';
}

/** Arched roof hall (regional / older international). */
function shellArchHall(ctx: Ctx, _r: Rand, title: string): void {
  rect(ctx, 30, 0, W - 60, 16, vgrad(ctx, 16, 0, [[0, '#d2c4a8'], [1, '#8a7a60']]));
  for (let x = 36; x < W - 36; x += 10) {
    rect(ctx, x, 2, 6, 12, '#3d4a55');
    rect(ctx, x + 1, 3, 4, 10, '#c9d6e0');
  }
  ctx.beginPath();
  ctx.moveTo(16, 16);
  ctx.quadraticCurveTo(W / 2, 30, W - 16, 16);
  ctx.lineTo(W - 16, 18);
  ctx.quadraticCurveTo(W / 2, 32, 16, 18);
  ctx.closePath();
  ctx.fillStyle = '#e8e0d0';
  ctx.fill();
  paintTitle(ctx, title, 11, '#2a3034');
}

/** Satellite finger with round connectors. */
function shellSatellite(ctx: Ctx, _r: Rand, title: string): void {
  rect(ctx, 20, 6, W - 40, 12, '#6d8798');
  for (const cx of [60, 140, 220, 300]) {
    circle(ctx, cx, 12, 14, '#8eb0c4');
    circle(ctx, cx, 12, 10, '#5a7a90');
    for (let a = 0; a < 6; a++) rect(ctx, cx - 6 + a * 2.2, 6, 0.4, 12, '#e6eef2');
  }
  rect(ctx, 0, 24, W, 2.6, '#f0f2f3');
  paintTitle(ctx, title, 18);
}

/** Tall control-tower-attached terminal. */
function shellTowerHall(ctx: Ctx, _r: Rand, title: string): void {
  rect(ctx, 40, 0, W - 100, 20, vgrad(ctx, 20, 0, [[0, '#b8cfe0'], [1, '#3f5c70']]));
  for (let x = 46; x < W - 66; x += 6) rect(ctx, x, 2, 0.45, 16, '#e8f0f4');
  rect(ctx, W - 56, 0, 14, 28, hgrad(ctx, W - 56, W - 42, [[0, '#c9d0d4'], [1, '#eef1f3']]));
  rect(ctx, W - 62, 24, 26, 5, '#5c7d92');
  rect(ctx, 0, 20, W - 50, 2.4, '#f4f6f7');
  paintTitle(ctx, title, 12);
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
