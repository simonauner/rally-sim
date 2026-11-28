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
  screen: [0.468, -0.037],
  backlight: [-2.035, -1.594],
  cabinHalfX: 0.713,
  archY: -0.206,
  archR: [0.335, 0.335],
  doorSeams: [0.492, -0.697],
  tailY: [0.282, 0.47],
  tailX: 0.54,
  bumperY: [-0.048, 0.045],
};
