import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SHIRTS = ['#c8202f', '#2f6db5', '#e2b13c', '#3f8f5a', '#7a4fa0', '#e46f2a'];
const SKIN = ['#f1c7a5', '#d9a77f', '#a8714d'];
const WALK_SPEED = 1.35;

interface Walker {
  mesh: THREE.Mesh;
  /** Seconds before this passenger starts walking. */
  delay: number;
  progress: number;
  done: boolean;
}

/** Low-poly passengers who walk to the cabin door and climb in. One small mesh each. */
export class Passengers {
  readonly root = new THREE.Group();
  private walkers: Walker[] = [];
  private readonly materials = new Map<string, THREE.Material>();
  private readonly path: THREE.Vector3[] = [];
  private readonly tmp = new THREE.Vector3();
  private pathLength = 0;
  private time = 0;

  private material(color: string): THREE.Material {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, vertexColors: true });
      this.materials.set(color, m);
    }
    return m;
  }

  private person(seed: number): THREE.BufferGeometry {
    const paint = (g: THREE.BufferGeometry, color: string) => {
      const c = new THREE.Color(color);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g.toNonIndexed();
    };
    const legs = new THREE.CylinderGeometry(0.13, 0.11, 0.82, 8);
    legs.translate(0, 0.41, 0);
    const body = new THREE.CapsuleGeometry(0.2, 0.5, 4, 10);
    body.translate(0, 1.15, 0);
    const head = new THREE.SphereGeometry(0.12, 12, 8);
    head.translate(0, 1.62, 0);
    const bag = new THREE.BoxGeometry(0.28, 0.32, 0.14);
    bag.translate(0, 1.1, -0.26);
    return mergeGeometries([
      paint(legs, '#2c323a'),
      paint(body, SHIRTS[seed % SHIRTS.length]),
      paint(head, SKIN[(seed * 7) % SKIN.length]),
      paint(bag, seed % 2 ? '#55402c' : '#30343a'),
    ]);
  }

  /** Starts boarding `count` passengers walking from `from` to the door at `door`. */
  start(count: number, from: THREE.Vector3, door: THREE.Vector3): void {
    this.clear();
    this.path.length = 0;
    // Walk in, turn towards the door just outside the wing, then step up into the cabin.
    this.path.push(from.clone(), new THREE.Vector3(door.x + 2.4, 0, door.z + 2.2), new THREE.Vector3(door.x, 0, door.z + 0.9), new THREE.Vector3(door.x, door.y, door.z - 0.2));
    this.pathLength = 0;
    for (let i = 1; i < this.path.length; i++) this.pathLength += this.path[i].distanceTo(this.path[i - 1]);
    const seed = Math.floor(Math.random() * 1000);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.person(seed + i), this.material('#ffffff'));
      mesh.castShadow = true;
      mesh.visible = false;
      this.root.add(mesh);
      this.walkers.push({ mesh, delay: i * 2.2, progress: 0, done: false });
    }
  }

  clear(): void {
    for (const w of this.walkers) {
      this.root.remove(w.mesh);
      w.mesh.geometry.dispose();
    }
    this.walkers = [];
  }

  get boarded(): number {
    return this.walkers.filter((w) => w.done).length;
  }

  get total(): number {
    return this.walkers.length;
  }

  update(dt: number): void {
    this.time += dt;
    for (const w of this.walkers) {
      if (w.done) continue;
      if (w.delay > 0) {
        w.delay -= dt;
        continue;
      }
      w.progress += WALK_SPEED * dt;
      if (w.progress >= this.pathLength) {
        w.done = true;
        w.mesh.visible = false;
        continue;
      }
      // Position along the poly-line.
      let d = w.progress;
      let i = 1;
      while (i < this.path.length - 1 && d > this.path[i].distanceTo(this.path[i - 1])) {
        d -= this.path[i].distanceTo(this.path[i - 1]);
        i++;
      }
      const a = this.path[i - 1];
      const b = this.path[i];
      const seg = a.distanceTo(b);
      this.tmp.lerpVectors(a, b, Math.min(1, d / seg));
      const climbing = i === this.path.length - 1;
      const bob = climbing ? 0 : Math.abs(Math.sin(this.time * 7 + w.delay)) * 0.05;
      w.mesh.position.set(this.tmp.x, this.tmp.y + bob, this.tmp.z);
      w.mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      w.mesh.rotation.z = climbing ? 0 : Math.sin(this.time * 7 + w.delay) * 0.05;
      w.mesh.visible = true;
    }
  }
}
