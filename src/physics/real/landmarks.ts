/**
 * Landmärken längs etapperna ur OpenStreetMap: åkrar, gårdar, sjöar, kraftledningar, broar och krön,
 * som sträckor längs vägen (m från etappens start). side 1 = vänster i färdriktningen, -1 = höger,
 * 0 = tvärs över. Genererad av tools/stages/landmarks.py.
 *
 * Kartdata © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 */

import type { Landmark } from '../stage';

export const LANDMARKS: Record<string, Landmark[]> = {
  'Grinsbol': [
    { kind: 'power', side: 0, from: 335, to: 335 },
    { kind: 'field', side: 1, from: 1630, to: 1740 },
    { kind: 'field', side: 1, from: 1990, to: 2140 },
    { kind: 'field', side: -1, from: 2400, to: 2470 },
  ],
  'Tollesrud': [
    { kind: 'power', side: 0, from: 4120, to: 4120 },
    { kind: 'field', side: 1, from: 4210, to: 4370 },
    { kind: 'field', side: -1, from: 4350, to: 4700 },
    { kind: 'farm', side: 1, from: 4430, to: 4650 },
    { kind: 'field', side: 1, from: 4660, to: 4700 },
  ],
  'Åsterud': [
    { kind: 'field', side: -1, from: 0, to: 240 },
    { kind: 'farm', side: 1, from: 0, to: 50 },
    { kind: 'field', side: 1, from: 60, to: 130 },
    { kind: 'field', side: 1, from: 540, to: 920 },
    { kind: 'power', side: 0, from: 823, to: 823 },
    { kind: 'field', side: 1, from: 980, to: 1250 },
    { kind: 'power', side: 0, from: 1595, to: 1595 },
    { kind: 'power', side: 0, from: 1706, to: 1706 },
    { kind: 'power', side: 0, from: 2017, to: 2017 },
    { kind: 'power', side: 0, from: 3530, to: 3530 },
    { kind: 'farm', side: -1, from: 4260, to: 4340 },
    { kind: 'power', side: 0, from: 4615, to: 4615 },
  ],
  'Botten': [
    { kind: 'lake', side: 1, from: 5400, to: 5460 },
  ],
  'Rannsjön': [
    { kind: 'lake', side: 1, from: 5380, to: 5480 },
  ],
  'Larssäter': [
    { kind: 'bridge', side: 0, from: 152, to: 152 },
  ],
  'Stor-Jangen': [
    { kind: 'crest', side: 0, from: 3360, to: 3360 },
  ],
  'Bergtjärnen': [
    { kind: 'lake', side: 1, from: 3450, to: 3580 },
    { kind: 'lake', side: 1, from: 4220, to: 4300 },
  ],
  'Näs': [
    { kind: 'lake', side: -1, from: 1660, to: 1890 },
    { kind: 'lake', side: 1, from: 1670, to: 1900 },
  ],
  'Rickleån': [
    { kind: 'farm', side: 1, from: 3090, to: 3260 },
    { kind: 'farm', side: -1, from: 3300, to: 3450 },
  ],
  'Valsfäboda': [
    { kind: 'farm', side: -1, from: 0, to: 120 },
    { kind: 'farm', side: -1, from: 170, to: 260 },
    { kind: 'farm', side: -1, from: 340, to: 450 },
    { kind: 'farm', side: 1, from: 510, to: 560 },
    { kind: 'farm', side: -1, from: 630, to: 690 },
    { kind: 'farm', side: -1, from: 730, to: 780 },
    { kind: 'farm', side: 1, from: 920, to: 1000 },
    { kind: 'farm', side: 1, from: 1290, to: 1360 },
    { kind: 'farm', side: -1, from: 2620, to: 2720 },
    { kind: 'farm', side: 1, from: 2700, to: 2770 },
    { kind: 'farm', side: -1, from: 2800, to: 3010 },
    { kind: 'farm', side: 1, from: 2820, to: 2950 },
    { kind: 'farm', side: -1, from: 3260, to: 3350 },
  ],
  'Hösjöälven': [
    { kind: 'bridge', side: 0, from: 3541, to: 3541 },
    { kind: 'lake', side: -1, from: 3610, to: 3750 },
  ],
  'Flarkån': [
    { kind: 'bridge', side: 0, from: 1386, to: 1386 },
  ],
  'Södra Hulteby': [
    { kind: 'field', side: -1, from: 1250, to: 1430 },
    { kind: 'farm', side: 1, from: 1300, to: 1380 },
    { kind: 'field', side: 1, from: 1390, to: 1470 },
    { kind: 'field', side: 1, from: 1940, to: 2100 },
    { kind: 'field', side: -1, from: 3130, to: 3470 },
    { kind: 'field', side: 1, from: 3210, to: 3610 },
    { kind: 'farm', side: 1, from: 3650, to: 3720 },
    { kind: 'farm', side: -1, from: 3690, to: 3790 },
  ],
  'Ämten': [
    { kind: 'field', side: -1, from: 70, to: 140 },
    { kind: 'lake', side: 1, from: 320, to: 420 },
    { kind: 'farm', side: -1, from: 450, to: 510 },
    { kind: 'farm', side: 1, from: 530, to: 590 },
    { kind: 'farm', side: 1, from: 1600, to: 1890 },
    { kind: 'farm', side: -1, from: 1710, to: 1850 },
    { kind: 'farm', side: 1, from: 2200, to: 2280 },
    { kind: 'farm', side: 1, from: 3160, to: 3310 },
    { kind: 'field', side: 1, from: 4040, to: 4260 },
  ],
  'Lindås': [
    { kind: 'farm', side: -1, from: 320, to: 380 },
    { kind: 'farm', side: 1, from: 850, to: 940 },
    { kind: 'field', side: 1, from: 1350, to: 1490 },
    { kind: 'field', side: -1, from: 1810, to: 1860 },
    { kind: 'farm', side: -1, from: 1860, to: 1940 },
    { kind: 'field', side: 1, from: 1870, to: 2060 },
    { kind: 'field', side: -1, from: 2640, to: 2860 },
    { kind: 'farm', side: -1, from: 2880, to: 2950 },
    { kind: 'field', side: 1, from: 2900, to: 3020 },
  ],
  'Lungsund': [
    { kind: 'farm', side: -1, from: 190, to: 290 },
    { kind: 'field', side: -1, from: 290, to: 370 },
  ],
  'Sundstorp': [
    { kind: 'field', side: -1, from: 1030, to: 1900 },
  ],
  'Bäckelid': [
    { kind: 'field', side: 1, from: 2320, to: 2600 },
    { kind: 'field', side: 1, from: 3070, to: 3250 },
    { kind: 'farm', side: 1, from: 4640, to: 4720 },
    { kind: 'field', side: -1, from: 5170, to: 5570 },
    { kind: 'field', side: 1, from: 5480, to: 5560 },
  ],
  'Niklasdamm': [
    { kind: 'field', side: 1, from: 630, to: 710 },
    { kind: 'bridge', side: 0, from: 752, to: 752 },
    { kind: 'field', side: 1, from: 780, to: 1010 },
    { kind: 'farm', side: 1, from: 1770, to: 2000 },
    { kind: 'farm', side: -1, from: 3060, to: 3110 },
    { kind: 'farm', side: 1, from: 4130, to: 4220 },
  ],
  'Broby': [
    { kind: 'farm', side: 1, from: 1190, to: 1250 },
    { kind: 'farm', side: -1, from: 1410, to: 1550 },
    { kind: 'farm', side: 1, from: 1420, to: 1470 },
  ],
};
