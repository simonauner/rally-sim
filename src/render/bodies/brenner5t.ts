import type { BodyShape } from './shape';

/**
 * Brenner 5T Coupé: angular two-door coupé from the early 80s with box flares. The body is drawn by the
 * Blender model (blender/brenner5t/), so this shape is only used for the damage zones, the decals and the
 * tail lamp glow, and follows the model's measurements.
 */
export const brenner5t: BodyShape = {
  halfX: 0.865,
  bottom: -0.305,
  nose: 1.905,
  tail: -2.415,
  belt: 0.34,
  roof: 0.775,
  crease: 0.0,
  screen: [0.55, -0.04],
  backlight: [-2.03, -1.3],
  hoodDrop: 0.17,
  trunkDrop: 0.05,
  cabinHalfX: 0.75,
  archY: -0.246,
  archR: [0.355, 0.355],
  doorSeams: [-0.593],
  sideGlass: [
    [-0.59, Infinity],
    [-Infinity, -0.66],
  ],
  doorHandles: [-0.43],
  lampY: [0.025, 0.175],
  grilleX: 0.39,
  lampX: [0.39, 0.775],
  tailY: [0.11, 0.345],
  tailX: 0.675,
  bumperY: [-0.1, -0.05],
  rearBumperDepth: 0.3,
};
