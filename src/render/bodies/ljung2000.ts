import type { BodyShape } from './shape';

/** Ljung 2000 16V: liten tredörrars halvkombi: kort sluttande huv, lång dörr, nästan lodrät baklucka. */
export const ljung2000: BodyShape = {
  halfX: 0.825,
  bottom: -0.3,
  nose: 1.65,
  tail: -2.07,
  belt: 0.36,
  roof: 0.86,
  crease: 0.12,
  screen: [0.62, 0.06],
  backlight: [-2.0, -1.64],
  hoodDrop: 0.11,
  trunkDrop: 0,
  cabinHalfX: 0.71,
  archY: -0.22,
  archR: [0.36, 0.355],
  doorSeams: [-0.66],
  sideGlass: [
    [-0.6, Infinity],
    [-Infinity, -0.7],
  ],
  doorHandles: [-0.52],
  lampY: [0.0, 0.17],
  grilleX: 0.33,
  lampX: [0.37, 0.77],
  tailY: [0.0, 0.2],
  tailX: 0.38,
  bumperY: [-0.13, -0.12],
  rearBumperDepth: 0.3,
};
