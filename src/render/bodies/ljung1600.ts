import type { BodyShape } from './shape';

/**
 * Ljung 1600 S: small three-door hatchback: short sloping hood, long door, wide C-pillar and nearly vertical
 * tailgate. The body is drawn by the Blender model (blender/ljung1600/), so the shape here is only used for
 * the damage zones, the decals, the lamp glow, and follows the model's dimensions.
 */
export const ljung1600: BodyShape = {
  halfX: 0.82,
  bottom: -0.226,
  nose: 1.636,
  tail: -2.156,
  belt: 0.454,
  roof: 0.878,
  crease: 0.229,
  screen: [0.468, -0.037],
  backlight: [-2.035, -1.594],
  hoodDrop: 0.193,
  trunkDrop: 0,
  cabinHalfX: 0.713,
  archY: -0.206,
  archR: [0.335, 0.335],
  doorSeams: [0.492, -0.697],
  sideGlass: [
    [-0.642, Infinity],
    [-Infinity, -0.757],
  ],
  doorHandles: [-0.538],
  lampY: [0.042, 0.241],
  grilleX: 0.489,
  lampX: [0.289, 0.695],
  tailY: [0.282, 0.47],
  tailX: 0.54,
  bumperY: [-0.048, 0.045],
  rearBumperDepth: 0.333,
};
