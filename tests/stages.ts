/**
 * Fictional stages used only by the tests: known roads with junctions, asphalt, mud and crests,
 * so timing, ghost, pace notes and the menu autopilot are tested against the same road every time. The game runs
 * real roads (src/physics/real/).
 */

import type { StageDef } from '../src/physics/stage';

/**
 * First stage: fictional forest stage, about 1.8 km. The surface only changes at junctions, where the stage
 * turns onto another road and the roads it leaves are closed off.
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
    // Junction: the gravel road continues straight on, the stage turns sharp right onto the asphalt road
    { x: 284, z: 338, y: 6, width: 6.5, surface: 'gravel' },
    { x: 300, z: 340, y: 5.8, width: 8, surface: 'asphalt' },
    { x: 304, z: 358, y: 5.3, width: 8, surface: 'asphalt' },
    { x: 320, z: 400, y: 4, width: 8, surface: 'asphalt' },
    { x: 330, z: 520, y: 2, width: 8, surface: 'asphalt' },
    // Junction: the asphalt road continues, the stage turns off left onto a gravel road
    { x: 262, z: 598, y: 1, width: 7, surface: 'gravel' },
    { x: 285, z: 680, y: 3, width: 6.5, surface: 'gravel' },
    // Junction: the gravel road continues, the stage turns left onto a muddy forest road
    { x: 340, z: 820, y: 7, width: 6, surface: 'mud' },
    { x: 460, z: 830, y: 9, width: 6, surface: 'mud' },
    // The forest road joins a gravel road coming from the south
    { x: 520, z: 850, y: 9, width: 6.5, surface: 'gravel' },
    // Crest and tight left
    { x: 542, z: 872, y: 9, width: 6.5, surface: 'gravel' },
    { x: 546, z: 900, y: 8, width: 6.5, surface: 'gravel' },
    { x: 530, z: 1030, y: 5, width: 6.5, surface: 'gravel' },
    { x: 440, z: 1110, y: 4, width: 7, surface: 'gravel' },
    { x: 420, z: 1240, y: 3, width: 7, surface: 'gravel' },
    { x: 420, z: 1280, y: 3, width: 7, surface: 'gravel' },
    // Run-off after the finish, so the car has room to stop on the road.
    { x: 420, z: 1340, y: 3, width: 7, surface: 'gravel' },
  ],
  spurs: [
    // The gravel road straight on and the asphalt road south from the first junction
    { points: [{ x: 308, z: 341 }, { x: 350, z: 346 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: 300, z: 340 }, { x: 281, z: 283 }], width: 8, surface: 'asphalt' },
    { points: [{ x: 262, z: 598 }, { x: 229, z: 636 }], width: 8, surface: 'asphalt' },
    { points: [{ x: 340, z: 820 }, { x: 358, z: 866 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: 520, z: 850 }, { x: 520, z: 800 }], width: 6.5, surface: 'gravel' },
  ],
};

/**
 * Second stage: fictional, about 2.6 km. Fast gravel, a muddy road across the bog, a long climb with
 * a crest, a stretch of asphalt and gravel to the finish.
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
    // Junction: the gravel road continues, the stage turns right out onto the bog
    { x: -330, z: 525, y: 8, width: 6.5, surface: 'gravel' },
    { x: -350, z: 545, y: 7.5, width: 5.5, surface: 'mud' },
    { x: -400, z: 550, y: 6, width: 5.5, surface: 'mud' },
    { x: -520, z: 545, y: 5, width: 5.5, surface: 'mud' },
    { x: -600, z: 570, y: 4, width: 5.5, surface: 'mud' },
    { x: -660, z: 620, y: 4, width: 5.5, surface: 'mud' },
    // The bog road joins a gravel road climbing towards the hill
    { x: -690, z: 700, y: 6, width: 6.5, surface: 'gravel' },
    { x: -680, z: 800, y: 12, width: 6.5, surface: 'gravel' },
    { x: -640, z: 880, y: 17, width: 6.5, surface: 'gravel' },
    // Crest on the hill
    { x: -560, z: 940, y: 21, width: 6.5, surface: 'gravel' },
    { x: -470, z: 960, y: 20, width: 6.5, surface: 'gravel' },
    { x: -380, z: 1010, y: 17, width: 6.5, surface: 'gravel' },
    { x: -350, z: 1080, y: 15, width: 6.5, surface: 'gravel' },
    { x: -400, z: 1160, y: 13, width: 7, surface: 'gravel' },
    { x: -420, z: 1280, y: 10, width: 7, surface: 'gravel' },
    // Junction: the stage turns right onto the asphalt road
    { x: -380, z: 1400, y: 7, width: 7, surface: 'gravel' },
    { x: -370, z: 1420, y: 6, width: 8, surface: 'asphalt' },
    { x: -300, z: 1500, y: 5, width: 8, surface: 'asphalt' },
    // Junction: the asphalt road continues, the stage turns off left onto gravel towards the finish
    { x: -180, z: 1530, y: 4, width: 8, surface: 'asphalt' },
    { x: -140, z: 1550, y: 4, width: 7, surface: 'gravel' },
    { x: -100, z: 1620, y: 3, width: 7, surface: 'gravel' },
    { x: -90, z: 1720, y: 3, width: 7, surface: 'gravel' },
    { x: -90, z: 1760, y: 3, width: 7, surface: 'gravel' },
    // Run-off after the finish
    { x: -90, z: 1820, y: 3, width: 7, surface: 'gravel' },
  ],
  spurs: [
    { points: [{ x: -330, z: 525 }, { x: -338, z: 610 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: -690, z: 700 }, { x: -770, z: 705 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: -370, z: 1420 }, { x: -440, z: 1445 }], width: 8, surface: 'asphalt' },
    { points: [{ x: -180, z: 1530 }, { x: -70, z: 1515 }], width: 8, surface: 'asphalt' },
  ],
};
