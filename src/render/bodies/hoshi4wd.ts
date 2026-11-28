import type { BodyShape } from './shape';

/**
 * Hoshi 2.0 4WD: rounded three-door liftback coupé from 1991 with wide fenders and pop-up headlights.
 * The body is drawn by the Blender model (blender/hoshi4wd/), so the shape here is only used for the damage zones,
 * the decals and the tail-light glow, and follows the model's dimensions.
 */
export const hoshi4wd: BodyShape = {
  halfX: 0.875,
  bottom: -0.215,
  nose: 2.045,
  tail: -2.37,
  belt: 0.43,
  roof: 0.81,
  screen: [0.53, -0.1],
  backlight: [-1.9, -0.92],
  cabinHalfX: 0.75,
  archY: -0.15,
  archR: [0.375, 0.375],
  doorSeams: [-0.69],
  tailY: [0.195, 0.345],
  tailX: 0.37,
  bumperY: [-0.08, 0.1],
};
