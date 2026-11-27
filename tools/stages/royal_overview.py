"""Royal Rally: rallyts översiktskarta (utan GPS-punkter) -> orange/gröna pixlar och en global transform
pixel -> meter från ortsnamnen på kartan. Användning: python3 -I royal_overview.py (kör före overview_local.py).
Kartan ska ligga i ../maps/royal/overview2025.jpg (se README.md)."""
import json, math, os, struct, subprocess, sys, urllib.parse, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); M = os.path.join(HERE, 'maps/royal'); G = os.path.join(HERE, 'royal')
bmp = M + '/overview.bmp'; subprocess.run(['sips', '-s', 'format', 'bmp', M + '/overview2025.jpg', '--out', bmp], check=True, capture_output=True)
b = open(bmp, 'rb').read(); off = struct.unpack_from('<I', b, 10)[0]; w, h = struct.unpack_from('<ii', b, 18); bpp = struct.unpack_from('<H', b, 28)[0]
row = ((w*bpp//8)+3) & ~3; flip = h > 0; h = abs(h)
orange, green = [], []
for y in range(h):
    for x in range(w):
        i = off + ((h-1-y) if flip else y)*row + x*(bpp//8); B, Gr, R = b[i], b[i+1], b[i+2]
        if R > 190 and 80 < Gr < 160 and B < 80: orange.append((x, y))
        elif Gr > 110 and R < 130 and B < 100 and Gr - R > 30 and Gr - B > 40: green.append((x, y))
json.dump(orange, open(M + '/orange.json', 'w')); json.dump(green, open(M + '/green.json', 'w'))
print('orange', len(orange), 'green', len(green), file=sys.stderr)
if not os.path.exists(G + '/towns.json'):
    q = '[out:json][timeout:60];node["place"~"town|village"]["name"~"^(Karlstad|Sunne|Kil|Forshaga|Kristinehamn|Munkfors|Storfors|Säffle|Deje|Hagfors|Filipstad|Väse|Grums|Vålberg|Skattkärr|Molkom|Torsby|Slottsbron)$"](59.0,12.3,60.3,14.8);out;'
    req = urllib.request.Request('https://maps.mail.ru/osm/tools/overpass/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'rally-sim-research/0.1'})
    open(G + '/towns.json', 'wb').write(urllib.request.urlopen(req, timeout=120).read())
# Ortsnamnens läge på kartan, avlästa i en nedskalad bild (1131 px bred) och skalade till originalet.
k = 3052 / 1131
towns = {t['tags']['name']: (t['lat'], t['lon']) for t in json.load(open(G + '/towns.json'))['elements']}
labels = {'Sunne': (222, 481), 'Kil': (342, 1023), 'Forshaga': (490, 965), 'Deje': (465, 868), 'Munkfors': (530, 500), 'Hagfors': (622, 183),
          'Molkom': (685, 848), 'Filipstad': (1035, 690), 'Väse': (765, 1180), 'Skattkärr': (612, 1165), 'Vålberg': (210, 1150), 'Kristinehamn': (948, 1285), 'Säffle': (25, 1593)}
LAT0, LON0 = 59.6, 13.5; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
m = lambda lat, lon: ((lon - LON0) * KX, (lat - LAT0) * KY)
P = [(x * k, y * k) for x, y in labels.values()]; Q = [m(*towns[n]) for n in labels]
def solve3(A, y):
    def det(M): return M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1])-M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0])+M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0])
    Dt = det(A); out = []
    for c in range(3):
        Mm = [r[:] for r in A]
        for r in range(3): Mm[r][c] = y[r]
        out.append(det(Mm) / Dt)
    return out
A = [[0]*3 for _ in range(3)]; bx = [0]*3; by = [0]*3
for (x, y), (qx, qy) in zip(P, Q):
    v = (x, y, 1)
    for i in range(3):
        bx[i] += v[i]*qx; by[i] += v[i]*qy
        for j in range(3): A[i][j] += v[i]*v[j]
AX, AY = solve3(A, bx), solve3(A, by)
for n, (x, y), q in zip(labels, P, Q):
    print(n.ljust(13), 'residual m', round(math.hypot(AX[0]*x+AX[1]*y+AX[2]-q[0], AY[0]*x+AY[1]*y+AY[2]-q[1])), file=sys.stderr)
json.dump({'AX': AX, 'AY': AY, 'LAT0': LAT0, 'LON0': LON0}, open(G + '/global_affine.json', 'w'))
