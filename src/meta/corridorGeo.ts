/**
 * Sample a hop's great-circle and stamp coarse geography onto the side-view corridor.
 * Airports stay on their pads; the middle becomes sea / plains / hills / mountains / desert
 * instead of one sterile hill strip for every route.
 */
import { AIRPORTS, airportByIata } from './airports.ts';
import {
  BASE_DEST_X0,
  ORIGIN_PAD_END,
  type CorridorLayout,
  geoCorridorX,
} from './flightLength.ts';
import type { MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { feature } from 'topojson-client';
import countriesTopo from 'world-atlas/countries-110m.json';
import {
  COUNTRY_BIOME,
  COUNTRY_LABEL,
  oceanName,
  REGIONS,
  RIVERS,
  SEAS,
  type Biome,
  type GeoRegion,
  type GeoRiver,
  type GeoSea,
} from './geoData.ts';

export type CorridorBiome = Exclude<Biome, never> | 'river';

export interface GeoSegment {
  x0: number;
  x1: number;
  biome: CorridorBiome;
  name: string;
}

const SAMPLES = 120;
/** Keep city/airport pads free of mid-corridor geography. */
const PAD = 500;

interface CountryShape {
  name: string;
  /** Polygons as [outer, ...holes]. */
  polys: [number, number][][][];
  bbox: [number, number, number, number];
}

const topo = countriesTopo as unknown as Topology<{ countries: GeometryCollection }>;

/** Natural Earth 110m countries — the real coastline decides land vs sea. */
const COUNTRIES: CountryShape[] = feature(topo, topo.objects.countries).features.flatMap((f) => {
  const g = f.geometry;
  const polys =
    g?.type === 'Polygon'
      ? [(g as Polygon).coordinates]
      : g?.type === 'MultiPolygon'
        ? (g as MultiPolygon).coordinates
        : [];
  if (!polys.length) return [];
  let x0 = 180;
  let y0 = 90;
  let x1 = -180;
  let y1 = -90;
  for (const poly of polys)
    for (const [lon, lat] of poly[0]) {
      x0 = Math.min(x0, lon);
      x1 = Math.max(x1, lon);
      y0 = Math.min(y0, lat);
      y1 = Math.max(y1, lat);
    }
  return [
    {
      name: String((f.properties as { name?: string } | null)?.name ?? ''),
      polys: polys as [number, number][][][],
      bbox: [x0, y0, x1, y1] as [number, number, number, number],
    },
  ];
});

function countryAt(lon: number, lat: number): string | undefined {
  for (const c of COUNTRIES) {
    const [x0, y0, x1, y1] = c.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    for (const [outer, ...holes] of c.polys) {
      if (pointInPoly(lon, lat, outer) && !holes.some((h) => pointInPoly(lon, lat, h))) return c.name;
    }
  }
  return undefined;
}

function pointInPoly(lon: number, lat: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const hit = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function firstMatch<T extends { poly: [number, number][] }>(lon: number, lat: number, list: T[]): T | undefined {
  return list.find((item) => pointInPoly(lon, lat, item.poly));
}

function nearRiver(lon: number, lat: number): GeoRiver | undefined {
  const tol = 0.2;
  for (const river of RIVERS) {
    for (let i = 0; i < river.line.length - 1; i++) {
      const [x0, y0] = river.line[i];
      const [x1, y1] = river.line[i + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((lon - x0) * dx + (lat - y0) * dy) / len2));
      const dist = Math.hypot(lon - (x0 + t * dx), lat - (y0 + t * dy));
      if (dist < tol) return river;
    }
  }
  return undefined;
}

function classify(lon: number, lat: number): { biome: CorridorBiome; name: string } {
  const country = countryAt(lon, lat);
  if (!country) {
    const sea: GeoSea | undefined = firstMatch(lon, lat, SEAS);
    return { biome: 'sea', name: sea?.name ?? oceanName(lon, lat) };
  }
  const region: GeoRegion | undefined = firstMatch(lon, lat, REGIONS);
  const highland =
    region &&
    (region.biome === 'mountains' ||
      region.biome === 'hills' ||
      region.biome === 'desert' ||
      region.biome === 'forest' ||
      region.biome === 'taiga');
  // Ranges and deserts keep their identity; plains still yield to a named river.
  if (highland) return { biome: region.biome, name: region.name };
  const river = nearRiver(lon, lat);
  if (river) return { biome: 'river', name: river.name };
  if (region) return { biome: region.biome, name: region.name };
  return { biome: COUNTRY_BIOME[country] ?? 'farmland', name: COUNTRY_LABEL[country] ?? country };
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}
function toDeg(r: number): number {
  return (r * 180) / Math.PI;
}

/** Spherical interpolation of a great-circle (handles date-line hops). */
export function lerpGreatCircle(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
  t: number,
): [number, number] {
  const φ1 = toRad(lat1);
  const λ1 = toRad(lon1);
  const φ2 = toRad(lat2);
  const λ2 = toRad(lon2);
  const cos = Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const d = Math.acos(Math.max(-1, Math.min(1, cos)));
  if (d < 1e-6) return [lon1, lat1];
  const a = Math.sin((1 - t) * d) / Math.sin(d);
  const b = Math.sin(t * d) / Math.sin(d);
  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
  const z = a * Math.sin(φ1) + b * Math.sin(φ2);
  return [toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.hypot(x, y)))];
}

function mergeSamples(samples: { t: number; biome: CorridorBiome; name: string }[]): { t0: number; t1: number; biome: CorridorBiome; name: string }[] {
  const out: { t0: number; t1: number; biome: CorridorBiome; name: string }[] = [];
  for (const s of samples) {
    const last = out[out.length - 1];
    if (last && last.biome === s.biome && last.name === s.name) last.t1 = s.t;
    else out.push({ t0: s.t, t1: s.t, biome: s.biome, name: s.name });
  }
  return out;
}

/** Geography stamped onto the authored reference corridor (city pads left empty). */
export function corridorGeoOnReference(fromIata: string, toIata: string): GeoSegment[] {
  const from = airportByIata(fromIata);
  const to = airportByIata(toIata);
  if (!from || !to) return [];
  const samples: { t: number; biome: CorridorBiome; name: string }[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const [lon, lat] = lerpGreatCircle(from.lon, from.lat, to.lon, to.lat, t);
    const c = classify(lon, lat);
    samples.push({ t, ...c });
  }
  const merged = mergeSamples(samples);
  const x0 = ORIGIN_PAD_END + PAD;
  const x1 = BASE_DEST_X0 - PAD;
  const span = Math.max(1, x1 - x0);
  const split: typeof merged = [];
  for (const s of merged) {
    const width = (s.t1 - s.t0) * span;
    // A river that fills the whole hop is a valley, not a 8 km wide water hazard.
    if (s.biome === 'river' && width > 700) {
      const mid = (s.t0 + s.t1) / 2;
      const half = 220 / span;
      if (s.t0 < mid - half) split.push({ t0: s.t0, t1: mid - half, biome: 'farmland', name: `${s.name} valley` });
      split.push({ t0: Math.max(s.t0, mid - half), t1: Math.min(s.t1, mid + half), biome: 'river', name: s.name });
      if (s.t1 > mid + half) split.push({ t0: mid + half, t1: s.t1, biome: 'farmland', name: `${s.name} valley` });
    } else {
      split.push(s);
    }
  }
  const raw = split
    .map((s) => ({
      x0: x0 + s.t0 * span,
      x1: x0 + s.t1 * span,
      biome: s.biome,
      name: s.name,
    }))
    .filter((s) => s.x1 - s.x0 > 80);
  return coarsenSegments(raw);
}

/** Visual family used to decide whether a cut needs a fog veil. */
export function biomeFamily(biome: CorridorBiome): 'water' | 'river' | 'high' | 'upland' | 'sand' | 'land' {
  if (biome === 'sea' || biome === 'ice') return 'water';
  if (biome === 'river') return 'river';
  if (biome === 'mountains') return 'high';
  if (biome === 'hills' || biome === 'forest' || biome === 'taiga') return 'upland';
  if (biome === 'desert') return 'sand';
  return 'land';
}

function isFeature(biome: CorridorBiome): boolean {
  const f = biomeFamily(biome);
  return f === 'water' || f === 'river' || f === 'high' || f === 'sand';
}

/** Merge flicker-slices so the corridor does not strobe every 100 m. */
function mergeFamilies(segs: GeoSegment[]): GeoSegment[] {
  const out: GeoSegment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    const sameRiver = last?.biome !== 'river' || last.name === s.name;
    if (last && sameRiver && biomeFamily(last.biome) === biomeFamily(s.biome)) {
      const lastW = last.x1 - last.x0;
      const sW = s.x1 - s.x0;
      last.x1 = s.x1;
      if (sW > lastW) {
        last.biome = s.biome;
        last.name = s.name;
      }
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

function coarsenSegments(segs: GeoSegment[]): GeoSegment[] {
  if (segs.length < 2) return segs;
  const minW = 500;
  const minFeature = 1400;
  const minRiver = 700;
  // Slivers under ~1 km of sea/land along a coast are 110m-coastline noise, not geography.
  const out = mergeFamilies(segs.filter((s) => s.x1 - s.x0 > 160 || segs.length < 3));
  if (!out.length) return segs;
  out[0].x0 = segs[0].x0;
  out[out.length - 1].x1 = segs[segs.length - 1].x1;
  for (let i = 1; i < out.length; i++) out[i].x0 = out[i - 1].x1;
  // Long hops squash seas and ranges to a few hundred metres — steal width so they stay readable.
  const minFor = (b: CorridorBiome) => (b === 'river' ? minRiver : minFeature);
  for (let i = 0; i < out.length; i++) {
    const w = out[i].x1 - out[i].x0;
    const min = minFor(out[i].biome);
    if (!isFeature(out[i].biome) || w >= min) continue;
    let need = min - w;
    const prev = out[i - 1];
    const next = out[i + 1];
    const keep = (n: GeoSegment) => (isFeature(n.biome) ? Math.max(minFor(n.biome), (n.x1 - n.x0) * 0.8) : 360);
    const room = (n: GeoSegment | undefined) => (n ? Math.max(0, n.x1 - n.x0 - keep(n)) : 0);
    const takeL = Math.min(need * 0.5, room(prev));
    if (prev && takeL > 0) {
      prev.x1 -= takeL;
      out[i].x0 -= takeL;
      need -= takeL;
    }
    const takeR = Math.min(need, room(next));
    if (next && takeR > 0) {
      next.x0 += takeR;
      out[i].x1 += takeR;
    }
  }
  // Absorb leftover boring slivers into the longer neighbour. Never delete a feature.
  for (let i = 0; i < out.length; ) {
    const w = out[i].x1 - out[i].x0;
    if (isFeature(out[i].biome) || w >= minW || out.length === 1) {
      i++;
      continue;
    }
    const prev = out[i - 1];
    const next = out[i + 1];
    if (prev && (!next || prev.x1 - prev.x0 >= (next.x1 - next.x0))) {
      prev.x1 = out[i].x1;
      out.splice(i, 1);
    } else if (next) {
      next.x0 = out[i].x0;
      out.splice(i, 1);
    } else {
      i++;
    }
  }
  // A river the track follows for kilometres is a valley with one crossing, not a lake.
  const final: GeoSegment[] = [];
  for (const s of mergeFamilies(out.filter((s) => s.x1 - s.x0 > 40))) {
    const w = s.x1 - s.x0;
    if (s.biome !== 'river' || w <= 1600) {
      final.push(s);
      continue;
    }
    const mid = (s.x0 + s.x1) / 2;
    const valley = { biome: 'farmland' as const, name: `${s.name} valley` };
    final.push({ ...valley, x0: s.x0, x1: mid - 380 });
    final.push({ ...s, x0: mid - 380, x1: mid + 380 });
    final.push({ ...valley, x0: mid + 380, x1: s.x1 });
  }
  return mergeFamilies(final);
}

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Network cities the great-circle passes within `maxKm` of, with route fraction t (0 = origin).
 * Endpoints and anything hugging the airports are skipped.
 */
export function corridorFlyovers(fromIata: string, toIata: string, maxKm = 90): { iata: string; t: number; km: number }[] {
  const from = airportByIata(fromIata);
  const to = airportByIata(toIata);
  if (!from || !to) return [];
  const pts: [number, number][] = [];
  for (let i = 0; i <= SAMPLES; i++) pts.push(lerpGreatCircle(from.lon, from.lat, to.lon, to.lat, i / SAMPLES));
  const out: { iata: string; t: number; km: number }[] = [];
  for (const ap of AIRPORTS) {
    if (ap.iata === fromIata || ap.iata === toIata) continue;
    let best = Infinity;
    let bestT = 0;
    pts.forEach(([lon, lat], i) => {
      const d = haversineKm(lon, lat, ap.lon, ap.lat);
      if (d < best) {
        best = d;
        bestT = i / SAMPLES;
      }
    });
    if (best <= maxKm && bestT > 0.14 && bestT < 0.86) out.push({ iata: ap.iata, t: bestT, km: best });
  }
  out.sort((a, b) => a.t - b.t);
  // Two skylines on top of each other read as clutter — keep the closer one.
  return out.filter((f, i) => !out.some((g, j) => j !== i && Math.abs(g.t - f.t) < 0.12 && g.km < f.km));
}

/** Segments as route fractions t0..t1 (0 = origin, 1 = destination). */
export function corridorGeoFractions(
  fromIata: string,
  toIata: string,
): { t0: number; t1: number; biome: CorridorBiome; name: string }[] {
  const x0 = ORIGIN_PAD_END + PAD;
  const span = BASE_DEST_X0 - PAD - x0;
  return corridorGeoOnReference(fromIata, toIata).map((s) => ({
    t0: (s.x0 - x0) / span,
    t1: (s.x1 - x0) / span,
    biome: s.biome,
    name: s.name,
  }));
}

/** Same segments on the live corridor, linear in distance flown. */
export function corridorGeoSegments(fromIata: string, toIata: string, layout: CorridorLayout): GeoSegment[] {
  return corridorGeoFractions(fromIata, toIata).map((s) => ({
    x0: geoCorridorX(s.t0, layout),
    x1: geoCorridorX(s.t1, layout),
    biome: s.biome,
    name: s.name,
  }));
}

export function biomeCaption(biome: CorridorBiome): string {
  switch (biome) {
    case 'sea':
      return 'over water';
    case 'mountains':
      return 'peaks off the wing';
    case 'hills':
      return 'ridges below';
    case 'desert':
      return 'sand and haze';
    case 'forest':
    case 'taiga':
      return 'forest canopy';
    case 'tropical':
      return 'warm air below';
    case 'steppe':
      return 'open steppe';
    case 'tundra':
    case 'ice':
      return 'high latitude';
    case 'river':
      return 'following the river';
    default:
      return 'fields and towns';
  }
}
