import type { BodyShape } from './shape';

/**
 * Henry 2.0 Turbo 4x4: four-door saloon from around 1990 in Group A rally trim. The body is drawn by the
 * Blender model (blender/henryTurbo4x4Meshy/), so this shape is only used for the damage zones, the decals and
 * the tail lamp glow, and follows the model's measurements.
 */
export const henryTurbo4x4: BodyShape = {
  halfX: 0.8485,
  bottom: -0.37,
  nose: 1.897,
  tail: -2.571,
  belt: 0.29,
  roof: 0.777,
  screen: [0.93, 0.0],
  backlight: [-1.9, -1.36],
  cabinHalfX: 0.76,
  archY: -0.26,
  archR: [0.36, 0.36],
  doorSeams: [-0.473, -1.244],
  tailY: [0.0, 0.14],
  tailX: 0.29,
  bumperY: [-0.15, -0.15],
};
