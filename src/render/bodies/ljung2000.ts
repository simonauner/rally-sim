import type { BodyShape } from './shape';

/**
 * Ljung 2000 16V: Ljung 1600 S:s kaross och hjulbas, breddad över kitcarens bredare spårvidd. Karossen
 * ritas av Blendermodellen (blender/ljung2000/, byggd av blender/ljung1600/build.py), så formen här används
 * bara till skadezonerna, dekalerna, lyktornas sken och följer modellens mått.
 */
export const ljung2000: BodyShape = {
  halfX: 0.851,
  bottom: -0.227,
  nose: 1.576,
  tail: -2.044,
  belt: 0.443,
  roof: 0.862,
  crease: 0.221,
  screen: [0.478, -0.012],
  backlight: [-1.945, -1.522],
  hoodDrop: 0.19,
  trunkDrop: 0,
  cabinHalfX: 0.74,
  archY: -0.207,
  archR: [0.335, 0.335],
  doorSeams: [0.501, -0.652],
  sideGlass: [
    [-0.599, Infinity],
    [-Infinity, -0.71],
  ],
  doorHandles: [-0.498],
  lampY: [0.03, 0.226],
  grilleX: 0.507,
  lampX: [0.3, 0.721],
  tailY: [0.279, 0.465],
  tailX: 0.56,
  bumperY: [-0.06, 0.046],
  rearBumperDepth: 0.3,
};
