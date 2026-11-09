import * as THREE from 'three';
import type { SpriteFrame } from '../art/Atlas';

/** Uniforms shared by every billboard material, driven by the time-of-day palette. */
export const atmosphere = {
  tint: { value: new THREE.Color(1, 1, 1) },
  haze: { value: new THREE.Color(0.75, 0.8, 0.85) },
  /** 0..1 — biome-seam fog bank washing the painted layers toward haze. */
  seam: { value: 0 },
};

const vertexShader = /* glsl */ `
  attribute vec4 uvRect;
  varying vec2 vUv;
  #ifdef FIELDS
    varying float vWorldX;
    varying float vBelow;
  #endif
  #ifdef TAPER
    uniform float taper;
    varying float vTaper;
  #endif
  void main() {
    #ifdef CENTER_ANCHOR
      float ty = position.y + 0.5;
    #else
      float ty = max(position.y, 0.0);
    #endif
    vUv = vec2(mix(uvRect.x, uvRect.z, position.x + 0.5), mix(uvRect.y, uvRect.w, ty));
    vec3 pos = position;
    #ifdef TAPER
      // Ranges sink into the plain at both ends of a stretch instead of ending in a cliff.
      float width = length(instanceMatrix[0].xyz);
      float u = position.x + 0.5;
      float edge = min(u, 1.0 - u) * width;
      float k = smoothstep(0.0, taper, edge);
      vTaper = k;
      if (pos.y > 0.0) pos.y *= mix(0.08, 1.0, k);
    #endif
    #ifdef FIELDS
      vec4 world = modelMatrix * instanceMatrix * vec4(pos, 1.0);
      vec4 base = modelMatrix * instanceMatrix * vec4(pos.x, 0.0, 0.0, 1.0);
      vWorldX = world.x;
      vBelow = base.y - world.y;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 tint;
  uniform vec3 haze;
  uniform float hazeAmount;
  uniform float opacity;
  uniform float seam;
  varying vec2 vUv;
  #ifdef TAPER
    varying float vTaper;
  #endif
  #ifdef FIELDS
    varying float vWorldX;
    varying float vBelow;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  #endif
  void main() {
    vec4 t = texture2D(map, vUv);
    if (t.a < 0.01) discard;
    vec3 c = t.rgb / t.a;
    #ifdef FIELDS
      // Field patchwork below the layer base: rows widen towards the viewer
      if (vBelow > 0.0) {
        float row = log2(1.0 + vBelow / 5.0) * 1.8;
        float band = floor(row);
        float cw = 70.0 + band * 40.0;
        float fx = (vWorldX + band * 53.0) / cw;
        float cell = floor(fx);
        float h = hash(vec2(cell, band));
        float h2 = hash(vec2(band, cell + 7.0));
        c *= mix(0.78, 1.12, h);
        c = mix(c, c * vec3(1.25, 1.1, 0.62), step(0.68, h2) * 0.6);
        // Hedgerows with tree clumps along the field edges
        float clump = step(0.45, hash(vec2(floor(vWorldX / (6.0 + band * 3.0)), band + 3.0)));
        float edge = 1.0 - smoothstep(0.0, 0.14, fract(row));
        c *= 1.0 - edge * mix(0.12, 0.42, clump);
        c *= 1.0 - 0.14 * (1.0 - smoothstep(0.0, 0.02, fract(fx)));
      }
    #endif
    float h = hazeAmount + (1.0 - hazeAmount) * seam * mix(0.55, 0.9, hazeAmount);
    float a = t.a * opacity;
    #ifdef TAPER
      h = mix(min(1.0, h + 0.35), h, vTaper);
      a *= smoothstep(0.0, 0.55, vTaper);
    #endif
    c = mix(c * tint, haze, h);
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`;

export function createBillboardMaterial(
  map: THREE.Texture,
  hazeAmount: number,
  opacity = 1,
  centerAnchor = false,
  fields = false,
  taper = 0,
): THREE.ShaderMaterial {
  const defines: Record<string, string> = {};
  if (centerAnchor) defines.CENTER_ANCHOR = '';
  if (fields) defines.FIELDS = '';
  if (taper > 0) defines.TAPER = '';
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      tint: atmosphere.tint,
      haze: atmosphere.haze,
      hazeAmount: { value: hazeAmount },
      opacity: { value: opacity },
      seam: atmosphere.seam,
      taper: { value: taper },
    },
    defines,
    vertexShader,
    fragmentShader,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** Unit quad anchored at bottom-centre with an optional skirt extending `skirt` heights below y=0. */
function createQuadGeometry(skirt: number, centerAnchor: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  if (centerAnchor) {
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
  } else if (skirt > 0) {
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, -skirt, 0, 0.5, -skirt, 0, -0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3),
    );
    g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
  } else {
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
  }
  return g;
}

export interface Placement {
  frame: SpriteFrame;
  /** Centre x of the sprite in world metres. */
  x: number;
  y?: number;
  z?: number;
  scale?: number;
  flip?: boolean;
}

const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

/**
 * Builds one InstancedMesh per atlas page for a list of placements.
 * Instances are sorted back-to-front so transparent overlaps blend correctly.
 */
export function buildSpriteBatches(
  pages: THREE.Texture[],
  placements: Placement[],
  options: { hazeAmount: number; skirt: number; opacity?: number; renderOrder: number; centerAnchor?: boolean; fields?: boolean },
): THREE.InstancedMesh[] {
  const byPage = new Map<number, Placement[]>();
  for (const p of placements) {
    const list = byPage.get(p.frame.page) ?? [];
    list.push(p);
    byPage.set(p.frame.page, list);
  }
  const meshes: THREE.InstancedMesh[] = [];
  for (const [page, list] of byPage) {
    list.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    const geometry = createQuadGeometry(options.skirt, !!options.centerAnchor);
    const rects = new Float32Array(list.length * 4);
    const material = createBillboardMaterial(pages[page], options.hazeAmount, options.opacity ?? 1, options.centerAnchor, options.fields);
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((p, i) => {
      const s = p.scale ?? 1;
      tmpPos.set(p.x, p.y ?? 0, p.z ?? 0);
      tmpScale.set(p.frame.w * s * (p.flip ? -1 : 1), p.frame.h * s, 1);
      tmpMatrix.compose(tmpPos, tmpQuat.identity(), tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
      rects.set([p.frame.u0, p.frame.v0, p.frame.u1, p.frame.v1], i * 4);
    });
    geometry.setAttribute('uvRect', new THREE.InstancedBufferAttribute(rects, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.renderOrder = options.renderOrder;
    meshes.push(mesh);
  }
  return meshes;
}

/** Bottom-anchored strip subdivided along x so the vertex shader can taper its ends. */
function createStripGeometry(skirt: number, cols: number): THREE.BufferGeometry {
  const rows = skirt > 0 ? [-skirt, 0, 1] : [0, 1];
  const pos: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c <= cols; c++) pos.push(c / cols - 0.5, rows[r], 0);
  }
  const stride = cols + 1;
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * stride + c;
      const b = a + 1;
      const d = a + stride;
      const e = d + 1;
      idx.push(a, b, d, d, b, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** A horizontally repeating painted strip covering world x segments. */
export function buildTileStrip(
  texture: THREE.Texture,
  tileW: number,
  tileH: number,
  segments: [number, number][],
  options: { hazeAmount: number; skirt: number; renderOrder: number; fields?: boolean; taper?: number },
): THREE.InstancedMesh {
  const taper = options.taper ?? 0;
  const widest = Math.max(1, ...segments.map(([a, b]) => b - a));
  const cols = Math.min(640, Math.max(32, Math.ceil((widest * 5) / Math.max(1, taper))));
  const geometry = taper > 0 ? createStripGeometry(options.skirt, cols) : createQuadGeometry(options.skirt, false);
  const material = createBillboardMaterial(texture, options.hazeAmount, 1, false, options.fields, taper);
  const mesh = new THREE.InstancedMesh(geometry, material, segments.length);
  const rects = new Float32Array(segments.length * 4);
  const vInset = 1.5 / (texture.image as HTMLCanvasElement).height;
  segments.forEach(([x0, x1], i) => {
    tmpPos.set((x0 + x1) / 2, 0, 0);
    tmpScale.set(x1 - x0, tileH, 1);
    tmpMatrix.compose(tmpPos, tmpQuat.identity(), tmpScale);
    mesh.setMatrixAt(i, tmpMatrix);
    rects.set([x0 / tileW, vInset, x1 / tileW, 1], i * 4);
  });
  geometry.setAttribute('uvRect', new THREE.InstancedBufferAttribute(rects, 4));
  mesh.computeBoundingSphere();
  mesh.renderOrder = options.renderOrder;
  // World remaps each segment onto the live corridor (and rewrites uvRect to keep the tile density).
  mesh.userData.tileStrip = { segments, tileW };
  return mesh;
}
