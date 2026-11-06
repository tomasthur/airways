/** Central Europe airport network for the map hub. Positions are WGS84 for SVG projection. */

export type AirportStatus = 'home' | 'open' | 'locked';

export interface Airport {
  id: string;
  iata: string;
  city: string;
  name: string;
  lat: number;
  lon: number;
  /** Short copy when selected as a destination. */
  brief?: string;
  /** Shown when the player taps a locked airport. */
  lockHint?: string;
}

export const AIRPORTS: Airport[] = [
  {
    id: 'bts',
    iata: 'BTS',
    city: 'Bratislava',
    name: 'M. R. Štefánik',
    lat: 48.1702,
    lon: 17.2127,
    brief: 'Your current base. Board, start up and launch from runway 31.',
  },
  {
    id: 'vie',
    iata: 'VIE',
    city: 'Vienna',
    name: 'Schwechat',
    lat: 48.1103,
    lon: 16.5697,
    brief: 'Short hop over the Danube and Parndorf plain. Land runway 29 with the PAPI.',
  },
  {
    id: 'prg',
    iata: 'PRG',
    city: 'Prague',
    name: 'Václav Havel',
    lat: 50.1008,
    lon: 14.26,
    lockHint: 'Prague is not cleared for your airline yet.',
  },
  {
    id: 'bud',
    iata: 'BUD',
    city: 'Budapest',
    name: 'Ferenc Liszt',
    lat: 47.4298,
    lon: 19.2611,
    lockHint: 'Budapest remains closed until you expand the network.',
  },
  {
    id: 'muc',
    iata: 'MUC',
    city: 'Munich',
    name: 'Franz Josef Strauss',
    lat: 48.3538,
    lon: 11.7861,
    lockHint: 'Munich is locked. Build your reputation first.',
  },
  {
    id: 'krk',
    iata: 'KRK',
    city: 'Kraków',
    name: 'John Paul II',
    lat: 50.0777,
    lon: 19.7848,
    lockHint: 'Kraków is not on your route network yet.',
  },
  {
    id: 'waw',
    iata: 'WAW',
    city: 'Warsaw',
    name: 'Chopin',
    lat: 52.1657,
    lon: 20.9671,
    lockHint: 'Warsaw opens later in the career.',
  },
  {
    id: 'lju',
    iata: 'LJU',
    city: 'Ljubljana',
    name: 'Jože Pučnik',
    lat: 46.2236,
    lon: 14.4576,
    lockHint: 'Ljubljana is not cleared yet.',
  },
];

export function airportByIata(iata: string): Airport | undefined {
  return AIRPORTS.find((a) => a.iata === iata);
}

export function routeKey(from: string, to: string): string {
  return `${from}-${to}`;
}
