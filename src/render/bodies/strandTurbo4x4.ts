import type { BodyShape } from './shape';

/**
 * Strand 2.0 Turbo 4x4: four-door saloon from around 1990 in Group A rally trim. The body is drawn by the
 * Blender model (blender/strandTurbo4x4/), so this shape is only used for the damage zones, the decals and
 * the tail lamp glow, and follows the model's measurements.
 */
export const strandTurbo4x4: BodyShape = {
  halfX: 0.8485,
  bottom: -0.37,
  nose: 1.897,
  tail: -2.571,
  belt: 0.31,
  roof: 0.779,
  screen: [0.615, 0.01],
  backlight: [-1.859, -1.298],
  cabinHalfX: 0.76,
  archY: -0.26,
  archR: [0.36, 0.36],
  doorSeams: [-0.565, -1.37],
  tailY: [0.0, 0.15],
  tailX: 0.31,
  bumperY: [-0.15, -0.15],
};
