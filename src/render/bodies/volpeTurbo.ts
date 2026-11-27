import type { BodyShape } from './shape';

/** Volpe 2.0 Turbo 16V: kantig femdörrars halvkombi med lådformade hjulhus, fyra runda strålkastare och takspoiler. */
export const volpeTurbo: BodyShape = {
  halfX: 0.8,
  bottom: -0.3,
  nose: 1.68,
  tail: -2.05,
  belt: 0.42,
  roof: 0.86,
  crease: 0.1,
  screen: [0.64, 0.04],
  backlight: [-2.0, -1.6],
  hoodDrop: 0.08,
  trunkDrop: 0,
  cabinHalfX: 0.72,
  archY: -0.21,
  archR: [0.37, 0.37],
  doorSeams: [-0.56, -1.42],
  sideGlass: [
    [-0.52, Infinity],
    [-1.3, -0.6],
    [-Infinity, -1.36],
  ],
  doorHandles: [-0.44, -1.28],
  lampY: [0.04, 0.22],
  grilleX: 0.34,
  lampX: [0.36, 0.76],
  tailY: [0.0, 0.24],
  tailX: 0.5,
  bumperY: [-0.11, -0.12],
  rearBumperDepth: 0.3,
  flare: 0.1,
  roundLamps: [
    [0.64, 0.088],
    [0.46, 0.07],
  ],
  hoodVents: true,
  paintedBumpers: true,
  spoiler: 'roof',
  rallyRims: true,
  // Tätt i en rad framför grillen, så de egna runda lyktorna syns utanför.
  podX: [0.285, 0.095, -0.095, -0.285],
};
