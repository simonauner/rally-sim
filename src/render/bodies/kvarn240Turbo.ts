import type { BodyShape } from './shape';

/**
 * Kvarn 240 Turbo: boxy 80s saloon: long flat hood and boot lid, large square lamps. The body is drawn by the
 * Blender model (blender/kvarn240/), so the shape here is only used for the damage zones, the decals, the lamp
 * glow, and follows the model's dimensions.
 */
export const kvarn240Turbo: BodyShape = {
  halfX: 0.855,
  bottom: -0.31,
  nose: 1.96,
  tail: -2.555,
  belt: 0.405,
  roof: 0.84,
  crease: 0.24,
  screen: [0.608, 0.149],
  backlight: [-1.735, -1.324],
  hoodDrop: 0.088,
  trunkDrop: 0.01,
  cabinHalfX: 0.77,
  archY: -0.23,
  archR: [0.37, 0.37],
  doorSeams: [-0.372, -1.194],
  sideGlass: [
    [-0.33, Infinity],
    [-1.19, -0.4],
    [-Infinity, -1.225],
  ],
  doorHandles: [-0.252, -1.08],
  lampY: [0.03, 0.25],
  grilleX: 0.262,
  lampX: [0.272, 0.858],
  tailY: [0.035, 0.212],
  tailX: 0.44,
  bumperY: [-0.08, -0.08],
  rearBumperDepth: 0.46,
};
