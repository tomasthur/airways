import { type Landmark, type Runway } from '../config';
import { airportByIata, routeKey } from './airports';
import { biomeCaption, corridorFlyovers, corridorGeoFractions } from './corridorGeo';
import { distanceKm } from './economy';
import {
  BASE_DEST_X0,
  BASE_DEST_X1,
  corridorLayout,
  geoCorridorX,
  ORIGIN_PAD_END,
  REFERENCE_LAYOUT,
  remapCorridorX,
  type CorridorLayout,
  type CorridorPerformance,
} from './flightLength';

/** Authored reference pads; {@link layoutRoute} places them for the flown hop and aircraft. */
const ORIGIN = { x0: 0, x1: ORIGIN_PAD_END } as const;
const DEST = { x0: BASE_DEST_X0, x1: BASE_DEST_X1 } as const;

/** Mid-corridor set dressing shared by both directions of a hop. */
export type SceneryTheme =
  | 'danubeWest'
  | 'danubeEast'
  | 'pannonian'
  | 'bohemian'
  | 'carpathian'
  | 'vistula'
  | 'channelSea'
  | 'atlanticOcean'
  | 'mediterranean'
  | 'alpine'
  | 'continental'
  | 'desertApproaches'
  | 'pacificRim';

export interface FlightRoute {
  id: string;
  from: string;
  to: string;
  origin: Runway;
  dest: Runway;
  /** Reciprocal numbers painted on the far runway ends in the world (visual only). */
  originReciprocal: string;
  destReciprocal: string;
  /** Visual corridor flavour (cities, water, hills) — independent of HUD landmarks. */
  scenery: SceneryTheme;
  landmarks: Landmark[];
  brief: string;
  welcomeTitle: string;
  welcomeMessage: string;
  /** Live corridor the runways and landmarks were placed on (reference layout for authored routes). */
  layout: CorridorLayout;
}

function rw(code: string, designator: string, slot: { x0: number; x1: number }): Runway {
  return { code, designator, x0: slot.x0, x1: slot.x1 };
}

/** Place an authored route on the corridor for this aircraft (runway lengths, cruise speed). */
export function layoutRoute(route: FlightRoute, perf: CorridorPerformance): FlightRoute {
  const layout = corridorLayout(distanceKm(route.from, route.to), perf);
  return {
    ...route,
    layout,
    origin: { ...route.origin, x0: 0, x1: layout.originEnd },
    dest: { ...route.dest, x0: layout.destX0, x1: layout.destX1 },
    landmarks: route.landmarks.map((l) =>
      l.geo
        ? { ...l, geo: false, x0: geoCorridorX(l.x0, layout), x1: geoCorridorX(l.x1, layout) }
        : { ...l, x0: remapCorridorX(l.x0, layout), x1: remapCorridorX(l.x1, layout) },
    ),
  };
}

const BTS_VIE_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'M. R. Štefánik Airport', subtitle: 'Bratislava · BTS' },
  { x0: 2500, x1: 3550, title: 'Petržalka', subtitle: 'Bratislava' },
  { x0: 3560, x1: 4060, title: 'SNP Bridge & the UFO', subtitle: 'over the Danube' },
  { x0: 4060, x1: 4700, title: 'Bratislava Castle', subtitle: 'and St. Martin’s Cathedral' },
  { x0: 4700, x1: 5500, title: 'Kamzík TV Tower', subtitle: 'Little Carpathians' },
  { x0: 6100, x1: 7700, title: 'Parndorf Plain', subtitle: 'Burgenland wind farms' },
  { x0: 8700, x1: 9450, title: 'Vienna skyline', subtitle: 'Donaustadt & DC Tower' },
  { x0: 9450, x1: 9870, title: 'St. Stephen’s Cathedral', subtitle: 'Stephansdom · Innere Stadt' },
  { x0: 9870, x1: 10250, title: 'Danube Canal', subtitle: 'Donaukanal' },
  { x0: 10250, x1: 10900, title: 'Wiener Riesenrad', subtitle: 'Prater' },
  { x0: 11100, x1: 13700, title: 'Vienna International Airport', subtitle: 'Schwechat · VIE' },
];

const VIE_BTS_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Vienna International Airport', subtitle: 'Schwechat · VIE' },
  { x0: 2500, x1: 4000, title: 'Wiener Becken', subtitle: 'leaving the capital' },
  { x0: 4500, x1: 6200, title: 'Parndorf Plain', subtitle: 'Burgenland' },
  { x0: 6500, x1: 7800, title: 'Little Carpathians', subtitle: 'ahead to the east' },
  { x0: 8000, x1: 9200, title: 'Bratislava skyline', subtitle: 'Castle & UFO bridge' },
  { x0: 9400, x1: 10500, title: 'Petržalka', subtitle: 'southern districts' },
  { x0: 11100, x1: 13700, title: 'M. R. Štefánik Airport', subtitle: 'Bratislava · BTS' },
];

const BTS_BUD_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'M. R. Štefánik Airport', subtitle: 'Bratislava · BTS' },
  { x0: 2500, x1: 3800, title: 'Danube corridor', subtitle: 'southeast toward Hungary' },
  { x0: 4200, x1: 5600, title: 'Žitný ostrov', subtitle: 'farmland & side channels' },
  { x0: 6000, x1: 7600, title: 'Győr approaches', subtitle: 'north-west Hungary' },
  { x0: 8000, x1: 9600, title: 'Danube Bend ahead', subtitle: 'hills above the river' },
  { x0: 9800, x1: 10800, title: 'Budapest outskirts', subtitle: 'Buda hills on the right' },
  { x0: 11100, x1: 13700, title: 'Budapest Airport', subtitle: 'Ferenc Liszt · BUD' },
];

const BUD_BTS_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Budapest Airport', subtitle: 'Ferenc Liszt · BUD' },
  { x0: 2500, x1: 4200, title: 'Leaving Pest', subtitle: 'north-west bound' },
  { x0: 4800, x1: 6600, title: 'Győr region', subtitle: 'cross-border lowlands' },
  { x0: 7200, x1: 9000, title: 'Žitný ostrov', subtitle: 'Slovak farmland' },
  { x0: 9400, x1: 10600, title: 'Bratislava ahead', subtitle: 'Castle ridge in sight' },
  { x0: 11100, x1: 13700, title: 'M. R. Štefánik Airport', subtitle: 'Bratislava · BTS' },
];

const VIE_BUD_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Vienna International Airport', subtitle: 'Schwechat · VIE' },
  { x0: 2600, x1: 4200, title: 'Marchfeld', subtitle: 'east of Vienna' },
  { x0: 4800, x1: 6400, title: 'Toward Győr', subtitle: 'crossing into Hungary' },
  { x0: 7000, x1: 8800, title: 'Transdanubian hills', subtitle: 'late afternoon light' },
  { x0: 9200, x1: 10600, title: 'Budapest approaches', subtitle: 'city haze on the horizon' },
  { x0: 11100, x1: 13700, title: 'Budapest Airport', subtitle: 'Ferenc Liszt · BUD' },
];

const BUD_VIE_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Budapest Airport', subtitle: 'Ferenc Liszt · BUD' },
  { x0: 2600, x1: 4400, title: 'Westbound', subtitle: 'toward Austria' },
  { x0: 5000, x1: 6800, title: 'Győr corridor', subtitle: 'motorway & river fog' },
  { x0: 7400, x1: 9200, title: 'Marchfeld', subtitle: 'Austrian lowlands' },
  { x0: 9600, x1: 10800, title: 'Vienna skyline', subtitle: 'city from the east' },
  { x0: 11100, x1: 13700, title: 'Vienna International Airport', subtitle: 'Schwechat · VIE' },
];

const BTS_PRG_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'M. R. Štefánik Airport', subtitle: 'Bratislava · BTS' },
  { x0: 2500, x1: 4200, title: 'Morava valley', subtitle: 'northwest into Czechia' },
  { x0: 4800, x1: 6800, title: 'Bohemian farmland', subtitle: 'fields and villages' },
  { x0: 7400, x1: 9200, title: 'Central Bohemia', subtitle: 'rolling hills ahead' },
  { x0: 9600, x1: 10800, title: 'Prague approaches', subtitle: 'city haze on the horizon' },
  { x0: 11100, x1: 13700, title: 'Václav Havel Airport', subtitle: 'Prague · PRG' },
];

const PRG_BTS_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Václav Havel Airport', subtitle: 'Prague · PRG' },
  { x0: 2600, x1: 4400, title: 'Leaving Bohemia', subtitle: 'southeast bound' },
  { x0: 5000, x1: 7200, title: 'Morava corridor', subtitle: 'toward Slovakia' },
  { x0: 8000, x1: 10000, title: 'Little Carpathians ahead', subtitle: 'Bratislava ridge' },
  { x0: 11100, x1: 13700, title: 'M. R. Štefánik Airport', subtitle: 'Bratislava · BTS' },
];

const VIE_PRG_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Vienna International Airport', subtitle: 'Schwechat · VIE' },
  { x0: 2600, x1: 4200, title: 'Weinviertel', subtitle: 'north of Vienna' },
  { x0: 4800, x1: 6800, title: 'Crossing into Czechia', subtitle: 'border lowlands' },
  { x0: 7400, x1: 9400, title: 'Bohemian Basin', subtitle: 'afternoon light' },
  { x0: 9800, x1: 10800, title: 'Prague outskirts', subtitle: 'Vltava valley ahead' },
  { x0: 11100, x1: 13700, title: 'Václav Havel Airport', subtitle: 'Prague · PRG' },
];

const PRG_VIE_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Václav Havel Airport', subtitle: 'Prague · PRG' },
  { x0: 2600, x1: 4500, title: 'Southbound Bohemia', subtitle: 'toward Austria' },
  { x0: 5200, x1: 7200, title: 'Border country', subtitle: 'fields and wind farms' },
  { x0: 8000, x1: 10000, title: 'Vienna ahead', subtitle: 'Danube plain opening' },
  { x0: 11100, x1: 13700, title: 'Vienna International Airport', subtitle: 'Schwechat · VIE' },
];

const BTS_KRK_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'M. R. Štefánik Airport', subtitle: 'Bratislava · BTS' },
  { x0: 2500, x1: 4200, title: 'Váh corridor', subtitle: 'northeast toward Poland' },
  { x0: 4800, x1: 7000, title: 'Carpathian foothills', subtitle: 'ridges on the right' },
  { x0: 7600, x1: 9600, title: 'Southern Poland', subtitle: 'farmland after the hills' },
  { x0: 10000, x1: 10800, title: 'Kraków approaches', subtitle: 'Vistula bend ahead' },
  { x0: 11100, x1: 13700, title: 'Kraków Airport', subtitle: 'John Paul II · KRK' },
];

const KRK_BTS_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Kraków Airport', subtitle: 'John Paul II · KRK' },
  { x0: 2600, x1: 4600, title: 'Leaving Małopolska', subtitle: 'southwest bound' },
  { x0: 5200, x1: 7400, title: 'Carpathian foothills', subtitle: 'cross-border ridges' },
  { x0: 8200, x1: 10200, title: 'Slovak lowlands', subtitle: 'Bratislava ahead' },
  { x0: 11100, x1: 13700, title: 'M. R. Štefánik Airport', subtitle: 'Bratislava · BTS' },
];

const BUD_KRK_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Budapest Airport', subtitle: 'Ferenc Liszt · BUD' },
  { x0: 2600, x1: 4500, title: 'North from Pest', subtitle: 'toward Slovakia' },
  { x0: 5200, x1: 7400, title: 'Carpathian approaches', subtitle: 'foothills building' },
  { x0: 8200, x1: 10000, title: 'Polish borderlands', subtitle: 'fields after the ridges' },
  { x0: 11100, x1: 13700, title: 'Kraków Airport', subtitle: 'John Paul II · KRK' },
];

const KRK_BUD_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Kraków Airport', subtitle: 'John Paul II · KRK' },
  { x0: 2600, x1: 4600, title: 'Southbound', subtitle: 'toward Hungary' },
  { x0: 5200, x1: 7400, title: 'Carpathian corridor', subtitle: 'ridges and valleys' },
  { x0: 8200, x1: 10200, title: 'Hungarian plain ahead', subtitle: 'Danube basin opening' },
  { x0: 11100, x1: 13700, title: 'Budapest Airport', subtitle: 'Ferenc Liszt · BUD' },
];

const KRK_WAW_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Kraków Airport', subtitle: 'John Paul II · KRK' },
  { x0: 2600, x1: 4500, title: 'Vistula upstream', subtitle: 'north toward the capital' },
  { x0: 5200, x1: 7400, title: 'Polish lowlands', subtitle: 'farmland and river fog' },
  { x0: 8200, x1: 10000, title: 'Mazovia', subtitle: 'Warsaw haze ahead' },
  { x0: 11100, x1: 13700, title: 'Warsaw Chopin', subtitle: 'WAW' },
];

const WAW_KRK_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Warsaw Chopin', subtitle: 'WAW' },
  { x0: 2600, x1: 4600, title: 'Leaving Mazovia', subtitle: 'southbound' },
  { x0: 5200, x1: 7400, title: 'Vistula country', subtitle: 'fields and side channels' },
  { x0: 8200, x1: 10200, title: 'Małopolska ahead', subtitle: 'Kraków ridge in sight' },
  { x0: 11100, x1: 13700, title: 'Kraków Airport', subtitle: 'John Paul II · KRK' },
];

const WAW_PRG_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Warsaw Chopin', subtitle: 'WAW' },
  { x0: 2600, x1: 4500, title: 'Westbound Poland', subtitle: 'toward Czechia' },
  { x0: 5200, x1: 7400, title: 'Silesian corridor', subtitle: 'industry and farmland' },
  { x0: 8200, x1: 10000, title: 'Bohemia ahead', subtitle: 'Prague approaches' },
  { x0: 11100, x1: 13700, title: 'Václav Havel Airport', subtitle: 'Prague · PRG' },
];

const PRG_WAW_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Václav Havel Airport', subtitle: 'Prague · PRG' },
  { x0: 2600, x1: 4600, title: 'East from Bohemia', subtitle: 'toward Poland' },
  { x0: 5200, x1: 7400, title: 'Border hills', subtitle: 'then open plain' },
  { x0: 8200, x1: 10200, title: 'Central Poland', subtitle: 'Warsaw on the nose' },
  { x0: 11100, x1: 13700, title: 'Warsaw Chopin', subtitle: 'WAW' },
];

const BTS_WAW_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'M. R. Štefánik Airport', subtitle: 'Bratislava · BTS' },
  { x0: 2500, x1: 4500, title: 'North-east corridor', subtitle: 'toward Poland' },
  { x0: 5200, x1: 7400, title: 'Carpathian foothills', subtitle: 'then Polish plain' },
  { x0: 8200, x1: 10200, title: 'Mazovia', subtitle: 'Warsaw haze ahead' },
  { x0: 11100, x1: 13700, title: 'Warsaw Chopin', subtitle: 'WAW' },
];

const WAW_BTS_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Warsaw Chopin', subtitle: 'WAW' },
  { x0: 2600, x1: 4600, title: 'South-west Poland', subtitle: 'toward Slovakia' },
  { x0: 5200, x1: 7400, title: 'Foothills ahead', subtitle: 'Carpathian ridges' },
  { x0: 8200, x1: 10200, title: 'Slovak lowlands', subtitle: 'Bratislava ahead' },
  { x0: 11100, x1: 13700, title: 'M. R. Štefánik Airport', subtitle: 'Bratislava · BTS' },
];

const VIE_KRK_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Vienna International Airport', subtitle: 'Schwechat · VIE' },
  { x0: 2600, x1: 4500, title: 'North-east from Vienna', subtitle: 'toward Poland' },
  { x0: 5200, x1: 7400, title: 'Carpathian approaches', subtitle: 'ridges building' },
  { x0: 8200, x1: 10200, title: 'Małopolska', subtitle: 'Kraków ahead' },
  { x0: 11100, x1: 13700, title: 'Kraków Airport', subtitle: 'John Paul II · KRK' },
];

const KRK_VIE_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Kraków Airport', subtitle: 'John Paul II · KRK' },
  { x0: 2600, x1: 4600, title: 'South-west bound', subtitle: 'toward Austria' },
  { x0: 5200, x1: 7400, title: 'Foothills and plain', subtitle: 'leaving Poland' },
  { x0: 8200, x1: 10200, title: 'Vienna ahead', subtitle: 'Danube basin' },
  { x0: 11100, x1: 13700, title: 'Vienna International Airport', subtitle: 'Schwechat · VIE' },
];

const VIE_WAW_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Vienna International Airport', subtitle: 'Schwechat · VIE' },
  { x0: 2600, x1: 4500, title: 'Long haul north', subtitle: 'across Central Europe' },
  { x0: 5200, x1: 7400, title: 'Polish approaches', subtitle: 'open farmland' },
  { x0: 8200, x1: 10200, title: 'Mazovia', subtitle: 'capital on the horizon' },
  { x0: 11100, x1: 13700, title: 'Warsaw Chopin', subtitle: 'WAW' },
];

const WAW_VIE_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Warsaw Chopin', subtitle: 'WAW' },
  { x0: 2600, x1: 4600, title: 'South toward Austria', subtitle: 'long visual leg' },
  { x0: 5200, x1: 7400, title: 'Central corridor', subtitle: 'fields and haze' },
  { x0: 8200, x1: 10200, title: 'Vienna ahead', subtitle: 'Danube plain' },
  { x0: 11100, x1: 13700, title: 'Vienna International Airport', subtitle: 'Schwechat · VIE' },
];

const BUD_WAW_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Budapest Airport', subtitle: 'Ferenc Liszt · BUD' },
  { x0: 2600, x1: 4500, title: 'North from Hungary', subtitle: 'toward Warsaw' },
  { x0: 5200, x1: 7400, title: 'Carpathian fringe', subtitle: 'then Polish plain' },
  { x0: 8200, x1: 10200, title: 'Mazovia', subtitle: 'Chopin ahead' },
  { x0: 11100, x1: 13700, title: 'Warsaw Chopin', subtitle: 'WAW' },
];

const WAW_BUD_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Warsaw Chopin', subtitle: 'WAW' },
  { x0: 2600, x1: 4600, title: 'South to Hungary', subtitle: 'long visual leg' },
  { x0: 5200, x1: 7400, title: 'Crossing the ridges', subtitle: 'Carpathian fringe' },
  { x0: 8200, x1: 10200, title: 'Hungarian plain', subtitle: 'Budapest ahead' },
  { x0: 11100, x1: 13700, title: 'Budapest Airport', subtitle: 'Ferenc Liszt · BUD' },
];

const BUD_PRG_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Budapest Airport', subtitle: 'Ferenc Liszt · BUD' },
  { x0: 2600, x1: 4500, title: 'North-west', subtitle: 'toward Bohemia' },
  { x0: 5200, x1: 7400, title: 'Morava country', subtitle: 'border farmland' },
  { x0: 8200, x1: 10200, title: 'Bohemian Basin', subtitle: 'Prague approaches' },
  { x0: 11100, x1: 13700, title: 'Václav Havel Airport', subtitle: 'Prague · PRG' },
];

const PRG_BUD_LANDMARKS: Landmark[] = [
  { x0: 200, x1: 1500, title: 'Václav Havel Airport', subtitle: 'Prague · PRG' },
  { x0: 2600, x1: 4600, title: 'South-east Bohemia', subtitle: 'toward Hungary' },
  { x0: 5200, x1: 7400, title: 'Morava corridor', subtitle: 'cross-border fields' },
  { x0: 8200, x1: 10200, title: 'Danube basin ahead', subtitle: 'Budapest haze' },
  { x0: 11100, x1: 13700, title: 'Budapest Airport', subtitle: 'Ferenc Liszt · BUD' },
];

function hop(
  from: string,
  to: string,
  fromDes: string,
  toDes: string,
  fromRecip: string,
  toRecip: string,
  scenery: SceneryTheme,
  landmarks: Landmark[],
  brief: string,
  welcomeTitle: string,
  welcomeMessage: string,
): FlightRoute {
  return {
    id: routeKey(from, to),
    from,
    to,
    origin: rw(from, fromDes, ORIGIN),
    dest: rw(to, toDes, DEST),
    originReciprocal: fromRecip,
    destReciprocal: toRecip,
    scenery,
    landmarks,
    brief,
    welcomeTitle,
    welcomeMessage,
    layout: REFERENCE_LAYOUT,
  };
}

/** Undirected corridor flavour for a from/to pair. */
export function sceneryThemeFor(from: string, to: string): SceneryTheme {
  const key = [from, to].sort().join('-');
  if (key === 'BTS-VIE') return 'danubeWest';
  if (key === 'BTS-BUD') return 'danubeEast';
  if (key === 'BUD-VIE') return 'pannonian';
  if (key === 'BTS-PRG' || key === 'PRG-VIE' || key === 'BUD-PRG') return 'bohemian';
  if (key === 'BTS-KRK' || key === 'BUD-KRK' || key === 'KRK-VIE') return 'carpathian';
  if (key === 'BTS-WAW' || key === 'KRK-WAW' || key === 'PRG-WAW' || key === 'VIE-WAW' || key === 'BUD-WAW') return 'vistula';

  const a = airportByIata(from);
  const b = airportByIata(to);
  const pair = new Set([from, to]);
  const regions = new Set([a?.region, b?.region]);

  // Transatlantic first so LON–NYC is not classified as Channel
  if (regions.has('americas') && (regions.has('europe') || regions.has('ce') || pair.has('LIS') || pair.has('LON') || pair.has('PAR') || pair.has('MAD') || pair.has('AMS'))) {
    return 'atlanticOcean';
  }
  if (pair.has('NYC') || (pair.has('MIA') && regions.has('europe'))) return 'atlanticOcean';

  // English Channel / North Sea hops into Britain & Ireland from the continent
  if (
    (pair.has('LON') || pair.has('DUB')) &&
    !regions.has('americas') &&
    !regions.has('asia') &&
    !regions.has('oceania') &&
    !regions.has('mena')
  ) {
    return 'channelSea';
  }

  // Med
  if (pair.has('ROM') || pair.has('ATH') || (pair.has('CAI') && (pair.has('ROM') || pair.has('ATH') || pair.has('IST')))) {
    return 'mediterranean';
  }

  // Alps
  if (pair.has('MUC') || pair.has('ZRH') || pair.has('MIL')) {
    if (regions.has('ce') || pair.has('VIE') || pair.has('MIL') || pair.has('ZRH') || pair.has('MUC')) return 'alpine';
  }

  // Desert / Gulf
  if (pair.has('DXB') || (pair.has('CAI') && pair.has('DXB'))) return 'desertApproaches';

  // Pacific / Asia long legs
  if (regions.has('asia') || regions.has('oceania') || pair.has('LAX') || pair.has('SFO') || pair.has('TYO') || pair.has('SIN') || pair.has('SYD') || pair.has('HKG')) {
    if (regions.has('americas') || regions.has('asia') || regions.has('oceania') || regions.has('mena')) return 'pacificRim';
  }

  return 'continental';
}

/** HUD captions for procedurally added world hops — follow the sampled geography. */
function corridorLandmarks(from: string, to: string, _theme: SceneryTheme): Landmark[] {
  const A = airportByIata(from)!;
  const B = airportByIata(to)!;
  const geo = corridorGeoFractions(from, to).filter((s) => s.t1 - s.t0 > 0.04);
  const marks: Landmark[] = [
    { x0: 200, x1: 1500, title: A.name, subtitle: `${A.city} · ${A.iata}` },
    { x0: 2200, x1: 3800, title: cityDepartureCaption(A.iata), subtitle: A.city },
  ];
  const enRoute: Landmark[] = geo.map((s) => ({
    x0: s.t0,
    x1: s.t1,
    title: s.name,
    subtitle: biomeCaption(s.biome),
    geo: true,
  }));
  for (const f of corridorFlyovers(from, to)) {
    const city = airportByIata(f.iata);
    if (!city) continue;
    const w = 0.035;
    // A city callout takes over the generic region caption for its stretch.
    for (const m of enRoute) {
      if (m.x0 < f.t - w && m.x1 > f.t + w) {
        enRoute.push({ ...m, x0: f.t + w });
        m.x1 = f.t - w;
      } else if (m.x0 < f.t + w && m.x1 > f.t - w) {
        if (m.x0 < f.t - w) m.x1 = f.t - w;
        else m.x0 = f.t + w;
      }
    }
    enRoute.push({
      x0: f.t - w,
      x1: f.t + w,
      title: `${f.km < 35 ? 'Over' : 'Passing'} ${city.city}`,
      subtitle: f.km < 35 ? cityArrivalCaption(f.iata) : `${Math.round(f.km)} km off the wing`,
      geo: true,
    });
  }
  marks.push(...enRoute.filter((m) => m.x1 - m.x0 > 0.02).sort((a, b) => a.x0 - b.x0));
  if (marks.length < 3) {
    marks.push({ x0: 0.1, x1: 0.9, title: 'En route', subtitle: 'cruise altitude', geo: true });
  }
  marks.push({ x0: 9800, x1: 11000, title: cityArrivalCaption(B.iata), subtitle: B.city });
  marks.push({ x0: 11100, x1: 13700, title: B.name, subtitle: `${B.city} · ${B.iata}` });
  return marks;
}

function cityDepartureCaption(iata: string): string {
  return `Leaving ${airportByIata(iata)?.city ?? iata}`;
}

function cityArrivalCaption(iata: string): string {
  switch (iata) {
    case 'BTS':
      return 'SNP Bridge & Castle';
    case 'VIE':
      return 'Stephansdom & Prater';
    case 'BUD':
      return 'Parliament & Chain Bridge';
    case 'PRG':
      return 'Castle & Charles Bridge';
    case 'KRK':
      return 'Wawel on the hill';
    case 'WAW':
      return 'Palace of Culture';
    case 'MUC':
      return 'Frauenkirche towers';
    case 'BER':
      return 'Brandenburg & TV tower';
    case 'AMS':
      return 'Canals & gables';
    case 'MAD':
      return 'Palacio skyline';
    case 'MIL':
      return 'Duomo spires';
    case 'ZRH':
      return 'Grossmünster & the lake';
    case 'IST':
      return 'Hagia Sophia & minarets';
    case 'ATH':
      return 'Acropolis on the hill';
    case 'LIS':
      return '25 de Abril Bridge';
    case 'DUB':
      return 'The Spire';
    case 'LON':
      return 'Thames & City skyline';
    case 'NYC':
      return 'Manhattan & Lady Liberty';
    case 'ROM':
      return 'Colosseum & St Peter’s';
    case 'PAR':
      return 'Tour Eiffel district';
    case 'MIA':
      return 'Art-deco waterfront';
    case 'SYD':
      return 'Opera House & Harbour Bridge';
    case 'SFO':
      return 'Golden Gate';
    case 'LAX':
      return 'Hollywood hills';
    case 'DXB':
      return 'Burj Khalifa';
    case 'CAI':
      return 'Pyramids of Giza';
    case 'TYO':
      return 'Skytree & Tokyo Tower';
    case 'SIN':
      return 'Marina Bay Sands';
    case 'HKG':
      return 'Victoria Harbour towers';
    default:
      return 'City skyline';
  }
}

function autoHop(from: string, to: string): FlightRoute {
  const A = airportByIata(from)!;
  const B = airportByIata(to)!;
  const scenery = sceneryThemeFor(from, to);
  return hop(
    from,
    to,
    '27',
    '09',
    '09',
    '27',
    scenery,
    corridorLandmarks(from, to, scenery),
    `${A.city} → ${B.city}. ${B.brief ?? 'File the visual and keep the PAPI honest.'}`,
    `Welcome to ${B.city}`,
    `Flight OM-BTV has landed at ${B.name}.`,
  );
}

/** Undirected world network edges beyond the hand-authored CE mesh. */
const WORLD_LINKS: [string, string][] = [
  // CE ↔ near Europe
  ['VIE', 'MUC'],
  ['PRG', 'MUC'],
  ['VIE', 'ZRH'],
  ['VIE', 'MIL'],
  ['BUD', 'MIL'],
  ['VIE', 'BER'],
  ['PRG', 'BER'],
  ['WAW', 'BER'],
  ['VIE', 'AMS'],
  ['PRG', 'AMS'],
  ['VIE', 'LON'],
  ['PRG', 'LON'],
  ['MUC', 'LON'],
  ['BUD', 'LON'],
  ['BTS', 'LON'],
  ['KRK', 'LON'],
  ['WAW', 'LON'],
  ['VIE', 'PAR'],
  ['MUC', 'PAR'],
  ['VIE', 'ROM'],
  ['BUD', 'ROM'],
  ['MIL', 'ROM'],
  ['VIE', 'MAD'],
  ['VIE', 'IST'],
  ['BUD', 'IST'],
  ['ROM', 'ATH'],
  ['IST', 'ATH'],
  ['MAD', 'LIS'],
  ['LON', 'DUB'],
  ['AMS', 'DUB'],
  // Europe web
  ['LON', 'PAR'],
  ['LON', 'AMS'],
  ['LON', 'BER'],
  ['LON', 'ROM'],
  ['LON', 'MAD'],
  ['LON', 'LIS'],
  ['PAR', 'ROM'],
  ['PAR', 'MAD'],
  ['PAR', 'AMS'],
  ['PAR', 'LIS'],
  ['BER', 'AMS'],
  ['ZRH', 'MIL'],
  ['ZRH', 'MUC'],
  ['AMS', 'BER'],
  // MENA bridges
  ['IST', 'DXB'],
  ['ATH', 'CAI'],
  ['ROM', 'CAI'],
  ['CAI', 'DXB'],
  ['LON', 'DXB'],
  // Atlantic
  ['LON', 'NYC'],
  ['PAR', 'NYC'],
  ['AMS', 'NYC'],
  ['MAD', 'NYC'],
  ['LIS', 'NYC'],
  ['DUB', 'NYC'],
  ['NYC', 'MIA'],
  ['NYC', 'LAX'],
  ['MIA', 'LAX'],
  ['LAX', 'SFO'],
  // Pacific / Asia
  ['DXB', 'SIN'],
  ['DXB', 'HKG'],
  ['SIN', 'TYO'],
  ['SIN', 'SYD'],
  ['SIN', 'HKG'],
  ['HKG', 'TYO'],
  ['TYO', 'LAX'],
  ['TYO', 'SFO'],
  ['SYD', 'HKG'],
  ['LAX', 'TYO'],
  ['SFO', 'TYO'],
];

/** Directed hops across the Central Europe network. */
export const ROUTES: FlightRoute[] = [
  hop('BTS', 'VIE', '31', '29', '13', '11', 'danubeWest', BTS_VIE_LANDMARKS, 'Short hop over the Danube and Parndorf plain. Land runway 29 with the PAPI.', 'Welcome to Vienna', 'Flight OM-BTV has landed at Vienna International Airport.'),
  hop('VIE', 'BTS', '11', '13', '29', '31', 'danubeWest', VIE_BTS_LANDMARKS, 'Return east across Burgenland. Land runway 13 at Bratislava.', 'Welcome to Bratislava', 'Flight OM-BTV has landed at M. R. Štefánik Airport.'),
  hop('BTS', 'BUD', '31', '31R', '13', '13L', 'danubeEast', BTS_BUD_LANDMARKS, 'Southeast along the Danube toward Ferenc Liszt. Watch speed on final.', 'Welcome to Budapest', 'Flight OM-BTV has landed at Budapest Ferenc Liszt International Airport.'),
  hop('BUD', 'BTS', '13L', '13', '31R', '31', 'danubeEast', BUD_BTS_LANDMARKS, 'Northwest back to Bratislava. Little Carpathians on the nose.', 'Welcome to Bratislava', 'Flight OM-BTV has landed at M. R. Štefánik Airport.'),
  hop('VIE', 'BUD', '11', '31R', '29', '13L', 'pannonian', VIE_BUD_LANDMARKS, 'Eastbound Vienna–Budapest. Cross the border and settle onto 31R.', 'Welcome to Budapest', 'Flight OM-BTV has landed at Budapest Ferenc Liszt International Airport.'),
  hop('BUD', 'VIE', '13L', '29', '31R', '11', 'pannonian', BUD_VIE_LANDMARKS, 'West to Schwechat. Pick up the PAPI for runway 29.', 'Welcome to Vienna', 'Flight OM-BTV has landed at Vienna International Airport.'),

  hop('BTS', 'PRG', '31', '24', '13', '06', 'bohemian', BTS_PRG_LANDMARKS, 'Northwest into Bohemia. Ease power in cruise and watch CHT.', 'Welcome to Prague', 'Flight OM-BTV has landed at Václav Havel Airport Prague.'),
  hop('PRG', 'BTS', '06', '13', '24', '31', 'bohemian', PRG_BTS_LANDMARKS, 'Southeast home to Bratislava across the Morava valley.', 'Welcome to Bratislava', 'Flight OM-BTV has landed at M. R. Štefánik Airport.'),
  hop('VIE', 'PRG', '11', '24', '29', '06', 'bohemian', VIE_PRG_LANDMARKS, 'North from Schwechat into Czechia. Plan an early descent.', 'Welcome to Prague', 'Flight OM-BTV has landed at Václav Havel Airport Prague.'),
  hop('PRG', 'VIE', '06', '29', '24', '11', 'bohemian', PRG_VIE_LANDMARKS, 'South to Vienna. Pick up the PAPI for runway 29.', 'Welcome to Vienna', 'Flight OM-BTV has landed at Vienna International Airport.'),

  hop('BTS', 'KRK', '31', '25', '13', '07', 'carpathian', BTS_KRK_LANDMARKS, 'Northeast over Carpathian foothills into Kraków.', 'Welcome to Kraków', 'Flight OM-BTV has landed at Kraków John Paul II International Airport.'),
  hop('KRK', 'BTS', '07', '13', '25', '31', 'carpathian', KRK_BTS_LANDMARKS, 'Southwest back to Bratislava. Expect bumps over the ridges.', 'Welcome to Bratislava', 'Flight OM-BTV has landed at M. R. Štefánik Airport.'),
  hop('BUD', 'KRK', '13L', '25', '31R', '07', 'carpathian', BUD_KRK_LANDMARKS, 'North from Budapest toward Kraków across the foothills.', 'Welcome to Kraków', 'Flight OM-BTV has landed at Kraków John Paul II International Airport.'),
  hop('KRK', 'BUD', '07', '31R', '25', '13L', 'carpathian', KRK_BUD_LANDMARKS, 'South to Ferenc Liszt. Watch speed on final.', 'Welcome to Budapest', 'Flight OM-BTV has landed at Budapest Ferenc Liszt International Airport.'),

  hop('KRK', 'WAW', '25', '33', '07', '15', 'vistula', KRK_WAW_LANDMARKS, 'North along the Vistula corridor into Warsaw.', 'Welcome to Warsaw', 'Flight OM-BTV has landed at Warsaw Chopin Airport.'),
  hop('WAW', 'KRK', '15', '07', '33', '25', 'vistula', WAW_KRK_LANDMARKS, 'South to Kraków. Keep wings level in the bumps.', 'Welcome to Kraków', 'Flight OM-BTV has landed at Kraków John Paul II International Airport.'),
  hop('WAW', 'PRG', '15', '24', '33', '06', 'vistula', WAW_PRG_LANDMARKS, 'West toward Prague across Silesia and Bohemia.', 'Welcome to Prague', 'Flight OM-BTV has landed at Václav Havel Airport Prague.'),
  hop('PRG', 'WAW', '06', '33', '24', '15', 'vistula', PRG_WAW_LANDMARKS, 'East to Warsaw Chopin. Settle early onto the glide.', 'Welcome to Warsaw', 'Flight OM-BTV has landed at Warsaw Chopin Airport.'),

  // Direct links so PRG / KRK / WAW open from every triangle base.
  hop('BTS', 'WAW', '31', '33', '13', '15', 'vistula', BTS_WAW_LANDMARKS, 'Long north-east leg to Warsaw Chopin. Manage power and CHT.', 'Welcome to Warsaw', 'Flight OM-BTV has landed at Warsaw Chopin Airport.'),
  hop('WAW', 'BTS', '15', '13', '33', '31', 'vistula', WAW_BTS_LANDMARKS, 'South-west home to Bratislava across the foothills.', 'Welcome to Bratislava', 'Flight OM-BTV has landed at M. R. Štefánik Airport.'),
  hop('VIE', 'KRK', '11', '25', '29', '07', 'carpathian', VIE_KRK_LANDMARKS, 'North-east from Schwechat into Kraków.', 'Welcome to Kraków', 'Flight OM-BTV has landed at Kraków John Paul II International Airport.'),
  hop('KRK', 'VIE', '07', '29', '25', '11', 'carpathian', KRK_VIE_LANDMARKS, 'South-west to Vienna. Pick up the PAPI for runway 29.', 'Welcome to Vienna', 'Flight OM-BTV has landed at Vienna International Airport.'),
  hop('VIE', 'WAW', '11', '33', '29', '15', 'vistula', VIE_WAW_LANDMARKS, 'Long northbound visual to Warsaw Chopin.', 'Welcome to Warsaw', 'Flight OM-BTV has landed at Warsaw Chopin Airport.'),
  hop('WAW', 'VIE', '15', '29', '33', '11', 'vistula', WAW_VIE_LANDMARKS, 'South to Schwechat. Plan an early descent.', 'Welcome to Vienna', 'Flight OM-BTV has landed at Vienna International Airport.'),
  hop('BUD', 'WAW', '13L', '33', '31R', '15', 'vistula', BUD_WAW_LANDMARKS, 'North from Ferenc Liszt to Warsaw.', 'Welcome to Warsaw', 'Flight OM-BTV has landed at Warsaw Chopin Airport.'),
  hop('WAW', 'BUD', '15', '31R', '33', '13L', 'vistula', WAW_BUD_LANDMARKS, 'South to Budapest. Watch speed on final.', 'Welcome to Budapest', 'Flight OM-BTV has landed at Budapest Ferenc Liszt International Airport.'),
  hop('BUD', 'PRG', '13L', '24', '31R', '06', 'bohemian', BUD_PRG_LANDMARKS, 'North-west into Bohemia toward Prague.', 'Welcome to Prague', 'Flight OM-BTV has landed at Václav Havel Airport Prague.'),
  hop('PRG', 'BUD', '06', '31R', '24', '13L', 'bohemian', PRG_BUD_LANDMARKS, 'South-east to Ferenc Liszt. Keep the PAPI honest.', 'Welcome to Budapest', 'Flight OM-BTV has landed at Budapest Ferenc Liszt International Airport.'),
];

// Append bidirectional world links (skip any pair already authored above).
{
  const have = new Set(ROUTES.map((r) => r.id));
  for (const [a, b] of WORLD_LINKS) {
    if (!airportByIata(a) || !airportByIata(b)) continue;
    if (!have.has(routeKey(a, b))) {
      ROUTES.push(autoHop(a, b));
      have.add(routeKey(a, b));
    }
    if (!have.has(routeKey(b, a))) {
      ROUTES.push(autoHop(b, a));
      have.add(routeKey(b, a));
    }
  }
}

/** @deprecated use NETWORK_ROUTE_IDS */
export const TRIANGLE_ROUTE_IDS = ROUTES.map((r) => r.id);
export const NETWORK_ROUTE_IDS = ROUTES.map((r) => r.id);

const AUTO_HOPS = new Map<string, FlightRoute>();

/** Authored hop if one exists, otherwise a generated charter between any two airports. */
export function getRoute(from: string, to: string): FlightRoute | undefined {
  if (from === to) return undefined;
  const authored = ROUTES.find((r) => r.from === from && r.to === to);
  if (authored) return authored;
  if (!airportByIata(from) || !airportByIata(to)) return undefined;
  const id = routeKey(from, to);
  let hop = AUTO_HOPS.get(id);
  if (!hop) {
    hop = autoHop(from, to);
    AUTO_HOPS.set(id, hop);
  }
  return hop;
}

export function routesFrom(from: string): FlightRoute[] {
  return ROUTES.filter((r) => r.from === from);
}

export const DEFAULT_ROUTE = ROUTES[0];
