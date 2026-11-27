import type { BodyShape } from './shape';

/**
 * Ljung 2000 16V: kitcaren på Ljung 1600 S:s kaross och hjulbas, breddad över den bredare spårvidden och
 * 3 cm lägre, med en stor lykta per sida. Karossen ritas av Blendermodellen (blender/ljung2000/, byggd av
 * blender/ljung1600/build.py), så formen här används bara till skadezonerna, dekalerna, lyktornas sken och
 * följer modellens mått.
 */
export const ljung2000: BodyShape = {
  halfX: 0.851,
  bottom: -0.257,
  nose: 1.576,
  tail: -2.044,
  belt: 0.413,
  roof: 0.832,
  crease: 0.191,
  screen: [0.478, -0.012],
  backlight: [-1.945, -1.522],
  hoodDrop: 0.19,
  trunkDrop: 0,
  cabinHalfX: 0.74,
  archY: -0.237,
  archR: [0.36, 0.36],
  doorSeams: [0.501, -0.652],
  sideGlass: [
    [-0.599, Infinity],
    [-Infinity, -0.71],
  ],
  doorHandles: [-0.498],
  lampY: [0.0, 0.2],
  grilleX: 0.516,
  lampX: [0.528, 0.74],
  tailY: [0.249, 0.435],
  tailX: 0.56,
  bumperY: [-0.09, 0.016],
  rearBumperDepth: 0.3,
};
