import * as THREE from 'three';
import { Atlas, makeCanvasTexture, type SpriteFrame } from '../art/Atlas';
import { bratislavaSprites, RIVER_WATER, SNP_RIVER_OFFSET } from '../art/bratislava';
import { countrySprites } from '../art/countryside';
import { paintCountryTile, paintHillsTile, paintMountainTile, type TileSpec } from '../art/tiles';
import { rng, range, pick, type Rand } from '../art/paint';
import { viennaSprites } from '../art/vienna';
import { BTS_RUNWAY, DANUBE, DANUBE_CANAL, RUNWAY_WIDTH, RUNWAY_Z, VIE_RUNWAY, ZONES, type Runway } from '../config';
import { buildSpriteBatches, buildTileStrip, type Placement } from './Billboards';

const WORLD_X0 = -3500;
const WORLD_X1 = 19000;
const GROUND_Z0 = -420;
const GROUND_Z1 = 90;

interface ParallaxLayer {
  group: THREE.Group;
  /** Fraction of the camera's height the layer follows (vertical parallax compression). */
  follow: number;
}

/** Ground strip, airports, rivers and painted parallax layers. */
export class World {
  readonly root = new THREE.Group();
  private layers: ParallaxLayer[] = [];
  private frames!: Map<string, SpriteFrame>;
  private pages!: THREE.Texture[];
  private turbineBlades: THREE.InstancedMesh[] = [];
  private turbineData: { x: number; y: number; phase: number; speed: number }[] = [];
  private papi!: THREE.Points;
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly white = new THREE.Color(1, 1, 0.92);
  private readonly red = new THREE.Color(1, 0.12, 0.08);
  readonly groundMaterials: THREE.Material[] = [];

  constructor(anisotropy: number) {
    const atlas = new Atlas();
    atlas.add(...countrySprites(), ...bratislavaSprites(), ...viennaSprites());
    const { pages, frames } = atlas.build(anisotropy);
    this.pages = pages;
    this.frames = frames;

    this.buildGround(anisotropy);
    this.buildRunway(BTS_RUNWAY, '13', anisotropy);
    this.buildRunway(VIE_RUNWAY, '11', anisotropy);
    this.buildWater();
    this.buildLights();
    this.buildLayers(anisotropy);
  }

  private frame(name: string): SpriteFrame {
    const f = this.frames.get(name);
    if (!f) throw new Error(`Missing sprite ${name}`);
    return f;
  }

  private addLayer(depth: number, follow: number): THREE.Group {
    const group = new THREE.Group();
    group.position.z = depth;
    this.root.add(group);
    this.layers.push({ group, follow });
    return group;
  }

  private tile(spec: TileSpec, anisotropy: number): THREE.Texture {
    return makeCanvasTexture(spec.canvas, anisotropy, true);
  }

  // ---------------------------------------------------------------- layers

  private buildLayers(anisotropy: number): void {
    const r = rng(2024);
    const P = this.pages;

    // Far clouds
    const cloudsFar = this.addLayer(-2600, 0.9);
    const farClouds: Placement[] = [];
    for (let x = WORLD_X0; x < WORLD_X1; x += range(r, 600, 1200)) {
      farClouds.push({ frame: this.frame(`cloud_${Math.floor(r() * 5)}`), x, y: range(r, 180, 620), z: r() * 10, scale: range(r, 1.4, 2.6), flip: r() < 0.5 });
    }
    buildSpriteBatches(P, farClouds, { hazeAmount: 0.3, skirt: 0, renderOrder: 0, opacity: 0.9 }).forEach((m) => cloudsFar.add(m));

    // Mountains
    const mountains = this.addLayer(-1500, 0.86);
    const mt = paintMountainTile();
    mountains.add(buildTileStrip(this.tile(mt, anisotropy), mt.w, mt.h, [[WORLD_X0, WORLD_X1]], { hazeAmount: 0.42, skirt: 8, renderOrder: 10 }));

    // Mid-distance clouds
    const cloudsMid = this.addLayer(-1100, 0.75);
    const midClouds: Placement[] = [];
    for (let x = WORLD_X0; x < WORLD_X1; x += range(r, 700, 1500)) {
      midClouds.push({ frame: this.frame(`cloud_${Math.floor(r() * 5)}`), x, y: range(r, 260, 520), z: r() * 10, scale: range(r, 0.9, 1.5), flip: r() < 0.5 });
    }
    buildSpriteBatches(P, midClouds, { hazeAmount: 0.18, skirt: 0, renderOrder: 15, opacity: 0.92 }).forEach((m) => cloudsMid.add(m));

    // Hills, forests and countryside + far city skylines
    const hills = this.addLayer(-800, 0.74);
    const ht = paintHillsTile();
    hills.add(buildTileStrip(this.tile(ht, anisotropy), ht.w, ht.h, [[WORLD_X0, WORLD_X1]], { hazeAmount: 0.28, skirt: 8, renderOrder: 20, fields: true }));
    const hillMasses: Placement[] = [
      { frame: this.frame('kamzik'), x: 4950, z: 1 },
      { frame: this.frame('kahlenberg'), x: 8550, z: 1 },
    ];
    buildSpriteBatches(P, hillMasses, { hazeAmount: 0.26, skirt: 8, renderOrder: 21, fields: true }).forEach((m) => hills.add(m));
    const hillSprites: Placement[] = [
      { frame: this.frame('vienna_far'), x: 8950, z: 3 },
      { frame: this.frame('vienna_far'), x: 9420, z: 3, flip: true },
      { frame: this.frame('vienna_far'), x: 9900, z: 3 },
      { frame: this.frame('vienna_far'), x: 10380, z: 3, flip: true },
      { frame: this.frame('dc_tower'), x: 9180, z: 4 },
      { frame: this.frame('millennium_tower'), x: 9330, z: 4 },
      { frame: this.frame('donauturm'), x: 9470, z: 4 },
    ];
    buildSpriteBatches(P, hillSprites, { hazeAmount: 0.26, skirt: 0, renderOrder: 21.5 }).forEach((m) => hills.add(m));

    // Mid-distance countryside strip with city panoramas
    const mid = this.addLayer(-380, 0.55);
    const ct = paintCountryTile();
    const snp = this.frame('snp_bridge');
    const snpLeft = DANUBE.x0 - SNP_RIVER_OFFSET;
    const snpRight = snpLeft + snp.w;
    const ctTex = this.tile(ct, anisotropy);
    mid.add(
      buildTileStrip(ctTex, ct.w, ct.h, [[WORLD_X0, snpLeft + 2], [snpRight - 2, WORLD_X1]], {
        hazeAmount: 0.1,
        skirt: 8,
        renderOrder: 30,
        fields: true,
      }),
    );
    const midSprites: Placement[] = [];
    const at = (name: string, left: number, z = 2, flip = false) => {
      const f = this.frame(name);
      midSprites.push({ frame: f, x: left + f.w / 2, z, flip });
    };
    // Sprites with an opaque base get a skirt; the rest stand on the tile strip
    const based: Placement[] = [
      { frame: snp, x: snpLeft + snp.w / 2, z: 3 },
      { frame: this.frame('bratislava_castle'), x: snpRight - 6 + this.frame('bratislava_castle').w / 2, z: 2 },
    ];
    buildSpriteBatches(P, based, { hazeAmount: 0.1, skirt: 8, renderOrder: 31 }).forEach((m) => mid.add(m));
    at('petrzalka_far', 2380, 1);
    at('petrzalka_far', 2700, 1.5, true);
    at('petrzalka_far', 3020, 1);
    at('petrzalka_far', 3300, 1.2, true);
    at('bratislava_oldtown', snpRight + 380, 1.5);
    at('village', 5650, 2);
    at('village', 6950, 2, true);
    at('village', 7900, 2);
    for (let x = ZONES.viennaCity.x0; x < ZONES.viennaCity.x1; x += 214) {
      at(r() < 0.5 ? 'vienna_block_a' : 'vienna_block_b', x, 1 + r() * 0.5, r() < 0.5);
    }
    at('votivkirche', 9020, 3);
    at('stephansdom', 9500, 3.5);
    at('karlskirche', 9760, 3);
    at('riesenrad', 10320, 3);
    buildSpriteBatches(P, midSprites, { hazeAmount: 0.1, skirt: 0, renderOrder: 31 }).forEach((m) => mid.add(m));

    // Wind farm (no skirt; towers stand on the strip)
    const turbines: Placement[] = [];
    const tower = this.frame('turbine_tower');
    for (let x = 6150; x < 7750; x += range(r, 150, 230)) {
      const z = range(r, -30, 1);
      const s = range(r, 0.85, 1.05);
      turbines.push({ frame: tower, x, z, scale: s, y: 9 });
      this.turbineData.push({ x, y: 9 + 95 * s, phase: r() * Math.PI * 2, speed: range(r, 0.9, 1.3) });
    }
    buildSpriteBatches(P, turbines, { hazeAmount: 0.12, skirt: 0, renderOrder: 32 }).forEach((m) => mid.add(m));
    const blades: Placement[] = this.turbineData.map((t) => ({ frame: this.frame('turbine_blades'), x: t.x, y: t.y, z: 0.5 }));
    this.turbineBlades = buildSpriteBatches(P, blades, { hazeAmount: 0.12, skirt: 0, renderOrder: 33, centerAnchor: true });
    this.turbineBlades.forEach((m) => mid.add(m));

    // Foreground fields between the near layer and the mid strip, visible once airborne
    const gaps: [number, number][] = [[DANUBE.x0 - 10, DANUBE.x1 + 10]];
    const foreSegments: [number, number][] = [];
    let segStart = WORLD_X0;
    for (const [g0, g1] of gaps) {
      foreSegments.push([segStart, g0]);
      segStart = g1;
    }
    foreSegments.push([segStart, WORLD_X1]);
    const fields = this.addLayer(-290, 0.44);
    fields.add(buildTileStrip(ctTex, ct.w * 0.8, ct.h * 0.8, foreSegments, { hazeAmount: 0.08, skirt: 8, renderOrder: 34, fields: true }));
    const fore = this.addLayer(-200, 0.3);
    fore.add(buildTileStrip(ctTex, ct.w * 0.62, ct.h * 0.62, foreSegments, { hazeAmount: 0.05, skirt: 8, renderOrder: 35, fields: true }));
    const inGap = (x0: number, x1: number) => gaps.some(([g0, g1]) => x1 > g0 && x0 < g1);
    const city = (out: Placement[], names: string[], x0: number, x1: number, scale: number, step: number) => {
      for (let x = x0; x < x1; x += step * range(r, 0.8, 1.2)) {
        const f = this.frame(pick(r, names));
        const w = f.w * scale;
        if (inGap(x - w / 2, x + w / 2)) continue;
        out.push({ frame: f, x, z: r(), scale, flip: r() < 0.5 });
      }
    };
    const blocks = ['vienna_block_a', 'vienna_block_b'];
    const fieldSprites: Placement[] = [];
    city(fieldSprites, ['petrzalka_far'], ZONES.bratislavaOutskirts.x0 + 100, ZONES.bratislavaOutskirts.x1, 0.7, 230);
    city(fieldSprites, blocks, ZONES.viennaCity.x0 + 100, ZONES.viennaCity.x1, 0.75, 125);
    buildSpriteBatches(P, fieldSprites, { hazeAmount: 0.08, skirt: 0, renderOrder: 34.5 }).forEach((m) => fields.add(m));
    const foreSprites: Placement[] = [];
    city(foreSprites, ['petrzalka_far'], ZONES.bratislavaOutskirts.x0 + 200, ZONES.bratislavaOutskirts.x1, 0.55, 190);
    city(foreSprites, blocks, ZONES.viennaCity.x0 + 200, ZONES.viennaCity.x1, 0.6, 105);
    buildSpriteBatches(P, foreSprites, { hazeAmount: 0.05, skirt: 0, renderOrder: 36 }).forEach((m) => fore.add(m));

    // Near layer: trees, houses, airports (stands on the real ground, no vertical compression)
    const near = this.addLayer(0, 0);
    near.add(...buildSpriteBatches(P, this.nearPlacements(rng(77)), { hazeAmount: 0.03, skirt: 0, renderOrder: 40 }));

    // Clouds the aircraft flies past
    const nearClouds: Placement[] = [];
    for (let x = 2600; x < WORLD_X1; x += range(r, 450, 900)) {
      nearClouds.push({ frame: this.frame(`cloud_${Math.floor(r() * 5)}`), x, y: range(r, 260, 1000), z: range(r, -260, -90), scale: range(r, 0.55, 1.1), flip: r() < 0.5 });
    }
    buildSpriteBatches(P, nearClouds, { hazeAmount: 0.06, skirt: 0, renderOrder: 50, opacity: 0.88 }).forEach((m) => near.add(m));
    const frontClouds: Placement[] = [];
    for (let x = 3200; x < WORLD_X1; x += range(r, 1400, 2600)) {
      frontClouds.push({ frame: this.frame(`cloud_${Math.floor(r() * 5)}`), x, y: range(r, 380, 900), z: range(r, 8, 14), scale: range(r, 0.18, 0.28) });
    }
    buildSpriteBatches(P, frontClouds, { hazeAmount: 0, skirt: 0, renderOrder: 60, opacity: 0.5 }).forEach((m) => near.add(m));
  }

  private nearPlacements(r: Rand): Placement[] {
    const list: Placement[] = [];
    const put = (name: string, x: number, z: number, scale = 1, flip = false) =>
      list.push({ frame: this.frame(name), x, z, scale, flip });
    const blocked = (x: number) =>
      (x > DANUBE.x0 - 25 && x < DANUBE.x1 + 25) ||
      (x > DANUBE_CANAL.x0 - 30 && x < DANUBE_CANAL.x1 + 30) ||
      (x > 380 && x < 1250) ||
      (x > VIE_RUNWAY.x0 + 150 && x < VIE_RUNWAY.x0 + 1700);

    // Airports
    put('bts_terminal', 620, -95);
    put('bts_tower', 860, -105);
    put('hangar', 1020, -110);
    put('airliner_generic', 560, -68);
    put('airliner_generic', 760, -72, 1, true);
    put('vie_terminal', VIE_RUNWAY.x0 + 620, -110);
    put('vie_tower', VIE_RUNWAY.x0 + 900, -125);
    put('hangar', VIE_RUNWAY.x0 + 1180, -112);
    put('hangar', VIE_RUNWAY.x0 + 1260, -116);
    put('airliner_austrian', VIE_RUNWAY.x0 + 470, -72);
    put('airliner_austrian', VIE_RUNWAY.x0 + 560, -74);
    put('airliner_generic', VIE_RUNWAY.x0 + 700, -73);
    put('airliner_austrian', VIE_RUNWAY.x0 + 800, -75, 1, true);

    // Danube canal bridge
    put('canal_bridge', (DANUBE_CANAL.x0 + DANUBE_CANAL.x1) / 2, -70);

    for (let x = WORLD_X0; x < WORLD_X1; ) {
      const inBratislava = x > ZONES.bratislavaOutskirts.x0 && x < ZONES.bratislavaOutskirts.x1;
      const inOldTown = x > ZONES.bratislavaCity.x0 && x < ZONES.bratislavaCity.x0 + 900;
      const inVienna = x > ZONES.viennaCity.x0 + 300 && x < ZONES.viennaCity.x1;
      if (blocked(x)) {
        x += 10;
        continue;
      }
      const z = range(r, -150, -60);
      if (inBratislava && r() < 0.55) {
        const name = r() < 0.6 ? 'panelak_a' : 'panelak_b';
        put(name, x, z - 40, 1, r() < 0.5);
        x += range(r, 60, 110);
      } else if ((inVienna || inOldTown) && r() < 0.75) {
        put(pick(r, ['vienna_house_a', 'vienna_house_b', 'vienna_house_c']), x, range(r, -120, -90));
        x += 27.5;
      } else {
        const roll = r();
        if (roll < 0.55) {
          // Cluster of trees
          const n = 2 + Math.floor(r() * 5);
          for (let i = 0; i < n; i++) put(`tree_${Math.floor(r() * 3)}`, x + i * range(r, 5, 9), z + range(r, -8, 8), range(r, 0.8, 1.25), r() < 0.5);
          x += n * 7 + range(r, 20, 90);
        } else if (roll < 0.68) {
          for (let i = 0; i < 6; i++) put('poplar', x + i * 6.5, z, range(r, 0.9, 1.1));
          x += 60 + range(r, 20, 80);
        } else if (roll < 0.82) {
          put(r() < 0.5 ? 'house_a' : 'house_b', x, z, 1, r() < 0.5);
          put(`tree_${Math.floor(r() * 3)}`, x + 14, z - 6, range(r, 0.9, 1.2));
          x += range(r, 40, 110);
        } else {
          put('bush', x, z + 20, range(r, 0.8, 1.3), r() < 0.5);
          x += range(r, 25, 80);
        }
      }
    }
    return list;
  }

  // ---------------------------------------------------------------- ground

  private buildGround(anisotropy: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const r = rng(5);
    ctx.fillStyle = '#7fa257';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = pick(r, ['#86aa5c', '#76994f', '#8db163', '#6f924a', '#93b56a']);
      ctx.fillRect(r() * 256, r() * 256, 2 + r() * 3, 1 + r() * 2);
    }
    const tex = makeCanvasTexture(canvas, anisotropy, true);
    tex.premultiplyAlpha = false;
    tex.wrapT = THREE.RepeatWrapping;
    const length = WORLD_X1 - WORLD_X0;
    const depth = GROUND_Z1 - GROUND_Z0;
    tex.repeat.set(length / 28, depth / 28);

    const segments = 900;
    const geo = new THREE.PlaneGeometry(length, depth, segments, 1);
    geo.rotateX(-Math.PI / 2);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    const c = new THREE.Color();
    const patches = ['#ffffff', '#f2f6dc', '#e4efd5', '#fff4d6', '#eaf2e2'];
    let current = new THREE.Color('#ffffff');
    const columnColors: THREE.Color[] = [];
    for (let i = 0; i <= segments; i++) {
      if (i % 6 === 0) current = new THREE.Color(pick(r, patches));
      columnColors.push(current);
    }
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const col = Math.round(((pos.getX(i) + length / 2) / length) * segments);
      c.copy(columnColors[Math.min(segments, Math.max(0, col))]);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
    this.groundMaterials.push(mat);
    const ground = new THREE.Mesh(geo, mat);
    ground.position.set((WORLD_X0 + WORLD_X1) / 2, 0, (GROUND_Z0 + GROUND_Z1) / 2);
    ground.receiveShadow = true;
    this.root.add(ground);

    // Aprons
    const apronMat = new THREE.MeshLambertMaterial({ color: '#a9aba6', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const apron = (x0: number, x1: number, z0: number, z1: number) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, apronMat);
      m.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
      m.receiveShadow = true;
      this.root.add(m);
    };
    apron(420, 1150, -100, -50);
    apron(700, 760, -50, RUNWAY_Z - 22);
    apron(VIE_RUNWAY.x0 + 300, VIE_RUNWAY.x0 + 1350, -112, -50);
    apron(VIE_RUNWAY.x0 + 700, VIE_RUNWAY.x0 + 760, -50, RUNWAY_Z - 22);
  }

  private buildRunway(rw: Runway, reciprocal: string, anisotropy: number): void {
    const length = rw.x1 - rw.x0;
    const width = RUNWAY_WIDTH;

    const base = document.createElement('canvas');
    base.width = 512;
    base.height = 128;
    const ctx = base.getContext('2d')!;
    const r = rng(9);
    ctx.fillStyle = '#4b4e51';
    ctx.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = r() < 0.5 ? '#45484b' : '#53575a';
      ctx.fillRect(r() * 512, r() * 128, 2, 1);
    }
    ctx.fillStyle = '#3d3f41';
    ctx.fillRect(0, 50, 512, 28);
    ctx.fillStyle = '#eceee8';
    ctx.fillRect(0, 4, 512, 2);
    ctx.fillRect(0, 122, 512, 2);
    ctx.fillRect(0, 62, 307, 4);
    const tex = makeCanvasTexture(base, anisotropy, true);
    tex.premultiplyAlpha = false;
    tex.repeat.set(length / 50, 1);
    const geo = new THREE.PlaneGeometry(length, width);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((rw.x0 + rw.x1) / 2, 0.03, RUNWAY_Z);
    mesh.receiveShadow = true;
    this.root.add(mesh);

    this.addThreshold(rw.x0, rw.designator, false, anisotropy);
    this.addThreshold(rw.x1, reciprocal, true, anisotropy);
  }

  private addThreshold(x: number, designator: string, reversed: boolean, anisotropy: number): void {
    const L = 400;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const pxPerM = 1024 / L;
    ctx.fillStyle = '#eceee8';
    for (let i = 0; i < 12; i++) {
      const y = 10 + i * 9.3 + (i >= 6 ? 6 : 0);
      ctx.fillRect(6 * pxPerM, y, 30 * pxPerM, 5);
    }
    ctx.save();
    ctx.translate(58 * pxPerM, 64);
    ctx.rotate(Math.PI / 2);
    ctx.font = 'bold 54px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(designator, 0, 0);
    ctx.restore();
    for (const d of [150, 450]) {
      ctx.fillRect(d * pxPerM, 30, 22 * pxPerM, 6);
      ctx.fillRect(d * pxPerM, 92, 22 * pxPerM, 6);
    }
    ctx.fillRect(300 * pxPerM, 22, 45 * pxPerM, 12);
    ctx.fillRect(300 * pxPerM, 94, 45 * pxPerM, 12);
    const tex = makeCanvasTexture(canvas, anisotropy, false);
    tex.premultiplyAlpha = false;
    const geo = new THREE.PlaneGeometry(L, RUNWAY_WIDTH);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(reversed ? x - L / 2 : x + L / 2, 0.04, RUNWAY_Z);
    if (reversed) mesh.rotation.y = Math.PI;
    mesh.renderOrder = 1;
    this.root.add(mesh);
  }

  private buildWater(): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    const r = rng(3);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = r() < 0.5 ? '#dfe9ef' : '#f7fbff';
      ctx.fillRect(r() * 128, r() * 128, 1 + r() * 2, 6 + r() * 16);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const waterMat = (w: number) => {
      const t = tex.clone();
      t.repeat.set(w / 20, (GROUND_Z1 - GROUND_Z0) / 20);
      t.needsUpdate = true;
      return new THREE.MeshLambertMaterial({
        color: RIVER_WATER,
        emissive: new THREE.Color(RIVER_WATER).multiplyScalar(0.45),
        map: t,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    };
    const stoneMat = new THREE.MeshLambertMaterial({ color: '#9a958b' });
    const river = (x0: number, x1: number, wallH: number) => {
      const depth = GROUND_Z1 - GROUND_Z0;
      const g = new THREE.PlaneGeometry(x1 - x0, depth);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, waterMat(x1 - x0));
      m.position.set((x0 + x1) / 2, 0.05, (GROUND_Z0 + GROUND_Z1) / 2);
      this.root.add(m);
      for (const x of [x0, x1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(3, wallH, depth), stoneMat);
        wall.position.set(x, wallH / 2 - 0.3, (GROUND_Z0 + GROUND_Z1) / 2);
        this.root.add(wall);
      }
    };
    river(DANUBE.x0, DANUBE.x1, 1.2);
    river(DANUBE_CANAL.x0, DANUBE_CANAL.x1, 1.6);
  }

  private buildLights(): void {
    const glow = document.createElement('canvas');
    glow.width = glow.height = 64;
    const g = glow.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(glow);

    const positions: number[] = [];
    const colors: number[] = [];
    const add = (x: number, y: number, z: number, color: string) => {
      positions.push(x, y, z);
      const c = new THREE.Color(color);
      colors.push(c.r, c.g, c.b);
    };
    for (const rw of [BTS_RUNWAY, VIE_RUNWAY]) {
      for (let x = rw.x0; x <= rw.x1; x += 60) {
        const color = x > rw.x1 - 600 ? '#ffb347' : '#fff6dc';
        add(x, 0.4, RUNWAY_Z + 23.5, color);
        add(x, 0.4, RUNWAY_Z - 23.5, color);
      }
      for (let z = -20; z <= 20; z += 5) {
        add(rw.x0 - 2, 0.4, RUNWAY_Z + z, '#3dff7a');
        add(rw.x1 + 2, 0.4, RUNWAY_Z + z, '#ff3b30');
      }
    }
    // Approach lighting system for VIE
    for (let x = VIE_RUNWAY.x0 - 900; x < VIE_RUNWAY.x0; x += 30) {
      for (const z of [-1.5, 0, 1.5]) add(x, 1.2, RUNWAY_Z + z, '#fff3cf');
    }
    for (let z = -15; z <= 15; z += 2.5) add(VIE_RUNWAY.x0 - 300, 1.2, RUNWAY_Z + z, '#fff3cf');

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.2,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 45;
    this.root.add(points);

    // PAPI: four lights left of the VIE touchdown zone, colour driven by glide angle
    const papiGeo = new THREE.BufferGeometry();
    const papiPos: number[] = [];
    for (let i = 0; i < 4; i++) papiPos.push(VIE_RUNWAY.x0 + 300, 0.8, RUNWAY_Z - 30 - i * 9);
    papiGeo.setAttribute('position', new THREE.Float32BufferAttribute(papiPos, 3));
    papiGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(12).fill(1), 3));
    const papiMat = mat.clone();
    papiMat.size = 4.5;
    this.papi = new THREE.Points(papiGeo, papiMat);
    this.papi.renderOrder = 46;
    this.root.add(this.papi);
  }

  /** Updates PAPI light colours: `whites` = number of lights showing white (0..4). */
  setPapi(whites: number): void {
    const attr = this.papi.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < 4; i++) {
      const c = i < whites ? this.white : this.red;
      attr.setXYZ(i, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }

  update(time: number, cameraY: number): void {
    for (const layer of this.layers) layer.group.position.y = cameraY * layer.follow;

    for (const mesh of this.turbineBlades) {
      const n = mesh.count;
      for (let i = 0; i < n; i++) {
        const t = this.turbineData[i];
        this.tmpPos.set(t.x, t.y, 0.5);
        this.tmpQuat.setFromAxisAngle(this.zAxis, -time * t.speed + t.phase);
        const s = (t.y - 9) / 95;
        this.tmpScale.set(96 * s, 96 * s, 1);
        this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
        mesh.setMatrixAt(i, this.tmpMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
