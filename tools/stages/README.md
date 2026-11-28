# The stage generator

The scripts that build `src/physics/real/*.ts` from the rally's stage maps, OpenStreetMap and EU-DEM.
Python 3 without extra packages; `sips` (macOS) reads the map images.

Each special stage has a folder with:

- `config.json`: map image (relative to the folder), anchor points `[px, py, lat, lon]`, start, finish,
  optional `via` points and `bbox`, the parts `[name, from_m, to_m]` and `max_grade`.
- `route.json`: the finished route in lat/lon, where on Earth the stage lies.
- `affine.json`: the transform map pixel → metres.
- `elev.json`: the elevation from OpenTopoData, saved so the API is not needed again.

`maps/` (the rally's maps), `map.osm` and intermediate files are not checked in; see `.gitignore`.

## The rally's maps

Put them in `maps/` before running the `red` and `route` steps:

| Folder | File | Source |
|---|---|---|
| `maps/byg/p1.png` | page 1 as PNG | rallysweden.com, `rally-sweden-2026-ss-*.pdf` for Bygdsiljum |
| `maps/back/p1.png` | page 1 as PNG | rallysweden.com, `rally-sweden-2026-ss-*.pdf` for Bäck |
| `maps/royal/overview2025.jpg` | the overview map | https://ercroyalrally.com/wp-content/uploads/2025/05/RROS2025_Oversiktskarta_250505-High-Res-3052x4316.jpg |

## Regenerating a stage

Rally Sweden (stage maps with GPS points), e.g. Bygdsiljum:

```sh
python3 -I tools/stages/pipeline.py tools/stages/bygdsiljum/config.json red osm fit route parts
python3 -I tools/stages/gen_ts.py tools/stages/bygdsiljum/parts.json BYGDSILJUM '<description>' > src/physics/real/bygdsiljum.ts
python3 -I tools/stages/cap_grade.py src/physics/real/bygdsiljum.ts 0.12   # snow stages: 12 %, 5 % for the first 60 m
```

Royal Rally (overview map without GPS points), e.g. Värmskog:

```sh
python3 -I tools/stages/royal_overview.py          # once: the colours and place names → global transform
python3 -I tools/stages/overview_local.py tools/stages/varmskog/config.json   # OSM via Overpass, affine.json, red.json
python3 -I tools/stages/pipeline.py tools/stages/varmskog/config.json route parts
python3 -I tools/stages/gen_ts.py tools/stages/varmskog/parts.json VARMSKOG '<description>' > src/physics/real/varmskog.ts
```

Running only `parts` (a new split or smoothing) needs just `route.json` and `elev.json` plus an
OSM extract for the junctions: run the `osm` step with a `bbox` around the route, or `overview_local.py`.

Andersvattnet was made before `pipeline.py`: `andersvattnet/parts.py` reads `route.json` (with the OSM way per
point) and `elev_full.json`, then `gen_ts.py` and `cap_grade.py` as above.

`<description>` is the first paragraph of the file's comment; take it from the existing file. After a changed
road: update `src/physics/real/lengths.ts` (the physics test prints the right value) and bump the stage's version.

## Landmarks

`landmarks.py` fetches OSM objects around each route (fields, farms and houses, lakes, power lines,
streams and named crests) via Overpass into `<stage>/features.json` and writes them as spans along
the road:

```sh
python3 -I tools/stages/landmarks.py > src/physics/real/landmarks.ts
```

With the current `route.json`, `elev.json` and the OSM extracts from November 2026 the scripts produce exactly the
checked-in files. A new OSM extract can give different junctions or a different route.
