import { type Landmark, type Runway } from '../config';
import { routeKey } from './airports';

/** Shared corridor geometry – every hop is a compressed side-view segment. */
const ORIGIN = { x0: 0, x1: 2000 } as const;
const DEST = { x0: 11500, x1: 13700 } as const;

export interface FlightRoute {
  id: string;
  from: string;
  to: string;
  origin: Runway;
  dest: Runway;
  /** Reciprocal numbers painted on the far runway ends in the world (visual only). */
  originReciprocal: string;
  destReciprocal: string;
  landmarks: Landmark[];
  brief: string;
  welcomeTitle: string;
  welcomeMessage: string;
}

function rw(code: string, designator: string, slot: typeof ORIGIN | typeof DEST): Runway {
  return { code, designator, x0: slot.x0, x1: slot.x1 };
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

function hop(
  from: string,
  to: string,
  fromDes: string,
  toDes: string,
  fromRecip: string,
  toRecip: string,
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
    landmarks,
    brief,
    welcomeTitle,
    welcomeMessage,
  };
}

/** Directed hops in the BTS · VIE · BUD triangle. */
export const ROUTES: FlightRoute[] = [
  hop(
    'BTS',
    'VIE',
    '31',
    '29',
    '13',
    '11',
    BTS_VIE_LANDMARKS,
    'Short hop over the Danube and Parndorf plain. Land runway 29 with the PAPI.',
    'Welcome to Vienna',
    'Flight OM-BTV has landed at Vienna International Airport.',
  ),
  hop(
    'VIE',
    'BTS',
    '11',
    '13',
    '29',
    '31',
    VIE_BTS_LANDMARKS,
    'Return east across Burgenland. Land runway 13 at Bratislava.',
    'Welcome to Bratislava',
    'Flight OM-BTV has landed at M. R. Štefánik Airport.',
  ),
  hop(
    'BTS',
    'BUD',
    '31',
    '31R',
    '13',
    '13L',
    BTS_BUD_LANDMARKS,
    'Southeast along the Danube toward Ferenc Liszt. Watch speed on final.',
    'Welcome to Budapest',
    'Flight OM-BTV has landed at Budapest Ferenc Liszt International Airport.',
  ),
  hop(
    'BUD',
    'BTS',
    '13L',
    '13',
    '31R',
    '31',
    BUD_BTS_LANDMARKS,
    'Northwest back to Bratislava. Little Carpathians on the nose.',
    'Welcome to Bratislava',
    'Flight OM-BTV has landed at M. R. Štefánik Airport.',
  ),
  hop(
    'VIE',
    'BUD',
    '11',
    '31R',
    '29',
    '13L',
    VIE_BUD_LANDMARKS,
    'Eastbound Vienna–Budapest. Cross the border and settle onto 31R.',
    'Welcome to Budapest',
    'Flight OM-BTV has landed at Budapest Ferenc Liszt International Airport.',
  ),
  hop(
    'BUD',
    'VIE',
    '13L',
    '29',
    '31R',
    '11',
    BUD_VIE_LANDMARKS,
    'West to Schwechat. Pick up the PAPI for runway 29.',
    'Welcome to Vienna',
    'Flight OM-BTV has landed at Vienna International Airport.',
  ),
];

export const TRIANGLE_ROUTE_IDS = ROUTES.map((r) => r.id);

export function getRoute(from: string, to: string): FlightRoute | undefined {
  return ROUTES.find((r) => r.from === from && r.to === to);
}

export function routesFrom(from: string): FlightRoute[] {
  return ROUTES.filter((r) => r.from === from);
}

export const DEFAULT_ROUTE = ROUTES[0];
