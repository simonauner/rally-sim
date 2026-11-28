import type { BodyShape } from './shape';

/**
 * Strand 2.0 GT: boxy two-door saloon from the late 70s in rally trim with arch extensions. The body is
 * drawn by the Blender model (blender/strandGt/), so this shape is only used for the damage zones, the
 * decals and the tail lamp glow, and follows the model's measurements.
 */
export const strandGt: BodyShape = {
  halfX: 0.785,
  bottom: -0.277,
  nose: 1.722,
  tail: -2.165,
  belt: 0.455,
  roof: 0.875,
  crease: 0.3,
  screen: [0.594, 0.036],
  backlight: [-1.495, -1.06],
  hoodDrop: 0.15,
  trunkDrop: 0.03,
  cabinHalfX: 0.72,
  archY: -0.203,
  archR: [0.345, 0.345],
  doorSeams: [-0.596],
  sideGlass: [
    [-0.54, Infinity],
    [-Infinity, -0.6],
  ],
  doorHandles: [-0.476],
  lampY: [0.08, 0.26],
  grilleX: 0.76,
  lampX: [0.54, 0.72],
  tailY: [0.1, 0.24],
  tailX: 0.52,
  bumperY: [0.015, 0.024],
  rearBumperDepth: 0.08,
};
