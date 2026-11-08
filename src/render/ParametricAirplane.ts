import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AircraftConfig, AircraftVisual } from '../sim/aircraft/AircraftConfig';
import { disposeObject, glowTexture, type AircraftModel, type AirplaneVisualState } from './Airplane';
import { loftAirfoil, loftFuselage, profileAt, strut, type Station, type WingSection } from './geometry';

/**
 * Procedural airliner / twin built from an {@link AircraftVisual} description.
 * Same conventions as the C172 model: origin at the main-wheel contact point, nose towards +x,
 * up +y, right wing towards +z (the camera side, where the boarding door is).
 */

const D2R = Math.PI / 180;
const FUSE_EXP = 2.15;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Fuselage outline: fraction from the nose, width / height fractions, centre-line offset (× height). */
const FUSE_PROFILE: [d: number, w: number, h: number, dy: number][] = [
  [0, 0.05, 0.05, -0.13],
  [0.012, 0.36, 0.44, -0.11],
  [0.035, 0.64, 0.72, -0.065],
  [0.07, 0.87, 0.9, -0.03],
  [0.12, 0.985, 0.985, -0.005],
  [0.17, 1, 1, 0],
  [0.62, 1, 1, 0],
  [0.72, 0.94, 0.9, 0.045],
  [0.82, 0.74, 0.66, 0.15],
  [0.92, 0.44, 0.36, 0.28],
  [0.985, 0.16, 0.13, 0.36],
  [1, 0.08, 0.07, 0.37],
];

/** Height fraction (−1 bottom … +1 top of the section) → livery v on the right (camera) side. */
function vAt(t: number): number {
  const s = Math.sign(t) * Math.abs(Math.max(-1, Math.min(1, t))) ** (FUSE_EXP / 2);
  return (Math.asin(s) + Math.PI / 2) / (Math.PI * 2);
}

interface PropRig {
  group: THREE.Group;
  dir: number;
}

export class ParametricAirplane implements AircraftModel {
  readonly root = new THREE.Group();
  readonly stairRun: number;
  doorOpen = false;
  lightsOn = true;
  private readonly model = new THREE.Group();
  private readonly props: PropRig[] = [];
  private readonly bladeMaterial: THREE.MeshStandardMaterial;
  private readonly discMaterial: THREE.MeshBasicMaterial;
  private readonly flaps: { hinge: THREE.Group; x: number; fowler: number }[] = [];
  private readonly elevators: THREE.Group[] = [];
  private readonly mainGears: { leg: THREE.Group; side: number }[] = [];
  private readonly noseGear = new THREE.Group();
  private readonly wheels: { mesh: THREE.Object3D; r: number }[] = [];
  private readonly beacons: THREE.Sprite[] = [];
  private readonly strobes: THREE.Sprite[] = [];
  private readonly navLights: THREE.Sprite[] = [];
  private readonly door = new THREE.Group();
  private readonly doorOpening: THREE.Mesh;
  private readonly stairs = new THREE.Group();
  private readonly tipLocal: THREE.Vector3[];
  private readonly sill: THREE.Vector3;
  private readonly bellyDrop: number;
  private readonly propRpmScale: number;
  private propAngle = 0;
  private time = 0;
  private doorAngle = 0;

  constructor(cfg: AircraftConfig, envMap: THREE.Texture | null) {
    const v = cfg.visual!;
    this.root.add(this.model);
    const L = v.lengthM;
    const H = v.fuselageHeightM;
    const W = v.fuselageWidthM;
    const semi = cfg.roll.wingSpanM / 2;
    const wing = v.wing;
    const big = v.windows >= 15;
    const jet = v.engines.kind === 'turbofan';

    // Main gear sits just aft of the wing root: that fixes where the nose is.
    const xNose = wing.rootXFrac * L + 0.85 * wing.rootChordM;
    const X = (d: number) => xNose - d * L;
    const cy = v.bellyHeightM + H / 2;
    const xTail = X(1);
    this.bellyDrop = v.bellyHeightM * 0.92;
    this.propRpmScale = cfg.propulsion === 'piston' ? 1 : 0.8;

    const std = (p: THREE.MeshStandardMaterialParameters) =>
      new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 0.8, side: THREE.DoubleSide, ...p });
    const liv = v.livery;
    const fuselageTex = canvasTexture(paintFuselage(cfg, v));
    const paint = std({ map: fuselageTex, roughness: 0.34, metalness: 0.06 });
    const body = std({ color: liv.body, roughness: 0.36, metalness: 0.06 });
    const wingMat = std({ color: jet ? '#d3d8dc' : liv.body, roughness: 0.42, metalness: jet ? 0.25 : 0.06 });
    const nacelleMat = std({ color: liv.engine, roughness: 0.3, metalness: 0.2 });
    const metal = std({ color: '#a3aab0', roughness: 0.3, metalness: 0.85 });
    const dark = std({ color: '#1f2328', roughness: 0.6, metalness: 0.2 });
    const tire = std({ color: '#1a1b1d', roughness: 0.92, metalness: 0 });
    const gearPaint = std({ color: '#c9ccd0', roughness: 0.45, metalness: 0.5 });
    this.bladeMaterial = std({ vertexColors: true, roughness: 0.5, metalness: 0.3, transparent: true });
    this.discMaterial = new THREE.MeshBasicMaterial({ color: '#d8dee3', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.model, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // ---------------------------------------------------------------- fuselage
    const stations: Station[] = FUSE_PROFILE.map(([d, w, h, dy]) => ({ x: X(d), w: w * W, h: h * H, cy: cy + dy * H })).reverse();
    add(loftFuselage(stations, { x0: xTail, x1: xNose, segX: 120, segR: 44, caps: true, exponent: FUSE_EXP }), paint);
    const section = (x: number) => profileAt(stations, x);

    // ---------------------------------------------------------------- wing planform
    const tanLE = Math.tan(wing.sweepDeg * D2R);
    const dih = Math.tan(wing.dihedralDeg * D2R);
    const zRoot = W * 0.42;
    const xRootLE = X(wing.rootXFrac);
    const yRoot = wing.mount === 'high' ? cy + 0.41 * H : cy - 0.3 * H;
    const swept = wing.sweepDeg > 12;
    const zKink = zRoot + 0.32 * (semi - zRoot);
    const chordKink = swept
      ? Math.max(wing.tipChordM * 1.5, wing.rootChordM - (zKink - zRoot) * tanLE)
      : lerp(wing.rootChordM, wing.tipChordM, (zKink - zRoot) / (semi - zRoot));
    const raked = wing.tip === 'raked';
    const zStraightEnd = raked ? semi * 0.9 : semi;
    const chordAt = (z: number) => {
      if (z <= zKink) return lerp(wing.rootChordM, chordKink, (z - zRoot) / (zKink - zRoot));
      return lerp(chordKink, wing.tipChordM, Math.min(1, (z - zKink) / (zStraightEnd - zKink)));
    };
    const xLEAt = (z: number) => xRootLE - (Math.min(z, zStraightEnd) - zRoot) * tanLE;
    const yAt = (z: number) => yRoot + (z - zRoot) * dih;
    const thick = jet ? 0.11 : 0.14;
    const camber = 0.02;
    const FLAP_F = 0.72;
    const zFlapEnd = zRoot + (semi - zRoot) * (jet ? 0.68 : 0.62);
    const sec = (z: number, side: number, f1 = 1): WingSection => ({ z: z * side, xLE: xLEAt(z), chord: chordAt(z), y: yAt(z), f1 });
    const tipSec = (side: number): WingSection =>
      raked
        ? { z: semi * side, xLE: xLEAt(zStraightEnd) - (semi - zStraightEnd) * Math.tan((wing.sweepDeg + 22) * D2R), chord: wing.tipChordM * 0.42, y: yAt(semi), f1: 1 }
        : sec(semi, side);
    const ascending = (list: WingSection[]) => list.sort((a, b) => a.z - b.z);

    const wingGeos: THREE.BufferGeometry[] = [];
    // Centre box through the fuselage.
    wingGeos.push(loftAirfoil([{ z: -zRoot, xLE: xRootLE, chord: wing.rootChordM, y: yRoot }, { z: zRoot, xLE: xRootLE, chord: wing.rootChordM, y: yRoot }], thick, camber));
    const zMidFlap = swept ? zKink : (zRoot + zFlapEnd) / 2;
    for (const side of [1, -1]) {
      wingGeos.push(loftAirfoil(ascending([sec(zRoot, side, FLAP_F), sec(zMidFlap, side, FLAP_F)]), thick, camber));
      wingGeos.push(loftAirfoil(ascending([sec(zMidFlap, side, FLAP_F), sec(zFlapEnd, side, FLAP_F)]), thick, camber));
      const outer = [sec(zFlapEnd, side), sec(zStraightEnd, side)];
      if (raked) outer.push(tipSec(side));
      wingGeos.push(loftAirfoil(ascending(outer), thick * 0.9, camber));
      // Flaps, one hinge per segment so swept trailing edges stay attached.
      for (const [za, zb] of [
        [zRoot, zMidFlap],
        [zMidFlap, zFlapEnd],
      ]) {
        const zm = (za + zb) / 2;
        const hx = xLEAt(zm) - FLAP_F * chordAt(zm);
        const hy = yAt(zm) - 0.01 * chordAt(zm);
        const hinge = new THREE.Group();
        hinge.position.set(hx, hy, 0);
        const fs = (z: number): WingSection => ({ z: z * side, xLE: xLEAt(z) - hx, chord: chordAt(z), y: yAt(z) - hy, f0: FLAP_F, f1: 1 });
        add(loftAirfoil(ascending([fs(za), fs(zb)]), thick, camber, 8), wingMat, hinge);
        this.model.add(hinge);
        this.flaps.push({ hinge, x: hx, fowler: 0.1 * chordAt(zm) });
      }
    }
    // Flap-track fairings under swept wings.
    if (jet) {
      for (const side of [1, -1]) {
        for (const z of [zKink * 0.85 + zRoot * 0.15, (zKink + zFlapEnd) / 2, zFlapEnd - 0.4]) {
          const c = chordAt(z);
          const x0 = xLEAt(z) - 0.45 * c;
          const x1 = xLEAt(z) - 1.18 * c;
          wingGeos.push(strut(new THREE.Vector3(x0, yAt(z) - 0.05 * c, z * side), new THREE.Vector3(x1, yAt(z) - 0.02 * c, z * side), 0.05 * c, 0.015 * c, 0.6));
        }
      }
    }
    add(mergeGeometries(wingGeos.map((g) => g.toNonIndexed())), wingMat);

    // Belly fairing (low wing) or sponsons (high wing).
    if (wing.mount === 'low' && big) {
      const x0 = xRootLE + 0.25 * wing.rootChordM;
      const x1 = xRootLE - 1.35 * wing.rootChordM;
      const fs: Station[] = [
        { x: x1, w: W * 0.4, h: H * 0.15, cy: cy - 0.38 * H },
        { x: lerp(x1, x0, 0.3), w: W * 1.02, h: H * 0.42, cy: cy - 0.3 * H },
        { x: lerp(x1, x0, 0.75), w: W * 1.04, h: H * 0.45, cy: cy - 0.29 * H },
        { x: x0, w: W * 0.5, h: H * 0.2, cy: cy - 0.33 * H },
      ];
      add(loftFuselage(fs, { x0: x1, x1: x0, segX: 24, segR: 24, caps: true, exponent: 2.4 }), body);
    } else if (wing.mount === 'high' && v.bellyHeightM < 1.2) {
      for (const side of [1, -1]) {
        const fs: Station[] = [
          { x: -3.2, w: 0.3, h: 0.4, cy: v.bellyHeightM + 0.45 },
          { x: -1.6, w: 0.95, h: 1.1, cy: v.bellyHeightM + 0.5 },
          { x: 1.4, w: 0.95, h: 1.1, cy: v.bellyHeightM + 0.5 },
          { x: 2.8, w: 0.3, h: 0.45, cy: v.bellyHeightM + 0.5 },
        ];
        const g = loftFuselage(fs, { x0: -3.2, x1: 2.8, segX: 16, segR: 16, caps: true, exponent: 2.6 });
        g.translate(0, 0, side * W * 0.46);
        add(g, body);
      }
    }

    // ---------------------------------------------------------------- winglets
    const tipX = raked ? tipSec(1).xLE : xLEAt(semi);
    const tipY = yAt(semi);
    const tipChord = raked ? wing.tipChordM * 0.42 : wing.tipChordM;
    const vertical = (h0: number, h1: number, rootChord: number, tipFrac: number, sweepDeg: number, t: number) => {
      const ts = Math.tan(sweepDeg * D2R);
      const secs: WingSection[] = [h0, h1].map((h) => ({ z: h, xLE: -Math.max(0, h) * ts, chord: rootChord * lerp(1, tipFrac, Math.abs(h) / Math.max(Math.abs(h0), Math.abs(h1), 1e-3)), y: 0 }));
      const g = loftAirfoil(secs, t, 0, 10);
      g.rotateX(-Math.PI / 2);
      return g;
    };
    if (wing.tip === 'winglet' || wing.tip === 'sharklet' || wing.tip === 'fence') {
      const geos: THREE.BufferGeometry[] = [];
      for (const side of [1, -1]) {
        const parts: THREE.BufferGeometry[] = [];
        if (wing.tip === 'fence') {
          parts.push(vertical(0, semi * 0.055, tipChord * 0.9, 0.55, 45, 0.1));
          const down = vertical(0, semi * 0.03, tipChord * 0.6, 0.5, 45, 0.1);
          down.scale(1, -1, 1);
          parts.push(down);
        } else {
          const h = wing.tip === 'sharklet' ? semi * 0.135 : Math.max(0.6, semi * 0.1);
          const g = vertical(0, h, tipChord * 0.95, wing.tip === 'sharklet' ? 0.3 : 0.4, wing.tip === 'sharklet' ? 42 : 34, 0.09);
          g.rotateX(side * (wing.tip === 'sharklet' ? 0.2 : 0.28));
          parts.push(g);
        }
        for (const g of parts) {
          g.translate(tipX, tipY, semi * side);
          geos.push(g.toNonIndexed());
        }
      }
      add(mergeGeometries(geos), wingMat);
    }

    // ---------------------------------------------------------------- tail
    const tail = v.tail;
    const finRootLE = xTail + 0.035 * L + tail.finChordM;
    const finSec = section(finRootLE - tail.finChordM * 0.5);
    const finBase = finSec.cy + finSec.h * 0.38;
    const finTipFrac = tail.type === 't' ? 0.72 : 0.38;
    const finGeo = vertical(-finSec.h * 0.3, tail.finHeightM, tail.finChordM, finTipFrac, tail.sweepDeg, 0.1);
    finGeo.translate(finRootLE, finBase, 0);
    planarUv(finGeo);
    add(finGeo, std({ map: canvasTexture(paintFin(v)), roughness: 0.34, metalness: 0.06 }));

    const finTipLE = finRootLE - tail.finHeightM * Math.tan(tail.sweepDeg * D2R);
    const stabHalf = tail.stabSpanM / 2;
    const stabSweep = Math.tan(Math.max(0, tail.sweepDeg - 6) * D2R);
    const stabRootLE = tail.type === 't' ? finTipLE - 0.05 * tail.finChordM : xTail + 0.04 * L + tail.stabChordM;
    const stabY = tail.type === 't' ? finBase + tail.finHeightM : section(stabRootLE - tail.stabChordM / 2).cy + 0.05 * H;
    const stabDih = tail.type === 't' ? 0 : Math.tan(6 * D2R);
    const ELEV_F = 0.68;
    const stabChordAt = (z: number) => tail.stabChordM * lerp(1, 0.4, z / stabHalf);
    const stabLEAt = (z: number) => stabRootLE - z * stabSweep;
    const stabSecs = (side: number, f0?: number, f1?: number, dx = 0, dy = 0): WingSection[] =>
      ascending(
        [0, stabHalf * 0.5, stabHalf].map((z) => ({ z: z * side, xLE: stabLEAt(z) - dx, chord: stabChordAt(z), y: stabY + z * stabDih - dy, f0, f1 })),
      );
    const stabMat = tail.type === 't' ? std({ color: liv.tail, roughness: 0.36, metalness: 0.06 }) : body;
    const stabGeos: THREE.BufferGeometry[] = [];
    for (const side of [1, -1]) {
      stabGeos.push(loftAirfoil(stabSecs(side, 0, ELEV_F), 0.1, 0).toNonIndexed());
      const hz = stabHalf * 0.5;
      const hx = stabLEAt(hz) - ELEV_F * stabChordAt(hz);
      const elev = new THREE.Group();
      elev.position.set(hx, stabY + hz * stabDih, 0);
      add(loftAirfoil(stabSecs(side, ELEV_F, 1, hx, stabY + hz * stabDih), 0.1, 0, 8), stabMat, elev);
      this.model.add(elev);
      this.elevators.push(elev);
    }
    add(mergeGeometries(stabGeos), stabMat);

    // ---------------------------------------------------------------- engines
    const eng = v.engines;
    const engineZs: number[] = [];
    for (const f of eng.spanFrac) engineZs.push(f * semi);
    const Dn = eng.nacelleDiaM;
    const Ln = eng.nacelleLengthM;
    const nacelleGeos: THREE.BufferGeometry[] = [];
    const darkGeos: THREE.BufferGeometry[] = [];
    const metalGeos: THREE.BufferGeometry[] = [];
    const engineNacelleY: number[] = [];
    for (const z of engineZs) {
      const xle = xLEAt(z);
      const yw = yAt(z);
      for (const side of [1, -1]) {
        if (jet) {
          const ny = yw - 0.62 * Dn;
          const front = xle + 0.55 * Ln;
          const prof: [number, number][] = [
            [0.36, 0],
            [0.42, 0.12],
            [0.5, 0.5],
            [0.5, 0.84],
            [0.475, 0.97],
            [0.445, 1],
            [0.41, 0.985],
          ];
          const g = new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r * Dn, a * Ln)), 28);
          g.rotateZ(-Math.PI / 2);
          g.translate(front - Ln, ny, z * side);
          nacelleGeos.push(g.toNonIndexed());
          const face = new THREE.CircleGeometry(0.41 * Dn, 24);
          face.rotateY(Math.PI / 2);
          face.translate(front - 0.06 * Ln, ny, z * side);
          darkGeos.push(face.toNonIndexed());
          const spinner = new THREE.ConeGeometry(0.12 * Dn, 0.22 * Dn, 16);
          spinner.rotateZ(-Math.PI / 2);
          spinner.translate(front - 0.03 * Ln, ny, z * side);
          metalGeos.push(spinner.toNonIndexed());
          const cone = new THREE.ConeGeometry(0.26 * Dn, 0.32 * Ln, 20);
          cone.rotateZ(Math.PI / 2);
          cone.translate(front - Ln - 0.12 * Ln, ny, z * side);
          metalGeos.push(cone.toNonIndexed());
          const pylonH = yw - (ny + 0.4 * Dn) + 0.15 * chordAt(z) * thick;
          const pylon = new THREE.BoxGeometry(0.8 * Ln, Math.max(0.3, pylonH), 0.14 * Dn);
          pylon.translate(front - 0.55 * Ln, ny + 0.4 * Dn + pylonH / 2, z * side);
          nacelleGeos.push(pylon.toNonIndexed());
          engineNacelleY.push(ny);
        } else {
          const high = wing.mount === 'high';
          const ny = high ? yw - 0.12 * Dn : yw + 0.22 * Dn;
          const front = xle + 0.45 * Ln;
          const prof: [number, number][] = [
            [0.1, 0],
            [0.32, 0.22],
            [0.5, 0.55],
            [0.5, 0.8],
            [0.44, 0.94],
            [0.34, 1],
          ];
          const g = new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r * Dn, a * Ln)), 24);
          g.rotateZ(-Math.PI / 2);
          g.translate(front - Ln, ny, z * side);
          nacelleGeos.push(g.toNonIndexed());
          const intake = new THREE.BoxGeometry(0.3 * Dn, 0.16 * Dn, 0.4 * Dn);
          intake.translate(front - 0.08 * Ln, ny - 0.42 * Dn, z * side);
          darkGeos.push(intake.toNonIndexed());
          this.buildProp(eng.propDiaM ?? Dn * 3, eng.blades ?? 4, Dn, new THREE.Vector3(front + 0.02, ny, z * side), side, liv.accent, std, add);
          engineNacelleY.push(ny);
        }
      }
    }
    add(mergeGeometries(nacelleGeos), nacelleMat);
    if (darkGeos.length) add(mergeGeometries(darkGeos), dark, this.model, false);
    if (metalGeos.length) add(mergeGeometries(metalGeos), metal);

    // ---------------------------------------------------------------- landing gear
    const rw = v.gear.wheelDiaM / 2;
    const wheelW = v.gear.wheelDiaM * 0.36;
    const wheelGeo = (r: number, w: number) => {
      const g = new THREE.CylinderGeometry(r, r, w, 20);
      g.rotateX(Math.PI / 2);
      return g;
    };
    const hubGeo = (r: number, w: number) => {
      const g = new THREE.CylinderGeometry(r * 0.5, r * 0.5, w * 1.06, 12);
      g.rotateX(Math.PI / 2);
      return g;
    };
    const buildLeg = (x: number, z: number, attachY: number, wheels: number, r: number, side: number) => {
      const leg = new THREE.Group();
      leg.position.set(x, attachY, z);
      const len = attachY - r;
      const thickness = 0.05 + r * 0.14;
      add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -len, 0), thickness, thickness * 0.85), gearPaint, leg);
      const layout: [number, number][] =
        wheels === 1
          ? [[0, 0]]
          : wheels === 2
            ? [
                [0, 1],
                [0, -1],
              ]
            : wheels === 4
              ? [
                  [1, 1],
                  [1, -1],
                  [-1, 1],
                  [-1, -1],
                ]
              : [
                  [1.6, 1],
                  [1.6, -1],
                  [0, 1],
                  [0, -1],
                  [-1.6, 1],
                  [-1.6, -1],
                ];
      const dz = wheels === 1 ? 0 : wheelW * 0.62 + 0.04;
      const dx = r * 1.25;
      if (wheels >= 4) {
        const beam = new THREE.BoxGeometry(dx * (wheels === 6 ? 3.6 : 2.4), thickness * 1.2, thickness * 1.2);
        beam.translate(0, -len, 0);
        add(beam, gearPaint, leg);
      } else if (wheels === 2) {
        add(strut(new THREE.Vector3(0, -len, -dz), new THREE.Vector3(0, -len, dz), thickness * 0.6, thickness * 0.6), gearPaint, leg);
      }
      for (const [ix, iz] of layout) {
        const w = add(wheelGeo(r, wheelW), tire, leg);
        w.position.set(ix * dx, -len, iz * dz);
        add(hubGeo(r, wheelW), metal, w);
        this.wheels.push({ mesh: w, r });
      }
      this.model.add(leg);
      return { leg, side };
    };
    const lowWing = wing.mount === 'low';
    const nacelleGear = eng.kind === 'wing-prop' && (lowWing || v.bellyHeightM >= 1.2);
    const zGear = nacelleGear ? engineZs[0] : lowWing ? W * 0.5 + 0.1 * semi : W * 0.46;
    for (const side of [1, -1]) {
      const attachY = nacelleGear ? engineNacelleY[0] - Dn * 0.3 : lowWing ? yAt(zGear) - 0.1 : v.bellyHeightM + 0.4;
      this.mainGears.push(buildLeg(0, zGear * side, Math.max(attachY, rw + 0.3), v.gear.mainWheels, rw, side));
    }
    if (v.gear.bodyGear) {
      for (const side of [1, -1]) this.mainGears.push(buildLeg(-0.045 * L, W * 0.2 * side, v.bellyHeightM + 0.3, 6, rw, side));
    }
    const noseX = X(big ? 0.11 : 0.13);
    const rn = rw * (big ? 0.72 : 0.8);
    const noseAttach = section(noseX).cy - section(noseX).h * 0.4;
    this.noseGear.position.set(noseX, noseAttach, 0);
    const nLen = noseAttach - rn;
    const nThick = 0.04 + rn * 0.14;
    add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -nLen, 0), nThick, nThick * 0.85), gearPaint, this.noseGear);
    const noseWheels = big ? [1, -1] : [0];
    for (const iz of noseWheels) {
      const w = add(wheelGeo(rn, wheelW * 0.8), tire, this.noseGear);
      w.position.set(0, -nLen, iz * (wheelW * 0.5 + 0.03));
      add(hubGeo(rn, wheelW * 0.8), metal, w);
      this.wheels.push({ mesh: w, r: rn });
    }
    this.model.add(this.noseGear);

    // ---------------------------------------------------------------- door and stairs
    const doorD = jet ? 0.115 : big ? 0.8 : 0.62;
    const doorW = big ? 1.05 : 0.78;
    const doorH = big ? Math.min(1.95, 0.62 * H) : 0.62 * H;
    const doorHingeX = X(doorD) + doorW / 2;
    const ds = section(X(doorD));
    const sillY = ds.cy - (v.doubleDeck ? 0.3 : big ? 0.2 : 0.3) * ds.h;
    const doorZ = ds.w / 2 * 0.97;
    this.door.position.set(doorHingeX, sillY, doorZ);
    const panel = new THREE.BoxGeometry(doorW, doorH, 0.06);
    panel.translate(-doorW / 2, doorH / 2, 0.03);
    add(panel, body, this.door);
    this.door.visible = false;
    this.model.add(this.door);
    const opening = new THREE.PlaneGeometry(doorW, doorH);
    opening.translate(doorHingeX - doorW / 2, sillY + doorH / 2, doorZ + 0.03);
    this.doorOpening = add(opening, new THREE.MeshBasicMaterial({ color: '#1d232a' }), this.model, false);
    this.doorOpening.visible = false;
    this.sill = new THREE.Vector3(doorHingeX - doorW / 2, sillY, doorZ);

    const run = Math.max(0.6, sillY * 1.15);
    const steps = Math.max(3, Math.round(sillY / 0.21));
    const stairGeos: THREE.BufferGeometry[] = [];
    const sw = doorW * 1.2;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const step = new THREE.BoxGeometry(sw, 0.06, run / steps + 0.05);
      step.translate(0, sillY * (1 - t) - 0.05, 0.25 + t * run);
      stairGeos.push(step);
    }
    for (const sx of [-sw / 2, sw / 2]) {
      stairGeos.push(strut(new THREE.Vector3(sx, sillY + 0.9, 0.25), new THREE.Vector3(sx, 0.95, run + 0.25), 0.03, 0.03));
      stairGeos.push(strut(new THREE.Vector3(sx, sillY - 0.1, 0.25), new THREE.Vector3(sx, 0, run + 0.25), 0.05, 0.05));
    }
    if (sillY > 2.2) {
      const truck = new THREE.BoxGeometry(sw * 1.4, 1.1, run * 0.7);
      truck.translate(0, 0.55, run * 0.55 + 0.25);
      stairGeos.push(truck);
    }
    for (const sg of stairGeos) sg.deleteAttribute('uv');
    add(mergeGeometries(stairGeos.map((sg) => (sg.index ? sg.toNonIndexed() : sg))), std({ color: '#d9dcdf', roughness: 0.6, metalness: 0.4 }), this.stairs);
    this.stairs.position.set(this.sill.x, 0, doorZ - 0.2);
    this.stairs.visible = false;
    this.model.add(this.stairs);
    this.stairRun = run + 0.4;

    // ---------------------------------------------------------------- lights
    const glow = glowTexture();
    const light = (color: string, x: number, y: number, z: number, size: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      sp.position.set(x, y, z);
      sp.scale.setScalar(size);
      this.model.add(sp);
      return sp;
    };
    const ls = Math.max(1, Math.sqrt(L / 10));
    this.navLights.push(light('#3dff6e', tipX - 0.1, tipY, semi + 0.05, 0.8 * ls), light('#ff3030', tipX - 0.1, tipY, -semi - 0.05, 0.8 * ls), light('#ffffff', xTail - 0.1, section(xTail + 0.3).cy, 0, 0.6 * ls));
    const top = section(X(0.45));
    this.beacons.push(light('#ff2a1a', X(0.45), top.cy + top.h / 2 + 0.1, 0, 1.6 * ls), light('#ff2a1a', X(0.5), top.cy - top.h / 2 - 0.1, 0, 1.4 * ls));
    this.strobes.push(light('#ffffff', tipX - tipChord * 0.8, tipY, semi + 0.05, 2 * ls), light('#ffffff', tipX - tipChord * 0.8, tipY, -semi - 0.05, 2 * ls));
    this.tipLocal = [new THREE.Vector3(tipX - tipChord * 0.5, tipY, semi), new THREE.Vector3(tipX - tipChord * 0.5, tipY, -semi)];
  }

  private buildProp(
    dia: number,
    blades: number,
    nacelleDia: number,
    at: THREE.Vector3,
    side: number,
    tipColor: string,
    std: (p: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial,
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, parent?: THREE.Object3D, shadow?: boolean) => THREE.Mesh,
  ): void {
    const group = new THREE.Group();
    group.position.copy(at);
    const R = dia / 2;
    const spinner = new THREE.LatheGeometry(
      [[0.34, 0], [0.33, 0.12], [0.29, 0.26], [0.2, 0.4], [0.1, 0.5], [0, 0.55]].map(([r, y]) => new THREE.Vector2(r * nacelleDia, y * nacelleDia)),
      20,
    );
    spinner.rotateZ(-Math.PI / 2);
    add(spinner, std({ color: '#e9ecef', roughness: 0.3, metalness: 0.4 }), group);
    const geos: THREE.BufferGeometry[] = [];
    const tip = new THREE.Color(tipColor);
    for (let i = 0; i < blades; i++) {
      const b = new THREE.BoxGeometry(0.035 * R, R * 0.92, 0.13 * R, 1, 6, 1);
      b.translate(0, R * 0.5, 0);
      const pos = b.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let k = 0; k < pos.count; k++) {
        const y = pos.getY(k) / R;
        const a = (0.95 - y) * 0.6;
        const x = pos.getX(k);
        const z = pos.getZ(k) * (1 - y * 0.45);
        pos.setXYZ(k, x * Math.cos(a) - z * Math.sin(a), pos.getY(k), x * Math.sin(a) + z * Math.cos(a));
        const c = y > 0.86 ? tip : new THREE.Color(0.13, 0.14, 0.15);
        colors.set([c.r, c.g, c.b], k * 3);
      }
      b.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      b.rotateX((i / blades) * Math.PI * 2);
      b.translate(0.12 * nacelleDia, 0, 0);
      geos.push(b);
    }
    const bladeMesh = add(mergeGeometries(geos), this.bladeMaterial, group);
    bladeMesh.geometry.computeVertexNormals();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 40), this.discMaterial);
    disc.rotation.y = Math.PI / 2;
    disc.position.x = 0.12 * nacelleDia;
    group.add(disc);
    this.model.add(group);
    this.props.push({ group, dir: side });
  }

  getWingTips(right: THREE.Vector3, left: THREE.Vector3): void {
    this.model.updateWorldMatrix(true, false);
    right.copy(this.tipLocal[0]).applyMatrix4(this.model.matrixWorld);
    left.copy(this.tipLocal[1]).applyMatrix4(this.model.matrixWorld);
  }

  doorSill(out: THREE.Vector3): THREE.Vector3 {
    this.model.updateWorldMatrix(true, false);
    return out.copy(this.sill).applyMatrix4(this.model.matrixWorld);
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

  update(dt: number, x: number, y: number, pitch: number, roll: number, s: AirplaneVisualState): void {
    this.time += dt;
    this.root.position.set(x, y, 0);
    this.root.rotation.set(roll, 0, pitch, 'ZYX');

    const doorTarget = this.doorOpen ? 1.25 : 0;
    this.doorAngle += Math.sign(doorTarget - this.doorAngle) * Math.min(Math.abs(doorTarget - this.doorAngle), dt * 1.2);
    this.door.rotation.y = this.doorAngle;
    this.door.visible = this.doorAngle > 0.005;
    this.doorOpening.visible = this.door.visible;
    this.stairs.visible = this.door.visible;

    // A gear-up landing puts the belly on the runway; in flight the retracted gear changes nothing.
    const g = 1 - s.gear;
    this.model.position.y = -g * this.bellyDrop * clamp01(1 - y / (this.bellyDrop * 3 + 2));

    const rpm = 0.22 + s.throttle * 0.78;
    this.propAngle += Math.min(rpm * 55 * this.propRpmScale, 30) * dt;
    for (const p of this.props) p.group.rotation.x = -this.propAngle * p.dir;
    this.bladeMaterial.opacity = 1 - THREE.MathUtils.smoothstep(rpm, 0.35, 0.8) * 0.7;
    this.discMaterial.opacity = THREE.MathUtils.smoothstep(rpm, 0.25, 0.9) * 0.18;

    for (const f of this.flaps) {
      f.hinge.rotation.z = s.flaps * 0.6;
      f.hinge.position.x = f.x - s.flaps * f.fowler;
    }
    for (const e of this.elevators) e.rotation.z = -s.elevator * 0.3;

    for (const { leg, side } of this.mainGears) {
      leg.rotation.x = side * 1.55 * g;
      leg.visible = s.gear > 0.03;
    }
    this.noseGear.rotation.z = 1.55 * g;
    this.noseGear.visible = s.gear > 0.03;

    if (s.onGround) for (const w of this.wheels) w.mesh.rotation.z -= (s.groundSpeed / w.r) * dt;

    const t = this.time;
    const on = this.lightsOn;
    for (const b of this.beacons) b.material.opacity = on ? ((t % 1.2) < 0.12 ? 1 : 0.05) : 0;
    const strobe = on && ((t % 1.6) < 0.06 || ((t % 1.6) > 0.16 && (t % 1.6) < 0.22)) ? 1 : 0;
    for (const sp of this.strobes) sp.material.opacity = strobe;
    for (const sp of this.navLights) sp.visible = on;
  }
}

function canvasTexture(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Side-projected texture coordinates (u along x, v along y) over the geometry's bounds. */
function planarUv(g: THREE.BufferGeometry): void {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - b.min.x) / (b.max.x - b.min.x);
    uv[i * 2 + 1] = (pos.getY(i) - b.min.y) / (b.max.y - b.min.y);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Fuselage livery: u along x (tail → nose), v around the section (bottom → right → top → left). */
function paintFuselage(cfg: AircraftConfig, v: AircraftVisual): HTMLCanvasElement {
  const CW = 2048;
  const CH = 512;
  const c = document.createElement('canvas');
  c.width = CW;
  c.height = CH;
  const g = c.getContext('2d')!;
  const L = v.lengthM;
  const H = v.fuselageHeightM;
  const liv = v.livery;
  const U = (d: number) => (1 - d) * CW;
  const Y = (vv: number) => (1 - vv) * CH;
  const band = (t0: number, t1: number, color: string, d0 = 0, d1 = 1) => {
    g.fillStyle = color;
    const a = vAt(t0);
    const b = vAt(t1);
    for (const [v0, v1] of [
      [a, b],
      [1 - b, 1 - a],
    ]) {
      g.fillRect(U(d1), Y(v1), U(d0) - U(d1), Y(v0) - Y(v1));
    }
  };
  g.fillStyle = liv.body;
  g.fillRect(0, 0, CW, CH);
  band(-1, -0.55, liv.belly);
  band(-0.56, -0.53, liv.accent);

  const big = v.windows >= 15;
  const winRows = v.doubleDeck ? [-0.22, 0.5] : [big ? 0.2 : 0.12];
  const stripeT = winRows[0] - (big ? 0.25 : 0.32);
  band(stripeT - 0.1, stripeT + 0.04, liv.stripe, 0.05, 1);
  band(stripeT - 0.16, stripeT - 0.12, liv.accent, 0.08, 1);

  // Cabin windows (skipping the door zones).
  const winW = big ? 0.27 * Math.sqrt(H / 4) : L * 0.05;
  const winH = big ? 0.36 * Math.sqrt(H / 4) : H * 0.26;
  const doors = v.engines.kind === 'turbofan' ? [0.115, 0.5, 0.86] : big ? [0.15, 0.8] : [0.62];
  const doorHalf = (big ? 0.7 : 0.45) / L;
  g.fillStyle = '#18222d';
  for (const row of winRows) {
    const tw = winH / H;
    const v0 = vAt(row - tw);
    const v1 = vAt(row + tw);
    const d0 = big ? 0.16 : 0.3;
    const d1 = big ? (v.doubleDeck && row > 0 ? 0.74 : 0.8) : 0.58;
    const n = v.windows;
    for (let i = 0; i < n; i++) {
      const d = d0 + ((d1 - d0) * (i + 0.5)) / n;
      if (doors.some((dd) => Math.abs(d - dd) < doorHalf + winW / L)) continue;
      const x = U(d) - (winW / L) * CW * 0.5;
      roundRect(g, x, Y(v1), (winW / L) * CW, Y(v0) - Y(v1), Math.min(6, ((winW / L) * CW) / 2.5));
    }
  }
  // Door outlines.
  g.strokeStyle = 'rgba(60,70,80,0.55)';
  g.lineWidth = 2;
  for (const dd of doors) {
    const t0 = winRows[0] - (big ? 0.62 : 0.55);
    const t1 = winRows[0] + (big ? 0.28 : 0.3);
    g.strokeRect(U(dd + doorHalf * 0.8), Y(vAt(t1)), ((doorHalf * 1.6) * CW), Y(vAt(t0)) - Y(vAt(t1)));
  }
  // Flight deck windows.
  g.fillStyle = '#121a22';
  g.beginPath();
  const cw = (d: number, t: number) => [U(d), Y(vAt(t))] as const;
  const pts = big
    ? [cw(0.028, 0.18), cw(0.06, 0.2), cw(0.062, 0.48), cw(0.04, 0.5), cw(0.03, 0.36)]
    : [cw(0.05, 0.12), cw(0.16, 0.14), cw(0.17, 0.58), cw(0.09, 0.62), cw(0.06, 0.4)];
  g.moveTo(...pts[0]);
  for (const p of pts.slice(1)) g.lineTo(...p);
  g.closePath();
  g.fill();
  g.strokeStyle = liv.body;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(...cw(big ? 0.045 : 0.11, 0.15));
  g.lineTo(...cw(big ? 0.048 : 0.115, 0.55));
  g.stroke();

  // Titles and registration (right side reads correctly to the camera).
  const titleT0 = (v.doubleDeck ? 0.62 : winRows[0]) + 0.16;
  const titleH = Y(vAt(titleT0)) - Y(vAt(titleT0 + (big ? 0.36 : 0.3)));
  g.fillStyle = liv.stripe;
  g.font = `bold ${Math.round(titleH)}px "Segoe UI", Arial, sans-serif`;
  g.textBaseline = 'bottom';
  if (big) g.fillText('AIRWAYS', U(0.22), Y(vAt(titleT0)));
  g.font = `bold ${Math.round(Math.min(titleH * 0.55, (2.2 / L) * CW * 0.3))}px "Segoe UI", Arial, sans-serif`;
  g.fillStyle = liv.accent === liv.body ? liv.stripe : '#2b3138';
  g.textBaseline = 'middle';
  g.fillText(cfg.registration, U(big ? 0.9 : 0.86), Y(vAt(big ? winRows[0] + 0.05 : stripeT + 0.25)));

  // Panel seams.
  g.strokeStyle = 'rgba(110,120,130,0.22)';
  g.lineWidth = 1;
  for (let i = 1; i < 16; i++) {
    g.beginPath();
    g.moveTo((i / 16) * CW, 0);
    g.lineTo((i / 16) * CW, CH);
    g.stroke();
  }
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.fill();
}

/** Tail fin: u along x (rear → front), v up the fin. */
function paintFin(v: AircraftVisual): HTMLCanvasElement {
  const W = 512;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const liv = v.livery;
  g.fillStyle = liv.tail;
  g.fillRect(0, 0, W, H);
  // Sweeping accent band from the root front to the trailing edge tip.
  g.fillStyle = liv.accent;
  g.beginPath();
  g.moveTo(W, H * 0.92);
  g.quadraticCurveTo(W * 0.45, H * 0.85, 0, H * 0.12);
  g.lineTo(0, H * 0.3);
  g.quadraticCurveTo(W * 0.5, H * 0.98, W, H);
  g.closePath();
  g.fill();
  // Logo: a white disc with a stylised swept wing.
  const cx = W * 0.42;
  const cy = H * 0.42;
  const r = W * 0.15;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = liv.tail;
  g.beginPath();
  g.moveTo(cx - r * 0.75, cy + r * 0.25);
  g.lineTo(cx + r * 0.7, cy - r * 0.55);
  g.lineTo(cx + r * 0.1, cy + r * 0.05);
  g.lineTo(cx + r * 0.45, cy + r * 0.6);
  g.closePath();
  g.fill();
  return c;
}
