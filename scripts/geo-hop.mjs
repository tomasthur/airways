import { corridorGeoOnReference } from '../src/meta/corridorGeo.ts';

for (const [a, b] of [
  ['PRG', 'LON'],
  ['VIE', 'NYC'],
  ['BTS', 'VIE'],
  ['ROM', 'CAI'],
  ['DXB', 'SIN'],
]) {
  const segs = corridorGeoOnReference(a, b);
  console.log(`\n${a} → ${b}`);
  for (const s of segs) {
    const km = ((s.x1 - s.x0) / (s.x1 > 0 ? 1 : 1)).toFixed(0);
    console.log(`  ${s.biome.padEnd(10)} ${String(s.x0.toFixed(0)).padStart(5)}–${String(s.x1.toFixed(0)).padStart(5)}  ${s.name}  (${km} m)`);
  }
}
