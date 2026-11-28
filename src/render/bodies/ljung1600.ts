import type { BodyShape } from './shape';

/**
 * Ljung 1600 S: small three-door hatchback: short sloping hood, long door, wide C-pillar and nearly vertical
 * tailgate. The body is drawn by the Blender model (blender/ljung1600/), so the shape here is only used for
 * the damage zones, the decals, the lamp glow, and follows the model's dimensions.
 */
export const ljung1600: BodyShape = {
  halfX: 0.805,
  bottom: -0.23,
  nose: 1.552,
  tail: -2.068,
  belt: 0.44,
  roof: 0.858,
  crease: 0.218,
  screen: [0.454, -0.036],
  backlight: [-1.969, -1.546],
  hoodDrop: 0.19,
  trunkDrop: 0,
  cabinHalfX: 0.7,
  archY: -0.21,
  archR: [0.335, 0.335],
  doorSeams: [0.477, -0.676],
  sideGlass: [
    [-0.623, Infinity],
    [-Infinity, -0.734],
  ],
  doorHandles: [-0.522],
  lampY: [0.034, 0.23],
  grilleX: 0.48,
  lampX: [0.284, 0.682],
  tailY: [0.27, 0.456],
  tailX: 0.53,
  bumperY: [-0.055, 0.037],
  rearBumperDepth: 0.3,
};
