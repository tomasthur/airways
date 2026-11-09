import * as THREE from 'three';
import { Atlas, makeCanvasTexture, type SpriteFrame } from '../art/Atlas';
import { airportTerminalSprites, terminalSpriteName } from '../art/airportShells';
import { bratislavaSprites, RIVER_WATER, SNP_RIVER_OFFSET } from '../art/bratislava';
import { countrySprites } from '../art/countryside';
import { paintCountryTile, paintDesertTile, paintHillsTile, paintMountainTile, type TileSpec } from '../art/tiles';
import { rng, range, pick, type Rand } from '../art/paint';
import { londonSprites } from '../art/london';
import { newyorkSprites } from '../art/newyork';
import { parisSprites } from '../art/paris';
import { romeSprites } from '../art/rome';
import { seaSprites } from '../art/seas';
import { viennaSprites } from '../art/vienna';
import { worldCitySprites } from '../art/worldCities';
import { BTS_RUNWAY, DANUBE, DANUBE_CANAL, RUNWAY_WIDTH, RUNWAY_Z, VIE_RUNWAY, ZONES, type Runway } from '../config';
import { FLYABLE_IATAS, airportByIata } from '../meta/airports';
import { biomeFamily, corridorFlyovers, corridorGeoSegments, type GeoSegment } from '../meta/corridorGeo';
import {
  BASE_DEST_X0,
  geoCorridorX,
  ORIGIN_PAD_END,
  REFERENCE_LAYOUT,
  remapCorridorSpan,
  remapCorridorX,
  type CorridorLayout,
} from '../meta/flightLength';
import { type SceneryTheme } from '../meta/routes';
import { buildSpriteBatches, buildTileStrip, type Placement } from './Billboards';

const SCENERY_THEMES: SceneryTheme[] = [
  'danubeWest',
  'danubeEast',
  'pannonian',
  'bohemian',
  'carpathian',
  'vistula',
  'channelSea',
  'atlanticOcean',
  'mediterranean',
  'alpine',
  'continental',
  'desertApproaches',
  'pacificRim',
];

/** Hand-painted Central European hops whose packs match their real ground. */
const AUTHORED_THEMES = new Set<SceneryTheme>(['danubeWest', 'danubeEast', 'pannonian', 'bohemian', 'carpathian', 'vistula']);

const SEA_WATER = '#4f7f9c';

/** Rivers sit inside their valley, so only a change of country type earns a fog veil. */
function scenicCut(a: GeoSegment, b: GeoSegment): boolean {
  const fam = (s: GeoSegment) => (s.biome === 'river' ? 'land' : biomeFamily(s.biome));
  return fam(a) !== fam(b);
}

/** Wide mid-corridor water used for ditch checks on over-sea themes. */
export const THEME_SEA_SPANS: Partial<Record<SceneryTheme, [number, number][]>> = {
  channelSea: [
    [4300, 7800],
    [8200, 8600],
  ],
  atlanticOcean: [[3800, 9000]],
  mediterranean: [
    [4500, 7200],
    [7600, 8200],
  ],
  pacificRim: [[4000, 8800]],
};

const WORLD_X0 = -3500;
/** Long enough for the longest corridor (A380, 12 min ≈ 157 km) plus overrun. */
const WORLD_X1 = 175000;
/** End of the authored reference layout; corridor scenery is generated up to here and remapped. */
const REF_X1 = 19000;
/** Shared full-length layers (clouds, far ridges) stay put when the corridor is remapped. */
function fixed<T extends THREE.Object3D>(obj: T): T {
  obj.userData.fixedCorridor = true;
  return obj;
}

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
  private runwayLightsMat!: THREE.PointsMaterial;
  private papiMat!: THREE.PointsMaterial;
  private readonly baseRunwayLightSize = 2.2;
  private readonly basePapiSize = 4.5;
  /** Origin (departure) terminal meshes tagged with userData.airport. */
  private readonly originTerminals: THREE.Object3D[] = [];
  /** Destination (arrival) terminal meshes tagged with userData.airport. */
  private readonly arrivalTerminals: THREE.Object3D[] = [];
  /** Mid-corridor scenery packs (and theme water) toggled by setRouteScenery. */
  private readonly sceneryGroups: { theme: SceneryTheme; group: THREE.Group }[] = [];
  /** Landmark city packs toggled by departure / arrival IATA. */
  private readonly cityLandmarkGroups: { iata: string; dep: THREE.Group; arr: THREE.Group }[] = [];
  /** Live hop geography (sea, ridges, desert) rebuilt each flight. */
  private readonly geoObjects: THREE.Object3D[] = [];
  private geoSeaSpans: [number, number][] = [];
  private mountainsLayer!: THREE.Group;
  private hillsLayer!: THREE.Group;
  private midLayer!: THREE.Group;
  private nearLayer!: THREE.Group;
  private fieldsLayer!: THREE.Group;
  private foreLayer!: THREE.Group;
  private stockFarMountains!: THREE.Object3D;
  private stockFarHills!: THREE.Object3D;
  private stockForeFields!: THREE.Object3D;
  private stockForeNear!: THREE.Object3D;
  private mtTex!: THREE.Texture;
  private htTex!: THREE.Texture;
  private ctTex!: THREE.Texture;
  private desertTex!: THREE.Texture;
  private fogTex!: THREE.CanvasTexture;
  private seaEdgeTex!: THREE.CanvasTexture;
  private mtSpec!: TileSpec;
  private htSpec!: TileSpec;
  private ctSpec!: TileSpec;
  private desertSpec!: TileSpec;
  /** Live X of biome-family cuts — Game pulls scene fog in around these. */
  private geoSeams: number[] = [];
  /** Width of the narrower neighbour at each seam (caps how wide its veil may get). */
  private geoSeamRoom: number[] = [];
  private waterTex!: THREE.CanvasTexture;
  private activeTheme: SceneryTheme = 'danubeWest';
  /** Iconic skyline behind each runway, per IATA (mid parallax layer so it reads from the ground). */
  private readonly airportSkylines: { iata: string; dep: THREE.Group; arr: THREE.Group }[] = [];
  private readonly cityIcons = new Map<string, Placement[]>();
  private originIata = 'BTS';
  private arrivalIata = 'VIE';
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpPos = new THREE.Vector3();
  /** Live corridor; scenery is remapped from the authored reference layout. */
  private layout: CorridorLayout = REFERENCE_LAYOUT;
  private readonly authSpans: { mesh: THREE.Object3D; x0: number; x1: number }[] = [];
  private readonly authStrips: { mesh: THREE.InstancedMesh; segs: Float32Array; tileW: number }[] = [];
  private readonly authObjects: { obj: THREE.Object3D; x: number }[] = [];
  private readonly authInstances: { mesh: THREE.InstancedMesh; xs: Float32Array }[] = [];
  private readonly authPoints: { points: THREE.Points; xs: Float32Array }[] = [];
  private readonly turbineAuthX: number[] = [];
  private readonly themeWaterAuth: { theme: SceneryTheme; spans: [number, number][] }[] = [];
  private readonly tmpScale = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly white = new THREE.Color(1, 1, 0.92);
  private readonly red = new THREE.Color(1, 0.12, 0.08);
  readonly groundMaterials: THREE.Material[] = [];

  constructor(anisotropy: number) {
    const atlas = new Atlas();
    atlas.add(
      ...countrySprites(),
      ...bratislavaSprites(),
      ...viennaSprites(),
      ...londonSprites(),
      ...newyorkSprites(),
      ...romeSprites(),
      ...parisSprites(),
      ...seaSprites(),
      ...worldCitySprites(),
      ...airportTerminalSprites(),
    );
    const { pages, frames } = atlas.build(anisotropy);
    this.pages = pages;
    this.frames = frames;
    this.fogTex = this.makeFogTexture();
    this.seaEdgeTex = this.makeSeaEdgeTexture();

    this.buildGround(anisotropy);
    this.buildRunway(BTS_RUNWAY, '13', anisotropy);
    this.buildRunway(VIE_RUNWAY, '11', anisotropy);
    this.buildWater();
    this.buildLights();
    this.buildLayers(anisotropy);
    this.buildRouteTerminals();
    this.buildCityLandmarkPacks();
    this.captureCorridorBases();
    this.setRouteScenery('danubeWest');
    this.setRouteAirports('BTS', 'VIE');
    this.setCorridor(REFERENCE_LAYOUT);
    this.setRouteGeography('BTS', 'VIE');
  }

  /**
   * Place authored scenery onto the live corridor for this hop and aircraft: runways, aprons and
   * water stretch to their live spans (textures keep their density), thresholds stay on the
   * runway ends, and everything else moves with {@link remapCorridorX}.
   * Always remaps from the captured reference positions (never compounds).
   */
  setCorridor(layout: CorridorLayout): void {
    this.layout = layout;
    for (const { mesh, x0, x1 } of this.authSpans) {
      const [na, nb] = remapCorridorSpan(x0, x1, layout);
      mesh.position.x = (na + nb) / 2;
      mesh.scale.x = (nb - na) / Math.max(1e-3, x1 - x0);
      const perM = mesh.userData.texRepeatPerM as number | undefined;
      const map = ((mesh as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined)?.map;
      if (perM && map) map.repeat.x = (nb - na) * perM;
    }
    for (const { obj, x } of this.authObjects) {
      const anchor = obj.userData.anchorX as number | undefined;
      obj.position.x = anchor === undefined ? remapCorridorX(x, layout) : remapCorridorX(anchor, layout) + (x - anchor);
    }
    const m4 = this.tmpMatrix;
    const p = this.tmpPos;
    const q = this.tmpQuat;
    const s = this.tmpScale;
    for (const { mesh, xs } of this.authInstances) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m4);
        m4.decompose(p, q, s);
        p.x = remapCorridorX(xs[i], layout);
        m4.compose(p, q, s);
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    for (const { mesh, segs, tileW } of this.authStrips) {
      const rects = mesh.geometry.getAttribute('uvRect') as THREE.InstancedBufferAttribute;
      for (let i = 0; i < mesh.count; i++) {
        const a = remapCorridorX(segs[i * 2], layout);
        const b = remapCorridorX(segs[i * 2 + 1], layout);
        mesh.getMatrixAt(i, m4);
        m4.decompose(p, q, s);
        p.x = (a + b) / 2;
        s.x = b - a;
        m4.compose(p, q, s);
        mesh.setMatrixAt(i, m4);
        rects.setX(i, a / tileW);
        rects.setZ(i, b / tileW);
      }
      rects.needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    for (const { points, xs } of this.authPoints) {
      const attr = points.geometry.getAttribute('position');
      for (let i = 0; i < xs.length; i++) attr.setX(i, remapCorridorX(xs[i], layout));
      attr.needsUpdate = true;
      points.geometry.computeBoundingSphere();
    }
    for (let i = 0; i < this.turbineData.length; i++) {
      this.turbineData[i].x = remapCorridorX(this.turbineAuthX[i] ?? this.turbineData[i].x, layout);
    }
  }

  /** Water hazard spans for the active corridor (ditch checks). */
  waterHazards(theme: SceneryTheme): [number, number][] {
    if (this.geoSeaSpans.length) return this.geoSeaSpans.map(([a, b]) => [a, b] as [number, number]);
    const authored =
      this.themeWaterAuth.find((t) => t.theme === theme)?.spans ??
      THEME_SEA_SPANS[theme] ??
      [];
    return authored.map(([a, b]) => remapCorridorSpan(a, b, this.layout));
  }

  private captureCorridorBases(): void {
    this.root.traverse((obj) => {
      if (obj.userData.fixedCorridor) return;
      if (obj.userData.corridorSpan) {
        const [x0, x1] = obj.userData.corridorSpan as [number, number];
        this.authSpans.push({ mesh: obj, x0, x1 });
        return;
      }
      if (obj.userData.tileStrip) {
        const { segments, tileW } = obj.userData.tileStrip as { segments: [number, number][]; tileW: number };
        this.authStrips.push({ mesh: obj as THREE.InstancedMesh, segs: new Float32Array(segments.flat()), tileW });
        return;
      }
      if ((obj as THREE.InstancedMesh).isInstancedMesh) {
        if (obj.userData.turbineOffset != null) return;
        const mesh = obj as THREE.InstancedMesh;
        const xs = new Float32Array(mesh.count);
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, this.tmpMatrix);
          this.tmpPos.setFromMatrixPosition(this.tmpMatrix);
          xs[i] = this.tmpPos.x;
        }
        this.authInstances.push({ mesh, xs });
        return;
      }
      if ((obj as THREE.Points).isPoints) {
        const points = obj as THREE.Points;
        const attr = points.geometry.getAttribute('position');
        const xs = new Float32Array(attr.count);
        for (let i = 0; i < attr.count; i++) xs[i] = attr.getX(i);
        this.authPoints.push({ points, xs });
        return;
      }
      if (obj !== this.root && Math.abs(obj.position.x) > 1e-4) {
        this.authObjects.push({ obj, x: obj.position.x });
      }
    });
    for (const t of this.turbineData) this.turbineAuthX.push(t.x);
  }

  private tagSpan(obj: THREE.Object3D, x0: number, x1: number): void {
    obj.userData.corridorSpan = [x0, x1];
  }

  /**
   * Show the correct painted terminals for this hop.
   * Both ends must match the filed route — never leave a leftover BTS/VIE sign.
   */
  setRouteAirports(from: string, to: string): void {
    const flyable = new Set<string>(FLYABLE_IATAS);
    const norm = (c: string) => (flyable.has(c) ? c : 'BTS');
    this.originIata = norm(from);
    this.arrivalIata = norm(to);
    for (const m of this.originTerminals) m.visible = m.userData.airport === this.originIata;
    for (const m of this.arrivalTerminals) m.visible = m.userData.airport === this.arrivalIata;
    this.applyCityPacks();
  }

  /** Swap mid-corridor set dressing (cities, water, hills) for this undirected hop. */
  setRouteScenery(theme: SceneryTheme): void {
    this.activeTheme = theme;
    // Hand-painted CE hops keep their packs; generic world themes put the wrong skylines
    // at the wrong airport, so live geography + airport skylines replace them.
    const authored = AUTHORED_THEMES.has(theme);
    for (const { theme: t, group } of this.sceneryGroups) group.visible = authored && t === theme;
    this.applyCityPacks();
  }

  /** 0 = clear air, 1 = inside a biome-seam fog bank. */
  seamFog(x: number): number {
    if (!this.geoSeams.length) return 0;
    const mid = Math.max(1800, this.layout.destX0 - this.layout.originEnd);
    // ~20–40 s of veil per seam at cruise — long hops must not spend minutes in cloud.
    const base = Math.min(1700, Math.max(700, mid * 0.035));
    let m = 0;
    for (let i = 0; i < this.geoSeams.length; i++) {
      // A narrow strait or ridge must stay visible between its two veils.
      const half = Math.min(base, Math.max(350, this.geoSeamRoom[i] * 0.28));
      const d = Math.abs(x - this.geoSeams[i]);
      if (d >= half) continue;
      const t = 1 - d / half;
      m = Math.max(m, t * t * (3 - 2 * t));
    }
    return m;
  }

  /**
   * Stamp real hop geography onto the live corridor: sea where the great-circle
   * crosses water, ridges only over actual ranges, desert over the Gulf, etc.
   */
  setRouteGeography(from: string, to: string): void {
    this.clearGeo();
    const segs = corridorGeoSegments(from, to, this.layout);
    const authored = AUTHORED_THEMES.has(this.activeTheme);
    // Hand-painted regional hops keep their continuous ridge band: their hill sprites
    // (Kamzík, Kahlenberg…) end in hard edges that only read right in front of it.
    this.stockFarMountains.visible = authored;
    this.stockFarHills.visible = authored;
    this.stockForeFields.visible = authored;
    this.stockForeNear.visible = authored;

    // Transitions scale with the corridor so an A380 hop does not get 50 km cliffs.
    const midLen = Math.max(4000, this.layout.destX0 - this.layout.originEnd);
    const taper = Math.min(2200, Math.max(700, midLen * 0.045));
    const fade = taper * 1.2;
    const pad = (spans: [number, number][], extra = 0) =>
      spans.map(([a, b]) => [a - taper * 0.7 - extra, b + taper * 0.7 + extra] as [number, number]);
    const merge = (spans: [number, number][]): [number, number][] => {
      const s = [...spans].sort((p, q) => p[0] - q[0]);
      const out: [number, number][] = [];
      for (const [a, b] of s) {
        const last = out[out.length - 1];
        if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
        else out.push([a, b]);
      }
      return out;
    };

    const sea: [number, number][] = [];
    const mountains: [number, number][] = [];
    const hills: [number, number][] = [];
    const farmland: [number, number][] = [];
    const desert: [number, number][] = [];
    const rivers: GeoSegment[] = [];

    for (const s of segs) {
      const span: [number, number] = [s.x0, s.x1];
      if (s.biome === 'sea' || s.biome === 'ice') sea.push(span);
      else if (s.biome === 'river') {
        // A river is a crossing in its valley, however long the track follows it.
        const c = (s.x0 + s.x1) / 2;
        const hw = Math.min((s.x1 - s.x0) / 2, 160 + taper * 0.12);
        rivers.push({ ...s, x0: c - hw, x1: c + hw });
        if (c - hw > s.x0 + 1) farmland.push([s.x0, c - hw]);
        if (s.x1 > c + hw + 1) farmland.push([c + hw, s.x1]);
      }
      else if (s.biome === 'mountains') mountains.push(span);
      else if (s.biome === 'hills' || s.biome === 'forest' || s.biome === 'taiga') hills.push(span);
      else if (s.biome === 'desert') desert.push(span);
      else farmland.push(span);
    }
    // Airports always sit in their own countryside: rolling hills behind, fields in front.
    const first = segs[0]?.x0 ?? this.layout.originEnd + 500;
    const last = segs[segs.length - 1]?.x1 ?? this.layout.destX0 - 500;
    const airportZones: [number, number][] = [
      [WORLD_X0, first],
      [last, this.layout.destX1 + 8000],
    ];
    hills.push(...airportZones);
    if (!authored) farmland.push(...airportZones);

    this.geoSeaSpans = [...sea, ...rivers.map((r) => [r.x0, r.x1] as [number, number])];
    this.geoSeams = [];
    this.geoSeamRoom = [];
    for (let i = 1; i < segs.length; i++) {
      if (!scenicCut(segs[i - 1], segs[i])) continue;
      this.geoSeams.push(segs[i].x0);
      this.geoSeamRoom.push(Math.min(segs[i - 1].x1 - segs[i - 1].x0, segs[i].x1 - segs[i].x0));
    }

    // Far: real ranges as tall peaks; uplands as a low blue ridge so hilly country reads
    // as hilly from cruise height too.
    if (mountains.length && !authored) {
      this.adoptGeo(
        this.mountainsLayer,
        buildTileStrip(this.mtTex, this.mtSpec.w * 1.1, this.mtSpec.h * 1.35, merge(pad(mountains, taper * 0.4)), {
          hazeAmount: 0.42,
          skirt: 8,
          renderOrder: 10,
          taper: taper * 1.3,
        }),
      );
    }
    const uplands = hills.filter(([a, b]) => a > WORLD_X0 && b < this.layout.destX1 + 7000);
    if (uplands.length && !authored) {
      this.adoptGeo(
        this.mountainsLayer,
        buildTileStrip(this.mtTex, this.mtSpec.w * 0.9, this.mtSpec.h * 0.62, merge(pad(uplands, taper * 0.3)), {
          hazeAmount: 0.55,
          skirt: 8,
          renderOrder: 9,
          taper: taper * 1.4,
        }),
      );
    }
    // Hill band: under ranges (foothills) and uplands; plains get gentle low country instead.
    const hillBand = merge(pad([...hills, ...mountains]));
    if (hillBand.length && !authored) {
      this.adoptGeo(
        this.hillsLayer,
        buildTileStrip(this.htTex, this.htSpec.w, this.htSpec.h, hillBand, {
          hazeAmount: 0.3,
          skirt: 8,
          renderOrder: 20,
          fields: true,
          taper,
        }),
      );
    }
    if (farmland.length && !authored) {
      this.adoptGeo(
        this.hillsLayer,
        buildTileStrip(this.ctTex, this.ctSpec.w * 1.15, this.ctSpec.h * 1.05, merge(pad(farmland)), {
          hazeAmount: 0.22,
          skirt: 8,
          renderOrder: 21,
          fields: true,
          taper,
        }),
      );
    }
    if (desert.length) {
      this.adoptGeo(
        this.hillsLayer,
        buildTileStrip(this.desertTex, this.desertSpec.w, this.desertSpec.h, merge(pad(desert)), {
          hazeAmount: 0.3,
          skirt: 8,
          renderOrder: 20,
          taper,
        }),
      );
    }
    // Near ground is continuous over all land and only breaks for open water.
    if (!authored) {
      const land = merge([...farmland, ...hills, ...mountains]);
      const coast = merge(pad(land, -taper * 0.4));
      this.adoptGeo(
        this.fieldsLayer,
        buildTileStrip(this.ctTex, this.ctSpec.w * 0.85, this.ctSpec.h * 0.85, coast, {
          hazeAmount: 0.1,
          skirt: 8,
          renderOrder: 34,
          fields: true,
          taper: taper * 0.6,
        }),
      );
      this.adoptGeo(
        this.foreLayer,
        buildTileStrip(this.ctTex, this.ctSpec.w * 0.62, this.ctSpec.h * 0.62, coast, {
          hazeAmount: 0.06,
          skirt: 8,
          renderOrder: 35,
          fields: true,
          taper: taper * 0.5,
        }),
      );
    }

    for (const [x0, x1] of sea) this.addGeoWater(x0 - fade * 0.35, x1 + fade * 0.35, 0);
    for (const riv of rivers) this.addGeoWater(riv.x0, riv.x1, 0.6);
    this.dressGeoSea(sea);
    if (!authored) this.dressGeoLand(farmland.filter(([a, b]) => a >= first - 1 && b <= last + 1), hills);
    this.dressFlyovers(from, to, sea);
    this.veilGeoSeams(segs, fade);
  }

  /** Skylines of real hubs the great-circle passes near (Munich on VIE–LON, Frankfurt-side uplands…). */
  private dressFlyovers(from: string, to: string, sea: [number, number][]): void {
    const k = (this.layout.destX0 - this.layout.originEnd) / (BASE_DEST_X0 - ORIGIN_PAD_END);
    const placements: Placement[] = [];
    for (const f of corridorFlyovers(from, to)) {
      const icons = this.cityIcons.get(f.iata);
      if (!icons?.length) continue;
      const cx = geoCorridorX(f.t, this.layout);
      if (sea.some(([a, b]) => cx > a && cx < b)) continue;
      const xs = icons.map((p) => p.x);
      const x0 = Math.min(...xs);
      const span = Math.max(1, Math.max(...xs) - x0);
      // Off-track cities sit further back and hazier than ones right under the wing.
      const near = 1 - Math.min(1, f.km / 90);
      // Far layer sits deep, so a long hop needs a bigger city to read — but as one tight skyline.
      const boost = Math.min(2.2, Math.max(1, k * 0.4));
      const c0 = x0 + span / 2;
      const squeeze = Math.min(1, 900 / span) * boost;
      for (const p of icons) {
        placements.push({
          ...p,
          x: cx + (p.x - c0) * squeeze,
          z: (p.z ?? 2) + 3,
          scale: (p.scale ?? 1) * (0.6 + 0.4 * near) * boost,
        });
      }
    }
    if (placements.length) {
      buildSpriteBatches(this.pages, placements, { hazeAmount: 0.34, skirt: 0, renderOrder: 22 }).forEach((m) =>
        this.adoptGeo(this.hillsLayer, m),
      );
    }
  }

  /** Hide hard biome cuts behind a bank of fog and cloud. */
  private veilGeoSeams(segs: GeoSegment[], fade: number): void {
    if (segs.length < 2) return;
    const r = rng((segs[0].x0 * 13 + segs[segs.length - 1].x1 * 7) | 0);
    const far: Placement[] = [];
    const mid: Placement[] = [];
    const near: Placement[] = [];
    const put = (list: Placement[], x: number, y: number, z: number, scale: number) => {
      list.push({
        frame: this.frame(`cloud_${Math.floor(r() * 5)}`),
        x,
        y,
        z,
        scale,
        flip: r() < 0.5,
      });
    };
    for (let i = 1; i < segs.length; i++) {
      if (!scenicCut(segs[i - 1], segs[i])) continue;
      const x = segs[i].x0;
      const room = Math.min(segs[i - 1].x1 - segs[i - 1].x0, segs[i].x1 - segs[i].x0);
      const half = Math.min(fade * 1.35, Math.max(300, room * 0.3));
      this.addFogBank(x, half * 2.1, 220, -900, 0.72);
      this.addFogBank(x + range(r, -80, 80), half * 1.6, 140, -420, 0.58);
      this.addFogBank(x, half * 1.8, 70, 8, 0.5, true);
      this.addFogBank(x + range(r, -40, 40), half * 1.2, 110, -180, 0.45);
      for (let k = 0; k < 14; k++) {
        put(far, x + (r() - 0.5) * half * 2.4, range(r, 40, 380), range(r, -14, 16), range(r, 2.0, 3.6));
      }
      for (let k = 0; k < 12; k++) {
        put(mid, x + (r() - 0.5) * half * 2.0, range(r, 18, 220), range(r, -10, 10), range(r, 1.3, 2.6));
      }
      for (let k = 0; k < 8; k++) {
        put(near, x + (r() - 0.5) * half * 1.5, range(r, 12, 160), range(r, -200, -30), range(r, 0.85, 1.7));
      }
      for (let k = 0; k < 6; k++) {
        put(mid, x + (k - 2.5) * (half * 0.38), range(r, 4, 28), range(r, -6, 6), range(r, 1.8, 2.8));
      }
    }
    if (far.length) {
      buildSpriteBatches(this.pages, far, { hazeAmount: 0.52, skirt: 0, renderOrder: 16, opacity: 0.86 }).forEach((m) =>
        this.adoptGeo(this.mountainsLayer, m),
      );
    }
    if (mid.length) {
      buildSpriteBatches(this.pages, mid, { hazeAmount: 0.34, skirt: 0, renderOrder: 28, opacity: 0.9 }).forEach((m) =>
        this.adoptGeo(this.hillsLayer, m),
      );
    }
    if (near.length) {
      buildSpriteBatches(this.pages, near, { hazeAmount: 0.16, skirt: 0, renderOrder: 48, opacity: 0.8 }).forEach((m) =>
        this.adoptGeo(this.nearLayer, m),
      );
    }
  }

  private addFogBank(x: number, width: number, height: number, z: number, opacity: number, ground = false): void {
    const mat = new THREE.MeshBasicMaterial({
      map: this.fogTex,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      color: 0xe8eef4,
    });
    if (ground) {
      const g = new THREE.PlaneGeometry(width, 260);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, 6, z);
      m.renderOrder = 44;
      this.adoptGeo(this.root, m);
      return;
    }
    const g = new THREE.PlaneGeometry(width, height);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, height * 0.28, z);
    m.renderOrder = 46;
    this.adoptGeo(this.root, m);
  }

  private dressGeoLand(farmland: [number, number][], hills: [number, number][]): void {
    const sprites: Placement[] = [];
    const put = (name: string, x: number, z: number, scale: number, flip: boolean) => {
      const f = this.frames.get(name);
      if (!f) return;
      sprites.push({ frame: f, x, z, scale, flip });
    };
    const r = rng(farmland.length * 97 + hills.length * 13 + 4);
    for (const [x0, x1] of farmland) {
      const w = x1 - x0;
      if (w < 500) continue;
      for (let x = x0 + 180; x < x1 - 180; x += range(r, 380, 720)) {
        put('village', x, 2, range(r, 0.75, 1.05), r() < 0.5);
        if (r() < 0.4) put('windmill', x + range(r, 40, 90), 2.4, range(r, 0.7, 1), r() < 0.5);
      }
    }
    if (sprites.length) {
      buildSpriteBatches(this.pages, sprites, { hazeAmount: 0.12, skirt: 0, renderOrder: 32 }).forEach((m) =>
        this.adoptGeo(this.midLayer, m),
      );
    }
  }

  /** Alpha ramp (green channel) that feathers the ends of the far sea plane into the coast. */
  private makeSeaEdgeTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 4;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, '#000');
    g.addColorStop(0.12, '#fff');
    g.addColorStop(0.88, '#fff');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 4);
    return new THREE.CanvasTexture(c);
  }

  private makeFogTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(512, 256);
    for (let y = 0; y < 256; y++) {
      const vy = 1 - y / 255;
      const rise = Math.min(1, vy * 1.35);
      for (let x = 0; x < 512; x++) {
        const u = x / 511;
        const hx = 1 - Math.abs(u * 2 - 1);
        const a = Math.pow(Math.max(0, hx), 1.15) * (0.35 + 0.65 * rise);
        const i = (y * 512 + x) * 4;
        img.data[i] = 232;
        img.data[i + 1] = 238;
        img.data[i + 2] = 244;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }

  private adoptGeo(parent: THREE.Object3D, obj: THREE.Object3D): void {
    parent.add(obj);
    this.geoObjects.push(obj);
  }

  private applyCityPacks(): void {
    // Near-plane city packs sit next to the aircraft and flash as giant towers — keep them off.
    for (const c of this.cityLandmarkGroups) {
      c.dep.visible = false;
      c.arr.visible = false;
    }
    // danubeWest already paints Bratislava (SNP, castle) and Vienna by hand.
    const local = this.activeTheme === 'danubeWest';
    for (const s of this.airportSkylines) {
      const skip = local && (s.iata === 'BTS' || s.iata === 'VIE');
      s.dep.visible = !skip && s.iata === this.originIata;
      s.arr.visible = !skip && s.iata === this.arrivalIata;
    }
  }

  private clearGeo(): void {
    for (const obj of this.geoObjects) obj.parent?.remove(obj);
    this.geoObjects.length = 0;
    this.geoSeaSpans = [];
    this.geoSeams = [];
    this.geoSeamRoom = [];
  }

  private addGeoWater(x0: number, x1: number, wallH: number): void {
    const depth = GROUND_Z1 - GROUND_Z0;
    const w = Math.max(40, x1 - x0);
    const t = this.waterTex.clone();
    t.repeat.set(w / 20, depth / 20);
    t.needsUpdate = true;
    const mat = new THREE.MeshLambertMaterial({
      color: RIVER_WATER,
      emissive: new THREE.Color(RIVER_WATER).multiplyScalar(0.45),
      map: t,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const g = new THREE.PlaneGeometry(w, depth);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set((x0 + x1) / 2, 0.06, (GROUND_Z0 + GROUND_Z1) / 2);
    this.adoptGeo(this.root, m);
    if (wallH === 0) {
      // Open sea runs out to the horizon behind the coast layers; soft ends blend into the shore.
      const farDepth = 5200;
      const fw = w + 600;
      const ft = this.waterTex.clone();
      ft.repeat.set(fw / 60, farDepth / 60);
      ft.needsUpdate = true;
      const far = new THREE.Mesh(
        new THREE.PlaneGeometry(fw, farDepth).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({
          color: SEA_WATER,
          emissive: new THREE.Color(SEA_WATER).multiplyScalar(0.5),
          map: ft,
          alphaMap: this.seaEdgeTex,
          transparent: true,
          depthWrite: false,
        }),
      );
      far.position.set((x0 + x1) / 2, 0.04, GROUND_Z0 - farDepth / 2 + 2);
      far.renderOrder = -1;
      this.adoptGeo(this.root, far);
    }
    if (wallH > 0.2) {
      const stone = new THREE.MeshLambertMaterial({ color: '#9a958b' });
      for (const x of [x0, x1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(3, wallH, depth), stone);
        wall.position.set(x, wallH / 2 - 0.3, (GROUND_Z0 + GROUND_Z1) / 2);
        this.adoptGeo(this.root, wall);
      }
    }
  }

  private dressGeoSea(spans: [number, number][]): void {
    const P = this.pages;
    const sprites: Placement[] = [];
    const put = (name: string, x: number, z = 2, scale = 1, flip = false) => {
      const f = this.frames.get(name);
      if (!f) return;
      sprites.push({ frame: f, x, z, scale, flip });
    };
    for (const [x0, x1] of spans) {
      const w = x1 - x0;
      if (w < 400) continue;
      const mid = (x0 + x1) / 2;
      if (w > 2500) {
        put('atlantic_swell', x0 + w * 0.25, 0.4, 1);
        put('atlantic_swell', x0 + w * 0.6, 0.3, 1, true);
        put('cargo_ship', x0 + w * 0.35, 2, 1.1);
        put('cargo_ship', x0 + w * 0.7, 2, 0.9, true);
      } else {
        put('channel_cliffs', x0 + 80, 1.5, 1);
        put('channel_cliffs', x1 - 80, 1.5, 1, true);
        put('ferry', mid - w * 0.15, 2.5);
        put('cargo_ship', mid + w * 0.18, 2);
      }
      if (w > 1200 && w < 5000) {
        put('med_isle', mid, 1.4, 0.9);
        put('sea_stack', x0 + w * 0.22, 2);
      }
    }
    if (sprites.length) {
      buildSpriteBatches(P, sprites, { hazeAmount: 0.08, skirt: 0, renderOrder: 31 }).forEach((m) => this.adoptGeo(this.midLayer, m));
    }
  }

  private sceneryGroup(parent: THREE.Object3D, theme: SceneryTheme): THREE.Group {
    const g = new THREE.Group();
    g.name = `scenery_${theme}`;
    g.visible = false;
    parent.add(g);
    this.sceneryGroups.push({ theme, group: g });
    return g;
  }

  /** @deprecated use setRouteAirports */
  setArrivalAirport(iata: string): void {
    const currentOrigin =
      this.originTerminals.find((m) => m.visible)?.userData.airport ?? 'BTS';
    this.setRouteAirports(currentOrigin, iata);
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

    // Far clouds (shared)
    const cloudsFar = this.addLayer(-2600, 0.9);
    const farClouds: Placement[] = [];
    for (let x = WORLD_X0; x < WORLD_X1; x += range(r, 600, 1200)) {
      farClouds.push({ frame: this.frame(`cloud_${Math.floor(r() * 5)}`), x, y: range(r, 180, 620), z: r() * 10, scale: range(r, 1.4, 2.6), flip: r() < 0.5 });
    }
    buildSpriteBatches(P, farClouds, { hazeAmount: 0.3, skirt: 0, renderOrder: 0, opacity: 0.9 }).forEach((m) => cloudsFar.add(fixed(m)));

    // Mountains (shared base silhouette — hidden on hops whose geography we stamp live)
    const mountains = this.addLayer(-1500, 0.86);
    this.mountainsLayer = mountains;
    const mt = paintMountainTile();
    this.mtSpec = mt;
    this.mtTex = this.tile(mt, anisotropy);
    this.stockFarMountains = fixed(buildTileStrip(this.mtTex, mt.w, mt.h, [[WORLD_X0, WORLD_X1]], { hazeAmount: 0.42, skirt: 8, renderOrder: 10 }));
    mountains.add(this.stockFarMountains);

    // Mid-distance clouds (shared)
    const cloudsMid = this.addLayer(-1100, 0.75);
    const midClouds: Placement[] = [];
    for (let x = WORLD_X0; x < WORLD_X1; x += range(r, 700, 1500)) {
      midClouds.push({ frame: this.frame(`cloud_${Math.floor(r() * 5)}`), x, y: range(r, 260, 520), z: r() * 10, scale: range(r, 0.9, 1.5), flip: r() < 0.5 });
    }
    buildSpriteBatches(P, midClouds, { hazeAmount: 0.18, skirt: 0, renderOrder: 15, opacity: 0.92 }).forEach((m) => cloudsMid.add(fixed(m)));

    // Hills base tile (shared) + theme hill accents / far skylines
    const hills = this.addLayer(-800, 0.74);
    this.hillsLayer = hills;
    const ht = paintHillsTile();
    this.htSpec = ht;
    this.htTex = this.tile(ht, anisotropy);
    this.stockFarHills = fixed(buildTileStrip(this.htTex, ht.w, ht.h, [[WORLD_X0, WORLD_X1]], { hazeAmount: 0.28, skirt: 8, renderOrder: 20, fields: true }));
    hills.add(this.stockFarHills);
    this.buildHillScenery(hills, P);
    const desert = paintDesertTile();
    this.desertSpec = desert;
    this.desertTex = this.tile(desert, anisotropy);

    // Mid countryside + theme cities / landmarks / turbines
    const mid = this.addLayer(-380, 0.55);
    this.midLayer = mid;
    const ct = paintCountryTile();
    this.ctSpec = ct;
    this.ctTex = this.tile(ct, anisotropy);
    this.buildMidScenery(mid, P, this.ctTex, ct.w, ct.h, r);

    // Foreground fields (shared strip with Danube gap; swapped for live hop geography)
    const gaps: [number, number][] = [[DANUBE.x0 - 10, DANUBE.x1 + 10]];
    const foreSegments: [number, number][] = [];
    let segStart = WORLD_X0;
    for (const [g0, g1] of gaps) {
      foreSegments.push([segStart, g0]);
      segStart = g1;
    }
    foreSegments.push([segStart, REF_X1]);
    const fields = this.addLayer(-290, 0.44);
    this.fieldsLayer = fields;
    this.stockForeFields = buildTileStrip(this.ctTex, ct.w * 0.8, ct.h * 0.8, foreSegments, { hazeAmount: 0.08, skirt: 8, renderOrder: 34, fields: true });
    fields.add(this.stockForeFields);
    const fore = this.addLayer(-200, 0.3);
    this.foreLayer = fore;
    this.stockForeNear = buildTileStrip(this.ctTex, ct.w * 0.62, ct.h * 0.62, foreSegments, { hazeAmount: 0.05, skirt: 8, renderOrder: 35, fields: true });
    fore.add(this.stockForeNear);
    this.buildForeScenery(fields, fore, P, gaps, r);

    // Near layer: shared airport pads + theme clutter + clouds
    const near = this.addLayer(0, 0);
    this.nearLayer = near;
    near.add(...buildSpriteBatches(P, this.nearAirportPlacements(), { hazeAmount: 0.03, skirt: 0, renderOrder: 40 }));
    this.buildNearScenery(near, P);
    const nearClouds: Placement[] = [];
    for (let x = 2600; x < WORLD_X1; x += range(r, 450, 900)) {
      nearClouds.push({ frame: this.frame(`cloud_${Math.floor(r() * 5)}`), x, y: range(r, 260, 1000), z: range(r, -260, -90), scale: range(r, 0.55, 1.1), flip: r() < 0.5 });
    }
    buildSpriteBatches(P, nearClouds, { hazeAmount: 0.06, skirt: 0, renderOrder: 50, opacity: 0.88 }).forEach((m) => near.add(fixed(m)));
    const frontClouds: Placement[] = [];
    for (let x = 3200; x < WORLD_X1; x += range(r, 1400, 2600)) {
      frontClouds.push({ frame: this.frame(`cloud_${Math.floor(r() * 5)}`), x, y: range(r, 380, 900), z: range(r, 8, 14), scale: range(r, 0.18, 0.28) });
    }
    buildSpriteBatches(P, frontClouds, { hazeAmount: 0, skirt: 0, renderOrder: 60, opacity: 0.5 }).forEach((m) => near.add(fixed(m)));
  }

  private buildHillScenery(hills: THREE.Group, P: THREE.Texture[]): void {
    const west = this.sceneryGroup(hills, 'danubeWest');
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('kamzik'), x: 4950, z: 1 },
        { frame: this.frame('kahlenberg'), x: 8550, z: 1 },
      ],
      { hazeAmount: 0.26, skirt: 8, renderOrder: 21, fields: true },
    ).forEach((m) => west.add(m));
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('vienna_far'), x: 8950, z: 3 },
        { frame: this.frame('vienna_far'), x: 9420, z: 3, flip: true },
        { frame: this.frame('vienna_far'), x: 9900, z: 3 },
        { frame: this.frame('vienna_far'), x: 10380, z: 3, flip: true },
        { frame: this.frame('dc_tower'), x: 9180, z: 4 },
        { frame: this.frame('millennium_tower'), x: 9330, z: 4 },
        { frame: this.frame('donauturm'), x: 9470, z: 4 },
      ],
      { hazeAmount: 0.26, skirt: 0, renderOrder: 21.5 },
    ).forEach((m) => west.add(m));

    const east = this.sceneryGroup(hills, 'danubeEast');
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('kamzik'), x: 4700, z: 1, scale: 0.85 },
        { frame: this.frame('kahlenberg'), x: 8200, z: 1, scale: 0.55 },
      ],
      { hazeAmount: 0.26, skirt: 8, renderOrder: 21, fields: true },
    ).forEach((m) => east.add(m));
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('budapest_far'), x: 9000, z: 3 },
        { frame: this.frame('budapest_far'), x: 9580, z: 3, flip: true },
        { frame: this.frame('budapest_far'), x: 10160, z: 3 },
        { frame: this.frame('budapest_far'), x: 10680, z: 3, flip: true },
      ],
      { hazeAmount: 0.26, skirt: 0, renderOrder: 21.5 },
    ).forEach((m) => east.add(m));

    const pan = this.sceneryGroup(hills, 'pannonian');
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('kahlenberg'), x: 6200, z: 1, scale: 0.4 },
        { frame: this.frame('kahlenberg'), x: 7800, z: 1, scale: 0.45, flip: true },
      ],
      { hazeAmount: 0.28, skirt: 8, renderOrder: 21, fields: true },
    ).forEach((m) => pan.add(m));
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('vienna_far'), x: 2800, z: 3, scale: 0.7 },
        { frame: this.frame('vienna_far'), x: 3400, z: 3, scale: 0.65, flip: true },
        { frame: this.frame('budapest_far'), x: 9200, z: 3 },
        { frame: this.frame('budapest_far'), x: 9800, z: 3, flip: true },
        { frame: this.frame('budapest_far'), x: 10400, z: 3 },
      ],
      { hazeAmount: 0.26, skirt: 0, renderOrder: 21.5 },
    ).forEach((m) => pan.add(m));

    // Bohemia: softer hills, Prague-like far city (reuse vienna_far massing)
    const boh = this.sceneryGroup(hills, 'bohemian');
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('kahlenberg'), x: 5600, z: 1, scale: 0.5 },
        { frame: this.frame('kamzik'), x: 7200, z: 1, scale: 0.7 },
      ],
      { hazeAmount: 0.28, skirt: 8, renderOrder: 21, fields: true },
    ).forEach((m) => boh.add(m));
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('vienna_far'), x: 9000, z: 3, scale: 0.9 },
        { frame: this.frame('vienna_far'), x: 9600, z: 3, flip: true },
        { frame: this.frame('vienna_far'), x: 10200, z: 3, scale: 0.85 },
        { frame: this.frame('dc_tower'), x: 9450, z: 4, scale: 0.55 },
      ],
      { hazeAmount: 0.26, skirt: 0, renderOrder: 21.5 },
    ).forEach((m) => boh.add(m));

    // Carpathian foothills — heavier ridges, sparse city
    const car = this.sceneryGroup(hills, 'carpathian');
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('kamzik'), x: 4200, z: 1 },
        { frame: this.frame('kahlenberg'), x: 5800, z: 1, scale: 0.85 },
        { frame: this.frame('kamzik'), x: 7400, z: 1, scale: 0.9, flip: true },
        { frame: this.frame('kahlenberg'), x: 9000, z: 1, scale: 0.7 },
      ],
      { hazeAmount: 0.3, skirt: 8, renderOrder: 21, fields: true },
    ).forEach((m) => car.add(m));
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('budapest_far'), x: 9800, z: 3, scale: 0.75 },
        { frame: this.frame('budapest_far'), x: 10400, z: 3, scale: 0.7, flip: true },
      ],
      { hazeAmount: 0.28, skirt: 0, renderOrder: 21.5 },
    ).forEach((m) => car.add(m));

    // Vistula — flat, river city cue near dest
    const vis = this.sceneryGroup(hills, 'vistula');
    buildSpriteBatches(
      P,
      [{ frame: this.frame('kahlenberg'), x: 7000, z: 1, scale: 0.35 }],
      { hazeAmount: 0.3, skirt: 8, renderOrder: 21, fields: true },
    ).forEach((m) => vis.add(m));
    buildSpriteBatches(
      P,
      [
        { frame: this.frame('vienna_far'), x: 3000, z: 3, scale: 0.55 },
        { frame: this.frame('budapest_far'), x: 9100, z: 3 },
        { frame: this.frame('budapest_far'), x: 9700, z: 3, flip: true },
        { frame: this.frame('budapest_far'), x: 10300, z: 3 },
        { frame: this.frame('millennium_tower'), x: 9900, z: 4, scale: 0.7 },
      ],
      { hazeAmount: 0.26, skirt: 0, renderOrder: 21.5 },
    ).forEach((m) => vis.add(m));

    // World themes — distant water haze / generic ridges; hero cities toggle separately.
    for (const theme of ['channelSea', 'atlanticOcean', 'mediterranean', 'pacificRim'] as const) {
      const g = this.sceneryGroup(hills, theme);
      const far =
        theme === 'channelSea'
          ? 'london_far'
          : theme === 'mediterranean'
            ? 'rome_far'
            : theme === 'atlanticOcean'
              ? 'manhattan_far'
              : 'paris_far';
      buildSpriteBatches(
        P,
        [
          { frame: this.frame(far), x: 2800, z: 3, scale: 0.55 },
          { frame: this.frame(far), x: 9200, z: 3, scale: 0.9 },
          { frame: this.frame(far), x: 10000, z: 3, scale: 0.85, flip: true },
        ],
        { hazeAmount: 0.28, skirt: 0, renderOrder: 21.5 },
      ).forEach((m) => g.add(m));
    }
    for (const theme of ['alpine', 'continental', 'desertApproaches'] as const) {
      const g = this.sceneryGroup(hills, theme);
      buildSpriteBatches(
        P,
        [
          { frame: this.frame('kahlenberg'), x: 5200, z: 1, scale: theme === 'alpine' ? 1 : 0.4 },
          { frame: this.frame('kamzik'), x: 7000, z: 1, scale: theme === 'alpine' ? 0.9 : 0.5 },
          { frame: this.frame('vienna_far'), x: 9400, z: 3, scale: 0.75 },
          { frame: this.frame('vienna_far'), x: 10100, z: 3, scale: 0.7, flip: true },
        ],
        { hazeAmount: 0.28, skirt: 8, renderOrder: 21, fields: true },
      ).forEach((m) => g.add(m));
    }
  }

  private buildMidScenery(
    mid: THREE.Group,
    P: THREE.Texture[],
    ctTex: THREE.Texture,
    ctW: number,
    ctH: number,
    r: Rand,
  ): void {
    const snp = this.frame('snp_bridge');
    const snpLeft = DANUBE.x0 - SNP_RIVER_OFFSET;
    const snpRight = snpLeft + snp.w;

    // --- danubeWest: BTS city → Parndorf → Vienna (legacy look)
    const west = this.sceneryGroup(mid, 'danubeWest');
    west.add(
      buildTileStrip(ctTex, ctW, ctH, [[WORLD_X0, snpLeft + 2], [snpRight - 2, REF_X1]], {
        hazeAmount: 0.1,
        skirt: 8,
        renderOrder: 30,
        fields: true,
      }),
    );
    buildSpriteBatches(
      P,
      [
        { frame: snp, x: snpLeft + snp.w / 2, z: 3 },
        { frame: this.frame('bratislava_castle'), x: snpRight - 6 + this.frame('bratislava_castle').w / 2, z: 2 },
      ],
      { hazeAmount: 0.1, skirt: 8, renderOrder: 31 },
    ).forEach((m) => west.add(m));
    const westSprites: Placement[] = [];
    const atWest = (name: string, left: number, z = 2, flip = false) => {
      const f = this.frame(name);
      westSprites.push({ frame: f, x: left + f.w / 2, z, flip });
    };
    atWest('petrzalka_far', 2380, 1);
    atWest('petrzalka_far', 2700, 1.5, true);
    atWest('petrzalka_far', 3020, 1);
    atWest('petrzalka_far', 3300, 1.2, true);
    atWest('bratislava_oldtown', snpRight + 380, 1.5);
    atWest('village', 5650, 2);
    atWest('village', 6950, 2, true);
    atWest('village', 7900, 2);
    for (let x = ZONES.viennaCity.x0; x < ZONES.viennaCity.x1; x += 214) {
      atWest(r() < 0.5 ? 'vienna_block_a' : 'vienna_block_b', x, 1 + r() * 0.5, r() < 0.5);
    }
    atWest('votivkirche', 9020, 3);
    atWest('stephansdom', 9500, 3.5);
    atWest('karlskirche', 9760, 3);
    atWest('riesenrad', 10320, 3);
    buildSpriteBatches(P, westSprites, { hazeAmount: 0.1, skirt: 0, renderOrder: 31 }).forEach((m) => west.add(m));
    this.addTurbines(west, P, 6150, 7750, rng(88));

    // --- danubeEast: channels, farmland, Budapest
    const east = this.sceneryGroup(mid, 'danubeEast');
    const eastGaps: [number, number][] = [
      [DANUBE.x0 - 10, DANUBE.x1 + 10],
      [5180, 5500],
      [6780, 7080],
      [8380, 8680],
    ];
    east.add(buildTileStrip(ctTex, ctW, ctH, this.segmentsMinusGaps(eastGaps), { hazeAmount: 0.1, skirt: 8, renderOrder: 30, fields: true, taper: 160 }));
    const eastSprites: Placement[] = [];
    const atEast = (name: string, left: number, z = 2, flip = false, scale = 1) => {
      const f = this.frame(name);
      eastSprites.push({ frame: f, x: left + (f.w * scale) / 2, z, flip, scale });
    };
    atEast('petrzalka_far', 2400, 1, false, 0.85);
    atEast('petrzalka_far', 2750, 1.2, true, 0.85);
    atEast('village', 4300, 2);
    atEast('village', 4900, 2, true);
    atEast('village', 5600, 2);
    atEast('village', 6200, 2, true);
    atEast('village', 7200, 2);
    atEast('village', 7900, 2, true);
    atEast('village', 8600, 2);
    buildSpriteBatches(P, eastSprites, { hazeAmount: 0.1, skirt: 0, renderOrder: 31 }).forEach((m) => east.add(m));
    this.addTurbines(east, P, 5800, 6600, rng(91));

    // --- pannonian: open plain, light turbines, both city cues at ends
    const pan = this.sceneryGroup(mid, 'pannonian');
    const panGaps: [number, number][] = [[4880, 5380]];
    pan.add(buildTileStrip(ctTex, ctW, ctH, this.segmentsMinusGaps(panGaps), { hazeAmount: 0.1, skirt: 8, renderOrder: 30, fields: true, taper: 160 }));
    const panSprites: Placement[] = [];
    const atPan = (name: string, left: number, z = 2, flip = false) => {
      const f = this.frame(name);
      panSprites.push({ frame: f, x: left + f.w / 2, z, flip });
    };
    atPan('village', 3200, 2);
    atPan('village', 4100, 2, true);
    atPan('village', 5600, 2);
    atPan('village', 6400, 2, true);
    atPan('village', 7600, 2);
    atPan('village', 8400, 2, true);
    for (let x = 2500; x < 3600; x += 220) {
      atPan(r() < 0.5 ? 'vienna_block_a' : 'vienna_block_b', x, 1);
    }
    buildSpriteBatches(P, panSprites, { hazeAmount: 0.1, skirt: 0, renderOrder: 31 }).forEach((m) => pan.add(m));
    this.addTurbines(pan, P, 5400, 7200, rng(94));

    // --- bohemian: villages, light turbines, no SNP
    const boh = this.sceneryGroup(mid, 'bohemian');
    const bohGaps: [number, number][] = [[5200, 5550], [7800, 8100]];
    boh.add(buildTileStrip(ctTex, ctW, ctH, this.segmentsMinusGaps(bohGaps), { hazeAmount: 0.1, skirt: 8, renderOrder: 30, fields: true, taper: 160 }));
    const bohSprites: Placement[] = [];
    for (const [name, x, flip] of [
      ['village', 3400, false],
      ['village', 4200, true],
      ['village', 5800, false],
      ['village', 6600, true],
      ['village', 8600, false],
      ['village', 9400, true],
    ] as const) {
      const f = this.frame(name);
      bohSprites.push({ frame: f, x: x + f.w / 2, z: 2, flip });
    }
    buildSpriteBatches(P, bohSprites, { hazeAmount: 0.1, skirt: 0, renderOrder: 31 }).forEach((m) => boh.add(m));
    this.addTurbines(boh, P, 6000, 7400, rng(101));

    // --- carpathian: fewer villages, denser tree bands via near layer
    const car = this.sceneryGroup(mid, 'carpathian');
    car.add(buildTileStrip(ctTex, ctW, ctH, [[WORLD_X0, REF_X1]], { hazeAmount: 0.12, skirt: 8, renderOrder: 30, fields: true }));
    const carSprites: Placement[] = [];
    for (const x of [3600, 4800, 6200, 8000, 9600]) {
      const f = this.frame('village');
      carSprites.push({ frame: f, x: x + f.w / 2, z: 2, flip: x % 2000 > 1000 });
    }
    buildSpriteBatches(P, carSprites, { hazeAmount: 0.12, skirt: 0, renderOrder: 31 }).forEach((m) => car.add(m));

    // --- vistula: river gaps + villages
    const vis = this.sceneryGroup(mid, 'vistula');
    const visGaps: [number, number][] = [[4000, 4450], [6200, 6600], [8800, 9200]];
    vis.add(buildTileStrip(ctTex, ctW, ctH, this.segmentsMinusGaps(visGaps), { hazeAmount: 0.1, skirt: 8, renderOrder: 30, fields: true, taper: 160 }));
    const visSprites: Placement[] = [];
    for (const x of [3000, 5000, 7200, 8200, 9800]) {
      const f = this.frame('village');
      visSprites.push({ frame: f, x: x + f.w / 2, z: 2 });
    }
    buildSpriteBatches(P, visSprites, { hazeAmount: 0.1, skirt: 0, renderOrder: 31 }).forEach((m) => vis.add(m));
    this.addTurbines(vis, P, 5000, 6000, rng(107));

    // --- Over-sea / world themes (city icons come from cityLandmarkGroups)
    this.buildSeaMidTheme(mid, P, ctTex, ctW, ctH, 'channelSea', [
      [4300, 7800],
      [8200, 8600],
    ], true);
    this.buildSeaMidTheme(mid, P, ctTex, ctW, ctH, 'atlanticOcean', [[3800, 9000]], false);
    this.buildSeaMidTheme(mid, P, ctTex, ctW, ctH, 'mediterranean', [
      [4500, 7200],
      [7600, 8200],
    ], true);
    this.buildSeaMidTheme(mid, P, ctTex, ctW, ctH, 'pacificRim', [[4000, 8800]], false);

    for (const theme of ['alpine', 'continental', 'desertApproaches'] as const) {
      const g = this.sceneryGroup(mid, theme);
      const gaps: [number, number][] =
        theme === 'alpine' ? [[5600, 6000], [7400, 7700]] : theme === 'desertApproaches' ? [[5200, 5800]] : [[6000, 6400]];
      g.add(buildTileStrip(ctTex, ctW, ctH, this.segmentsMinusGaps(gaps), { hazeAmount: 0.1, skirt: 8, renderOrder: 30, fields: true, taper: 160 }));
      const sprites: Placement[] = [];
      for (const x of [3200, 4400, 6800, 8600, 9800]) {
        sprites.push({ frame: this.frame('village'), x: x + this.frame('village').w / 2, z: 2 });
      }
      buildSpriteBatches(P, sprites, { hazeAmount: 0.1, skirt: 0, renderOrder: 31 }).forEach((m) => g.add(m));
      if (theme === 'alpine') this.addTurbines(g, P, 6200, 7200, rng(121));
    }
  }

  private buildSeaMidTheme(
    mid: THREE.Group,
    P: THREE.Texture[],
    ctTex: THREE.Texture,
    ctW: number,
    ctH: number,
    theme: SceneryTheme,
    gaps: [number, number][],
    withCliffs: boolean,
  ): void {
    const g = this.sceneryGroup(mid, theme);
    g.add(buildTileStrip(ctTex, ctW, ctH, this.segmentsMinusGaps(gaps), { hazeAmount: 0.1, skirt: 8, renderOrder: 30, fields: true, taper: 160 }));
    const sprites: Placement[] = [];
    const put = (name: string, left: number, z = 2, scale = 1, flip = false) => {
      const f = this.frame(name);
      sprites.push({ frame: f, x: left + (f.w * scale) / 2, z, scale, flip });
    };
    put('village', 2800, 2);
    put('village', 3400, 2, 1, true);
    if (withCliffs) {
      put('channel_cliffs', gaps[0][0] - 180, 1.5, 1.1);
      put('channel_cliffs', gaps[0][1] + 20, 1.5, 1.0, true);
    }
    if (theme === 'atlanticOcean' || theme === 'pacificRim') {
      put('atlantic_swell', gaps[0][0] + 200, 0.5, 1);
      put('atlantic_swell', gaps[0][0] + 900, 0.4, 1, true);
      put('cargo_ship', gaps[0][0] + 1400, 2, 1.1);
      put('cargo_ship', gaps[0][0] + 3200, 2, 0.9, true);
    } else {
      put('ferry', gaps[0][0] + 800, 2.5);
      put('cargo_ship', gaps[0][0] + 1800, 2);
      put('ferry', gaps[0][0] + 2600, 2.5, 1, true);
    }
    if (theme === 'mediterranean') {
      put('med_isle', gaps[0][0] + 1100, 1.5);
      put('med_isle', gaps[0][0] + 2200, 1.2, 0.85, true);
      put('sea_stack', gaps[0][0] + 600, 2);
    }
    put('village', 9200, 2);
    put('village', 10000, 2, 1, true);
    buildSpriteBatches(P, sprites, { hazeAmount: 0.1, skirt: 0, renderOrder: 31 }).forEach((m) => g.add(m));
  }

  /** Iconic city packs at departure (west) and arrival (east) corridor thirds. */
  /**
   * The city's icons spread behind the departure and arrival runways on the mid layer,
   * so the skyline is on screen while you taxi, take off and flare.
   */
  private buildAirportSkyline(iata: string, icons: Placement[]): void {
    if (!icons.length) return;
    this.cityIcons.set(iata, icons);
    const xs = icons.map((p) => p.x);
    const x0 = Math.min(...xs);
    const span = Math.max(1, Math.max(...xs) - x0);
    const place = (from: number, width: number): Placement[] =>
      icons.map((p) => ({
        ...p,
        x: from + ((p.x - x0) / span) * width,
        z: (p.z ?? 2) + 1,
        scale: (p.scale ?? 1) * 1.05,
      }));
    const depG = new THREE.Group();
    const arrG = new THREE.Group();
    depG.visible = false;
    arrG.visible = false;
    depG.name = `skyline_dep_${iata}`;
    arrG.name = `skyline_arr_${iata}`;
    this.midLayer.add(depG);
    this.midLayer.add(arrG);
    const opts = { hazeAmount: 0.14, skirt: 0, renderOrder: 31.8 };
    buildSpriteBatches(this.pages, place(-500, 2300), opts).forEach((m) => depG.add(m));
    const d0 = REFERENCE_LAYOUT.destX0;
    buildSpriteBatches(this.pages, place(d0 - 900, 2600), opts).forEach((m) => arrG.add(m));
    this.airportSkylines.push({ iata, dep: depG, arr: arrG });
  }

  private buildCityLandmarkPacks(): void {
    const mid = this.root; // sit with world so parallax matches mid layer roughly
    const P = this.pages;
    const pack = (
      iata: string,
      dep: Placement[],
      arr: Placement[],
    ) => {
      const depG = new THREE.Group();
      const arrG = new THREE.Group();
      depG.visible = false;
      arrG.visible = false;
      depG.name = `city_dep_${iata}`;
      arrG.name = `city_arr_${iata}`;
      mid.add(depG);
      mid.add(arrG);
      buildSpriteBatches(P, dep, { hazeAmount: 0.1, skirt: 0, renderOrder: 31.5 }).forEach((m) => depG.add(m));
      buildSpriteBatches(P, arr, { hazeAmount: 0.1, skirt: 0, renderOrder: 31.5 }).forEach((m) => arrG.add(m));
      this.cityLandmarkGroups.push({ iata, dep: depG, arr: arrG });
      this.buildAirportSkyline(iata, arr.length >= dep.length ? arr : dep);
    };
    const f = (name: string) => this.frame(name);
    const at = (name: string, x: number, z = 3, scale = 1) => ({
      frame: f(name),
      x,
      z,
      scale,
    });

    pack(
      'LON',
      [
        at('london_far', 3000, 2, 0.85),
        at('london_far', 3600, 2, 0.8),
        at('the_shard', 3200, 4, 0.7),
        at('big_ben', 3800, 4, 0.75),
        at('tower_bridge', 4100, 3, 0.7),
      ],
      [
        at('london_far', 8800, 2),
        at('london_far', 9400, 2, 1),
        at('london_far', 10000, 2),
        at('st_pauls', 9100, 3.5),
        at('big_ben', 9600, 4),
        at('london_eye', 10050, 3.5),
        at('tower_bridge', 10400, 3),
        at('the_shard', 10750, 4),
        at('london_block', 8900, 2, 0.9),
        at('london_block', 9300, 2, 0.9),
      ],
    );

    pack(
      'NYC',
      [
        at('manhattan_far', 2900, 2, 0.75),
        at('statue_liberty', 3400, 4, 0.7),
        at('empire_state', 3800, 4, 0.55),
      ],
      [
        at('manhattan_far', 8600, 2),
        at('manhattan_far', 9300, 2),
        at('manhattan_far', 10000, 2),
        at('statue_liberty', 8400, 4.5),
        at('brooklyn_bridge', 9000, 3),
        at('one_wtc', 9600, 4),
        at('empire_state', 10050, 4),
        at('chrysler', 10380, 4),
        at('nyc_block', 9200, 2),
        at('nyc_block', 9700, 2),
        at('nyc_block', 10200, 2),
      ],
    );

    pack(
      'ROM',
      [
        at('rome_far', 3100, 2, 0.8),
        at('colosseum', 3600, 3, 0.75),
        at('st_peters', 4000, 3.5, 0.7),
      ],
      [
        at('rome_far', 9000, 2),
        at('rome_far', 9600, 2),
        at('pantheon', 9200, 3),
        at('colosseum', 9800, 3.5),
        at('st_peters', 10400, 4),
      ],
    );

    pack(
      'PAR',
      [
        at('paris_far', 3000, 2, 0.8),
        at('eiffel', 3500, 4, 0.65),
        at('arc_triomphe', 3900, 3, 0.7),
      ],
      [
        at('paris_far', 8900, 2),
        at('paris_far', 9500, 2),
        at('paris_block', 9100, 2),
        at('paris_block', 9600, 2),
        at('notre_dame', 9400, 3.5),
        at('arc_triomphe', 9900, 3),
        at('eiffel', 10400, 4),
      ],
    );

    pack(
      'BTS',
      [
        at('petrzalka_far', 2600, 1, 0.85),
        at('petrzalka_far', 3100, 1.2, 0.8),
        at('snp_bridge', 3600, 3, 0.75),
        at('bratislava_castle', 4000, 2, 0.7),
      ],
      [
        at('petrzalka_far', 8800, 1),
        at('petrzalka_far', 9300, 1.2),
        at('snp_bridge', 9800, 3),
        at('bratislava_castle', 10400, 2),
        at('bratislava_oldtown', 10800, 1.5),
      ],
    );

    pack(
      'VIE',
      [
        at('vienna_far', 2800, 2, 0.75),
        at('stephansdom', 3400, 3.5, 0.7),
        at('riesenrad', 3900, 3, 0.7),
      ],
      [
        at('vienna_far', 8800, 2),
        at('vienna_far', 9500, 2),
        at('vienna_block_a', 9000, 2),
        at('vienna_block_b', 9400, 2),
        at('votivkirche', 9100, 3),
        at('stephansdom', 9700, 3.5),
        at('karlskirche', 10100, 3),
        at('riesenrad', 10550, 3),
        at('dc_tower', 10800, 4, 0.75),
      ],
    );

    pack(
      'BUD',
      [
        at('budapest_far', 2900, 2, 0.75),
        at('chain_bridge', 3400, 3, 0.7),
        at('budapest_parliament', 3900, 3.5, 0.7),
      ],
      [
        at('budapest_far', 8800, 2),
        at('budapest_far', 9600, 2),
        at('chain_bridge', 9200, 3),
        at('budapest_parliament', 10000, 3.5),
        at('millennium_tower', 10500, 4, 0.75),
      ],
    );

    pack(
      'PRG',
      [
        at('prague_far', 2900, 2, 0.8),
        at('charles_bridge', 3400, 3, 0.7),
        at('prague_castle', 3900, 3.5, 0.7),
      ],
      [
        at('prague_far', 8800, 2),
        at('prague_far', 9500, 2),
        at('charles_bridge', 9200, 3),
        at('prague_castle', 10100, 3.5),
      ],
    );

    pack('KRK', [at('krakow_far', 3000, 2, 0.8), at('wawel', 3600, 3.5, 0.75)], [at('krakow_far', 9000, 2), at('krakow_far', 9700, 2), at('wawel', 10200, 3.5)]);
    pack('WAW', [at('warsaw_far', 3000, 2, 0.8), at('pkin', 3600, 4, 0.6)], [at('warsaw_far', 8900, 2), at('warsaw_far', 9600, 2), at('pkin', 10300, 4)]);
    pack('MUC', [at('munich_far', 3000, 2, 0.8), at('frauenkirche', 3600, 3.5, 0.75)], [at('munich_far', 9000, 2), at('frauenkirche', 10000, 3.5)]);
    pack(
      'BER',
      [at('berlin_far', 2900, 2, 0.8), at('brandenburg', 3500, 3, 0.75), at('tv_tower', 4000, 4, 0.6)],
      [at('berlin_far', 8800, 2), at('berlin_far', 9600, 2), at('brandenburg', 9400, 3), at('tv_tower', 10400, 4)],
    );
    pack(
      'AMS',
      [at('ams_far', 3000, 2, 0.8), at('canal_house', 3500, 3, 0.75), at('windmill', 4000, 3, 0.7)],
      [at('ams_far', 8900, 2), at('canal_house', 9400, 3), at('windmill', 10200, 3)],
    );
    pack('MAD', [at('madrid_far', 3000, 2, 0.8), at('palacio_real', 3600, 3.5, 0.75)], [at('madrid_far', 9000, 2), at('palacio_real', 10100, 3.5)]);
    pack('MIL', [at('milan_far', 3000, 2, 0.8), at('duomo_milan', 3600, 3.5, 0.75)], [at('milan_far', 9000, 2), at('duomo_milan', 10100, 3.5)]);
    pack('ZRH', [at('zurich_far', 3000, 2, 0.8), at('grossmunster', 3600, 3.5, 0.75)], [at('zurich_far', 9000, 2), at('grossmunster', 10100, 3.5)]);
    pack(
      'IST',
      [at('istanbul_far', 2900, 2, 0.8), at('hagia_sophia', 3500, 3.5, 0.7), at('blue_mosque', 4000, 3.5, 0.65)],
      [at('istanbul_far', 8800, 2), at('hagia_sophia', 9600, 3.5), at('blue_mosque', 10400, 3.5)],
    );
    pack('ATH', [at('athens_far', 3000, 2, 0.8), at('parthenon', 3600, 3.5, 0.8)], [at('athens_far', 9000, 2), at('parthenon', 10100, 3.5)]);
    pack(
      'LIS',
      [at('lisbon_far', 2900, 2, 0.8), at('abril_bridge', 3400, 3, 0.7), at('belem_tower', 4000, 3, 0.75)],
      [at('lisbon_far', 8800, 2), at('abril_bridge', 9400, 3), at('belem_tower', 10400, 3)],
    );
    pack('DUB', [at('dublin_far', 3000, 2, 0.8), at('dublin_spire', 3700, 4, 0.7)], [at('dublin_far', 9000, 2), at('dublin_spire', 10200, 4)]);
    pack('MIA', [at('miami_far', 3000, 2, 0.8), at('art_deco', 3600, 3, 0.8)], [at('miami_far', 8900, 2), at('miami_far', 9600, 2), at('art_deco', 10100, 3)]);
    pack(
      'DXB',
      [at('dubai_far', 2900, 2, 0.75), at('burj_khalifa', 3600, 4, 0.55)],
      [at('dubai_far', 8600, 2), at('dubai_far', 9400, 2), at('burj_khalifa', 10200, 4)],
    );
    pack('CAI', [at('cairo_far', 3000, 2, 0.8), at('pyramids', 3600, 3.5, 0.8)], [at('cairo_far', 9000, 2), at('pyramids', 10100, 3.5)]);
    pack(
      'LAX',
      [at('lax_far', 2900, 2, 0.8), at('hollywood', 3600, 3, 0.8)],
      [at('lax_far', 8800, 2), at('lax_far', 9600, 2), at('hollywood', 10300, 3)],
    );
    pack(
      'SFO',
      [at('sfo_far', 2900, 2, 0.8), at('golden_gate', 3400, 3, 0.7)],
      [at('sfo_far', 8800, 2), at('golden_gate', 9600, 3), at('sfo_far', 10400, 2)],
    );
    pack(
      'TYO',
      [at('tokyo_far', 2800, 2, 0.75), at('tokyo_tower', 3400, 4, 0.6), at('skytree', 3900, 4, 0.55)],
      [at('tokyo_far', 8600, 2), at('tokyo_far', 9400, 2), at('tokyo_tower', 9800, 4), at('skytree', 10500, 4)],
    );
    pack(
      'SIN',
      [at('singapore_far', 2900, 2, 0.8), at('marina_bay', 3600, 3.5, 0.75)],
      [at('singapore_far', 8800, 2), at('marina_bay', 10000, 3.5)],
    );
    pack(
      'SYD',
      [at('sydney_far', 2900, 2, 0.8), at('harbour_bridge', 3400, 3, 0.7), at('opera_house', 4000, 3.5, 0.7)],
      [at('sydney_far', 8700, 2), at('harbour_bridge', 9400, 3), at('opera_house', 10400, 3.5)],
    );
    pack(
      'HKG',
      [at('hongkong_far', 2800, 2, 0.75), at('ifc_tower', 3600, 4, 0.6)],
      [at('hongkong_far', 8600, 2), at('hongkong_far', 9400, 2), at('ifc_tower', 10300, 4)],
    );
  }

  private segmentsMinusGaps(gaps: [number, number][]): [number, number][] {
    const out: [number, number][] = [];
    let start = WORLD_X0;
    const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
    for (const [g0, g1] of sorted) {
      if (g0 > start) out.push([start, g0]);
      start = Math.max(start, g1);
    }
    if (start < REF_X1) out.push([start, REF_X1]);
    return out;
  }

  private addTurbines(parent: THREE.Group, P: THREE.Texture[], x0: number, x1: number, r: Rand): void {
    const turbines: Placement[] = [];
    const tower = this.frame('turbine_tower');
    const local: { x: number; y: number; phase: number; speed: number }[] = [];
    for (let x = x0; x < x1; x += range(r, 150, 230)) {
      const z = range(r, -30, 1);
      const s = range(r, 0.85, 1.05);
      turbines.push({ frame: tower, x, z, scale: s, y: 9 });
      local.push({ x, y: 9 + 95 * s, phase: r() * Math.PI * 2, speed: range(r, 0.9, 1.3) });
    }
    buildSpriteBatches(P, turbines, { hazeAmount: 0.12, skirt: 0, renderOrder: 32 }).forEach((m) => parent.add(m));
    const start = this.turbineData.length;
    this.turbineData.push(...local);
    const blades: Placement[] = local.map((t) => ({ frame: this.frame('turbine_blades'), x: t.x, y: t.y, z: 0.5 }));
    const meshes = buildSpriteBatches(P, blades, { hazeAmount: 0.12, skirt: 0, renderOrder: 33, centerAnchor: true });
    meshes.forEach((m) => {
      // Offset instance indices so update() can map mesh instances → turbineData slice.
      m.userData.turbineOffset = start;
      parent.add(m);
      this.turbineBlades.push(m);
    });
  }

  private buildForeScenery(
    fields: THREE.Group,
    fore: THREE.Group,
    P: THREE.Texture[],
    gaps: [number, number][],
    r: Rand,
  ): void {
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

    const westF = this.sceneryGroup(fields, 'danubeWest');
    const westFore = this.sceneryGroup(fore, 'danubeWest');
    const fieldSprites: Placement[] = [];
    city(fieldSprites, ['petrzalka_far'], ZONES.bratislavaOutskirts.x0 + 100, ZONES.bratislavaOutskirts.x1, 0.7, 230);
    city(fieldSprites, blocks, ZONES.viennaCity.x0 + 100, ZONES.viennaCity.x1, 0.75, 125);
    buildSpriteBatches(P, fieldSprites, { hazeAmount: 0.08, skirt: 0, renderOrder: 34.5 }).forEach((m) => westF.add(m));
    const foreSprites: Placement[] = [];
    city(foreSprites, ['petrzalka_far'], ZONES.bratislavaOutskirts.x0 + 200, ZONES.bratislavaOutskirts.x1, 0.55, 190);
    city(foreSprites, blocks, ZONES.viennaCity.x0 + 200, ZONES.viennaCity.x1, 0.6, 105);
    buildSpriteBatches(P, foreSprites, { hazeAmount: 0.05, skirt: 0, renderOrder: 36 }).forEach((m) => westFore.add(m));

    const eastF = this.sceneryGroup(fields, 'danubeEast');
    const eastFore = this.sceneryGroup(fore, 'danubeEast');
    const eastField: Placement[] = [];
    city(eastField, ['petrzalka_far'], ZONES.bratislavaOutskirts.x0 + 100, ZONES.bratislavaOutskirts.x1 - 200, 0.65, 260);
    city(eastField, ['village'], 4500, 9000, 0.9, 380);
    buildSpriteBatches(P, eastField, { hazeAmount: 0.08, skirt: 0, renderOrder: 34.5 }).forEach((m) => eastF.add(m));
    const eastForeSprites: Placement[] = [];
    city(eastForeSprites, ['petrzalka_far'], ZONES.bratislavaOutskirts.x0 + 200, 3400, 0.5, 220);
    city(eastForeSprites, ['village'], 4800, 8800, 0.75, 420);
    buildSpriteBatches(P, eastForeSprites, { hazeAmount: 0.05, skirt: 0, renderOrder: 36 }).forEach((m) => eastFore.add(m));

    const panF = this.sceneryGroup(fields, 'pannonian');
    const panFore = this.sceneryGroup(fore, 'pannonian');
    const panField: Placement[] = [];
    city(panField, blocks, 2400, 3800, 0.55, 200);
    city(panField, ['village'], 4000, 9500, 0.95, 360);
    buildSpriteBatches(P, panField, { hazeAmount: 0.08, skirt: 0, renderOrder: 34.5 }).forEach((m) => panF.add(m));
    const panForeSprites: Placement[] = [];
    city(panForeSprites, ['village'], 3000, 10000, 0.7, 400);
    buildSpriteBatches(P, panForeSprites, { hazeAmount: 0.05, skirt: 0, renderOrder: 36 }).forEach((m) => panFore.add(m));

    for (const theme of [
      'bohemian',
      'carpathian',
      'vistula',
      'channelSea',
      'atlanticOcean',
      'mediterranean',
      'alpine',
      'continental',
      'desertApproaches',
      'pacificRim',
    ] as const) {
      const fGroup = this.sceneryGroup(fields, theme);
      const foreGroup = this.sceneryGroup(fore, theme);
      const fieldPl: Placement[] = [];
      const seaish = theme === 'channelSea' || theme === 'atlanticOcean' || theme === 'mediterranean' || theme === 'pacificRim';
      city(fieldPl, ['village'], 2600, seaish ? 4000 : 10000, theme === 'alpine' ? 0.8 : 0.95, seaish ? 520 : 380);
      if (!seaish) city(fieldPl, ['village'], 7000, 10000, 0.9, 400);
      buildSpriteBatches(P, fieldPl, { hazeAmount: 0.08, skirt: 0, renderOrder: 34.5 }).forEach((m) => fGroup.add(m));
      const forePl: Placement[] = [];
      city(forePl, ['village'], 2800, seaish ? 3900 : 9800, 0.7, 420);
      buildSpriteBatches(P, forePl, { hazeAmount: 0.05, skirt: 0, renderOrder: 36 }).forEach((m) => foreGroup.add(m));
    }
  }

  private buildNearScenery(near: THREE.Group, P: THREE.Texture[]): void {
    for (const theme of SCENERY_THEMES) {
      const g = this.sceneryGroup(near, theme);
      const list = this.nearThemePlacements(theme, rng(77 + theme.length * 13));
      buildSpriteBatches(P, list, { hazeAmount: 0.03, skirt: 0, renderOrder: 40 }).forEach((m) => g.add(m));
    }
  }

  /** Shared airport pads at both corridor ends (terminals swapped separately). */
  private nearAirportPlacements(): Placement[] {
    const list: Placement[] = [];
    const put = (name: string, x: number, z: number, scale = 1, flip = false) =>
      list.push({ frame: this.frame(name), x, z, scale, flip });
    put('bts_tower', 860, -105);
    put('hangar', 1020, -110);
    put('airliner_generic', 560, -68);
    put('airliner_generic', 760, -72, 1, true);
    put('vie_tower', VIE_RUNWAY.x0 + 900, -125);
    put('hangar', VIE_RUNWAY.x0 + 1180, -112);
    put('hangar', VIE_RUNWAY.x0 + 1260, -116);
    put('airliner_austrian', VIE_RUNWAY.x0 + 470, -72);
    put('airliner_austrian', VIE_RUNWAY.x0 + 560, -74);
    put('airliner_generic', VIE_RUNWAY.x0 + 700, -73);
    put('airliner_austrian', VIE_RUNWAY.x0 + 800, -75, 1, true);
    return list;
  }

  private nearThemePlacements(theme: SceneryTheme, r: Rand): Placement[] {
    const list: Placement[] = [];
    const put = (name: string, x: number, z: number, scale = 1, flip = false) =>
      list.push({ frame: this.frame(name), x, z, scale, flip });

    const waterGaps: [number, number][] =
      theme === 'danubeWest'
        ? [
            [DANUBE.x0 - 25, DANUBE.x1 + 25],
            [DANUBE_CANAL.x0 - 30, DANUBE_CANAL.x1 + 30],
          ]
        : theme === 'danubeEast'
          ? [
              [DANUBE.x0 - 25, DANUBE.x1 + 25],
              [5180, 5500],
              [6780, 7080],
              [8380, 8680],
            ]
          : theme === 'bohemian'
            ? [
                [5200, 5550],
                [7800, 8100],
              ]
            : theme === 'vistula'
              ? [
                  [4000, 4450],
                  [6200, 6600],
                  [8800, 9200],
                ]
              : theme === 'carpathian'
                ? [[6400, 6750]]
                : theme === 'alpine'
                  ? [
                      [5600, 6000],
                      [7400, 7700],
                    ]
                  : theme === 'desertApproaches'
                    ? [[5200, 5800]]
                    : theme === 'continental'
                      ? [[6000, 6400]]
                      : THEME_SEA_SPANS[theme] ?? [[4880, 5380]];

    const blocked = (x: number) =>
      waterGaps.some(([a, b]) => x > a && x < b) ||
      (x > 380 && x < 1250) ||
      (x > VIE_RUNWAY.x0 + 150 && x < VIE_RUNWAY.x0 + 1700);

    if (theme === 'danubeWest') {
      put('canal_bridge', (DANUBE_CANAL.x0 + DANUBE_CANAL.x1) / 2, -70);
    }

    for (let x = WORLD_X0; x < REF_X1; ) {
      if (blocked(x)) {
        x += 10;
        continue;
      }
      const z = range(r, -150, -60);
      const cityThemes = theme === 'danubeWest' || theme === 'danubeEast';
      const inBratislava = cityThemes && x > ZONES.bratislavaOutskirts.x0 && x < ZONES.bratislavaOutskirts.x1;
      const inOldTown = theme === 'danubeWest' && x > ZONES.bratislavaCity.x0 && x < ZONES.bratislavaCity.x0 + 900;
      const inVienna = theme === 'danubeWest' && x > ZONES.viennaCity.x0 + 300 && x < ZONES.viennaCity.x1;
      const inFarm = theme !== 'danubeWest' && x > 4000 && x < 10000;
      const denseTrees = theme === 'carpathian' && x > 3500 && x < 9500;

      if (inBratislava && r() < 0.55) {
        put(r() < 0.6 ? 'panelak_a' : 'panelak_b', x, z - 40, 1, r() < 0.5);
        x += range(r, 60, 110);
      } else if ((inVienna || inOldTown) && r() < 0.75) {
        put(pick(r, ['vienna_house_a', 'vienna_house_b', 'vienna_house_c']), x, range(r, -120, -90));
        x += 27.5;
      } else if (inFarm && r() < 0.12) {
        put(r() < 0.5 ? 'house_a' : 'house_b', x, z, 1, r() < 0.5);
        put(`tree_${Math.floor(r() * 3)}`, x + 14, z - 6, range(r, 0.9, 1.2));
        x += range(r, 50, 140);
      } else if (denseTrees && r() < 0.55) {
        const n = 4 + Math.floor(r() * 6);
        for (let i = 0; i < n; i++) put(`tree_${Math.floor(r() * 3)}`, x + i * range(r, 4, 8), z + range(r, -10, 10), range(r, 0.85, 1.3), r() < 0.5);
        x += n * 6 + range(r, 15, 50);
      } else {
        const roll = r();
        if (roll < 0.55) {
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

  private buildRouteTerminals(): void {
    // One named shell per flyable airport at both corridor ends; visibility is route-driven.
    for (const code of FLYABLE_IATAS) {
      const ap = airportByIata(code);
      if (!ap) continue;
      const sprite = terminalSpriteName(code);
      const originMeshes = buildSpriteBatches(
        this.pages,
        [{ frame: this.frame(sprite), x: 620, z: -95, scale: 0.85 }],
        { hazeAmount: 0.03, skirt: 0, renderOrder: 40 },
      );
      for (const m of originMeshes) {
        m.userData.airport = code;
        m.visible = false;
        this.root.add(m);
        this.originTerminals.push(m);
      }
      const destMeshes = buildSpriteBatches(
        this.pages,
        [{ frame: this.frame(sprite), x: VIE_RUNWAY.x0 + 620, z: -110, scale: 1.05 }],
        { hazeAmount: 0.03, skirt: 0, renderOrder: 40 },
      );
      for (const m of destMeshes) {
        m.userData.airport = code;
        m.visible = false;
        this.root.add(m);
        this.arrivalTerminals.push(m);
      }
    }
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
    ground.userData.fixedCorridor = true;
    this.root.add(ground);

    // Aprons
    const apronMat = new THREE.MeshLambertMaterial({ color: '#a9aba6', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const apron = (x0: number, x1: number, z0: number, z1: number) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, apronMat);
      m.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
      m.receiveShadow = true;
      this.tagSpan(m, x0, x1);
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
    mesh.userData.texRepeatPerM = 1 / 50;
    this.tagSpan(mesh, rw.x0, rw.x1);
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
    mesh.userData.anchorX = x;
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
    this.waterTex = tex;
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
    const river = (parent: THREE.Object3D, x0: number, x1: number, wallH: number) => {
      const depth = GROUND_Z1 - GROUND_Z0;
      const g = new THREE.PlaneGeometry(x1 - x0, depth);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, waterMat(x1 - x0));
      m.position.set((x0 + x1) / 2, 0.05, (GROUND_Z0 + GROUND_Z1) / 2);
      m.userData.texRepeatPerM = 1 / 20;
      this.tagSpan(m, x0, x1);
      parent.add(m);
      for (const x of [x0, x1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(3, wallH, depth), stoneMat);
        wall.position.set(x, wallH / 2 - 0.3, (GROUND_Z0 + GROUND_Z1) / 2);
        parent.add(wall);
      }
    };

    const recordWater = (theme: SceneryTheme, spans: [number, number][]) => {
      this.themeWaterAuth.push({ theme, spans: spans.map(([a, b]) => [a, b]) });
    };

    const west = this.sceneryGroup(this.root, 'danubeWest');
    river(west, DANUBE.x0, DANUBE.x1, 1.2);
    river(west, DANUBE_CANAL.x0, DANUBE_CANAL.x1, 1.6);
    recordWater('danubeWest', [
      [DANUBE.x0, DANUBE.x1],
      [DANUBE_CANAL.x0, DANUBE_CANAL.x1],
    ]);

    const east = this.sceneryGroup(this.root, 'danubeEast');
    river(east, DANUBE.x0, DANUBE.x1, 1.2);
    river(east, 5180, 5500, 1.0);
    river(east, 6780, 7080, 1.0);
    river(east, 8380, 8680, 0.9);
    recordWater('danubeEast', [
      [DANUBE.x0, DANUBE.x1],
      [5180, 5500],
      [6780, 7080],
      [8380, 8680],
    ]);

    const pan = this.sceneryGroup(this.root, 'pannonian');
    river(pan, 4880, 5380, 1.1);
    recordWater('pannonian', [[4880, 5380]]);

    const boh = this.sceneryGroup(this.root, 'bohemian');
    river(boh, 5200, 5550, 1.0);
    river(boh, 7800, 8100, 0.9);
    recordWater('bohemian', [
      [5200, 5550],
      [7800, 8100],
    ]);

    const car = this.sceneryGroup(this.root, 'carpathian');
    river(car, 6400, 6750, 0.85);
    recordWater('carpathian', [[6400, 6750]]);

    const vis = this.sceneryGroup(this.root, 'vistula');
    river(vis, 4000, 4450, 1.15);
    river(vis, 6200, 6600, 1.1);
    river(vis, 8800, 9200, 1.05);
    recordWater('vistula', [
      [4000, 4450],
      [6200, 6600],
      [8800, 9200],
    ]);

    const sea = (theme: SceneryTheme, spans: [number, number][], wall: number) => {
      const g = this.sceneryGroup(this.root, theme);
      for (const [x0, x1] of spans) river(g, x0, x1, wall);
      recordWater(theme, spans);
    };
    sea('channelSea', THEME_SEA_SPANS.channelSea!, 0.6);
    sea('atlanticOcean', THEME_SEA_SPANS.atlanticOcean!, 0.35);
    sea('mediterranean', THEME_SEA_SPANS.mediterranean!, 0.5);
    sea('pacificRim', THEME_SEA_SPANS.pacificRim!, 0.35);

    const alp = this.sceneryGroup(this.root, 'alpine');
    river(alp, 5600, 6000, 0.9);
    river(alp, 7400, 7700, 0.85);
    recordWater('alpine', [
      [5600, 6000],
      [7400, 7700],
    ]);

    const con = this.sceneryGroup(this.root, 'continental');
    river(con, 6000, 6400, 1.0);
    recordWater('continental', [[6000, 6400]]);

    const des = this.sceneryGroup(this.root, 'desertApproaches');
    river(des, 5200, 5800, 0.4);
    recordWater('desertApproaches', [[5200, 5800]]);
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
    // Approach lighting system: long enough that jets can pick it up before short final.
    for (let x = VIE_RUNWAY.x0 - 2400; x < VIE_RUNWAY.x0; x += 30) {
      for (const z of [-1.5, 0, 1.5]) add(x, 1.2, RUNWAY_Z + z, '#fff3cf');
    }
    for (let z = -18; z <= 18; z += 2.5) add(VIE_RUNWAY.x0 - 300, 1.2, RUNWAY_Z + z, '#fff3cf');
    for (let z = -12; z <= 12; z += 3) add(VIE_RUNWAY.x0 - 900, 1.2, RUNWAY_Z + z, '#fff3cf');
    for (let z = -9; z <= 9; z += 3) add(VIE_RUNWAY.x0 - 1500, 1.2, RUNWAY_Z + z, '#fff3cf');

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.runwayLightsMat = new THREE.PointsMaterial({
      size: this.baseRunwayLightSize,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(geo, this.runwayLightsMat);
    points.renderOrder = 45;
    this.root.add(points);

    // PAPI: four lights left of the VIE touchdown zone, colour driven by glide angle
    const papiGeo = new THREE.BufferGeometry();
    const papiPos: number[] = [];
    for (let i = 0; i < 4; i++) papiPos.push(VIE_RUNWAY.x0 + 300, 0.8, RUNWAY_Z - 30 - i * 9);
    papiGeo.setAttribute('position', new THREE.Float32BufferAttribute(papiPos, 3));
    papiGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(12).fill(1), 3));
    this.papiMat = this.runwayLightsMat.clone();
    this.papiMat.size = this.basePapiSize;
    this.papi = new THREE.Points(papiGeo, this.papiMat);
    this.papi.renderOrder = 46;
    this.root.add(this.papi);
  }

  /** Bigger camera pull-back for airliners — keep runway / PAPI lights readable. */
  setLightScale(k: number): void {
    const s = Math.max(1, k);
    this.runwayLightsMat.size = this.baseRunwayLightSize * Math.sqrt(s);
    this.papiMat.size = this.basePapiSize * Math.sqrt(s);
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
      const offset = (mesh.userData.turbineOffset as number) || 0;
      for (let i = 0; i < n; i++) {
        const t = this.turbineData[offset + i];
        if (!t) continue;
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
