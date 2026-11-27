import type { BodyShape } from './shape';

/**
 * Sora 2.0 Turbo: rundad tvådörrars coupé från sent 90-tal. Karossen ritas av Blendermodellen
 * (blender/soraTurbo/), så formen här används bara till skadezonerna, dekalerna, baklyktornas sken och
 * fälgarna, och följer modellens mått.
 */
export const soraTurbo: BodyShape = {
  halfX: 0.845,
  bottom: -0.32,
  nose: 1.89,
  tail: -2.27,
  belt: 0.44,
  roof: 0.92,
  crease: 0.24,
  screen: [0.51, 0.05],
  backlight: [-1.49, -0.91],
  hoodDrop: 0.22,
  trunkDrop: 0.04,
  cabinHalfX: 0.75,
  archY: -0.14,
  archR: [0.375, 0.375],
  doorSeams: [-0.68],
  sideGlass: [
    [-0.61, Infinity],
    [-Infinity, -0.66],
  ],
  doorHandles: [-0.47],
  lampY: [0.11, 0.2],
  grilleX: 0.21,
  lampX: [0.24, 0.76],
  tailY: [0.19, 0.35],
  tailX: 0.38,
  bumperY: [-0.13, -0.12],
  rearBumperDepth: 0.36,
  hoodScoopZ: [0.93, 1.31], // objektet 'scoop' i Blendermodellen
  goldRims: true,
};
