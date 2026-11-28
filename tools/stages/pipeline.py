"""Real special stage -> stage parts. Usage: python3 -I pipeline.py <config.json> <steps...>
Steps: red, osm, fit, route, parts. Config: map (png, relative), anchors [[px,py,lat,lon]...], start [px,py],
goal [px,py], parts [[name, from_m, to_m]...]. Working folder: the config's folder."""
import json, math, sys, struct, subprocess, heapq, os, time, urllib.request
import xml.etree.ElementTree as ET
# The working folder is the config's folder; 'map' is given relative to it.
cfg = json.load(open(sys.argv[1])); D = os.path.dirname(os.path.abspath(sys.argv[1]))
steps = sys.argv[2:]
HW = ('primary','secondary','tertiary','unclassified','residential','service','track','road')
def load(n): return json.load(open(f'{D}/{n}'))
def save(n, v): json.dump(v, open(f'{D}/{n}', 'w'))

if 'red' in steps:
    bmp = f'{D}/map.bmp'; subprocess.run(['sips', '-s', 'format', 'bmp', os.path.join(D, cfg['map']), '--out', bmp], check=True, capture_output=True)
    b = open(bmp, 'rb').read(); off = struct.unpack_from('<I', b, 10)[0]; w, h = struct.unpack_from('<ii', b, 18); bpp = struct.unpack_from('<H', b, 28)[0]
    row = ((w * bpp // 8) + 3) & ~3; flip = h > 0; h = abs(h); pts = []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            i = off + ((h - 1 - y) if flip else y) * row + x * (bpp // 8); B, G, R = b[i], b[i+1], b[i+2]
            # Redness instead of fixed thresholds: the line is semi-transparent and takes on different hues over different backgrounds.
            if R > 140 and R - G > 90 and R - B > 80 and G < 110: pts.append((x, y))
    save('red.json', pts); print('red px', len(pts), file=sys.stderr)

lats = [a[2] for a in cfg['anchors']]; lons = [a[3] for a in cfg['anchors']]
LAT0, LON0 = sum(lats) / len(lats), sum(lons) / len(lons)
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
def m(lat, lon): return ((lon - LON0) * KX, (lat - LAT0) * KY)

if 'osm' in steps:
    pad = 0.04; bb = tuple(cfg['bbox']) if 'bbox' in cfg else (min(lons) - pad * 2, min(lats) - pad, max(lons) + pad * 2, max(lats) + pad)
    url = 'https://api.openstreetmap.org/api/0.6/map?bbox=%.4f,%.4f,%.4f,%.4f' % bb
    req = urllib.request.Request(url, headers={'User-Agent': 'rally-sim-research/0.1'})
    open(f'{D}/map.osm', 'wb').write(urllib.request.urlopen(req, timeout=180).read()); print('osm ok', bb, file=sys.stderr)

def roads():
    root = ET.parse(f'{D}/map.osm').getroot()
    nodes = {n.get('id'): (float(n.get('lat')), float(n.get('lon'))) for n in root.iter('node')}
    ways = []
    for w in root.iter('way'):
        tags = {t.get('k'): t.get('v') for t in w.iter('tag')}
        if tags.get('highway') in HW: ways.append((w.get('id'), tags, [r.get('ref') for r in w.iter('nd') if r.get('ref') in nodes]))
    return nodes, ways

def solve3(A, y):
    def det(M): return M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1])-M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0])+M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0])
    Dt = det(A); out = []
    for c in range(3):
        M = [r[:] for r in A]
        for r in range(3): M[r][c] = y[r]
        out.append(det(M) / Dt)
    return out
def lstsq(P, Q):
    A = [[0]*3 for _ in range(3)]; bx = [0]*3; by = [0]*3
    for (x, y), (qx, qy) in zip(P, Q):
        v = (x, y, 1)
        for i in range(3):
            bx[i] += v[i]*qx; by[i] += v[i]*qy
            for j in range(3): A[i][j] += v[i]*v[j]
    return solve3(A, bx), solve3(A, by)

if 'fit' in steps:
    nodes, ways = roads(); segs = []
    for _, _, refs in ways:
        for a, b in zip(refs, refs[1:]): segs.append((m(*nodes[a]), m(*nodes[b])))
    G = 200.0; grid = {}
    for i, (a, b) in enumerate(segs):
        for gx in range(int(min(a[0], b[0]) // G), int(max(a[0], b[0]) // G) + 1):
            for gy in range(int(min(a[1], b[1]) // G), int(max(a[1], b[1]) // G) + 1): grid.setdefault((gx, gy), []).append(i)
    def nearest(p):
        best = (1e18, None); gx, gy = int(p[0] // G), int(p[1] // G)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in grid.get((gx+dx, gy+dy), []):
                    a, b = segs[i]; vx, vy = b[0]-a[0], b[1]-a[1]; L = vx*vx + vy*vy or 1e-9
                    t = max(0, min(1, ((p[0]-a[0])*vx + (p[1]-a[1])*vy) / L)); q = (a[0]+t*vx, a[1]+t*vy)
                    d = (q[0]-p[0])**2 + (q[1]-p[1])**2
                    if d < best[0]: best = (d, q)
        return best
    if 'scale' in cfg:
        a0 = cfg['anchors'][cfg.get('anchor', 0)]; k = cfg['scale']; e0, n0 = m(a0[2], a0[3])
        AX, AY = [k, 0, e0 - k * a0[0]], [0, -k, n0 + k * a0[1]]
    else:
        AX, AY = lstsq([(a[0], a[1]) for a in cfg['anchors']], [m(a[2], a[3]) for a in cfg['anchors']])
    res = [(math.hypot(AX[0]*a[0]+AX[1]*a[1]+AX[2]-m(a[2],a[3])[0], AY[0]*a[0]+AY[1]*a[1]+AY[2]-m(a[2],a[3])[1])) for a in cfg['anchors']]
    print('anchor residuals m', [round(r) for r in res], file=sys.stderr)
    red = load('red.json')
    for it in range(12):
        P, Q, ds = [], [], []
        for p in red:
            d, q = nearest((AX[0]*p[0]+AX[1]*p[1]+AX[2], AY[0]*p[0]+AY[1]*p[1]+AY[2]))
            if q is not None and d < 150**2: P.append(p); Q.append(q); ds.append(math.sqrt(d))
        ds.sort()
        if cfg.get('fit') == 'translate':
            # Translation only: scale and rotation stay fixed (a dense town road network otherwise pulls it askew).
            ex = sum(q[0] - (AX[0]*p[0]+AX[1]*p[1]+AX[2]) for p, q in zip(P, Q)) / len(P)
            ny = sum(q[1] - (AY[0]*p[0]+AY[1]*p[1]+AY[2]) for p, q in zip(P, Q)) / len(P)
            AX = [AX[0], AX[1], AX[2] + ex]; AY = [AY[0], AY[1], AY[2] + ny]
        else: AX, AY = lstsq(P, Q)
    print('fit median', round(ds[len(ds)//2], 1), 'p90', round(ds[int(len(ds)*.9)], 1), file=sys.stderr)
    save('affine.json', {'AX': AX, 'AY': AY})

if 'route' in steps:
    nodes, ways = roads(); aff = load('affine.json'); AX, AY = aff['AX'], aff['AY']
    tf = lambda p: (AX[0]*p[0]+AX[1]*p[1]+AX[2], AY[0]*p[0]+AY[1]*p[1]+AY[2])
    red = [tf(p) for p in load('red.json')]; RG = 50.0; rg = {}
    for p in red: rg.setdefault((int(p[0]//RG), int(p[1]//RG)), []).append(p)
    def rd(p):
        gx, gy = int(p[0]//RG), int(p[1]//RG); best = 1e9
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                for q in rg.get((gx+dx, gy+dy), []): best = min(best, math.hypot(p[0]-q[0], p[1]-q[1]))
        return best
    adj = {}; wayof = {}
    for wid, tags, refs in ways:
        for a, b in zip(refs, refs[1:]):
            pa, pb = m(*nodes[a]), m(*nodes[b]); L = math.hypot(pb[0]-pa[0], pb[1]-pa[1])
            d = min(rd(pa), rd(pb), rd(((pa[0]+pb[0])/2, (pa[1]+pb[1])/2)))
            c = L * (1 + (min(d, 400) / 40) ** 2)
            adj.setdefault(a, []).append((b, c)); adj.setdefault(b, []).append((a, c)); wayof[(a, b)] = wayof[(b, a)] = wid
    # Gaps in OSM: where a road ends near the red line, the route follows the line on the map
    # (a pixel graph through the red pixels) to the nearest other road. Costs three times more than OSM.
    raw = load('red.json'); pix = {(p[0], p[1]) for p in raw}
    det = AX[0]*AY[1] - AX[1]*AY[0]
    def topx(e, n): e -= AX[2]; n -= AY[2]; return ((AY[1]*e - AX[1]*n)/det, (-AY[0]*e + AX[0]*n)/det)
    mpp = math.hypot(AX[0], AY[0])  # metres per pixel
    def nearpix(p, r=12):
        x, y = topx(*p); best = None
        for q in pix:
            d = (q[0]-x)**2 + (q[1]-y)**2
            if d < r*r and (best is None or d < best[0]): best = (d, q)
        return best[1] if best else None
    deg = {n: len(v) for n, v in adj.items()}
    near = [n for n in adj if rd(m(*nodes[n])) < 30]
    npix = {}
    for n in near:
        q = nearpix(m(*nodes[n]))
        if q: npix.setdefault(q, []).append(n)
    virtual = {}
    for A in [n for n in near if deg[n] == 1]:
        src = nearpix(m(*nodes[A]))
        if not src: continue
        dist2 = {src: 0}; prv = {}; pq2 = [(0, src)]; limit = 2500 / mpp
        while pq2:
            dd, u = heapq.heappop(pq2)
            if dd > dist2[u] or dd > limit: continue
            for dx in (-2, 0, 2):
                for dy in (-2, 0, 2):
                    v = (u[0]+dx, u[1]+dy)
                    if v == u or v not in pix: continue
                    nd = dd + math.hypot(dx, dy)
                    if nd < dist2.get(v, 1e18): dist2[v] = nd; prv[v] = u; heapq.heappush(pq2, (nd, v))
        for q, Bs in npix.items():
            if q not in dist2 or dist2[q] * mpp < 100: continue
            for B in Bs:
                if B == A: continue
                path = [q]
                while path[-1] != src: path.append(prv[path[-1]])
                geo = [tf(pp) for pp in reversed(path[::3])]
                c = 3 * dist2[q] * mpp
                adj[A].append((B, c)); adj[B].append((A, c)); virtual[(A, B)] = geo; virtual[(B, A)] = geo[::-1]
    print('bridges', len(virtual) // 2, file=sys.stderr)
    nn = lambda p: min(adj, key=lambda n: math.hypot(m(*nodes[n])[0]-p[0], m(*nodes[n])[1]-p[1]))
    # The route goes via the waypoints in order ('via', pixels), e.g. when start and finish are close together.
    stops = [nn(tf(p)) for p in [cfg['start'], *cfg.get('via', []), cfg['goal']]]
    path = [stops[0]]
    for start, goal in zip(stops, stops[1:]):
        dist = {start: 0}; prev = {}; pq = [(0, start)]
        while pq:
            dd, u = heapq.heappop(pq)
            if u == goal: break
            if dd > dist[u]: continue
            for v, c in adj[u]:
                if dd + c < dist.get(v, 1e18): dist[v] = dd + c; prev[v] = u; heapq.heappush(pq, (dd + c, v))
        leg = [goal]
        while leg[-1] != start: leg.append(prev[leg[-1]])
        path += leg[::-1][1:]
    pts = [m(*nodes[path[0]])]; traced = 0
    for a, b in zip(path, path[1:]):
        if (a, b) in virtual:
            g = virtual[(a, b)]; traced += sum(math.hypot(q[0]-p[0], q[1]-p[1]) for p, q in zip(g, g[1:])); pts += g
        pts.append(m(*nodes[b]))
    print('traced from map km', round(traced / 1000, 2), file=sys.stderr)
    L = sum(math.hypot(b[0]-a[0], b[1]-a[1]) for a, b in zip(pts, pts[1:])); off = sorted(rd(p) for p in pts)
    print('route km', round(L/1000, 2), 'max off red', round(off[-1]), 'p90', round(off[int(len(off)*.9)]), file=sys.stderr)
    save('route.json', [{'lat': LAT0 + n / KY, 'lon': LON0 + e / KX} for e, n in pts])

if 'parts' in steps:
    route = load('route.json'); nodes, ways = roads()
    P = [m(p['lat'], p['lon']) for p in route]; s = [0.0]
    for a, b in zip(P, P[1:]): s.append(s[-1] + math.hypot(b[0]-a[0], b[1]-a[1]))
    TOTAL = s[-1]
    def at(d):
        d = min(max(d, 0), TOTAL)
        for i in range(len(s)-1):
            if s[i+1] >= d:
                t = (d - s[i]) / ((s[i+1]-s[i]) or 1); return (P[i][0]+(P[i+1][0]-P[i][0])*t, P[i][1]+(P[i+1][1]-P[i][1])*t)
    STEP = 20; full = [at(d) for d in range(0, int(TOTAL) + 1, STEP)]
    sm = [full[0]] + [((full[i-1][0]+2*full[i][0]+full[i+1][0])/4, (full[i-1][1]+2*full[i][1]+full[i+1][1])/4) for i in range(1, len(full)-1)] + [full[-1]]
    # Corners at junctions (OSM nodes at right angles) are smoothed to at least about 15 m radius, so a car gets round.
    MIN_R = 30.0; moved = 0
    for it in range(200):
        changed = False
        for i in range(1, len(sm)-1):
            a, b, c = sm[i-1], sm[i], sm[i+1]
            h1, h2 = math.atan2(b[1]-a[1], b[0]-a[0]), math.atan2(c[1]-b[1], c[0]-b[0])
            ang = abs(math.atan2(math.sin(h2-h1), math.cos(h2-h1)))
            if ang > 1e-6 and STEP / ang < MIN_R:
                nb = (0.5*b[0] + 0.25*(a[0]+c[0]), 0.5*b[1] + 0.25*(a[1]+c[1])); moved = max(moved, math.hypot(nb[0]-full[i][0], nb[1]-full[i][1])); sm[i] = nb; changed = True
        if not changed: break
    print('corner smoothing: max shift m', round(moved, 1), file=sys.stderr)
    if os.path.exists(f'{D}/elev.json') and len(load('elev.json')) == len(sm): ys = load('elev.json')
    else:
        lls = [(LAT0 + n / KY, LON0 + e / KX) for e, n in sm]; ys = []
        for k in range(0, len(lls), 100):
            q = '|'.join(f'{a:.6f},{b:.6f}' for a, b in lls[k:k+100])
            req = urllib.request.Request('https://api.opentopodata.org/v1/eudem25m?locations=' + q, headers={'User-Agent': 'rally-sim-research/0.1'})
            ys += [r['elevation'] for r in json.load(urllib.request.urlopen(req, timeout=60))['results']]; time.sleep(1.1)
        save('elev.json', ys)
    ys = [(ys[max(0,i-1)] + 2*ys[i] + ys[min(len(ys)-1,i+1)]) / 4 for i in range(len(ys))]
    # The elevation data (25 m) picks up shore banks and ditches beside the road. With 'max_grade' the
    # profile is smoothed where it is steeper, but only there, so hills and crests otherwise stay.
    if 'max_grade' in cfg:
        g = cfg['max_grade']; seg = [math.hypot(sm[i+1][0]-sm[i][0], sm[i+1][1]-sm[i][1]) for i in range(len(sm)-1)]
        for _ in range(2000):
            changed = False
            for i in range(len(ys)-1):
                d = ys[i+1] - ys[i]; lim = g * seg[i]
                if abs(d) > lim + 1e-3:
                    adj = (abs(d) - lim) / 2 * (1 if d > 0 else -1); ys[i] += adj; ys[i+1] -= adj; changed = True
            if not changed: break
        print('max grade after', round(max(abs(ys[i+1]-ys[i]) / max(seg[i], 1e-6) for i in range(len(ys)-1)) * 100, 1), '%', file=sys.stderr)
    ridx = {(round(p['lat'], 7), round(p['lon'], 7)): i for i, p in enumerate(route)}
    def segd(q, A, B):
        vx, vy = B[0]-A[0], B[1]-A[1]; L2 = vx*vx + vy*vy or 1e-9
        t = max(0, min(1, ((q[0]-A[0])*vx + (q[1]-A[1])*vy) / L2)); return math.hypot(A[0]+vx*t-q[0], A[1]+vy*t-q[1])
    out = []
    for name, a, b in cfg['parts']:
        b = min(b, int(TOTAL)); i0, i1 = a // STEP, min(len(sm)-1, b // STEP); ox, oz = sm[i0]
        loc = lambda e, n: (-(e - ox), n - oz)
        # Wider road in tight corners (under about 30 m radius), as at a junction where the car can use the mouth.
        def sharp(i):
            if i <= 0 or i >= len(sm) - 1: return False
            a, b, c = sm[i-1], sm[i], sm[i+1]
            h1, h2 = math.atan2(b[1]-a[1], b[0]-a[0]), math.atan2(c[1]-b[1], c[0]-b[0])
            ang = abs(math.atan2(math.sin(h2-h1), math.cos(h2-h1)))
            return ang > 1e-6 and STEP / ang < 30
        wide = lambda i: any(sharp(j) for j in (i-1, i, i+1))
        pts = [(*loc(*sm[i]), ys[i] - ys[i0], 8 if wide(i) else 6) for i in range(i0, i1 + 1)]
        road = sm[max(0, i0-2):i1+3]; droad = lambda q: min(segd(q, A, B) for A, B in zip(road, road[1:]))
        spurs = []
        for _, _, refs in ways:
            for k, ref in enumerate(refs):
                ri = ridx.get((round(nodes[ref][0], 7), round(nodes[ref][1], 7)))
                if ri is None or not (a + 40 < s[ri] < b - 60): continue
                for dirn in (1, -1):
                    seq = [m(*nodes[refs[j]]) for j in range(k, len(refs) if dirn > 0 else -1, dirn)]
                    if len(seq) < 2: continue
                    ps = [seq[0]]; L = 0
                    for pa, pb in zip(seq, seq[1:]):
                        d = math.hypot(pb[0]-pa[0], pb[1]-pa[1])
                        if L + d >= 80: t = (80-L)/d; ps.append((pa[0]+(pb[0]-pa[0])*t, pa[1]+(pb[1]-pa[1])*t)); L = 80; break
                        L += d; ps.append(pb)
                    if L < 40: continue
                    # The first point after the junction at least 20 m away, so the direction and the barrier come out right.
                    ps = [ps[0]] + [q for q in ps[1:-1] if math.hypot(q[0]-ps[0][0], q[1]-ps[0][1]) >= 20] + [ps[-1]]
                    dense = []; acc = 0
                    for pa, pb in zip(ps, ps[1:]):
                        d = math.hypot(pb[0]-pa[0], pb[1]-pa[1]); n = max(1, int(d // 5))
                        for kk in range(1, n+1): acc += d/n; dense.append((acc, (pa[0]+(pb[0]-pa[0])*kk/n, pa[1]+(pb[1]-pa[1])*kk/n)))
                    if any(dd >= 15 and droad(q) < 12 for dd, q in dense): continue
                    if any(math.hypot(ps[-1][0]-o[-1][0], ps[-1][1]-o[-1][1]) < 40 for o in spurs): continue
                    spurs.append(ps)
        sep = min([math.hypot(pts[i][0]-pts[j][0], pts[i][1]-pts[j][1]) for i in range(len(pts)) for j in range(i+8, len(pts))] or [1e9])
        print(name, f'{(b-a)/1000:.1f} km', 'elev', round(min(p[2] for p in pts)), round(max(p[2] for p in pts)), 'spurs', len(spurs), 'closest', round(sep), file=sys.stderr)
        out.append({'name': name, 'road': [[round(x, 1), round(z, 1), round(y, 1)] + ([w] if w != 6 else []) for x, z, y, w in pts], 'spurs': [[{'x': round(loc(*q)[0]), 'z': round(loc(*q)[1])} for q in sp] for sp in spurs]})
    print('total km', round(TOTAL/1000, 2), file=sys.stderr); save('parts.json', out)
