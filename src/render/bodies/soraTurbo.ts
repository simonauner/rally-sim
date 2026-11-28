import type { BodyShape } from './shape';

/**
 * Sora 2.0 Turbo: rounded two-door coupé from the late 90s. The body is drawn by the Blender model
 * (blender/soraTurbo/), so the shape here is only used for the damage zones, the decals and the tail-light glow,
 * and follows the model's dimensions.
 */
export const soraTurbo: BodyShape = {
  halfX: 0.845,
  bottom: -0.32,
  nose: 1.89,
  tail: -2.27,
  belt: 0.37,
  roof: 0.815,
  screen: [0.51, -0.05],
  backlight: [-1.62, -0.9],
  cabinHalfX: 0.732,
  archY: -0.14,
  archR: [0.375, 0.375],
  doorSeams: [-0.68],
  tailY: [0.175, 0.34],
  tailX: 0.39,
  bumperY: [-0.13, -0.12],
  hoodScoopZ: [0.88, 1.2], // the 'scoop' object in the Blender model
};
