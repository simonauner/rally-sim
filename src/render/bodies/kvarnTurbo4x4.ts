import type { BodyShape } from './shape';

/** Kvarn Turbo 4x4: boxy 80s saloon: long flat hood and boot lid, large square lamps. */
export const kvarnTurbo4x4: BodyShape = {
  halfX: 0.85,
  bottom: -0.31,
  nose: 1.96,
  tail: -2.53,
  belt: 0.4,
  roof: 0.83,
  crease: 0.19,
  screen: [0.546, 0.123],
  backlight: [-1.67, -1.318],
  hoodDrop: 0.08,
  trunkDrop: 0.05,
  cabinHalfX: 0.74,
  archY: -0.24,
  archR: [0.39, 0.38], // the rear wheel arch hugs the wheel more tightly
  doorSeams: [-0.4, -1.22],
  sideGlass: [
    [-0.37, Infinity],
    [-1.06, -0.45],
    [-Infinity, -1.11],
  ],
  doorHandles: [-0.27, -1.1],
  lampY: [0.03, 0.255],
  grilleX: 0.39,
  lampX: [0.43, 0.79],
  tailY: [0.04, 0.24],
  tailX: 0.46,
  bumperY: [-0.1, -0.055],
  rearBumperDepth: 0.46,
};
