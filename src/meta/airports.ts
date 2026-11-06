/** Central Europe airport network for the map hub. Positions are WGS84 for SVG projection. */

export type AirportStatus = 'home' | 'open' | 'locked';

/** Index into the terminal shell catalog (distinct silhouettes). */
export type AirportShellId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Airport {
  id: string;
  iata: string;
  city: string;
  name: string;
  lat: number;
  lon: number;
  /** Terminal shell silhouette 0..7. */
  shell: AirportShellId;
  /** Painted on the in-world terminal building. */
  terminalTitle: string;
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
    shell: 0,
    terminalTitle: 'LETISKO BRATISLAVA',
    brief: 'Board, start up and launch toward your next open destination.',
  },
  {
    id: 'vie',
    iata: 'VIE',
    city: 'Vienna',
    name: 'Schwechat',
    lat: 48.1103,
    lon: 16.5697,
    shell: 1,
    terminalTitle: 'VIENNA INTERNATIONAL AIRPORT',
    brief: 'Schwechat runway 29 – PAPI and a firm but gentle touchdown.',
  },
  {
    id: 'prg',
    iata: 'PRG',
    city: 'Prague',
    name: 'Václav Havel',
    lat: 50.1008,
    lon: 14.26,
    shell: 3,
    terminalTitle: 'PRAGUE VACLAV HAVEL',
    brief: 'North-west into Bohemia. Keep the CHT honest on the climb.',
  },
  {
    id: 'bud',
    iata: 'BUD',
    city: 'Budapest',
    name: 'Ferenc Liszt',
    lat: 47.4298,
    lon: 19.2611,
    shell: 2,
    terminalTitle: 'BUDAPEST FERENC LISZT',
    brief: 'Danube corridor into Hungary. Land at Ferenc Liszt and keep the PAPI honest.',
  },
  {
    id: 'muc',
    iata: 'MUC',
    city: 'Munich',
    name: 'Franz Josef Strauss',
    lat: 48.3538,
    lon: 11.7861,
    shell: 6,
    terminalTitle: 'MUNICH AIRPORT',
    lockHint: 'Munich is locked. Build your reputation first.',
  },
  {
    id: 'krk',
    iata: 'KRK',
    city: 'Kraków',
    name: 'John Paul II',
    lat: 50.0777,
    lon: 19.7848,
    shell: 4,
    terminalTitle: 'KRAKOW JOHN PAUL II',
    brief: 'Carpathian approaches into southern Poland. Watch for bumps over the foothills.',
  },
  {
    id: 'waw',
    iata: 'WAW',
    city: 'Warsaw',
    name: 'Chopin',
    lat: 52.1657,
    lon: 20.9671,
    shell: 5,
    terminalTitle: 'WARSAW CHOPIN',
    brief: 'Vistula corridor into the capital. Settle early onto the PAPI.',
  },
  {
    id: 'lju',
    iata: 'LJU',
    city: 'Ljubljana',
    name: 'Jože Pučnik',
    lat: 46.2236,
    lon: 14.4576,
    shell: 7,
    terminalTitle: 'LJUBLJANA AIRPORT',
    lockHint: 'Ljubljana is not cleared yet.',
  },
];

/** Airports that can appear as from/to on a filed route. */
export const FLYABLE_IATAS = ['BTS', 'VIE', 'BUD', 'PRG', 'KRK', 'WAW'] as const;

export function airportByIata(iata: string): Airport | undefined {
  return AIRPORTS.find((a) => a.iata === iata);
}

export function routeKey(from: string, to: string): string {
  return `${from}-${to}`;
}
