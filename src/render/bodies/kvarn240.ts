import type { BodyShape } from './shape';

/**
 * Kvarn 240 GL: boxy 80s saloon: long flat hood and boot lid, large square lamps. The body is drawn by the
 * Blender model (blender/kvarn240/), so the shape here is only used for the damage zones, the decals, the lamp
 * glow, and follows the model's dimensions.
 */
export const kvarn240: BodyShape = {
  halfX: 0.855,
  bottom: -0.304,
  nose: 2,
  tail: -2.633,
  belt: 0.428,
  roof: 0.873,
  screen: [0.608, 0.149],
  backlight: [-1.735, -1.324],
  cabinHalfX: 0.77,
  archY: -0.222,
  archR: [0.37, 0.37],
  doorSeams: [-0.372, -1.194],
  tailY: [0.049, 0.23],
  tailX: 0.44,
  bumperY: [-0.069, -0.069],
};
