import type { BodyShape } from './shape';

/** Brenner 5T Coupé: låg tvådörrars coupé: lång huv, kraftigt lutad vindruta, kort tak och kort bagagelucka. */
export const brenner5t: BodyShape = {
  halfX: 0.84,
  bottom: -0.29,
  nose: 1.84,
  tail: -2.2,
  belt: 0.35,
  roof: 0.76,
  crease: 0.14,
  screen: [0.5, -0.12],
  backlight: [-1.62, -1.02],
  hoodDrop: 0.1,
  trunkDrop: 0.03,
  cabinHalfX: 0.7,
  archY: -0.22,
  archR: [0.375, 0.37],
  doorSeams: [-0.78],
  sideGlass: [
    [-0.72, Infinity],
    [-Infinity, -0.82],
  ],
  doorHandles: [-0.64],
  lampY: [0.0, 0.14],
  grilleX: 0.3,
  lampX: [0.34, 0.76],
  tailY: [0.03, 0.2],
  tailX: 0.4,
  bumperY: [-0.12, -0.09],
  rearBumperDepth: 0.36,
};
