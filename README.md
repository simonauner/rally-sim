# Rally

Browser game in early development. The goal is a rally simulator with a Colin McRae 2005 feel:
realistic car physics, a career with money and upgrades, fictional cars and brands.
This prototype proves only one thing: **does the car feel right to drive?**

## Running

```sh
npm install
npm run dev          # http://localhost:5173
npm run test:physics # physics tests without a browser
npm run build        # typecheck + production build in dist/
npm run build:single # a single HTML file in dist-single/
```

Requires WebGPU: Chrome/Edge, Firefox 141+ (Windows, ARM Mac) or Safari 26.
`?webgl` in the address forces the WebGL2 backend and is only meant for debugging.

## Controls

| Key | Function |
| --- | --- |
| W / S | Throttle / brake (S reverses when stopped) |
| A / D | Steer |
| Space | Handbrake |
| R | Back on the road where the car is (the clock keeps running; on the test track: to the start) |
| T | Restart the stage (repairs the car) |
| G | Ghost on/off |
| Esc | Pause menu (continue, restart, controls, main menu) |
| C | Change camera (chase near and far, bonnet, driver view, top-down, side view for damage); the choice is saved |
| M, E / Q | Manual gearbox |
| F1 | Debug on/off: telemetry, damage, g-force and the tuning panel (hidden at start) |
| F3 | Force vectors on/off (red = tyre force, blue = wheel load, green = direction of travel) |
| H | Hide/show help text |

Gamepad: left stick, RT/LT, A = handbrake. The tuning panel (F1) tunes the car while you drive.

## Menus

The game starts in a main menu: drive the stage, the test track, or view the controls. The world is built only
once you have chosen. Esc opens the pause menu; "Huvudmeny" reloads the page, since switching worlds while
driving is not supported. `?testbana` skips the menu and goes straight to the test track.

## The stages

All stages are real roads (`src/physics/real/`): special stages from Rally Sweden (snow) and
Royal Rally of Scandinavia (gravel), split into stages of 3.4–6 km and named after places along
the road. The geometry comes from OpenStreetMap and the elevation from EU-DEM.

| Championship | Class | Special stage | Stages |
|---|---|---|---|
| Skogsrallyt | 1 | Värmskog (gravel) | Grinsbol, Tollesrud, Åsterud at dusk |
| Myrkullarallyt | 1 | Gårdsjö and Colins (gravel) | Botten at dawn, Rannsjön, Larssäter, Stor-Jangen |
| Vinterrallyt | 1 | Bygdsiljum (snow) | Åsjön, Altarliden, Bergtjärnen, Torpet, Trollberget at night |
| Forsrallyt | 1 | Bäck (snow) | Näs, Rickleån, Valsfäboda at dusk |
| Tallmoklassikern | 2 | Royal Forest (gravel) | Södra Hulteby, Ämten, Lindås, Lungsund |
| Ljunghedsrallyt | 2 | Ängebäckstorp and Ölme (gravel) | Sundstorp, Bäckelid, Niklasdamm, Broby at dusk |
| Israllyt | 2 | Andersvattnet (snow) | Storberget, Hösjöälven, Röjmyrberget, Flarkån at dusk |

Rally Sweden's stage maps have GPS points; Royal Rally's stages are traced from the rally's
overview map (about 26 m per pixel) and can be off by ±50 m. Where a forest road is missing from OpenStreetMap it is
traced from the map. Corners at junctions are smoothed and widened so the car gets round,
the gradient on the gravel stages is capped at 12 % (otherwise the elevation data picks up steep banks beside the
road), and after the finish there are 240 m to stop in. Beyond the road edge the terrain follows an average of
the surrounding road, so there are no ledges on the inside of tight corners. Road data © OpenStreetMap
contributors, ODbL 1.0; the derived data in `src/physics/real/` is shared under the same licence.
Along the road stands what the map shows: fields with fences and bales, red farmhouses, lakes and
ponds, power lines, bridges over streams and the crowd at Colin's Crest (`src/physics/real/landmarks.ts`).
The scripts that generate the stages, including where on the map each special stage lies, are in
`tools/stages/` (see the README there).
The tests also run two fictional stages with known junctions and surfaces (`tests/stages.ts`).

The winter stages are lined with snowbanks instead of a ditch: drive into them and the wheels dig in, the car
is braked hard and takes mild damage. Stages at dusk, dawn and night (`light` on
the stage) are driven with the car's headlights. A hard frontal hit breaks the lamp on that side,
and a broken lamp gives no light (`Car.lamps`). The tail lights are always on and brighter when
braking. In Fri körning you first choose a championship and then a stage.

The `water` surface (fords where the road dips into a stream: the water slows the car, grips
worse and sprays to the sides) is still there, but no stage has fords right now.

The weather is randomized per stage (`src/physics/weather.ts`): mostly dry, but sometimes rain or fog,
and on winter stages snowfall or fog. Rain makes tarmac, gravel and mud more slippery and snowfall makes
snow more slippery; fog shortens the view distance. The tyre menu shows the weather and the grip with the weather included, and
the championship's opponents drive slower in bad weather. `?vader=regn|dimma|snöfall` forces
a weather for debugging.
Before each start you choose tyres (gravel, tarmac or winter); the menu shows the stage's surfaces and
preselects the tyre with the best average grip (`bestTyre` in `src/physics/stage.ts`).
The road is a spline through control points, and each point has elevation, width and surface
(the surface applies until the next point). Off the road there is a ditch and then mud.

The clock starts when the car passes the start gate and stops at the finish gate, with two splits.
After the finish an autopilot takes over and brakes the car along the road (there is an 80 m run-out), and
a finish screen shows the time, splits and comparison with the record, with the choices Kör igen and Huvudmeny.
The finish screen has a top-down map of the stage where each 25 m piece is coloured green or red by how
much time the run gained or lost against the previous record's ghost, plus where you lost and gained the most.
The best time is saved in the browser (localStorage) until accounts and saving exist, together with
a ghost: the best run recorded at 20 Hz, which is driven as a translucent car beside you.

The co-driver reads pace notes with the browser's Swedish speech synthesis, about three seconds before each note.
The notes are computed from the spline: corners 1–6 (1 tightest) with direction and "lång", crests, surface changes,
finish and distance between the notes. They are also shown at the top of the screen.

## The test track (`?testbana`)

Along +Z from the start: gravel (0–40 m), a strip of tarmac with mud on the right and snow on the left (40–100),
washboard (110–150), jump (170–180), two concrete pillars (220), concrete wall for crash testing (260).
"Testplatser" in the panel moves the car there.

## Architecture

```
src/physics/   pure TypeScript, no browser code (also runs in Node)
  car.ts         rigid body (6 degrees of freedom), suspension per wheel, wheel spin, assists
  tires.ts       "Pacejka-lite": normalized slip vector gives a friction ellipse
  surfaces.ts    surfaces and tyre types as plain data (grip per combination)
  drivetrain.ts  engine curve, turbo boost, clutch, gearbox (auto/manual), differential
  collision.ts   sequential impulses against static boxes and the ground
  params.ts      the cars (fictional), in class 1 and class 2
  world.ts       the test track's elevation, surfaces and obstacles
  stage.ts       stage as a spline with elevation, width and surface per control point
src/account/   account: protocol (shared with sync/), recovery key, sync in the browser
sync/          the sync server (Cloudflare Worker, Durable Objects)
src/render/    Three.js (WebGPU), clay look, deformable body, terrain, dust per surface, debug
  bodies/        the body shape per car, built in code
  models/        cars modelled in Blender (generated files, see below)
blender/       Blender sources: a build script and a .blend per modelled car
src/main.ts    game loop: fixed physics step at 240 Hz, rendering decoupled
tests/         physics tests with expected ranges
```

### Cars from Blender

Sora 2.0 Turbo, Hoshi 2.0 4WD, Volpe 2.0 Turbo 16V, Kvarn 240 (GL and Turbo, same model), Ljung 1600 S and Ljung 2000 16V are modelled in Blender instead of built from a shape in
`src/render/bodies/`. `blender/<car>/<car>.blend` is the source (e.g. `blender/soraTurbo/soraTurbo.blend`): edit it in Blender and transfer it to the game with

```sh
blender -b blender/soraTurbo/soraTurbo.blend -P blender/export.py   # writes src/render/models/soraTurbo.ts
blender -b blender/soraTurbo/soraTurbo.blend -P blender/render.py -- /tmp/sora   # the whole car and close-ups of the parts
```

The model is in the car's coordinates (origin at the centre of mass, the ground at y = −0.486) with Blender's
X = x, Y = −z, Z = y, so the car points towards −Y. The objects in the *Export* collection become the car's parts:
`body` and `body_…` (the Sora's doors, bumpers and tailgate) are panels that dent separately and have
their origin at the car's; the others are loose details that fall off (`flap…` = mud flaps, `pod…` = auxiliary lights, only
class 2). A part named `wheel` is a whole wheel with the outside towards +x, mirrored on the right side; a part
named `rim` is only the rim and is fitted into a hollow tyre. The colour is chosen per face by the material's name
(`paint`, `shade`, `glass`, `black`, `dark`, `chrome`, `lamp`, `amber`, `tail`, `reverse`, `plate`, `white`,
`gold`, `rubber`); `paint` and `shade` follow the car's paint. The Sora's build script is split per part:
`shell.py` (the body, the lamps and the panels), `parts.py` (wing, exhaust, wheels and other details)
and `common.py` (dimensions, materials and mesh tools). The
*Reference* collection (wheels and ground) is not exported. `blender/<car>/build.py` builds a new .blend from
scratch and overwrites the old one. The build scripts decimate the body after colouring with `blender/simplify.py`
(colour edges and sharp edges are locked), so the mesh stays close to the shape with a third of the triangles. The Hoshi's headlights are popped up (`popup…`).
The Kvarn's lamps, grille and bumpers are separate parts (`headlamp…`, `grille`, `bumper…`, `taillamp…`).
The Volpe also has a roof spoiler, bonnet vents and auxiliary lights as separate parts (`spoiler`, `vents…`, `pod`).
The Ljung has round twin headlights and black plastic flares around the wheel arches (`flare…`). The Ljung 2000 16V is built by
the same script (`blender/ljung1600/build.py -- ljung2000`): same body and wheelbase, widened over the kit car's wider track,
lower, with one large lamp per side, a kit front (`bumper_holes`, `spoiler_vents`) and a roof scoop (`scoop`).

### The physics' key choices

- **Fixed step at 240 Hz**, fully separate from rendering.
- **The wheel is solved semi-implicitly** (Rosenbrock). Otherwise the tyre force becomes unstable at low speed.
- The tyre force depends on longitudinal and lateral slip, wheel load (load sensitivity) and surface × tyre type.
- Suspension: spring, separate bump/rebound damping, anti-roll bars, bump stops.
- Drivetrain: the clutch slips at launch, the engine's inertia is reflected to the wheels, differential with lock and preload.
- Damage: collisions give impulses per contact point. The panels dent (vertex displacement on the body),
  and the damage affects power, wheel alignment and grip.

### Measured values (see `npm run test:physics`)

| Measure | Result |
| --- | --- |
| 0–100 km/h tarmac, tarmac tyres | ~9.1 s |
| 0–100 km/h gravel, gravel tyres | ~10.9 s |
| Braking 100–0 tarmac / gravel | ~41 m / ~50 m |
| Lateral grip tarmac / gravel | ~0.87 g / ~0.68 g |

The figures are reasonable for a 1250 kg rear-wheel-drive hobby car, but are **not calibrated against real data**.
What remains is to drive and feel.

## Next steps

1. Drive, tune. The feel decides the parameters, not the other way round.
2. More stages and championships (`STAGES` in `src/physics/stage.ts`, `CHAMPIONSHIPS` in `src/career/championship.ts`).

## Career

Karriär in the main menu has a wallet that is synced with the account. Money comes from:

- **Daily bonus:** 500 kr the first time you open Karriär each day.
- **Single races:** prize money by time (gold, silver, bronze, otherwise a finishing fee). The car is repaired
  for free afterwards, so the cars in the garage never take damage.
- **Championships** (Skogsrallyt, Myrkullarallyt, Vinterrallyt and Forsrallyt, three to five stages each, some at dusk, dawn or night; the prize money grows with the number of stages): you race against seven
  randomized fictional drivers, and the standings are shown after each stage. The placing decides
  the prize money, which is larger than for single races and scales with difficulty (easy ×0.75, hard ×1.25, `DIFFICULTY_PRIZE`). The field's best drives at gold time; if you have
  your own records on the stages, the two fastest are placed close to your pace, and if you are faster than the whole
  field, one or two of them find the same speed for the next stage (`src/career/rivals.ts`). Damage carries over between stages; at service you repair with your own
  money or drive on damaged. There is no restart. If you retire, the car is repaired for free
  but you get no prize money. Progress is saved in the browser, since the page reloads between
  stages (`?mastarskap=<tyre>` loads the next stage with the tyres chosen before the reload).
- **Class 2:** once all three championships in class 1 are won, the car dealer sells seven faster
  cars (Ljung 2000 16V with front-wheel drive, Strand 2.0 GT with rear-wheel drive and five with
  four-wheel drive and a centre diff: Kvarn Turbo 4x4, Hoshi 2.0 4WD, Volpe 2.0 Turbo 16V, Brenner 5T Coupé and
  Sora 2.0 Turbo). They have their own parts in the garage, by drivetrain and engine (centre diff for
  four-wheel drive, boost and anti-lag for turbo, throttle bodies for naturally aspirated engines, some parts for a single
  car, and the Brenner has its own Group B parts), and their own championships
  (Tallmoklassikern, Ljunghedsrallyt and Israllyt). The medal thresholds and the field are
  8 % faster and the prize money doubled (`TIER_PACE` and `TIER_PRIZE` in `src/career/career.ts`).
  Each class races only its own championships.

The money buys upgrades in the garage (engine, drivetrain, brakes, suspension, body and tyres, once per car) and
cars at the car dealer. You start with the Kvarn 240 GL. Rules and prices are in
`src/career/career.ts`. Fri körning is still there with all cars and without money.

## Deployment

`.github/workflows/deploy.yml` builds and tests on every push and pull request. On push to
main the game is deployed to GitHub Pages (https://www.auner.se/rally-sim/) and the sync server
to Cloudflare Workers. This requires, once:

- Settings → Pages → Source: GitHub Actions.
- Secret `CLOUDFLARE_API_TOKEN` (the Cloudflare template "Edit Cloudflare Workers").
- Variable `SYNC_URL` with the sync server's address, which is shown after the first `npm run deploy` in `sync/`.

Which origins may call the sync server is set in `ALLOWED_ORIGINS` in `sync/wrangler.jsonc`.

## Account and sync

The design comes from season-o-meter. The account is created automatically on the first visit: a
128-bit secret in the browser. The server (`sync/`, a Cloudflare Worker with one Durable Object
per account) stores the account under the SHA-256 of the secret and never sees the secret itself.
Under Konto in the main menu are the recovery key (Crockford base32 with a checksum, so a
mistyped key is rejected) and "Återställ med nyckel", which switches account and brings the records along.

What is synced is the best time, splits and ghost per track. The key contains the track's
version epoch, and the server always keeps the lowest time, so a record is never overwritten by a
worse run from another device. Without `VITE_SYNC_URL` the account exists only locally.

```sh
cd sync && npm install
npm run dev                                        # the sync server on :8787, allows :5173
VITE_SYNC_URL=http://localhost:8787 npm run dev    # the game against the local server (in the root)
```
