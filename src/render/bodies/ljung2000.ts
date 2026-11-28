import type { BodyShape } from './shape';

/**
 * Ljung 2000 16V: the kit car on the Ljung 1600 S body and wheelbase, widened over the wider track and
 * 3 cm lower, with one large lamp per side. The body is drawn by the Blender model (blender/ljung2000/, built by
 * blender/ljung1600/build.py), so the shape here is only used for the damage zones, the decals, the lamp glow,
 * and follows the model's dimensions.
 */
export const ljung2000: BodyShape = {
  halfX: 0.867,
  bottom: -0.253,
  nose: 1.661,
  tail: -2.131,
  belt: 0.427,
  roof: 0.852,
  screen: [0.493, -0.012],
  backlight: [-2.01, -1.57],
  cabinHalfX: 0.754,
  archY: -0.233,
  archR: [0.36, 0.36],
  doorSeams: [0.517, -0.672],
  tailY: [0.26, 0.449],
  tailX: 0.571,
  bumperY: [-0.084, 0.024],
};
