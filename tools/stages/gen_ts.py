import json, sys
parts, const, desc = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
print(f'''/**
 * {desc}
 * Vägen följer OpenStreetMap och höjden EU-DEM, samplad var 20:e meter med lätt utjämning. Varje
 * del har origo i sin startpunkt: x väster, z norr, y höjd över starten, i meter.
 *
 * Vägdata © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 * Höjd: EU-DEM v1.1 via OpenTopoData, framställd med Copernicus-data finansierad av EU.
 * Datan i den här filen är härledd från OpenStreetMap och delas under ODbL 1.0.
 */

import type {{ RealStagePart }} from '../stage';

export const {const}: RealStagePart[] = [''')
for p in parts:
    print(f"  {{\n    name: '{p['name']}',\n    road: [")
    for r in p['road']: print('      [' + ', '.join(str(v) for v in r) + '],')
    print('    ],\n    spurs: [')
    for sp in p['spurs']: print('      [' + ', '.join(f"{{ x: {q['x']}, z: {q['z']} }}" for q in sp) + '],')
    print('    ],\n  },')
print('];')
