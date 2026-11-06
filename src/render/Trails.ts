import * as THREE from 'three';

const POINTS = 56;
const SAMPLE_DT = 0.045;

/**
 * Faint wing-tip vortex trails: two ribbons following the wing tips, fading with age.
 * One mesh, one draw call; buffers are reused every frame.
 */
export class Trails {
  readonly mesh: THREE.Mesh;
  private readonly history: Float32Array[] = [new Float32Array(POINTS * 3), new Float32Array(POINTS * 3)];
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private head = 0;
  private filled = 0;
  private timer = 0;
  private strength = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const verts = 2 * POINTS * 2;
    this.positions = new Float32Array(verts * 3);
    this.alphas = new Float32Array(verts);
    const index: number[] = [];
    for (let t = 0; t < 2; t++) {
      const base = t * POINTS * 2;
      for (let i = 0; i < POINTS - 1; i++) {
        const a = base + i * 2;
        index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        void main() { vAlpha = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float opacity;
        varying float vAlpha;
        void main() { gl_FragColor = vec4(0.97, 0.98, 1.0, vAlpha * opacity); }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 55;
  }

  reset(): void {
    this.filled = 0;
    this.head = 0;
    this.strength = 0;
    this.mesh.visible = false;
  }

  /**
   * @param intensity 0..1 how visible the trails should be (airspeed, angle of attack, humid air).
   */
  update(dt: number, right: THREE.Vector3, left: THREE.Vector3, intensity: number): void {
    this.strength += (intensity - this.strength) * Math.min(1, dt * 1.5);
    this.timer += dt;
    if (this.timer >= SAMPLE_DT) {
      this.timer = 0;
      this.head = (this.head + 1) % POINTS;
      this.filled = Math.min(POINTS, this.filled + 1);
    }
    // The newest point always sits exactly at the wing tip.
    this.history[0].set([right.x, right.y, right.z], this.head * 3);
    this.history[1].set([left.x, left.y, left.z], this.head * 3);

    this.mesh.visible = this.strength > 0.01 && this.filled > 2;
    this.material.uniforms.opacity.value = this.strength * 0.32;
    if (!this.mesh.visible) return;

    const p = this.positions;
    const a = this.alphas;
    for (let t = 0; t < 2; t++) {
      const h = this.history[t];
      for (let i = 0; i < POINTS; i++) {
        const age = Math.min(i, this.filled - 1);
        const k = ((this.head - age) % POINTS + POINTS) % POINTS;
        const x = h[k * 3];
        const y = h[k * 3 + 1];
        const z = h[k * 3 + 2];
        // Ribbon widens slightly and fades out with age.
        const w = 0.05 + (age / POINTS) * 0.18;
        const v = (t * POINTS + i) * 2;
        p[v * 3] = x;
        p[v * 3 + 1] = y + w;
        p[v * 3 + 2] = z;
        p[v * 3 + 3] = x;
        p[v * 3 + 4] = y - w;
        p[v * 3 + 5] = z;
        const fade = i >= this.filled ? 0 : (1 - i / POINTS) * Math.min(1, i / 3);
        a[v] = fade;
        a[v + 1] = fade;
      }
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
  }
}
