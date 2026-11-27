import type { BodyShape } from './shape';

/**
 * Hoshi 2.0 4WD: rundad tredörrars liftback-coupé med lång, kraftigt sluttande huv och smala lyktor,
 * luftintag på huven och taket, lång sluttande bakruta och en vinge på bakluckan. Måtten är uppmätta
 * på en sidoritning av förebilden (marken ligger vid y ≈ -0,51).
 */
export const hoshi4wd: BodyShape = {
  halfX: 0.83,
  bottom: -0.3,
  nose: 1.98,
  tail: -2.25,
  belt: 0.31,
  roof: 0.78,
  crease: 0.04,
  screen: [0.55, -0.1],
  backlight: [-1.87, -0.62],
  // Nosen ligger ~0,3 m under gördellinjen: en lång, kraftigt sluttande huv.
  hoodDrop: 0.3,
  trunkDrop: 0,
  beltRise: 0.08,
  taper: [0.1, 0.06],
  cabinHalfX: 0.68,
  archY: -0.21,
  archR: [0.38, 0.38],
  doorSeams: [-0.66],
  sideGlass: [
    [-0.6, Infinity],
    [-Infinity, -0.7],
  ],
  doorHandles: [-0.54],
  lampY: [-0.065, -0.01],
  grilleX: 0.4,
  lampX: [0.36, 0.76],
  tailY: [0.13, 0.25],
  tailX: 0.14,
  bumperY: [-0.2, -0.17],
  bumperH: 0.27,
  bumperBlinkers: true,
  frontIntakeOnly: true,
  rearBumperDepth: 0.34,
  flare: 0.06,
  paintedBumpers: true,
  spoiler: 'trunk',
  hoodScoop: true,
  lampBand: true,
  round: 0.1,
  rallyRims: true,
  paintedMirrors: true,
  roofVent: true,
};
