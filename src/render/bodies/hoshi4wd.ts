import type { BodyShape } from './shape';

/**
 * Hoshi 2.0 4WD: rundad tredörrars liftback-coupé från 1991 med breda skärmar och uppfällda strålkastare.
 * Karossen ritas av Blendermodellen (blender/hoshi4wd/), så formen här används bara till skadezonerna,
 * dekalerna, baklyktornas sken och fälgarna, och följer modellens mått.
 */
export const hoshi4wd: BodyShape = {
  halfX: 0.875,
  bottom: -0.215,
  nose: 2.045,
  tail: -2.37,
  belt: 0.43,
  roof: 0.81,
  crease: 0.2,
  screen: [0.53, -0.1],
  backlight: [-1.9, -0.92],
  hoodDrop: 0.2,
  trunkDrop: 0.02,
  cabinHalfX: 0.75,
  archY: -0.15,
  archR: [0.375, 0.375],
  doorSeams: [-0.69],
  sideGlass: [
    [-0.66, Infinity],
    [-Infinity, -0.72],
  ],
  doorHandles: [-0.5],
  lampY: [0.21, 0.32],
  grilleX: 0.4,
  lampX: [0.34, 0.66],
  tailY: [0.195, 0.345],
  tailX: 0.37,
  bumperY: [-0.08, 0.1],
  rearBumperDepth: 0.34,
  rallyRims: true,
};
