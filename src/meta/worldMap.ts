/**
 * World chart geometry for the hub: Natural Earth 110m land + country borders,
 * projected with Miller cylindrical into a 1000-unit-wide world plane.
 */
import type { MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { feature, mesh } from 'topojson-client';
import countriesTopo from 'world-atlas/countries-110m.json';

/** World plane width in SVG units (360° of longitude). */
export const WORLD_W = 1000;
const K = WORLD_W / 360;
const LAT_TOP = 82;
const LAT_BOTTOM = -58;

function millerY(lat: number): number {
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * phi)) * (180 / Math.PI);
}

const Y_TOP = millerY(LAT_TOP);

export const WORLD_H = (Y_TOP - millerY(LAT_BOTTOM)) * K;

export function projectLonLat(lon: number, lat: number): { x: number; y: number } {
  return { x: (lon + 180) * K, y: (Y_TOP - millerY(lat)) * K };
}

/** Rings → path; breaks at the antimeridian so nothing streaks across the chart. */
function ringsToPath(rings: Position[][], close: boolean): string {
  let d = '';
  for (const ring of rings) {
    if (ring.every(([, lat]) => lat < LAT_BOTTOM + 2)) continue;
    let prevLon: number | null = null;
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      const p = projectLonLat(lon, lat);
      const jump = prevLon !== null && Math.abs(lon - prevLon) > 180;
      d += `${i === 0 || jump ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      prevLon = lon;
    }
    if (close) d += 'Z';
  }
  return d;
}

const topo = countriesTopo as unknown as Topology<{
  countries: GeometryCollection;
  land: GeometryCollection;
}>;

/**
 * Filled rings must stay continuous: unwrap longitudes across ±180 and draw a
 * wrapped copy for the overhang (e.g. Chukotka), instead of splitting the ring.
 */
function polygonToPath(rings: Position[][]): string {
  let d = '';
  for (const ring of rings) {
    if (ring.every(([, lat]) => lat < LAT_BOTTOM + 2)) continue;
    const pts: Position[] = [];
    let offset = 0;
    let prev: number | null = null;
    for (const [lon, lat] of ring) {
      if (prev !== null) {
        if (lon - prev > 180) offset -= 360;
        else if (prev - lon > 180) offset += 360;
      }
      prev = lon;
      pts.push([lon + offset, lat]);
    }
    const lons = pts.map(([lon]) => lon);
    const shifts = [0];
    if (Math.min(...lons) < -180) shifts.push(360);
    if (Math.max(...lons) > 180) shifts.push(-360);
    for (const s of shifts) {
      pts.forEach(([lon, lat], i) => {
        const p = projectLonLat(lon + s, lat);
        d += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      });
      d += 'Z';
    }
  }
  return d;
}

function buildLandPath(): string {
  const land = feature(topo, topo.objects.land);
  let d = '';
  for (const f of land.features) {
    const g = f.geometry;
    if (g.type === 'Polygon') d += polygonToPath((g as Polygon).coordinates);
    else if (g.type === 'MultiPolygon') for (const poly of (g as MultiPolygon).coordinates) d += polygonToPath(poly);
  }
  return d;
}

function buildBorderPath(): string {
  const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b) as MultiLineString;
  return ringsToPath(borders.coordinates, false);
}

export const LAND_PATH = buildLandPath();
export const BORDER_PATH = buildBorderPath();
