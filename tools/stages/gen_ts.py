import json, sys
parts, const, desc = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
print(f'''/**
 * {desc}
 * The road follows OpenStreetMap and the elevation EU-DEM, sampled every 20 m with light smoothing.
 * Each part has its origin at its start point: x west, z north, y height above the start, in metres.
 *
 * Road data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 * Elevation: EU-DEM v1.1 via OpenTopoData, produced using Copernicus data funded by the EU.
 * The data in this file is derived from OpenStreetMap and shared under ODbL 1.0.
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
