/**
 * Fiktiva etapper som bara testerna använder: kända vägar med korsningar, asfalt, lera och krön,
 * så tidtagning, ghost, pacenotes och menyns autopilot provas mot samma väg varje gång. Spelet kör
 * verkliga vägar (src/physics/real/).
 */

import type { StageDef } from '../src/physics/stage';

/**
 * Första etappen: fiktiv skogsetapp, ca 1,8 km. Underlaget byter bara i korsningar, där etappen
 * leds in på en annan väg och de vägar den lämnar är avspärrade.
 */
export const STAGE_SKOGSBERG: StageDef = {
  name: 'Skogsberg',
  version: '1.0.1',
  recordsSince: '1.0.0',
  points: [
    { x: 0, z: -20, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 0, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 120, y: 1, width: 7, surface: 'gravel' },
    { x: 40, z: 250, y: 3, width: 6.5, surface: 'gravel' },
    { x: 130, z: 320, y: 5, width: 6.5, surface: 'gravel' },
    { x: 240, z: 330, y: 6, width: 6.5, surface: 'gravel' },
    // Korsning: grusvägen fortsätter rakt fram, etappen svänger snävt höger ut på asfaltsvägen
    { x: 284, z: 338, y: 6, width: 6.5, surface: 'gravel' },
    { x: 300, z: 340, y: 5.8, width: 8, surface: 'asphalt' },
    { x: 304, z: 358, y: 5.3, width: 8, surface: 'asphalt' },
    { x: 320, z: 400, y: 4, width: 8, surface: 'asphalt' },
    { x: 330, z: 520, y: 2, width: 8, surface: 'asphalt' },
    // Korsning: asfaltsvägen fortsätter, etappen viker av vänster på en grusväg
    { x: 262, z: 598, y: 1, width: 7, surface: 'gravel' },
    { x: 285, z: 680, y: 3, width: 6.5, surface: 'gravel' },
    // Korsning: grusvägen fortsätter, etappen svänger vänster in på en lerig skogsväg
    { x: 340, z: 820, y: 7, width: 6, surface: 'mud' },
    { x: 460, z: 830, y: 9, width: 6, surface: 'mud' },
    // Skogsvägen mynnar i en grusväg som kommer söderifrån
    { x: 520, z: 850, y: 9, width: 6.5, surface: 'gravel' },
    // Krön och snäv vänster
    { x: 542, z: 872, y: 9, width: 6.5, surface: 'gravel' },
    { x: 546, z: 900, y: 8, width: 6.5, surface: 'gravel' },
    { x: 530, z: 1030, y: 5, width: 6.5, surface: 'gravel' },
    { x: 440, z: 1110, y: 4, width: 7, surface: 'gravel' },
    { x: 420, z: 1240, y: 3, width: 7, surface: 'gravel' },
    { x: 420, z: 1280, y: 3, width: 7, surface: 'gravel' },
    // Utrullning efter mål, så bilen hinner stanna på vägen.
    { x: 420, z: 1340, y: 3, width: 7, surface: 'gravel' },
  ],
  spurs: [
    // Grusvägen rakt fram och asfaltsvägen söderut från första korsningen
    { points: [{ x: 308, z: 341 }, { x: 350, z: 346 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: 300, z: 340 }, { x: 281, z: 283 }], width: 8, surface: 'asphalt' },
    { points: [{ x: 262, z: 598 }, { x: 229, z: 636 }], width: 8, surface: 'asphalt' },
    { points: [{ x: 340, z: 820 }, { x: 358, z: 866 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: 520, z: 850 }, { x: 520, z: 800 }], width: 6.5, surface: 'gravel' },
  ],
};

/**
 * Andra etappen: fiktiv, ca 2,6 km. Snabbt grus, en lerig väg över myren, en lång stigning med
 * krön, en asfaltsbit och grus in i mål.
 */
export const STAGE_MYRKULLA: StageDef = {
  name: 'Myrkulla',
  version: '1.0.1',
  recordsSince: '1.0.0',
  points: [
    { x: 0, z: -20, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 0, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 100, y: 1, width: 7, surface: 'gravel' },
    { x: -30, z: 200, y: 2, width: 7, surface: 'gravel' },
    { x: -110, z: 260, y: 4, width: 7, surface: 'gravel' },
    { x: -220, z: 280, y: 5, width: 6.5, surface: 'gravel' },
    { x: -300, z: 340, y: 6, width: 6.5, surface: 'gravel' },
    { x: -320, z: 450, y: 8, width: 6.5, surface: 'gravel' },
    // Korsning: grusvägen fortsätter, etappen svänger höger ut på myren
    { x: -330, z: 525, y: 8, width: 6.5, surface: 'gravel' },
    { x: -350, z: 545, y: 7.5, width: 5.5, surface: 'mud' },
    { x: -400, z: 550, y: 6, width: 5.5, surface: 'mud' },
    { x: -520, z: 545, y: 5, width: 5.5, surface: 'mud' },
    { x: -600, z: 570, y: 4, width: 5.5, surface: 'mud' },
    { x: -660, z: 620, y: 4, width: 5.5, surface: 'mud' },
    // Myrvägen mynnar i en grusväg som stiger upp mot kullen
    { x: -690, z: 700, y: 6, width: 6.5, surface: 'gravel' },
    { x: -680, z: 800, y: 12, width: 6.5, surface: 'gravel' },
    { x: -640, z: 880, y: 17, width: 6.5, surface: 'gravel' },
    // Krön på kullen
    { x: -560, z: 940, y: 21, width: 6.5, surface: 'gravel' },
    { x: -470, z: 960, y: 20, width: 6.5, surface: 'gravel' },
    { x: -380, z: 1010, y: 17, width: 6.5, surface: 'gravel' },
    { x: -350, z: 1080, y: 15, width: 6.5, surface: 'gravel' },
    { x: -400, z: 1160, y: 13, width: 7, surface: 'gravel' },
    { x: -420, z: 1280, y: 10, width: 7, surface: 'gravel' },
    // Korsning: etappen svänger höger ut på asfaltsvägen
    { x: -380, z: 1400, y: 7, width: 7, surface: 'gravel' },
    { x: -370, z: 1420, y: 6, width: 8, surface: 'asphalt' },
    { x: -300, z: 1500, y: 5, width: 8, surface: 'asphalt' },
    // Korsning: asfaltsvägen fortsätter, etappen viker av vänster på grus mot mål
    { x: -180, z: 1530, y: 4, width: 8, surface: 'asphalt' },
    { x: -140, z: 1550, y: 4, width: 7, surface: 'gravel' },
    { x: -100, z: 1620, y: 3, width: 7, surface: 'gravel' },
    { x: -90, z: 1720, y: 3, width: 7, surface: 'gravel' },
    { x: -90, z: 1760, y: 3, width: 7, surface: 'gravel' },
    // Utrullning efter mål
    { x: -90, z: 1820, y: 3, width: 7, surface: 'gravel' },
  ],
  spurs: [
    { points: [{ x: -330, z: 525 }, { x: -338, z: 610 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: -690, z: 700 }, { x: -770, z: 705 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: -370, z: 1420 }, { x: -440, z: 1445 }], width: 8, surface: 'asphalt' },
    { points: [{ x: -180, z: 1530 }, { x: -70, z: 1515 }], width: 8, surface: 'asphalt' },
  ],
};
