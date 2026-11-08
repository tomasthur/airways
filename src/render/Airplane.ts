import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loftAirfoil, loftFuselage, strut, type Station, type WingSection } from './geometry';

/**
 * Procedural Cessna 172RG-style aircraft. Origin at the main-wheel contact point,
 * nose towards +x, up +y, right wing towards +z (facing the camera).
 */

const STATIONS: Station[] = [
  { x: -4.78, w: 0.1, h: 0.2, cy: 1.98 },
  { x: -4.4, w: 0.3, h: 0.38, cy: 1.95 },
  { x: -3.5, w: 0.5, h: 0.56, cy: 1.9 },
  { x: -2.5, w: 0.72, h: 0.78, cy: 1.82 },
  { x: -1.5, w: 0.95, h: 1.08, cy: 1.72 },
  { x: -0.6, w: 1.1, h: 1.42, cy: 1.62 },
  { x: 0.3, w: 1.14, h: 1.5, cy: 1.6 },
  { x: 1.15, w: 1.14, h: 1.5, cy: 1.58 },
  { x: 2.0, w: 1.1, h: 1.2, cy: 1.44 },
  { x: 2.7, w: 1.02, h: 1.02, cy: 1.4 },
  { x: 3.3, w: 0.86, h: 0.8, cy: 1.37 },
];
const X_TAIL = -4.78;
const X_NOSE = 3.3;

export interface AirplaneVisualState {
  throttle: number;
  flaps: number;
  gear: number;
  elevator: number;
  groundSpeed: number;
  onGround: boolean;
  /** Flight spoilers 0..1 (0 on types without a speed brake). */
  speedBrake?: number;
}

/** What the game needs from any aircraft model (hand-built C172 or parametric types). */
export interface AircraftModel {
  readonly root: THREE.Group;
  doorOpen: boolean;
  lightsOn: boolean;
  readonly doorFullyOpen: boolean;
  readonly doorFullyClosed: boolean;
  /** Horizontal run of the boarding stairs out from the door (0 = step straight in). */
  readonly stairRun: number;
  update(dt: number, x: number, y: number, pitch: number, roll: number, s: AirplaneVisualState): void;
  getWingTips(right: THREE.Vector3, left: THREE.Vector3): void;
  doorSill(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

/** Releases the GPU resources of a model built from unique geometries / materials / textures. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture && v !== (m as THREE.MeshStandardMaterial).envMap) v.dispose();
      m.dispose();
    }
  });
}

export class Airplane implements AircraftModel {
  readonly root = new THREE.Group();
  readonly stairRun = 0;
  private readonly model = new THREE.Group();
  private readonly propeller = new THREE.Group();
  private readonly bladeMaterial: THREE.MeshStandardMaterial;
  private readonly discMaterial: THREE.MeshBasicMaterial;
  private readonly flaps: THREE.Group[] = [];
  private readonly elevator = new THREE.Group();
  private readonly mainGears: THREE.Group[] = [];
  private readonly noseGear = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly beacon: THREE.Sprite;
  private readonly strobes: THREE.Sprite[] = [];
  private readonly navLights: THREE.Sprite[] = [];
  private readonly door = new THREE.Group();
  private readonly doorOpening: THREE.Mesh;
  private readonly tipLocal: THREE.Vector3[];
  private propAngle = 0;
  private time = 0;
  private doorAngle = 0;
  /** Door target: 0 closed, 1 open. */
  doorOpen = false;
  lightsOn = true;

  constructor(envMap: THREE.Texture | null) {
    this.root.add(this.model);

    const livery = new THREE.CanvasTexture(paintLivery());
    livery.colorSpace = THREE.SRGBColorSpace;
    livery.anisotropy = 4;
    const std = (p: THREE.MeshStandardMaterialParameters) =>
      new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 0.8, side: THREE.DoubleSide, ...p });
    const paint = std({ map: livery, roughness: 0.36, metalness: 0.05 });
    const white = std({ color: '#f2f3f0', roughness: 0.4, metalness: 0.05 });
    const glass = std({ color: '#162330', roughness: 0.06, metalness: 0.4, envMapIntensity: 1.6 });
    const metal = std({ color: '#a3aab0', roughness: 0.32, metalness: 0.85 });
    const dark = std({ color: '#2c3034', roughness: 0.55, metalness: 0.2 });
    const tire = std({ color: '#1a1b1d', roughness: 0.92, metalness: 0 });
    const spinnerMat = std({ color: '#c41e2d', roughness: 0.28, metalness: 0.15 });
    this.bladeMaterial = std({ vertexColors: true, roughness: 0.5, metalness: 0.3, transparent: true });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.model, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // Fuselage with painted livery
    add(loftFuselage(STATIONS, { x0: X_TAIL, x1: X_NOSE, segX: 64, segR: 36, caps: true }), paint);

    // Cockpit glass conforming to the fuselage
    const win = (x0: number, x1: number, p0: number, p1: number) =>
      loftFuselage(STATIONS, { x0, x1, segX: 8, segR: 8, phi0: p0 * Math.PI, phi1: p1 * Math.PI, inflate: 0.012, uRange: [X_TAIL, X_NOSE] });
    const glassGeos = [
      win(1.18, 1.95, 0.2, 0.8), // windshield
      win(0.22, 1.02, 0.1, 0.36), // front side windows
      win(0.22, 1.02, 0.64, 0.9),
      win(-1.2, 0.08, 0.1, 0.34), // rear side windows
      win(-1.2, 0.08, 0.66, 0.9),
      win(-1.62, -0.7, 0.36, 0.64), // rear "omni-vision" window
    ];
    add(mergeGeometries(glassGeos), glass, this.model, false);

    // Wing: inboard section (with flap cut-out) and tapered outer panels with dihedral
    const dihedral = Math.tan(THREE.MathUtils.degToRad(1.7));
    const chordAt = (z: number) => (Math.abs(z) < 2.6 ? 1.63 : 1.63 - ((Math.abs(z) - 2.6) / 2.9) * 0.5);
    const wy = 2.36;
    const sec = (z: number, f1 = 1): WingSection => ({ z, xLE: 0.85, chord: chordAt(z), y: wy + Math.abs(z) * dihedral, f1 });
    const wingGeos = [
      loftAirfoil([sec(-2.8, 0.75), sec(-0.55, 0.75), sec(0, 0.75), sec(0.55, 0.75), sec(2.8, 0.75)], 0.12, 0.02),
      loftAirfoil([sec(2.8), sec(4.2), sec(5.5)], 0.12, 0.02),
      loftAirfoil([sec(-5.5), sec(-4.2), sec(-2.8)], 0.12, 0.02),
    ];
    // Wing struts
    for (const s of [1, -1]) {
      wingGeos.push(strut(new THREE.Vector3(0.05, 1.0, 0.52 * s), new THREE.Vector3(0.32, 2.3 + 2.55 * dihedral, 2.55 * s), 0.05, 0.04, 0.45));
    }
    add(mergeGeometries(wingGeos), white);

    // Flaps (hinged at the 75% chord line)
    for (const s of [1, -1]) {
      const hinge = new THREE.Group();
      const hx = 0.85 - 0.75 * 1.63;
      const hy = wy + 1.7 * dihedral - 0.02;
      hinge.position.set(hx, hy, 0);
      const z0 = 0.58 * s;
      const z1 = 2.78 * s;
      const flapSec = (z: number): WingSection => ({ z, xLE: 0.85 - hx, chord: 1.63, y: wy + Math.abs(z) * dihedral - hy, f0: 0.755, f1: 1 });
      add(loftAirfoil(s > 0 ? [flapSec(z0), flapSec(z1)] : [flapSec(z1), flapSec(z0)], 0.12, 0.02, 8), white, hinge);
      this.model.add(hinge);
      this.flaps.push(hinge);
    }

    // Horizontal stabiliser and elevator
    const hingeX = -4.3;
    const stabY = 1.98;
    const stab = (z: number, front: boolean): WingSection => {
      const t = Math.abs(z) / 1.75;
      const xLE = -3.62 - t * 0.22;
      const chord = 1.08 - t * 0.3;
      const fh = (xLE - hingeX) / chord;
      return front ? { z, xLE, chord, y: stabY, f1: fh } : { z, xLE: xLE - hingeX, chord, y: 0, f0: fh };
    };
    add(loftAirfoil([stab(-1.75, true), stab(0, true), stab(1.75, true)], 0.09, 0), white);
    this.elevator.position.set(hingeX, stabY, 0);
    add(loftAirfoil([stab(-1.75, false), stab(0, false), stab(1.75, false)], 0.09, 0, 8), white, this.elevator);
    this.model.add(this.elevator);

    // Vertical fin with rudder livery
    const fin = new THREE.Shape();
    const finPts: [number, number][] = [
      [-2.25, 2.17], [-3.2, 2.34], [-3.5, 2.55], [-4.32, 3.52], [-4.5, 3.6], [-4.95, 3.6], [-5.05, 3.45], [-4.95, 1.98], [-4.6, 2.0],
    ];
    fin.moveTo(finPts[0][0], finPts[0][1]);
    for (const [x, y] of finPts.slice(1)) fin.lineTo(x, y);
    fin.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    finGeo.translate(0, 0, -0.05);
    const finUv = finGeo.attributes.uv as THREE.BufferAttribute;
    const finPos = finGeo.attributes.position;
    for (let i = 0; i < finPos.count; i++) finUv.setXY(i, (finPos.getX(i) + 5.1) / 2.9, (finPos.getY(i) - 1.95) / 1.7);
    const finTex = new THREE.CanvasTexture(paintFin());
    finTex.colorSpace = THREE.SRGBColorSpace;
    add(finGeo, std({ map: finTex, roughness: 0.38, metalness: 0.05 }));

    // Propeller: spinner, twisted blades with painted tips, motion disc
    this.propeller.position.set(X_NOSE + 0.02, 1.37, 0);
    const spinner = new THREE.LatheGeometry(
      [[0.3, 0], [0.295, 0.1], [0.27, 0.22], [0.21, 0.34], [0.12, 0.43], [0, 0.48]].map(([r, y]) => new THREE.Vector2(r, y)),
      20,
    );
    spinner.rotateZ(-Math.PI / 2);
    add(spinner, spinnerMat, this.propeller);
    const blade = new THREE.BoxGeometry(0.05, 0.92, 0.15, 1, 8, 1);
    blade.translate(0, 0.5, 0);
    const bp = blade.attributes.position;
    const colors = new Float32Array(bp.count * 3);
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i);
      const a = (0.95 - y) * 0.55;
      const x = bp.getX(i);
      const z = bp.getZ(i) * (1 - y * 0.35);
      bp.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
      const tip = y > 0.84;
      colors.set(tip ? [0.95, 0.75, 0.1] : [0.13, 0.14, 0.15], i * 3);
    }
    blade.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    blade.translate(0.18, 0, 0);
    const blade2 = blade.clone();
    blade2.rotateX(Math.PI);
    const blades = add(mergeGeometries([blade, blade2]), this.bladeMaterial, this.propeller);
    blades.geometry.computeVertexNormals();
    this.discMaterial = new THREE.MeshBasicMaterial({ color: '#d8dee3', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), this.discMaterial);
    disc.rotation.y = Math.PI / 2;
    disc.position.x = 0.18;
    this.propeller.add(disc);
    this.model.add(this.propeller);

    // Cowling details: exhaust, air intakes
    add(strut(new THREE.Vector3(2.4, 0.95, 0.15), new THREE.Vector3(2.0, 0.86, 0.2), 0.04, 0.04), metal);
    const intake = new THREE.BoxGeometry(0.05, 0.16, 0.32);
    intake.translate(X_NOSE + 0.01, 1.1, 0);
    add(intake, dark);

    // Landing gear (retractable, 172RG style)
    const wheelGeo = (r: number, w: number) => {
      const g = new THREE.CylinderGeometry(r, r, w, 20);
      g.rotateX(Math.PI / 2);
      return g;
    };
    const hubGeo = (r: number, w: number) => {
      const g = new THREE.CylinderGeometry(r * 0.45, r * 0.45, w * 1.08, 12);
      g.rotateX(Math.PI / 2);
      return g;
    };
    for (const s of [1, -1]) {
      const leg = new THREE.Group();
      leg.position.set(-0.05, 1.0, 0.5 * s);
      leg.rotation.order = 'ZYX';
      const axle = new THREE.Vector3(0.1, -0.7, 0.7 * s);
      add(strut(new THREE.Vector3(0, 0, 0), axle, 0.055, 0.04), metal, leg);
      const wheel = add(wheelGeo(0.3, 0.17), tire, leg);
      wheel.position.copy(axle);
      add(hubGeo(0.3, 0.17), metal, wheel);
      this.wheels.push(wheel);
      this.model.add(leg);
      this.mainGears.push(leg);
    }
    this.noseGear.position.set(2.25, 0.95, 0);
    add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.07, -0.7, 0), 0.05, 0.04), metal, this.noseGear);
    const noseWheel = add(wheelGeo(0.25, 0.13), tire, this.noseGear);
    noseWheel.position.set(0.07, -0.7, 0);
    add(hubGeo(0.25, 0.13), metal, noseWheel);
    this.wheels.push(noseWheel);
    this.model.add(this.noseGear);

    // Antenna and step
    add(strut(new THREE.Vector3(-0.9, 2.3, 0), new THREE.Vector3(-1.25, 2.75, 0), 0.012, 0.008), dark, this.model, false);

    // Navigation lights, beacon and strobes
    const glow = glowTexture();
    const light = (color: string, x: number, y: number, z: number, size: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      sp.position.set(x, y, z);
      sp.scale.setScalar(size);
      this.model.add(sp);
      return sp;
    };
    const tipY = wy + 5.5 * dihedral;
    this.navLights.push(light('#3dff6e', 0.45, tipY, 5.55, 0.7), light('#ff3030', 0.45, tipY, -5.55, 0.7), light('#ffffff', -5.08, 2.0, 0, 0.5));
    this.beacon = light('#ff2a1a', -4.72, 3.66, 0, 1.4);
    this.strobes.push(light('#ffffff', 0.2, tipY, 5.56, 1.8), light('#ffffff', 0.2, tipY, -5.56, 1.8));
    this.tipLocal = [new THREE.Vector3(0.1, tipY, 5.5), new THREE.Vector3(0.1, tipY, -5.5)];

    // Right cabin door (camera side), hinged at its front edge over the painted outline.
    // Hidden while closed so the closed aircraft looks exactly like the livery.
    const doorW = 0.85;
    const doorH = 1.12;
    const doorY = 1.02;
    const doorZ = 0.58;
    this.door.position.set(1.05, doorY, doorZ);
    const panel = new THREE.BoxGeometry(doorW, doorH, 0.04);
    panel.translate(-doorW / 2, doorH / 2, 0.02);
    add(panel, white, this.door);
    const pane = new THREE.BoxGeometry(doorW * 0.78, doorH * 0.42, 0.05);
    pane.translate(-doorW / 2, doorH * 0.7, 0.025);
    add(pane, glass, this.door, false);
    this.door.visible = false;
    this.model.add(this.door);
    const opening = new THREE.PlaneGeometry(doorW, doorH);
    opening.translate(1.05 - doorW / 2, doorY + doorH / 2, doorZ + 0.012);
    this.doorOpening = add(opening, new THREE.MeshBasicMaterial({ color: '#1d232a' }), this.model, false);
    this.doorOpening.visible = false;
  }

  /** World positions of the two wing tips (right, left). */
  getWingTips(right: THREE.Vector3, left: THREE.Vector3): void {
    this.model.updateWorldMatrix(true, false);
    right.copy(this.tipLocal[0]).applyMatrix4(this.model.matrixWorld);
    left.copy(this.tipLocal[1]).applyMatrix4(this.model.matrixWorld);
  }

  /** World position of the cabin door sill (for boarding passengers). */
  doorSill(out: THREE.Vector3): THREE.Vector3 {
    this.model.updateWorldMatrix(true, false);
    return out.set(0.62, 0.95, 0.75).applyMatrix4(this.model.matrixWorld);
  }

  get doorFullyOpen(): boolean {
    return this.doorAngle > 1.15;
  }

  get doorFullyClosed(): boolean {
    return this.doorAngle < 0.01;
  }

  dispose(): void {
    disposeObject(this.root);
  }

  /** Applies physics pose and animates moving parts. */
  update(dt: number, x: number, y: number, pitch: number, roll: number, s: AirplaneVisualState): void {
    this.time += dt;
    this.root.position.set(x, y, 0);
    // Pitch about the world z axis, bank about the aircraft's own longitudinal axis.
    this.root.rotation.set(roll, 0, pitch, 'ZYX');

    const doorTarget = this.doorOpen ? 1.25 : 0;
    this.doorAngle += Math.sign(doorTarget - this.doorAngle) * Math.min(Math.abs(doorTarget - this.doorAngle), dt * 1.4);
    this.door.rotation.y = this.doorAngle;
    this.door.visible = this.doorAngle > 0.005;
    this.doorOpening.visible = this.door.visible;
    this.model.position.y = -0.55 * (1 - s.gear);

    // Propeller: visible blades at low rpm, blurred disc at high rpm
    const rpm = 0.22 + s.throttle * 0.78;
    this.propAngle += Math.min(rpm * 70, 32) * dt;
    this.propeller.rotation.x = -this.propAngle;
    this.bladeMaterial.opacity = 1 - THREE.MathUtils.smoothstep(rpm, 0.35, 0.8) * 0.7;
    this.discMaterial.opacity = THREE.MathUtils.smoothstep(rpm, 0.25, 0.9) * 0.22;

    for (const f of this.flaps) {
      f.rotation.z = s.flaps * 0.52;
      f.position.x = 0.85 - 0.75 * 1.63 - s.flaps * 0.12;
    }
    this.elevator.rotation.z = -s.elevator * 0.32;

    const g = 1 - s.gear;
    this.mainGears[0].rotation.set(0.785 * g, 0, -1.35 * g);
    this.mainGears[1].rotation.set(-0.785 * g, 0, -1.35 * g);
    this.noseGear.rotation.z = -1.5 * g;

    if (s.onGround) {
      for (let i = 0; i < this.wheels.length; i++) {
        const r = i < 2 ? 0.3 : 0.25;
        this.wheels[i].rotation.z -= (s.groundSpeed / r) * dt;
      }
    }

    const t = this.time;
    const on = this.lightsOn;
    this.beacon.material.opacity = on ? ((t % 1.2) < 0.12 ? 1 : 0.05) : 0;
    const strobe = on && ((t % 1.6) < 0.06 || ((t % 1.6) > 0.16 && (t % 1.6) < 0.22)) ? 1 : 0;
    for (const sp of this.strobes) sp.material.opacity = strobe;
    for (const sp of this.navLights) sp.visible = on;
  }
}

export function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.15, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Fuselage livery: u along x (tail → nose), v around the section (bottom → right → top → left). */
function paintLivery(): HTMLCanvasElement {
  const W = 1024;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const X = (x: number) => ((x - X_TAIL) / (X_NOSE - X_TAIL)) * W;
  const Y = (v: number) => (1 - v) * H;
  g.fillStyle = '#f5f6f3';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#d3d7da';
  g.fillRect(0, Y(0.07), W, H);
  g.fillRect(0, 0, W, Y(0.93));
  // Cheat lines in Slovak blue and red, mirrored on both sides
  for (const mirror of [false, true]) {
    const band = (v0: number, v1: number, color: string) => {
      g.fillStyle = color;
      const a = mirror ? 1 - v1 : v0;
      const b = mirror ? 1 - v0 : v1;
      g.fillRect(0, Y(b), W, Y(a) - Y(b));
    };
    band(0.175, 0.232, '#1d3f8f');
    band(0.243, 0.259, '#c8202f');
  }
  // Cowling seam and door outline
  g.strokeStyle = 'rgba(80,90,100,0.55)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(X(2.0), 0);
  g.lineTo(X(2.0), H);
  g.stroke();
  g.strokeRect(X(0.2), Y(0.43), X(1.05) - X(0.2), Y(0.27) - Y(0.43));
  g.strokeRect(X(0.2), Y(0.73), X(1.05) - X(0.2), Y(0.57) - Y(0.73));
  for (const x of [-3.6, -2.6, -1.6]) {
    g.strokeStyle = 'rgba(120,130,140,0.35)';
    g.beginPath();
    g.moveTo(X(x), 0);
    g.lineTo(X(x), H);
    g.stroke();
  }
  // Registration on the right side of the tail cone
  g.fillStyle = '#1d3f8f';
  g.font = 'bold 30px "Segoe UI", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('OM-BTV', X(-3.7), Y(0.31));
  return c;
}

function paintFin(): HTMLCanvasElement {
  const W = 512;
  const H = 300;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const X = (x: number) => ((x + 5.1) / 2.9) * W;
  const Y = (y: number) => (1 - (y - 1.95) / 1.7) * H;
  g.fillStyle = '#f4f5f2';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1d3f8f';
  g.beginPath();
  g.moveTo(X(-5.2), Y(2.6));
  g.lineTo(X(-3.6), Y(3.7));
  g.lineTo(X(-5.2), Y(3.7));
  g.closePath();
  g.fill();
  g.fillStyle = '#c8202f';
  g.beginPath();
  g.moveTo(X(-5.2), Y(2.42));
  g.lineTo(X(-3.4), Y(3.66));
  g.lineTo(X(-3.55), Y(3.7));
  g.lineTo(X(-5.2), Y(2.54));
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(60,70,80,0.6)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(X(-4.58), Y(1.98));
  g.lineTo(X(-4.5), Y(3.6));
  g.stroke();
  return c;
}
