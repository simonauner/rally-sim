# Rally

Webbläsarspel i tidig utveckling. Målet är en rallysimulator med Colin McRae 2005-känsla:
realistisk bilfysik, karriär med pengar och uppgraderingar, fiktiva bilar och märken.
Den här prototypen bevisar bara en sak: **känns bilen rätt att köra?**

## Köra

```sh
npm install
npm run dev          # http://localhost:5173
npm run test:physics # fysiktester utan webbläsare
npm run build        # typecheck + produktionsbygge i dist/
npm run build:single # en enda HTML-fil i dist-single/
```

Kräver WebGPU: Chrome/Edge, Firefox 141+ (Windows, ARM-Mac) eller Safari 26.
`?webgl` på adressen tvingar WebGL2-backend och är bara till för felsökning.

## Styrning

| Tangent | Funktion |
| --- | --- |
| W / S | Gas / broms (S backar vid stopp) |
| A / D | Styr |
| Mellanslag | Handbroms |
| R | Tillbaka på vägen där bilen är (klockan går vidare; på testbanan: till startplatsen) |
| T | Starta om etappen (reparerar bilen) |
| G | Ghost av/på |
| Esc | Pausmeny (fortsätt, starta om, kontroller, huvudmeny) |
| C | Byt kamera (bakifrån nära och långt, motorhuv, förarvy, uppifrån, sidovy för skador); valet sparas |
| M, E / Q | Manuell växellåda |
| F1 | Felsökning av/på: telemetri, skador, g-kraft och trimningspanelen (dolda från start) |
| F3 | Kraftvektorer av/på (röd = däckkraft, blå = hjullast, grön = färdriktning) |
| H | Dölj/visa hjälptext |

Gamepad: vänsterspak, RT/LT, A = handbroms. Trimningspanelen (F1) trimmar bilen medan du kör.

## Menyer

Spelet startar i en huvudmeny: kör etappen, testbanan eller se kontrollerna. Världen byggs först
när man valt. Esc öppnar pausmenyn; "Huvudmeny" laddar om sidan, eftersom byte av värld under
körning inte finns. `?testbana` hoppar över menyn och går direkt till testbanan.

## Etapperna

Alla etapper är verkliga vägar (`src/physics/real/`): specialsträckor ur Rally Sweden (snö) och
Royal Rally of Scandinavia (grus), delade i etapper på 3,4–6 km och uppkallade efter orter längs
vägen. Geometrin kommer ur OpenStreetMap och höjden ur EU-DEM.

| Mästerskap | Klass | Sträcka | Etapper |
|---|---|---|---|
| Skogsrallyt | 1 | Värmskog (grus) | Grinsbol, Tollesrud, Åsterud i skymning |
| Myrkullarallyt | 1 | Gårdsjö och Colins (grus) | Botten i gryning, Rannsjön, Larssäter, Stor-Jangen |
| Vinterrallyt | 1 | Bygdsiljum (snö) | Åsjön, Altarliden, Bergtjärnen, Torpet, Trollberget på natten |
| Forsrallyt | 1 | Bäck (snö) | Näs, Rickleån, Valsfäboda i skymning |
| Tallmoklassikern | 2 | Royal Forest (grus) | Södra Hulteby, Ämten, Lindås, Lungsund |
| Ljunghedsrallyt | 2 | Ängebäckstorp och Ölme (grus) | Sundstorp, Bäckelid, Niklasdamm, Broby i skymning |
| Israllyt | 2 | Andersvattnet (snö) | Storberget, Hösjöälven, Röjmyrberget, Flarkån i skymning |

Rally Swedens sträckkartor har GPS-punkter; Royal Rallys sträckor är hittade på rallyts
översiktskarta (ca 26 m per pixel) och kan avvika ±50 m. Där en skogsväg saknas i OpenStreetMap är
den avritad från kartan. Hörn i korsningar är utjämnade och breddade så att bilen kommer runt,
lutningen på grusetapperna är begränsad till 12 % (höjddatan tar annars med branter bredvid
vägen), och efter mål finns 240 m att stanna på. Utanför vägkanten följer terrängen ett medel av
vägen runt omkring, så det blir inga kanter på insidan av snäva kurvor. Vägdata © OpenStreetMap
contributors, ODbL 1.0; den härledda datan i `src/physics/real/` delas under samma licens.
Testerna kör dessutom två fiktiva etapper med kända korsningar och underlag (`tests/stages.ts`).

Vinteretapperna kantas av snövallar i stället för dike: kör man i dem gräver hjulen ner sig, bilen
bromsas kraftigt och tar en mild skada. Etapper i skymning, gryning och natt (`light` på
etappen) körs med bilens strålkastare. En hård smäll framifrån slår sönder lyktan på den sidan,
och en trasig lykta lyser inte (`Car.lamps`). Baklyktorna lyser alltid och starkare vid
inbromsning. I Fri körning väljer man först mästerskap och sedan etapp.

Underlaget `water` (vadställen där vägen dyker ner i en bäck: vattnet bromsar bilen, greppar
sämre och sprutar åt sidorna) finns kvar, men ingen etapp har vadställen just nu.

Vädret slumpas per etapp (`src/physics/weather.ts`): oftast uppehåll, men ibland regn eller dimma,
och på vinteretapper snöfall eller dimma. Regn gör asfalt, grus och lera halare och snöfall gör
snön halare; dimma kortar sikten. Däckmenyn visar vädret och greppet med vädret inräknat, och
mästerskapets motståndare kör långsammare i dåligt väder. `?vader=regn|dimma|snöfall` tvingar
fram ett väder vid felsökning.
Före varje start väljer man däck (grus, asfalt eller vinter); menyn visar etappens underlag och
förväljer det däck som greppar bäst i snitt (`bestTyre` i `src/physics/stage.ts`).
Vägen är en spline genom stödpunkter, och varje punkt har höjd, bredd och underlag
(underlaget gäller fram till nästa punkt). Utanför vägen kommer ett dike och sedan lera.

Klockan startar när bilen passerar startportalen och stannar vid målportalen, med två mellantider.
Efter mål tar en autopilot över och bromsar in bilen längs vägen (det finns 80 m utrullning), och
en målskärm visar tid, mellantider och jämförelse mot rekordet, med valen Kör igen och Huvudmeny.
Målskärmen har en karta över etappen ovanifrån där varje 25 m-bit färgas grön eller röd efter hur
mycket tid åket tjänade eller tappade mot förra rekordets ghost, plus var man tappade och tjänade mest.
Bästa tiden sparas i webbläsaren (localStorage) tills konto och sparning finns, tillsammans med
en ghost: bästa åket inspelat i 20 Hz, som körs som en genomskinlig bil bredvid dig.

Kartläsaren läser pacenotes med webbläsarens svenska talsyntes, ungefär tre sekunder före varje not.
Noterna räknas fram ur splinen: kurvor 1–6 (1 snävast) med riktning och "lång", krön, byte av underlag,
mål och avstånd mellan noterna. De visas också överst på skärmen.

## Testbanan (`?testbana`)

Längs +Z från start: grus (0–40 m), asfaltsremsa med lera till höger och snö till vänster (40–100),
tvättbräda (110–150), hopp (170–180), två betongpelare (220), betongvägg för krocktest (260).
"Testplatser" i panelen flyttar bilen dit.

## Arkitektur

```
src/physics/   ren TypeScript, ingen webbläsarkod (körs även i Node)
  car.ts         stel kropp (6 frihetsgrader), fjädring per hjul, hjulvarv, hjälpmedel
  tires.ts       "Pacejka-lite": normaliserad slipvektor ger friktionsellips
  surfaces.ts    underlag och däcktyper som ren data (grepp per kombination)
  drivetrain.ts  motorkurva, koppling, växellåda (auto/manuell), differential
  collision.ts   sekventiella impulser mot statiska boxar och mark
  params.ts      bilarna (fiktiva), i klass 1 och klass 2
  world.ts       testbanans höjd, underlag och hinder
  stage.ts       etapp som spline med höjd, bredd och underlag per stödpunkt
src/account/   konto: protokoll (delas med sync/), återställningsnyckel, synk i webbläsaren
sync/          synkservern (Cloudflare Worker, Durable Objects)
src/render/    Three.js (WebGPU), clay-look, deformerbar kaross, terräng, damm per underlag, debug
  bodies/        karossens form per bil, byggs i kod
  models/        bilar modellerade i Blender (genererade filer, se nedan)
blender/       Blender-källor: ett byggskript och en .blend per modellerad bil
src/main.ts    spelloop: fast fysiksteg 240 Hz, rendering frikopplad
tests/         fysiktester med förväntade intervall
```

### Bilar från Blender

Sora 2.0 Turbo, Hoshi 2.0 4WD och Kvarn 240 (GL och Turbo, samma modell) är modellerade i Blender i stället för byggda av en form i
`src/render/bodies/`. `blender/<bil>/<bil>.blend` är källan (t.ex. `blender/soraTurbo/soraTurbo.blend`): redigera den i Blender och för över den till spelet med

```sh
blender -b blender/soraTurbo/soraTurbo.blend -P blender/export.py   # skriver src/render/models/soraTurbo.ts
blender -b blender/soraTurbo/soraTurbo.blend -P blender/render.py -- /tmp/sora   # hela bilen och närbilder av delarna
```

Modellen ligger i bilens koordinater (origo i tyngdpunkten, marken på y = −0,486) med Blenders
X = x, Y = −z, Z = y, så bilen pekar mot −Y. Objekten i samlingen *Export* blir bilens delar:
`body` och `body_…` (Soras dörrar, stötfångare och baklucka) är paneler som bucklas var för sig och har
sitt origo i bilens; övriga är lösa detaljer som ramlar av (`flap…` = stänkskydd, `pod…` = extraljus, bara
klass 2). En del som heter `wheel` är ett helt hjul med utsidan åt +x, speglat på höger sida; en del som
heter `rim` är bara fälgen och sätts i ett ihåligt däck. Färgen väljs per yta med materialets namn
(`paint`, `shade`, `glass`, `black`, `dark`, `chrome`, `lamp`, `amber`, `tail`, `reverse`, `plate`, `white`,
`gold`, `rubber`); `paint` och `shade` följer bilens lack. Soras byggskript är uppdelat per del:
`shell.py` (karossen, lyktorna och panelerna), `parts.py` (vinge, avgassystem, hjul och övriga detaljer)
och `common.py` (mått, material och nätverktyg). Samlingen
*Reference* (hjul och mark) exporteras inte. `blender/<bil>/build.py` bygger en ny .blend från
början och skriver över den gamla. Hoshins strålkastare är uppfällda (`popup…`).
Kvarnens lyktor, grill och stötfångare är egna delar (`headlamp…`, `grille`, `bumper…`, `taillamp…`).

### Fysikens viktigaste val

- **Fast steg 240 Hz**, helt skilt från renderingen.
- **Hjulet löses semi-implicit** (Rosenbrock). Annars blir däckkraften instabil vid låg fart.
- Däckkraften beror på slip i längd- och sidled, hjullast (lastkänslighet) och underlag × däcktyp.
- Fjädring: fjäder, separat dämpning för ihop/isär, krängningshämmare, gummianslag.
- Drivlina: koppling slirar vid start, motorns tröghet reflekteras till hjulen, differential med spärr och förspänning.
- Skada: kollisioner ger impulser per kontaktpunkt. Plåten bucklas (vertexförskjutning på kroppen),
  och skadan påverkar effekt, hjulinställning och grepp.

### Uppmätta värden (se `npm run test:physics`)

| Mått | Resultat |
| --- | --- |
| 0–100 km/h asfalt, asfaltsdäck | ~9,1 s |
| 0–100 km/h grus, grusdäck | ~10,9 s |
| Broms 100–0 asfalt / grus | ~41 m / ~50 m |
| Sidgrepp asfalt / grus | ~0,87 g / ~0,68 g |

Siffrorna är rimliga för en 1250 kg bakhjulsdriven hobbybil, men är **inte kalibrerade mot riktig data**.
Det som återstår är att köra och känna.

## Nästa steg

1. Köra, trimma. Känslan avgör parametrarna, inte tvärtom.
2. Fler etapper och mästerskap (`STAGES` i `src/physics/stage.ts`, `CHAMPIONSHIPS` i `src/career/championship.ts`).

## Karriär

Karriär i huvudmenyn har en kassa som synkas med kontot. Pengar kommer från:

- **Dagsbonus:** 500 kr första gången man öppnar Karriär varje dag.
- **Enstaka lopp:** prispengar efter tid (guld, silver, brons, annars en målpeng). Bilen lagas
  gratis efteråt, så bilarna i garaget tar aldrig skada.
- **Mästerskap** (Skogsrallyt, Myrkullarallyt, Vinterrallyt och Forsrallyt, tre till fem etapper vardera, några i skymning, gryning eller natt; prispengarna växer med antalet etapper): man kör mot sju
  slumpade fiktiva förare, och efter varje etapp visas ställningen. Placeringen avgör
  prispengarna, som är större än för enstaka lopp. Fältets bästa kör på guldtid; har man
  egna rekord på etapperna läggs de två snabbaste nära ens takt, och är man snabbare än hela
  fältet hittar en eller två av dem samma fart till nästa etapp (`src/career/rivals.ts`). Skador följer med mellan etapperna; på servicen lagar man för egna
  pengar eller kör vidare skadad. Omstart finns inte. Den som avbryter får bilen lagad gratis
  men inga prispengar. Framsteget sparas i webbläsaren, eftersom sidan laddas om mellan
  etapperna (`?mastarskap` laddar nästa etapp).
- **Klass 2:** när alla tre mästerskapen i klass 1 är vunna säljer bilhandlaren sju snabbare
  bilar (Ljung 2000 16V med framhjulsdrift, Strand 2.0 GT med bakhjulsdrift och fem med
  fyrhjulsdrift och mittdiff: Kvarn Turbo 4x4, Hoshi 2.0 4WD, Volpe 2.0 Turbo 16V, Brenner 5T Coupé och
  Sora 2.0 Turbo). De har egna delar i garaget och egna mästerskap
  (Tallmoklassikern, Ljunghedsrallyt och Israllyt). Medaljgränserna och fältet är
  8 % snabbare och prispengarna dubbla (`TIER_PACE` och `TIER_PRIZE` i `src/career/career.ts`).
  Varje klass kör bara sina egna mästerskap.

Pengarna köper uppgraderingar i garaget (motor, bromsar, fjädring, däck, tre nivåer var) och
bilar hos bilhandlaren. Man börjar med Kvarn 240 GL. Regler och priser finns i
`src/career/career.ts`. Fri körning finns kvar med alla bilar och utan pengar.

## Driftsättning

`.github/workflows/deploy.yml` bygger och testar vid varje push och pull request. Vid push till
main driftsätts spelet på GitHub Pages (https://www.auner.se/rally-sim/) och synkservern
på Cloudflare Workers. Det kräver, en gång:

- Settings → Pages → Source: GitHub Actions.
- Secret `CLOUDFLARE_API_TOKEN` (Cloudflare-mallen "Edit Cloudflare Workers").
- Variabel `SYNC_URL` med synkserverns adress, som visas efter första `npm run deploy` i `sync/`.

Vilka adresser som får anropa synkservern står i `ALLOWED_ORIGINS` i `sync/wrangler.jsonc`.

## Konto och synk

Upplägget kommer från season-o-meter. Kontot skapas automatiskt vid första besöket: en
128-bitars hemlighet i webbläsaren. Servern (`sync/`, Cloudflare Worker med en Durable Object
per konto) lagrar kontot under SHA-256 av hemligheten och ser aldrig själva hemligheten.
Under Konto i huvudmenyn finns återställningsnyckeln (Crockford base32 med checksumma, så en
felskriven nyckel avvisas) och "Återställ med nyckel", som byter konto och tar med rekorden.

Det som synkas är bästa tid, mellantider och ghost per bana. Nyckeln innehåller banans
versionsepok, och servern behåller alltid lägsta tiden, så ett rekord skrivs aldrig över av ett
sämre åk från en annan enhet. Utan `VITE_SYNC_URL` finns kontot bara lokalt.

```sh
cd sync && npm install
npm run dev                                        # synkservern på :8787, tillåter :5173
VITE_SYNC_URL=http://localhost:8787 npm run dev    # spelet mot den lokala servern (i roten)
```
