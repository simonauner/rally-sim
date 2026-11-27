import type { BodyShape } from './shape';

/**
 * Volpe 2.0 Turbo 16V: kantig femdörrars halvkombi med lådformade hjulhus, fyra runda strålkastare och takspoiler.
 * Karossen ritas av Blendermodellen (blender/volpeTurbo/), så formen här används bara till skadezonerna,
 * dekalerna, lyktornas sken och följer modellens mått.
 */
export const volpeTurbo: BodyShape = {
  halfX: 0.885,
  bottom: -0.29,
  nose: 1.705,
  tail: -1.975,
  belt: 0.425,
  roof: 0.826,
  crease: 0.19,
  screen: [0.564, 0.09],
  backlight: [-1.88, -1.3],
  hoodDrop: 0.15,
  trunkDrop: 0,
  cabinHalfX: 0.78,
  archY: -0.21,
  archR: [0.37, 0.37],
  doorSeams: [-0.44, -1.36],
  sideGlass: [
    [-0.41, Infinity],
    [-0.925, -0.47],
    [-Infinity, -0.95],
  ],
  doorHandles: [-0.3, -1.24],
  lampY: [0.08, 0.26],
  grilleX: 0.355,
  lampX: [0.385, 0.728],
  tailY: [0.05, 0.42],
  tailX: 0.61,
  bumperY: [-0.11, -0.1],
  rearBumperDepth: 0.3,
  flare: 0.075,
  roundLamps: [
    [0.64, 0.088],
    [0.455, 0.07],
  ],
  hoodVents: true,
  paintedBumpers: true,
  spoiler: 'roof',
  rallyRims: true,
  // Tätt i en rad framför grillen, så de egna runda lyktorna syns utanför.
  podX: [0.285, 0.095, -0.095, -0.285],
};
