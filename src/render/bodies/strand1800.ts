import type { BodyShape } from './shape';

/**
 * Strand 1800: boxy two-door saloon from the late 70s in rally trim with arch extensions. The body is
 * drawn by the Blender model (blender/strand1800/), so this shape is only used for the damage zones, the
 * decals and the tail lamp glow, and follows the model's measurements.
 */
export const strand1800: BodyShape = {
  halfX: 0.785,
  bottom: -0.277,
  nose: 1.722,
  tail: -2.165,
  belt: 0.455,
  roof: 0.875,
  screen: [0.594, 0.036],
  backlight: [-1.495, -1.06],
  cabinHalfX: 0.72,
  archY: -0.203,
  archR: [0.345, 0.345],
  doorSeams: [-0.596],
  tailY: [0.1, 0.24],
  tailX: 0.52,
  bumperY: [0.015, 0.024],
};
