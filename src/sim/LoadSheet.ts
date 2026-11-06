import type { AircraftConfig } from './aircraft/AircraftConfig.ts';

export interface Load {
  passengers: number;
  baggageKg: number;
  fuelKg: number;
}

export interface LoadSheet {
  massKg: number;
  items: { label: string; kg: number }[];
  /** Human-readable reasons the load is not allowed; empty when it is. */
  problems: string[];
}

/** Pilot plus one passenger, light baggage and most of the fuel: 1100 kg in the 172RG. */
export const DEFAULT_LOAD: Load = { passengers: 1, baggageKg: 20, fuelKg: 140 };

export function computeLoadSheet(c: AircraftConfig, load: Load): LoadSheet {
  const m = c.mass;
  const items = [
    { label: 'Empty aircraft', kg: m.emptyKg },
    { label: 'Pilot', kg: m.personKg },
    { label: `Passengers × ${load.passengers}`, kg: load.passengers * m.personKg },
    { label: 'Baggage', kg: load.baggageKg },
    { label: 'Fuel', kg: load.fuelKg },
  ];
  const massKg = items.reduce((s, i) => s + i.kg, 0);
  const problems: string[] = [];
  if (!Number.isInteger(load.passengers) || load.passengers < 0 || load.passengers > m.maxPassengers) {
    problems.push(`${c.name} seats at most ${m.maxPassengers} passengers.`);
  }
  if (load.baggageKg < 0 || load.baggageKg > m.maxBaggageKg) problems.push(`Baggage limit is ${m.maxBaggageKg} kg.`);
  if (load.fuelKg < 0 || load.fuelKg > m.maxFuelKg) problems.push(`Usable fuel is at most ${m.maxFuelKg} kg.`);
  if (massKg > m.mtowKg) problems.push(`Take-off mass ${Math.round(massKg)} kg exceeds the maximum of ${m.mtowKg} kg.`);
  return { massKg, items, problems };
}
