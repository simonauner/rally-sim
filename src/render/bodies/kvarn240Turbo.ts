import type { BodyShape } from './shape';

/**
 * Kvarn 240 Turbo: boxy 80s saloon: long flat hood and boot lid, large square lamps. The body is drawn by the
 * Blender model (blender/kvarn240/), so the shape here is only used for the damage zones, the decals, the lamp
 * glow, and follows the model's dimensions.
 */
export const kvarn240Turbo: BodyShape = {
  halfX: 0.855,
  bottom: -0.304,
  nose: 2,
  tail: -2.633,
  belt: 0.428,
  roof: 0.873,
  crease: 0.259,
  screen: [0.608, 0.149],
  backlight: [-1.735, -1.324],
  hoodDrop: 0.09,
  trunkDrop: 0.01,
  cabinHalfX: 0.77,
  archY: -0.222,
  archR: [0.37, 0.37],
  doorSeams: [-0.372, -1.194],
  sideGlass: [
    [-0.33, Infinity],
    [-1.19, -0.4],
    [-Infinity, -1.225],
  ],
  doorHandles: [-0.252, -1.08],
  lampY: [0.044, 0.269],
  grilleX: 0.262,
  lampX: [0.272, 0.858],
  tailY: [0.049, 0.23],
  tailX: 0.44,
  bumperY: [-0.069, -0.069],
  rearBumperDepth: 0.512,
};
