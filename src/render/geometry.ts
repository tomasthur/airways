import * as THREE from 'three';

export interface Station {
  x: number;
  w: number;
  h: number;
  cy: number;
}

/** Catmull-Rom interpolation of fuselage cross-section parameters along x. */
export function profileAt(stations: Station[], x: number): Station {
  let i = 0;
  while (i < stations.length - 2 && x > stations[i + 1].x) i++;
  const p1 = stations[i];
  const p2 = stations[i + 1];
  const p0 = stations[Math.max(0, i - 1)];
  const p3 = stations[Math.min(stations.length - 1, i + 2)];
  const t = Math.max(0, Math.min(1, (x - p1.x) / (p2.x - p1.x)));
  const cr = (a: number, b: number, c: number, d: number) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };
  return {
    x,
    w: Math.max(0.02, cr(p0.w, p1.w, p2.w, p3.w)),
    h: Math.max(0.02, cr(p0.h, p1.h, p2.h, p3.h)),
    cy: cr(p0.cy, p1.cy, p2.cy, p3.cy),
  };
}

const sgnPow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;

export interface LoftOptions {
  x0: number;
  x1: number;
  segX: number;
  segR: number;
  /** Angle range around the section: -π/2 bottom, 0 right (+z), π/2 top, π left. */
  phi0?: number;
  phi1?: number;
  inflate?: number;
  exponent?: number;
  /** x range used to map u texture coordinates. */
  uRange?: [number, number];
  caps?: boolean;
}

/** Lofts a superelliptic tube along x through interpolated stations. */
export function loftFuselage(stations: Station[], o: LoftOptions): THREE.BufferGeometry {
  const phi0 = o.phi0 ?? -Math.PI / 2;
  const phi1 = o.phi1 ?? Math.PI * 1.5;
  const inflate = o.inflate ?? 0;
  const e = 2 / (o.exponent ?? 2.6);
  const [ux0, ux1] = o.uRange ?? [o.x0, o.x1];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= o.segX; i++) {
    const x = o.x0 + ((o.x1 - o.x0) * i) / o.segX;
    const s = profileAt(stations, x);
    for (let j = 0; j <= o.segR; j++) {
      const phi = phi0 + ((phi1 - phi0) * j) / o.segR;
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      pos.push(x, s.cy + (s.h / 2 + inflate) * sgnPow(sn, e), (s.w / 2 + inflate) * sgnPow(c, e));
      uv.push((x - ux0) / (ux1 - ux0), (phi + Math.PI / 2) / (Math.PI * 2));
    }
  }
  const row = o.segR + 1;
  for (let i = 0; i < o.segX; i++) {
    for (let j = 0; j < o.segR; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  if (o.caps) {
    for (const end of [0, o.segX]) {
      const s = profileAt(stations, o.x0 + ((o.x1 - o.x0) * end) / o.segX);
      const center = pos.length / 3;
      pos.push(s.x, s.cy, 0);
      uv.push(end === 0 ? 0 : 1, 0.5);
      for (let j = 0; j < o.segR; j++) idx.push(center, end * row + j, end * row + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface WingSection {
  z: number;
  xLE: number;
  chord: number;
  y: number;
  /** Chord fraction range of the airfoil to build (for flaps/elevators). */
  f0?: number;
  f1?: number;
}

function naca(t: number, thickness: number, camber: number): [number, number] {
  const yt = 5 * thickness * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
  const p = 0.4;
  const yc = camber === 0 ? 0 : t < p ? (camber / (p * p)) * (2 * p * t - t * t) : (camber / (1 - p) ** 2) * (1 - 2 * p + 2 * p * t - t * t);
  return [yc + yt, yc - yt];
}

/** Lofts a NACA 4-digit airfoil through spanwise sections (along z). */
export function loftAirfoil(sections: WingSection[], thickness: number, camber: number, n = 14): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = n * 2 + 2;
  for (const s of sections) {
    const f0 = s.f0 ?? 0;
    const f1 = s.f1 ?? 1;
    const ts: number[] = [];
    for (let i = 0; i <= n; i++) ts.push(f0 + ((f1 - f0) * (1 - Math.cos((Math.PI * i) / n))) / 2);
    for (const t of ts) {
      const [u] = naca(t, thickness, camber);
      pos.push(s.xLE - t * s.chord, s.y + u * s.chord, s.z);
    }
    for (let i = ts.length - 1; i >= 0; i--) {
      const [, l] = naca(ts[i], thickness, camber);
      pos.push(s.xLE - ts[i] * s.chord, s.y + l * s.chord, s.z);
    }
  }
  for (let k = 0; k < sections.length - 1; k++) {
    for (let j = 0; j < ring; j++) {
      const a = k * ring + j;
      const b = k * ring + ((j + 1) % ring);
      const c = a + ring;
      const d = b + ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  for (const k of [0, sections.length - 1]) {
    let cx = 0;
    let cy = 0;
    for (let j = 0; j < ring; j++) {
      cx += pos[(k * ring + j) * 3];
      cy += pos[(k * ring + j) * 3 + 1];
    }
    const center = pos.length / 3;
    pos.push(cx / ring, cy / ring, sections[k].z);
    for (let j = 0; j < ring; j++) idx.push(center, k * ring + j, k * ring + ((j + 1) % ring));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Cylinder between two points. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, flatten = 1): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 10);
  g.deleteAttribute('uv');
  g.scale(1, 1, flatten);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}
