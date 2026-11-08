import type * as THREE from 'three';
import type { AircraftConfig } from '../sim/aircraft/AircraftConfig';
import { Airplane, type AircraftModel } from './Airplane';
import { ParametricAirplane } from './ParametricAirplane';

/** The hand-built C172 or a parametric model from the type's visual description. */
export function createAircraftModel(cfg: AircraftConfig, envMap: THREE.Texture | null): AircraftModel {
  return cfg.visual ? new ParametricAirplane(cfg, envMap) : new Airplane(envMap);
}
