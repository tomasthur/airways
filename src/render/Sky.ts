import * as THREE from 'three';

interface PaletteStop {
  skyTop: string;
  skyMid: string;
  horizon: string;
  haze: string;
  sun: string;
  tint: string;
  sunLight: string;
  hemiSky: string;
  hemiGround: string;
  sunIntensity: number;
  sunHeight: number;
}

/** Afternoon over Bratislava → golden hour over Vienna. */
const STOPS: PaletteStop[] = [
  {
    skyTop: '#3d74c0',
    skyMid: '#7eb0e2',
    horizon: '#dbe8ef',
    haze: '#bccfdc',
    sun: '#fff3d6',
    tint: '#ffffff',
    sunLight: '#fff2de',
    hemiSky: '#bcd6f0',
    hemiGround: '#6f7f52',
    sunIntensity: 2.6,
    sunHeight: 0.34,
  },
  {
    skyTop: '#3a64aa',
    skyMid: '#8fb2d8',
    horizon: '#ecdcc8',
    haze: '#d3c9be',
    sun: '#ffe2b0',
    tint: '#fff4e6',
    sunLight: '#ffe0b8',
    hemiSky: '#c9d4e6',
    hemiGround: '#6c7450',
    sunIntensity: 2.4,
    sunHeight: 0.22,
  },
  {
    skyTop: '#2f4f92',
    skyMid: '#b59bb0',
    horizon: '#f7c58f',
    haze: '#e4b996',
    sun: '#ffcf8a',
    tint: '#ffe3c6',
    sunLight: '#ffd3a8',
    hemiSky: '#cfd3e6',
    hemiGround: '#7a7650',
    sunIntensity: 2.8,
    sunHeight: 0.07,
  },
];

export interface Palette {
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  horizon: THREE.Color;
  haze: THREE.Color;
  sun: THREE.Color;
  tint: THREE.Color;
  sunLight: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  sunIntensity: number;
  sunHeight: number;
}

const colorKeys = ['skyTop', 'skyMid', 'horizon', 'haze', 'sun', 'tint', 'sunLight', 'hemiSky', 'hemiGround'] as const;
const parsed = STOPS.map((s) => {
  const out: Record<string, THREE.Color> = {};
  for (const k of colorKeys) out[k] = new THREE.Color(s[k]);
  return out;
});

export function createPalette(): Palette {
  const p = {} as Palette;
  for (const k of colorKeys) p[k] = new THREE.Color();
  p.sunIntensity = 1;
  p.sunHeight = 0.3;
  return p;
}

/** Samples the palette at route progress t in [0, 1] without allocating. */
export function samplePalette(t: number, out: Palette): void {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  for (const k of colorKeys) out[k].copy(parsed[i][k]).lerp(parsed[i + 1][k], s);
  out.sunIntensity = STOPS[i].sunIntensity + (STOPS[i + 1].sunIntensity - STOPS[i].sunIntensity) * s;
  out.sunHeight = STOPS[i].sunHeight + (STOPS[i + 1].sunHeight - STOPS[i].sunHeight) * s;
}

/** Full-screen sky gradient with a sun disc and glow, drawn behind everything. */
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    top: { value: new THREE.Color() },
    mid: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    sunColor: { value: new THREE.Color() },
    sunPos: { value: new THREE.Vector2(0.8, 0.7) },
    horizonY: { value: 0.5 },
    aspect: { value: 1.6 },
  };

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 0.5 + 0.5;
          gl_Position = vec4(position.xy, 0.9999, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 top;
        uniform vec3 mid;
        uniform vec3 horizon;
        uniform vec3 sunColor;
        uniform vec2 sunPos;
        uniform float horizonY;
        uniform float aspect;
        varying vec2 vUv;
        void main() {
          float t = clamp((vUv.y - horizonY) / max(1.0 - horizonY, 0.05), 0.0, 1.0);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.45, t));
          col = mix(col, top, smoothstep(0.35, 1.0, t));
          vec2 d = (vUv - sunPos) * vec2(aspect, 1.0);
          float dist = length(d);
          col += sunColor * (exp(-dist * dist * 9.0) * 0.32 + exp(-dist * 3.0) * 0.1);
          float disc = smoothstep(0.034, 0.028, dist);
          col = mix(col, sunColor * 1.15 + vec3(0.15), disc);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }

  update(p: Palette, camera: THREE.PerspectiveCamera): void {
    const u = this.uniforms;
    u.top.value.copy(p.skyTop);
    u.mid.value.copy(p.skyMid);
    u.horizon.value.copy(p.horizon);
    u.sunColor.value.copy(p.sun);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizon = 0.5 + 0.5 * (Math.tan(-camera.rotation.x) / Math.tan(halfFov));
    u.horizonY.value = horizon;
    u.sunPos.value.set(0.8, horizon + p.sunHeight);
    u.aspect.value = camera.aspect;
  }
}
