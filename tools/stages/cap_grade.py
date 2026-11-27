"""Begränsar lutningen i en datafil för verkliga etapper (road: [x, z, y(, w)]) utan att röra x/z."""
import math, re, sys
p, g = sys.argv[1], float(sys.argv[2]); src = open(p).read()
out, worst_before, worst_after = [], 0, 0
parts = re.split(r'(    road: \[\n)', src)
res = parts[0]
for k in range(1, len(parts), 2):
    head, body = parts[k], parts[k+1]
    end = body.index('    ],\n')
    lines = body[:end].splitlines()
    toks = [re.findall(r'-?\d+(?:\.\d+)?', l) for l in lines]
    vals = [[float(v) for v in t] for t in toks]
    seg = [math.hypot(vals[i+1][0]-vals[i][0], vals[i+1][1]-vals[i][1]) for i in range(len(vals)-1)]
    ys = [v[2] for v in vals]
    worst_before = max(worst_before, max(abs(ys[i+1]-ys[i]) / max(seg[i], 1e-6) for i in range(len(seg))))
    for _ in range(5000):
        changed = False
        for i in range(len(ys)-1):
            # Startrakan (första 60 m) nästan plan, så en bil kommer iväg från stillastående på snö.
            d = ys[i+1] - ys[i]; lim = (0.05 if sum(seg[:i]) < 60 else g) * seg[i]
            if abs(d) > lim + 1e-3:
                adj = (abs(d) - lim) / 2 * (1 if d > 0 else -1); ys[i] += adj; ys[i+1] -= adj; changed = True
        if not changed: break
    ys = [y - ys[0] for y in ys]  # starten ligger kvar på höjd 0
    worst_after = max(worst_after, max(abs(ys[i+1]-ys[i]) / max(seg[i], 1e-6) for i in range(len(seg))))
    new = []
    for t, y0_, y in zip(toks, [v[2] for v in vals], ys):
        yt = t[2] if abs(round(y, 1) - y0_) < 1e-9 else repr(round(y, 1))
        new.append('      [' + ', '.join([t[0], t[1], yt] + t[3:]) + '],')
    res += head + '\n'.join(new) + '\n' + body[end:]
open(p, 'w').write(res)
print(p.split('/')[-1], 'max grade %.0f %% -> %.1f %%' % (worst_before * 100, worst_after * 100))
