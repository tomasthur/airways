import type { AircraftConfig } from './AircraftConfig.ts';
import { A320 } from './a320.ts';
import { A388 } from './a388.ts';
import { ATR72 } from './atr72.ts';
import { B777 } from './b777.ts';
import { B789 } from './b789.ts';
import { BE350 } from './be350.ts';
import { C172RG } from './c172rg.ts';
import { DH8D } from './dh8d.ts';
import { E190 } from './e190.ts';
import { PA34 } from './pa34.ts';

/** Every flyable type, smallest to largest (the career order). */
export const AIRCRAFT: AircraftConfig[] = [C172RG, PA34, BE350, ATR72, DH8D, E190, A320, B789, B777, A388];

export function aircraftById(id: string): AircraftConfig {
  return AIRCRAFT.find((a) => a.id === id) ?? C172RG;
}
