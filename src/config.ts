/** World layout along the flight path. 1 world unit = 1 metre, +x = direction of flight. */

export interface Runway {
  code: string;
  designator: string;
  x0: number;
  x1: number;
}

export const BTS_RUNWAY: Runway = { code: 'BTS', designator: '31', x0: 0, x1: 2000 };
export const VIE_RUNWAY: Runway = { code: 'VIE', designator: '29', x0: 11500, x1: 13700 };

export const START_X = 140;

/** Runway centreline z (the aircraft rolls at z = 0, near the camera-side edge). */
export const RUNWAY_Z = -16;
export const RUNWAY_WIDTH = 45;

/** Touchdown aiming point used for the glide-path guidance (PAPI). */
export const AIM_POINT_X = VIE_RUNWAY.x0 + 300;
export const GLIDE_SLOPE_DEG = 3.5;

/** Flying this far past the Vienna runway end ends the mission. */
export const OVERFLY_LIMIT_X = VIE_RUNWAY.x1 + 2600;

export const SUGGESTED_CRUISE_ALT = 350;

/** Rivers crossing the flight path (x ranges). */
export const DANUBE = { x0: 3680, x1: 3980 };
export const DANUBE_CANAL = { x0: 9880, x1: 9925 };

/** Major zones used to compose the scenery. */
export const ZONES = {
  bratislavaOutskirts: { x0: 2300, x1: 3700 },
  bratislavaCity: { x0: 3950, x1: 5300 },
  countryside: { x0: 5300, x1: 8400 },
  viennaCity: { x0: 8400, x1: 10900 },
};

export interface Landmark {
  x0: number;
  x1: number;
  title: string;
  subtitle: string;
  /** x0/x1 are route fractions (0–1) on the en-route geography span, not reference metres. */
  geo?: boolean;
}

/** Captions shown while passing landmarks (camera x ranges). */
export const LANDMARKS: Landmark[] = [
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
