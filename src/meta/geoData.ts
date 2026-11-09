/**
 * Hand-authored geography for the side-view corridor: mountain ranges, deserts and other
 * landscape regions, named seas and major rivers. Coordinates are [lon, lat] (WGS84) and
 * deliberately coarse — they only decide what the player sees below a great-circle leg.
 */

export type Biome =
  | 'sea'
  | 'farmland'
  | 'forest'
  | 'hills'
  | 'mountains'
  | 'desert'
  | 'steppe'
  | 'taiga'
  | 'tundra'
  | 'ice'
  | 'tropical';

export interface GeoRegion {
  name: string;
  biome: Exclude<Biome, 'sea'>;
  poly: [number, number][];
}

export interface GeoSea {
  name: string;
  poly: [number, number][];
}

export interface GeoRiver {
  name: string;
  /** Visual width on the corridor (m). */
  widthM: number;
  line: [number, number][];
}

const box = (lon0: number, lat0: number, lon1: number, lat1: number): [number, number][] => [
  [lon0, lat0],
  [lon1, lat0],
  [lon1, lat1],
  [lon0, lat1],
];

/** First match wins: keep specific ranges above broad plateaus. */
export const REGIONS: GeoRegion[] = [
  // —— Europe: high mountains
  {
    name: 'The Alps',
    biome: 'mountains',
    poly: [
      [5.5, 44.0], [7.0, 43.8], [7.8, 44.2], [8.8, 45.6], [10.5, 45.7], [12.5, 46.0], [14.5, 46.3], [16.0, 46.8],
      [16.2, 47.6], [14.0, 47.8], [12.0, 47.7], [10.0, 47.6], [8.6, 47.3], [7.0, 46.9], [6.0, 46.4], [5.6, 45.4],
    ],
  },
  { name: 'The Pyrenees', biome: 'mountains', poly: [[-1.8, 43.4], [0, 42.6], [1.5, 42.3], [3.2, 42.4], [3.0, 42.9], [1.0, 43.0], [-1.0, 43.3]] },
  {
    name: 'Tatras & Carpathians',
    biome: 'mountains',
    poly: [[19.2, 49.0], [20.4, 49.4], [21.0, 49.2], [20.6, 48.9], [19.6, 48.8]],
  },
  {
    name: 'The Carpathians',
    biome: 'hills',
    poly: [
      [17.3, 48.6], [19.0, 49.6], [20.5, 49.5], [22.5, 49.2], [24.5, 48.3], [26.0, 47.5], [26.5, 45.9], [25.0, 45.3],
      [22.5, 45.0], [22.0, 45.8], [23.5, 46.6], [24.6, 47.3], [23.5, 47.9], [22.0, 48.5], [20.5, 48.6], [19.0, 48.3], [17.8, 48.2],
    ],
  },
  {
    name: 'Dinaric Alps',
    biome: 'mountains',
    poly: [[14.2, 45.6], [15.5, 44.5], [17.0, 43.5], [18.5, 42.6], [19.8, 42.3], [20.5, 42.7], [19.5, 43.8], [17.5, 44.6], [15.8, 45.4]],
  },
  {
    name: 'The Apennines',
    biome: 'hills',
    poly: [
      [8.5, 44.6], [10.5, 44.5], [12.5, 43.6], [13.8, 42.5], [15.0, 41.2], [16.0, 40.0], [16.4, 39.0], [15.9, 38.4],
      [15.4, 39.6], [14.6, 40.6], [13.6, 41.6], [12.6, 42.6], [11.3, 43.6], [9.6, 44.2],
    ],
  },
  {
    name: 'Scandinavian Mountains',
    biome: 'mountains',
    poly: [[5.0, 59.0], [8.0, 61.0], [12.0, 63.5], [14.5, 66.0], [18.0, 68.5], [22.0, 69.8], [19.0, 70.0], [15.0, 68.5], [12.0, 66.5], [8.5, 63.5], [5.5, 62.0], [4.8, 60.5]],
  },
  { name: 'Scottish Highlands', biome: 'hills', poly: box(-6.5, 56.2, -2.5, 58.6) },
  { name: 'Balkan Mountains', biome: 'hills', poly: [[21.0, 41.0], [22.5, 40.8], [24.5, 41.2], [26.5, 42.3], [26.5, 43.0], [23.5, 43.3], [22.3, 42.8], [21.0, 42.0]] },
  { name: 'Pindus Mountains', biome: 'mountains', poly: [[20.3, 39.2], [21.0, 38.5], [22.5, 38.3], [22.5, 40.3], [21.0, 40.5]] },
  {
    name: 'Taurus Mountains',
    biome: 'mountains',
    poly: [[29.0, 36.5], [33.0, 36.2], [36.0, 36.8], [38.5, 37.8], [42.0, 38.5], [44.0, 39.5], [44.5, 38.0], [41.0, 37.3], [37.0, 36.9], [33.0, 36.8], [30.5, 37.3]],
  },
  { name: 'The Caucasus', biome: 'mountains', poly: [[37.5, 44.5], [40.5, 43.5], [44.0, 42.5], [47.5, 41.5], [49.0, 41.0], [46.5, 41.6], [43.0, 42.0], [40.0, 42.8]] },
  // —— Europe: uplands
  { name: 'Bohemian Massif', biome: 'hills', poly: [[12.0, 50.3], [14.5, 50.9], [16.8, 50.4], [16.5, 49.0], [14.5, 48.6], [13.0, 48.9], [12.2, 49.6]] },
  { name: 'German Uplands', biome: 'hills', poly: [[6.2, 50.0], [8.5, 51.5], [11.0, 51.8], [12.5, 50.5], [11.0, 50.2], [9.5, 49.6], [7.5, 49.2]] },
  { name: 'Black Forest & Vosges', biome: 'hills', poly: [[6.6, 47.8], [8.5, 47.6], [8.8, 48.8], [7.5, 49.0], [6.6, 48.2]] },
  { name: 'The Ardennes', biome: 'forest', poly: [[4.5, 49.6], [6.3, 49.8], [6.5, 50.6], [5.0, 50.5]] },
  { name: 'Massif Central', biome: 'hills', poly: [[2.0, 44.2], [4.5, 44.2], [4.6, 45.8], [3.0, 46.2], [1.8, 45.4]] },
  { name: 'Meseta Central', biome: 'steppe', poly: [[-7.0, 38.0], [-2.0, 37.8], [-0.8, 39.5], [-1.5, 41.5], [-3.5, 42.8], [-6.5, 42.5], [-7.0, 40.5]] },
  { name: 'Low Countries polders', biome: 'farmland', poly: [[3.3, 51.2], [5.0, 51.4], [7.0, 52.3], [7.2, 53.4], [4.6, 53.2], [3.6, 51.9]] },
  { name: 'Ural Mountains', biome: 'hills', poly: box(56, 51, 62, 68) },
  // Broad lowlands last so named ranges above still win. Polygons stay inland of the Channel.
  {
    name: 'England & Wales',
    biome: 'farmland',
    poly: [
      [-5.7, 50.1], [-3.6, 50.25], [-1.8, 50.55], [0.15, 50.72], [1.05, 51.08], [1.45, 51.45],
      [1.55, 52.2], [1.1, 53.0], [-0.3, 53.55], [-1.4, 54.5], [-2.1, 55.8], [-4.9, 55.25],
      [-4.7, 53.0], [-5.25, 51.65], [-5.0, 50.55],
    ],
  },
  {
    name: 'Northern France',
    biome: 'farmland',
    poly: [[-1.8, 48.15], [2.45, 48.2], [2.55, 50.62], [1.55, 50.9], [0.15, 50.62], [-1.55, 49.7], [-1.9, 48.8]],
  },
  {
    name: 'North European Plain',
    biome: 'farmland',
    poly: [
      [2.6, 48.9], [8.2, 48.4], [12.8, 49.2], [16.5, 50.4], [19.5, 51.2], [21.0, 53.6],
      [14.2, 54.4], [8.2, 53.7], [4.8, 52.6], [3.2, 51.0],
    ],
  },
  {
    name: 'Pannonian Basin',
    biome: 'farmland',
    poly: [[16.0, 45.6], [21.6, 45.5], [22.6, 47.8], [21.2, 48.5], [17.2, 48.55], [16.1, 47.3]],
  },

  // —— North Africa & Middle East
  { name: 'Atlas Mountains', biome: 'mountains', poly: [[-9.8, 30.5], [-6.0, 31.5], [-3.0, 33.0], [0, 34.5], [4, 35.7], [9, 36.8], [10, 36.0], [6, 35.0], [2, 34.2], [-2, 32.5], [-5.5, 30.8], [-9, 29.8]] },
  { name: 'Nile Valley', biome: 'farmland', poly: [[30.6, 29.5], [31.6, 29.5], [31.6, 31.6], [30.0, 31.5], [29.9, 30.8]] },
  { name: 'Sinai', biome: 'desert', poly: [[32.3, 31.2], [34.2, 31.3], [35.2, 29.5], [34.3, 27.8], [32.7, 29.6]] },
  {
    name: 'The Sahara',
    biome: 'desert',
    poly: [
      [-17, 21], [-12, 28], [-8, 30], [-2, 32], [3, 32], [10, 31.5], [15, 31], [20, 30.8], [25, 30.5], [29.5, 30.3],
      [32, 29], [33.5, 27], [34.8, 24], [36, 20], [37, 16], [30, 15], [20, 15], [10, 15.5], [0, 15.5], [-10, 16], [-16.5, 16.5],
    ],
  },
  { name: 'Syrian Desert', biome: 'desert', poly: [[36.5, 34.5], [40, 36], [43, 35], [47, 31], [42, 31.5], [38, 31.5], [36.5, 32.5]] },
  {
    name: 'Zagros Mountains',
    biome: 'mountains',
    poly: [[44.5, 36.5], [46.5, 35.0], [48.5, 32.5], [51.0, 30.0], [54.0, 28.0], [56.5, 27.2], [57.0, 28.3], [54.5, 29.5], [52.0, 31.0], [49.5, 33.5], [47.0, 36.0], [45.5, 37.5]],
  },
  { name: 'Alborz Mountains', biome: 'mountains', poly: box(49, 35.7, 57, 37) },
  { name: 'Dasht-e Kavir', biome: 'desert', poly: [[51, 35], [56, 36], [60, 35], [61, 31], [60, 27], [57, 27.5], [54, 30], [51, 32.5]] },
  {
    name: 'Arabian Desert',
    biome: 'desert',
    poly: [
      [35, 29.5], [38, 31.5], [42, 32], [47, 30.0], [48.5, 28.5], [50, 26.5], [52, 24.2], [56, 26.0], [56.5, 24.5],
      [59.5, 22.5], [55, 17.5], [52, 16.5], [45, 13], [43, 14.5], [42, 17], [39, 21], [37, 24.5], [35, 27.5],
    ],
  },

  // —— Asia
  {
    name: 'The Himalaya',
    biome: 'mountains',
    poly: [
      [66.0, 34.0], [70.0, 35.5], [74.0, 37.5], [78.0, 36.0], [82.0, 35.5], [88.0, 36.0], [95.0, 34.5], [100.0, 31.5],
      [102.0, 28.0], [98.0, 27.5], [94.0, 27.8], [89.0, 27.3], [84.0, 28.0], [80.0, 29.5], [77.0, 31.5], [74.0, 33.0], [70.0, 33.5],
    ],
  },
  { name: 'Tian Shan', biome: 'mountains', poly: box(70, 40, 90, 44.5) },
  { name: 'Thar Desert', biome: 'desert', poly: [[69, 24], [73, 30], [75.5, 29], [74, 26], [71, 24]] },
  {
    name: 'Taklamakan & Gobi',
    biome: 'desert',
    poly: [[76, 37], [78, 41], [88, 42], [95, 41], [105, 43], [112, 44], [111, 41], [103, 39], [95, 38.5], [88, 37], [80, 36.5]],
  },
  { name: 'Kazakh Steppe', biome: 'steppe', poly: [[50, 45], [55, 52], [70, 54], [80, 51], [82, 47], [75, 44], [63, 43], [55, 42]] },
  { name: 'Anatolian Plateau', biome: 'steppe', poly: [[29.5, 38.0], [33.0, 37.4], [37.0, 37.6], [40.0, 39.0], [38.0, 40.2], [33.0, 40.0], [30.0, 39.6]] },
  { name: 'Japanese Alps', biome: 'mountains', poly: [[136.0, 34.5], [138.3, 35.0], [139.0, 36.2], [140.5, 37.5], [141.0, 39.0], [140.0, 40.5], [139.5, 38.0], [137.5, 37.0], [136.0, 35.8]] },
  { name: 'South China hills', biome: 'hills', poly: box(108, 23, 120, 30) },

  // —— Americas
  {
    name: 'Rocky Mountains',
    biome: 'mountains',
    poly: [[-125, 60], [-115, 60], [-110, 55], [-106, 50], [-104, 45], [-104.5, 40], [-105.5, 35], [-108, 32], [-112, 33], [-111, 37], [-112, 42], [-115, 46], [-119, 50], [-124, 55]],
  },
  {
    name: 'Sierra Nevada & Cascades',
    biome: 'mountains',
    poly: [[-122.5, 49], [-120.5, 49], [-120.8, 45], [-121.0, 42], [-118.3, 38], [-117.6, 35.6], [-118.9, 35.0], [-120, 37.5], [-121.6, 40], [-122, 42.5], [-122.3, 46]],
  },
  {
    name: 'Mojave & Great Basin',
    biome: 'desert',
    poly: [[-120, 42], [-114, 42], [-110, 40], [-108.5, 36], [-106, 32], [-110, 30], [-113, 31], [-115, 32.7], [-116.5, 34], [-118, 35.2], [-118.5, 37.5], [-120, 39]],
  },
  { name: 'Great Plains', biome: 'steppe', poly: [[-104, 49], [-97, 49], [-96, 40], [-98, 32], [-104, 32], [-105, 40]] },
  {
    name: 'Appalachian Mountains',
    biome: 'hills',
    poly: [
      [-85.5, 34.0], [-83, 35.0], [-80.5, 37.5], [-78.5, 39.5], [-76.0, 41.5], [-74.5, 42.5], [-72.5, 44.5], [-70.0, 45.5],
      [-68.0, 47.0], [-70.5, 47.5], [-72.5, 45.8], [-75.0, 44.0], [-77.0, 42.0], [-79.5, 40.0], [-82.0, 37.0], [-84.5, 35.2],
    ],
  },
  { name: 'Florida', biome: 'tropical', poly: [[-82.8, 24.5], [-79.8, 24.5], [-79.9, 28.5], [-82.8, 28.5]] },
  { name: 'Canadian Shield', biome: 'taiga', poly: [[-95, 49], [-75, 46], [-62, 50], [-60, 56], [-80, 60], [-95, 58]] },

  // —— Oceania
  { name: 'Great Dividing Range', biome: 'hills', poly: [[146, -38.5], [149.5, -37.5], [151.0, -33.0], [152.5, -29.0], [152, -26], [150.5, -26], [150.5, -30], [149.0, -33.5], [147.5, -36.0], [145.5, -37.5]] },
  { name: 'Australian Outback', biome: 'desert', poly: [[115, -33], [123, -34], [135, -34.5], [140, -35], [145, -33], [146, -28], [142, -20], [136, -15], [129, -14], [122, -18], [115, -22], [113.5, -26]] },
];

/** Named seas, smallest first; anything else falls back to {@link oceanName}. */
export const SEAS: GeoSea[] = [
  {
    name: 'Strait of Dover',
    poly: [
      [0.55, 50.68], [1.85, 50.72], [2.75, 51.02], [2.7, 51.38], [1.45, 51.42], [0.75, 51.18], [0.5, 50.92],
    ],
  },
  { name: 'English Channel', poly: box(-5.8, 48.85, 2.0, 51.22) },
  { name: 'Irish Sea', poly: box(-6.6, 52.0, -2.8, 55.0) },
  { name: 'Bosphorus', poly: box(28.9, 40.95, 29.2, 41.25) },
  { name: 'Sea of Marmara', poly: box(26.5, 40.2, 29.9, 41.1) },
  { name: 'Adriatic Sea', poly: [[12.2, 45.8], [13.8, 45.8], [19.8, 41.5], [19.5, 40.0], [18.2, 40.0], [12.0, 44.0]] },
  { name: 'Tyrrhenian Sea', poly: box(9.5, 37.8, 16.0, 43.0) },
  { name: 'Ligurian Sea', poly: box(7.0, 42.8, 10.5, 44.5) },
  { name: 'Aegean Sea', poly: box(22.5, 35.3, 28.5, 41.0) },
  { name: 'Ionian Sea', poly: box(15.5, 34.0, 22.5, 40.5) },
  { name: 'Balearic Sea', poly: box(-1.0, 37.5, 4.5, 42.5) },
  { name: 'Alboran Sea', poly: box(-5.6, 35.0, -1.0, 37.2) },
  { name: 'Black Sea', poly: box(27.4, 40.8, 42.0, 47.0) },
  { name: 'Bay of Biscay', poly: box(-10.0, 43.3, -1.0, 48.6) },
  {
    name: 'North Sea',
    poly: [
      [1.5, 51.2], [2.7, 51.05], [3.6, 51.35], [6.2, 53.0], [8.1, 54.2], [8.3, 57.6],
      [4.2, 58.6], [1.2, 58.0], [-1.4, 55.4], [0.6, 53.1], [1.45, 51.7],
    ],
  },
  { name: 'Baltic Sea', poly: box(9.5, 53.5, 30.5, 66.0) },
  { name: 'Mediterranean Sea', poly: box(-6.0, 30.0, 36.5, 46.0) },
  { name: 'Red Sea', poly: [[32.3, 30.0], [35.0, 28.0], [43.5, 12.5], [42.5, 12.0], [32.0, 29.5]] },
  { name: 'Persian Gulf', poly: box(47.5, 23.5, 57.0, 30.5) },
  { name: 'Gulf of Oman', poly: box(56.0, 22.0, 61.0, 26.5) },
  { name: 'Caspian Sea', poly: box(46.5, 36.5, 55.0, 47.5) },
  { name: 'Arabian Sea', poly: box(50.0, 5.0, 77.0, 25.0) },
  { name: 'Bay of Bengal', poly: box(80.0, 5.0, 95.0, 22.5) },
  { name: 'Andaman Sea', poly: box(92.0, 5.0, 99.0, 16.0) },
  { name: 'Strait of Malacca', poly: box(95.0, 0.5, 104.0, 6.0) },
  { name: 'Java Sea', poly: box(105.0, -8.0, 119.0, -3.0) },
  { name: 'South China Sea', poly: box(99.0, 0.0, 121.0, 23.0) },
  { name: 'East China Sea', poly: box(119.0, 24.0, 131.0, 33.0) },
  { name: 'Sea of Japan', poly: box(128.0, 34.0, 142.0, 52.0) },
  { name: 'Philippine Sea', poly: box(121.0, 5.0, 140.0, 33.0) },
  { name: 'Timor Sea', poly: box(122.0, -14.0, 132.0, -8.0) },
  { name: 'Coral Sea', poly: box(142.0, -30.0, 165.0, -10.0) },
  { name: 'Tasman Sea', poly: box(147.0, -48.0, 175.0, -30.0) },
  { name: 'Gulf of Mexico', poly: box(-98.0, 18.0, -80.5, 31.0) },
  { name: 'Caribbean Sea', poly: box(-88.0, 9.0, -60.0, 22.0) },
  { name: 'Gulf of St. Lawrence', poly: box(-67.0, 45.5, -56.0, 51.5) },
  { name: 'Labrador Sea', poly: box(-64.0, 52.0, -45.0, 63.0) },
];

export function oceanName(lon: number, lat: number): string {
  if (lat > 66) return 'Arctic Ocean';
  if (lon > -80 && lon < 20) return lat > 40 ? 'North Atlantic' : lat > 0 ? 'Atlantic Ocean' : 'South Atlantic';
  if (lon >= 20 && lon < 115 && lat < 25) return 'Indian Ocean';
  return lat > 0 ? 'North Pacific' : 'South Pacific';
}

export const RIVERS: GeoRiver[] = [
  {
    name: 'Danube',
    widthM: 320,
    line: [[8.2, 48.0], [10.0, 48.5], [12.1, 49.0], [13.5, 48.6], [16.4, 48.2], [17.1, 48.1], [18.8, 47.8], [19.05, 47.5], [18.9, 46.0], [20.3, 45.2], [22.5, 44.6], [24.5, 43.7], [27.5, 44.0], [28.2, 45.4], [29.6, 45.2]],
  },
  { name: 'Vltava', widthM: 150, line: [[14.4, 48.6], [14.3, 49.3], [14.42, 50.08], [14.4, 50.35]] },
  { name: 'Elbe', widthM: 220, line: [[15.8, 50.0], [14.4, 50.35], [14.1, 50.9], [13.7, 51.05], [12.4, 51.8], [11.6, 52.8], [10.0, 53.55], [8.7, 53.9]] },
  { name: 'Vistula', widthM: 220, line: [[18.9, 49.6], [19.9, 50.05], [21.7, 50.6], [21.0, 52.25], [19.0, 52.9], [18.8, 54.3]] },
  { name: 'Oder', widthM: 180, line: [[18.0, 50.0], [17.0, 51.1], [15.5, 52.0], [14.6, 52.6], [14.3, 53.4]] },
  { name: 'Rhine', widthM: 280, line: [[9.5, 47.5], [8.6, 47.6], [7.6, 47.6], [8.0, 48.8], [8.4, 49.5], [8.3, 50.0], [7.6, 50.4], [7.0, 50.9], [6.8, 51.4], [6.1, 51.85], [4.5, 51.9]] },
  { name: 'Seine', widthM: 180, line: [[4.5, 48.3], [2.4, 48.85], [1.0, 49.4], [0.1, 49.45]] },
  { name: 'Loire', widthM: 200, line: [[4.1, 45.0], [3.0, 47.0], [1.0, 47.4], [-1.5, 47.2], [-2.2, 47.3]] },
  { name: 'Thames', widthM: 200, line: [[-1.9, 51.7], [-1.0, 51.5], [-0.12, 51.5], [0.7, 51.5]] },
  { name: 'Po', widthM: 220, line: [[7.5, 44.9], [9.2, 45.1], [11.0, 45.0], [12.4, 44.95]] },
  { name: 'Tiber', widthM: 120, line: [[12.2, 43.0], [12.5, 41.9], [12.25, 41.74]] },
  { name: 'Tagus', widthM: 260, line: [[-1.9, 40.4], [-3.7, 39.9], [-6.0, 39.6], [-8.5, 39.2], [-9.1, 38.7]] },
  { name: 'Nile', widthM: 420, line: [[31.0, 22.0], [32.9, 24.1], [32.6, 25.7], [31.2, 27.2], [31.25, 30.0], [31.2, 31.4]] },
  { name: 'Euphrates', widthM: 260, line: [[38.5, 37.0], [39.5, 36.0], [41.0, 34.5], [43.5, 32.5], [46.5, 31.0], [48.0, 30.0]] },
  { name: 'Tigris', widthM: 240, line: [[42.0, 37.3], [43.1, 36.3], [44.4, 33.3], [46.0, 32.0], [47.5, 31.0]] },
  { name: 'Indus', widthM: 320, line: [[73, 35], [72.0, 33.5], [71.0, 30.5], [68.5, 26], [67.5, 24]] },
  { name: 'Ganges', widthM: 380, line: [[78.0, 30.0], [80.3, 26.5], [83.0, 25.3], [85.1, 25.6], [87.9, 24.5], [89.0, 22.0]] },
  { name: 'Mekong', widthM: 400, line: [[98, 29], [100, 22], [102.6, 17.9], [105.8, 15.1], [105.9, 11.5], [106.6, 9.7]] },
  { name: 'Yangtze', widthM: 450, line: [[91, 33], [98, 32], [104, 29], [106.5, 29.5], [111.3, 30.7], [114.3, 30.6], [117.5, 30.5], [121.5, 31.5]] },
  { name: 'Mississippi', widthM: 450, line: [[-91.0, 46.5], [-91.5, 43.5], [-91.0, 40.5], [-90.2, 38.6], [-89.5, 36.5], [-91.0, 33.0], [-91.2, 31.0], [-90.0, 29.9], [-89.3, 29.1]] },
  { name: 'Ohio', widthM: 300, line: [[-80.0, 40.4], [-82.5, 38.6], [-85.7, 38.2], [-88.0, 37.5], [-89.1, 37.0]] },
  { name: 'Missouri', widthM: 280, line: [[-111.5, 47.5], [-104.0, 47.9], [-100.5, 46.8], [-96.5, 42.5], [-95.9, 41.2], [-94.6, 39.1], [-90.2, 38.8]] },
  { name: 'Colorado', widthM: 200, line: [[-109, 38.5], [-111.5, 36.5], [-114.5, 36.0], [-114.6, 33.0], [-114.8, 32.0]] },
  { name: 'St. Lawrence', widthM: 500, line: [[-76.3, 44.2], [-73.6, 45.5], [-71.2, 46.8], [-68.5, 48.5]] },
  { name: 'Hudson', widthM: 260, line: [[-73.9, 43.2], [-73.75, 42.65], [-73.95, 41.5], [-74.0, 40.7]] },
  { name: 'Murray', widthM: 180, line: [[148, -36.5], [146, -36], [142, -34.2], [139.3, -35.3]] },
];

/**
 * Default landscape for a country when no named range/plain covers the point.
 * Anything not listed reads as farmland — the safe European default.
 */
export const COUNTRY_BIOME: Record<string, Exclude<Biome, 'sea'>> = {
  Austria: 'hills',
  Switzerland: 'mountains',
  Slovenia: 'hills',
  Croatia: 'hills',
  'Bosnia and Herz.': 'mountains',
  Montenegro: 'mountains',
  Albania: 'mountains',
  Macedonia: 'hills',
  Kosovo: 'hills',
  Serbia: 'hills',
  Bulgaria: 'hills',
  Greece: 'hills',
  Italy: 'hills',
  Spain: 'hills',
  Portugal: 'hills',
  Czechia: 'hills',
  Slovakia: 'hills',
  Norway: 'forest',
  Sweden: 'forest',
  Finland: 'taiga',
  Estonia: 'forest',
  Latvia: 'forest',
  Iceland: 'tundra',
  Greenland: 'ice',
  Turkey: 'steppe',
  Morocco: 'hills',
  Algeria: 'desert',
  Tunisia: 'steppe',
  Libya: 'desert',
  Egypt: 'desert',
  Israel: 'desert',
  Jordan: 'desert',
  'Saudi Arabia': 'desert',
  Iraq: 'desert',
  Iran: 'steppe',
  Kuwait: 'desert',
  Qatar: 'desert',
  'United Arab Emirates': 'desert',
  Oman: 'desert',
  Yemen: 'desert',
  Kazakhstan: 'steppe',
  Mongolia: 'steppe',
  Afghanistan: 'mountains',
  Pakistan: 'steppe',
  Nepal: 'mountains',
  Thailand: 'tropical',
  Vietnam: 'tropical',
  Malaysia: 'tropical',
  Indonesia: 'tropical',
  Philippines: 'tropical',
  Brazil: 'tropical',
  Mexico: 'steppe',
  Canada: 'taiga',
  Australia: 'steppe',
};

/** Shorter display names for Natural Earth country labels. */
export const COUNTRY_LABEL: Record<string, string> = {
  'United States of America': 'United States',
  'Bosnia and Herz.': 'Bosnia & Herzegovina',
  'Dem. Rep. Congo': 'DR Congo',
  'Central African Rep.': 'Central African Republic',
  'Dominican Rep.': 'Dominican Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  'Solomon Is.': 'Solomon Islands',
  'Falkland Is.': 'Falkland Islands',
  'Fr. S. Antarctic Lands': 'French Southern Lands',
  'N. Cyprus': 'Cyprus',
  'W. Sahara': 'Western Sahara',
  'S. Sudan': 'South Sudan',
  Macedonia: 'North Macedonia',
};
