# Etappgeneratorn

Skripten som gör `src/physics/real/*.ts` av rallyts sträckkartor, OpenStreetMap och EU-DEM.
Python 3 utan extra paket; `sips` (macOS) läser in kartbilderna.

Varje sträcka har en mapp med:

- `config.json`: kartbild (relativt mappen), ankarpunkter `[px, py, lat, lon]`, start, mål,
  ev. `via`-punkter och `bbox`, delarna `[namn, från_m, till_m]` och `max_grade`.
- `route.json`: den färdiga rutten i lat/lon, var på jorden etappen ligger.
- `affine.json`: transformen kartpixel → meter.
- `elev.json`: höjden från OpenTopoData, sparad så att API:t inte behövs igen.

`maps/` (rallyts kartor), `map.osm` och mellanfiler checkas inte in; se `.gitignore`.

## Rallyts kartor

Lägg dem i `maps/` innan stegen `red` och `route` körs:

| Mapp | Fil | Källa |
|---|---|---|
| `maps/byg/p1.png` | sida 1 som PNG | rallysweden.com, `rally-sweden-2026-ss-*.pdf` för Bygdsiljum |
| `maps/back/p1.png` | sida 1 som PNG | rallysweden.com, `rally-sweden-2026-ss-*.pdf` för Bäck |
| `maps/royal/overview2025.jpg` | översiktskartan | https://ercroyalrally.com/wp-content/uploads/2025/05/RROS2025_Oversiktskarta_250505-High-Res-3052x4316.jpg |

## Göra om en etapp

Rally Sweden (sträckkartor med GPS-punkter), t.ex. Bygdsiljum:

```sh
python3 -I tools/stages/pipeline.py tools/stages/bygdsiljum/config.json red osm fit route parts
python3 -I tools/stages/gen_ts.py tools/stages/bygdsiljum/parts.json BYGDSILJUM '<beskrivning>' > src/physics/real/bygdsiljum.ts
python3 -I tools/stages/cap_grade.py src/physics/real/bygdsiljum.ts 0.12   # snöetapper: 12 %, 5 % första 60 m
```

Royal Rally (översiktskarta utan GPS-punkter), t.ex. Värmskog:

```sh
python3 -I tools/stages/royal_overview.py          # en gång: färgerna och ortsnamnen → global transform
python3 -I tools/stages/overview_local.py tools/stages/varmskog/config.json   # OSM via Overpass, affine.json, red.json
python3 -I tools/stages/pipeline.py tools/stages/varmskog/config.json route parts
python3 -I tools/stages/gen_ts.py tools/stages/varmskog/parts.json VARMSKOG '<beskrivning>' > src/physics/real/varmskog.ts
```

Bara `parts` (ny uppdelning eller utjämning) räcker med `route.json` och `elev.json` plus ett
OSM-uttag för korsningarna: kör `osm`-steget med en `bbox` runt rutten, eller `overview_local.py`.

Andersvattnet gjordes före `pipeline.py`: `andersvattnet/parts.py` läser `route.json` (med OSM-way per
punkt) och `elev_full.json`, därefter `gen_ts.py` och `cap_grade.py` som ovan.

`<beskrivning>` är första stycket i filens kommentar; ta det från den befintliga filen. Efter en ändrad
väg: uppdatera `src/physics/real/lengths.ts` (fysiktestet skriver ut rätt värde) och höj etappens version.

## Landmärken

`landmarks.py` hämtar OSM-objekt runt varje rutt (åkrar, gårdar och hus, sjöar, kraftledningar,
åar och namngivna krön) via Overpass till `<etapp>/features.json` och skriver dem som sträckor längs
vägen:

```sh
python3 -I tools/stages/landmarks.py > src/physics/real/landmarks.ts
```

Med dagens `route.json`, `elev.json` och OSM-uttagen från november 2026 ger skripten exakt de
incheckade filerna. Ett nytt OSM-uttag kan ge andra korsningar eller en annan rutt.
