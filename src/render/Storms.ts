import * as THREE from 'three';
import { makeCanvasTexture } from '../art/Atlas';
import type { StormCell, Weather } from '../sim/Weather';
import { createBillboardMaterial } from './Billboards';

const PPM = 0.55;
/** Storm clouds live in the parallax backdrop (between the mountains and the hills). */
const STORM_Z = -1300;
/** Fraction of camera height the layer follows; heights are compressed by (1 − follow) so tops line up with altitude. */
const STORM_FOLLOW = 0.5;
const STORM_SCALE = 1 - STORM_FOLLOW;
const RAIN_STREAKS = 1400;

/** Paints a cumulonimbus with anvil, dark base and rain shaft. Canvas y grows downwards. */
function paintStorm(cell: StormCell, seed: number): { canvas: HTMLCanvasElement; w: number; h: number } {
  const w = cell.radius * 2.8;
  const h = cell.top + 80;
  const cw = Math.ceil(w * PPM);
  const ch = Math.ceil(h * PPM);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d')!;
  let s = seed;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const X = (m: number) => (m + w / 2) * PPM;
  const Y = (m: number) => ch - m * PPM;
  const dark = cell.severity === 'severe' ? 0.62 : cell.severity === 'moderate' ? 0.78 : 0.9;
  const shade = (k: number, a: number) => {
    const v = Math.round(255 * k);
    return `rgba(${Math.round(v * 0.93)},${Math.round(v * 0.96)},${v},${a})`;
  };
  const puff = (x: number, y: number, rad: number, lit: number, a = 1) => {
    const gr = g.createRadialGradient(X(x - rad * 0.2), Y(y + rad * 0.35), rad * PPM * 0.1, X(x), Y(y), rad * PPM);
    gr.addColorStop(0, shade(Math.min(1, lit + 0.12), a));
    gr.addColorStop(0.7, shade(lit, a * 0.92));
    gr.addColorStop(1, shade(lit * 0.95, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(X(x), Y(y), rad * PPM, 0, Math.PI * 2);
    g.fill();
  };

  // Rain shaft below the base.
  const shaftW = cell.radius * 1.2;
  const rainGrad = g.createLinearGradient(0, Y(cell.base), 0, Y(0));
  rainGrad.addColorStop(0, shade(dark * 0.75, cell.severity === 'light' ? 0.35 : 0.55));
  rainGrad.addColorStop(1, shade(dark * 0.8, 0.12));
  g.fillStyle = rainGrad;
  g.beginPath();
  g.moveTo(X(-shaftW / 2), Y(cell.base + 20));
  g.lineTo(X(shaftW / 2), Y(cell.base + 20));
  g.lineTo(X(shaftW / 2 + 60), Y(0));
  g.lineTo(X(-shaftW / 2 + 20), Y(0));
  g.closePath();
  g.fill();
  g.strokeStyle = shade(dark * 0.7, 0.18);
  g.lineWidth = 1;
  for (let i = 0; i < 70; i++) {
    const x = -shaftW / 2 + r() * shaftW;
    g.beginPath();
    g.moveTo(X(x), Y(cell.base));
    g.lineTo(X(x + 40), Y(0));
    g.stroke();
  }

  // Tower: stacked puffs, darker at the bottom, sunlit near the top.
  const towerH = cell.top - cell.base;
  for (let i = 0; i < 70; i++) {
    const t = r();
    const y = cell.base + t * towerH * 0.92;
    const spread = cell.radius * (0.95 - t * 0.35);
    const x = (r() - 0.5) * 2 * spread * 0.8;
    const rad = 70 + r() * 110 * (1 - t * 0.3);
    puff(x, y, rad, dark * (0.72 + t * 0.35));
  }
  // Anvil spreading downwind at the top.
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const x = -cell.radius * 0.6 + t * cell.radius * 1.9;
    const y = cell.top - 60 - Math.sin(t * Math.PI) * 25 + r() * 20;
    puff(x, y, 60 + r() * 50, Math.min(1, dark + 0.18), 0.95);
  }
  // Flat, dark base.
  const base = g.createLinearGradient(0, Y(cell.base + 140), 0, Y(cell.base - 10));
  base.addColorStop(0, shade(dark * 0.7, 0));
  base.addColorStop(1, shade(dark * 0.55, 0.9));
  g.fillStyle = base;
  g.fillRect(X(-cell.radius * 0.95), Y(cell.base + 140), cell.radius * 1.9 * PPM, 150 * PPM);
  return { canvas, w, h };
}

interface StormVisual {
  cell: StormCell;
  mesh: THREE.Mesh;
}

/** Thunderstorm clouds, rain around the camera and lightning. */
export class Storms {
  readonly root = new THREE.Group();
  private readonly layer = new THREE.Group();
  private visuals: StormVisual[] = [];
  private readonly rain: THREE.LineSegments;
  private readonly rainMat: THREE.ShaderMaterial;
  private readonly bolt: THREE.Line;
  private boltTimer = 0;
  private nextFlash = 4;
  /** 0..1 brightness of the current lightning flash. */
  flash = 0;
  /** Set for one frame when a flash starts: distance (m) from the aircraft to the strike. */
  strike: number | null = null;
  private weather: Weather | null = null;
  private anisotropy: number;

  constructor(anisotropy: number) {
    this.anisotropy = anisotropy;
    const seeds = new Float32Array(RAIN_STREAKS * 2 * 4);
    for (let i = 0; i < RAIN_STREAKS; i++) {
      const x = (Math.random() - 0.5) * 140;
      const y = Math.random() * 90;
      const z = -45 + Math.random() * 62;
      seeds.set([x, y, z, 0, x, y, z, 1], i * 8);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_STREAKS * 2 * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, center: { value: new THREE.Vector3() }, opacity: { value: 0 }, slant: { value: 0.35 } },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float time;
        uniform vec3 center;
        uniform float slant;
        varying float vTip;
        void main() {
          float y = mod(seed.y - time * 38.0, 90.0) - 45.0;
          // World-anchored in x (wrapping around the camera) so the aircraft visibly flies through the rain.
          vec3 p = vec3(center.x + mod(seed.x - center.x, 140.0) - 70.0, center.y + y, seed.z);
          p.x += seed.w * slant * 2.6;
          p.y += seed.w * 2.6;
          vTip = seed.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float opacity;
        varying float vTip;
        void main() { gl_FragColor = vec4(0.82, 0.86, 0.92, opacity * mix(0.9, 0.2, vTip)); }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(geo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 58;
    this.rain.visible = false;
    this.root.add(this.rain);

    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    this.bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: '#f4f2ff', transparent: true, opacity: 0, toneMapped: false }));
    this.bolt.frustumCulled = false;
    this.bolt.renderOrder = 13;
    this.layer.position.z = STORM_Z;
    this.layer.add(this.bolt);
    this.root.add(this.layer);
  }

  setWeather(weather: Weather): void {
    for (const v of this.visuals) {
      this.layer.remove(v.mesh);
      v.mesh.geometry.dispose();
      const mat = v.mesh.material as THREE.ShaderMaterial;
      mat.uniforms.map.value.dispose();
      mat.dispose();
    }
    this.visuals = [];
    this.weather = weather;
    weather.storms.forEach((cell, i) => {
      const { canvas, w, h } = paintStorm(cell, weather.seed + i * 97 + 1);
      const tex = makeCanvasTexture(canvas, this.anisotropy, false);
      const mat = createBillboardMaterial(tex, 0.12, 0.97);
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, 0.5, 0);
      // The billboard shader expects an instance-free uvRect attribute.
      geo.setAttribute('uvRect', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]), 4));
      const mesh = new THREE.InstancedMesh(geo, mat, 1);
      mesh.setMatrixAt(0, new THREE.Matrix4().makeScale(w * STORM_SCALE, h * STORM_SCALE, 1));
      mesh.renderOrder = 12;
      mesh.frustumCulled = false;
      this.layer.add(mesh);
      this.visuals.push({ cell, mesh });
    });
    this.nextFlash = 3;
  }

  update(dt: number, time: number, simTime: number, camera: THREE.Camera, planeX: number, planeY: number, rain: number): void {
    const w = this.weather;
    this.layer.position.y = camera.position.y * STORM_FOLLOW;
    for (const v of this.visuals) v.mesh.position.set(w ? w.stormX(v.cell, simTime) : v.cell.x0, 0, 0);

    this.rainMat.uniforms.time.value = time;
    this.rainMat.uniforms.center.value.set(camera.position.x, camera.position.y - 10, 0);
    this.rainMat.uniforms.opacity.value += (rain * 0.55 - this.rainMat.uniforms.opacity.value) * Math.min(1, dt * 2);
    this.rain.visible = this.rainMat.uniforms.opacity.value > 0.01;

    // Lightning: frequency grows with severity and proximity.
    this.strike = null;
    this.flash = Math.max(0, this.flash - dt * 4.5);
    this.boltTimer = Math.max(0, this.boltTimer - dt);
    (this.bolt.material as THREE.LineBasicMaterial).opacity = this.boltTimer > 0 ? Math.min(1, this.boltTimer * 6) : 0;
    let best: { cell: StormCell; x: number; dist: number } | null = null;
    for (const v of this.visuals) {
      const x = w ? w.stormX(v.cell, simTime) : v.cell.x0;
      const dist = Math.abs(x - planeX);
      if (dist < 6000 && (!best || dist < best.dist)) best = { cell: v.cell, x, dist };
    }
    if (!best || best.cell.severity === 'light') return;
    this.nextFlash -= dt;
    if (this.nextFlash > 0) return;
    const rate = best.cell.severity === 'severe' ? 1 : 0.55;
    this.nextFlash = (3 + Math.random() * 7) / rate;
    this.flash = Math.max(0.25, 1 - best.dist / 6000);
    this.boltTimer = 0.25;
    this.strike = Math.hypot(best.dist, planeY - best.cell.base);
    const pos = this.bolt.geometry.attributes.position as THREE.BufferAttribute;
    let x = best.x + (Math.random() - 0.5) * best.cell.radius * STORM_SCALE;
    let y = (best.cell.base + 40) * STORM_SCALE;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      pos.setXYZ(i, x, y, 5);
      x += (Math.random() - 0.5) * 30;
      y -= ((best.cell.base + 40) * STORM_SCALE) / (n - 1);
    }
    pos.needsUpdate = true;
  }
}
