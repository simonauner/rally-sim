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

Etapperna är *Skogsberg* (ca 1,8 km: grus, en asfaltsbit och en lerig skogsdel) och *Myrkulla*
(ca 2,7 km: snabbt grus, en lerig väg över myren, en lång stigning med krön och en asfaltsbit).
*Frostberga* är en vinteretapp (ca 2,1 km packad snö med en plogad grusväg på mitten). Där
kantas vägen av snövallar i stället för dike: kör man i dem gräver hjulen ner sig, bilen bromsas
kraftigt och tar en mild skada.
Alla finns också baklänges, samma väg åt andra hållet med egna noter, rekord och ghost.
Tre etapper körs i annat ljus (`light` på etappen): *Tallmon* i skymning (snabbt grus med en
asfaltsbit), *Ljungheden* i gryning (ljunghedar med krön och en lerig sänka) och *Isvallen* på
natten (snö). Då lyser bilens strålkastare. En hård smäll framifrån slår sönder lyktan på den
sidan, och en trasig lykta lyser inte (`Car.lamps`). Baklyktorna lyser alltid och starkare vid
inbromsning. I Fri körning väljer man först mästerskap och sedan etapp.

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
  params.ts      bilen "Kvarn 240 GL" (fiktiv)
  world.ts       testbanans höjd, underlag och hinder
  stage.ts       etapp som spline med höjd, bredd och underlag per stödpunkt
src/account/   konto: protokoll (delas med sync/), återställningsnyckel, synk i webbläsaren
sync/          synkservern (Cloudflare Worker, Durable Objects)
src/render/    Three.js (WebGPU), clay-look, deformerbar kaross, terräng, damm per underlag, debug
src/main.ts    spelloop: fast fysiksteg 240 Hz, rendering frikopplad
tests/         fysiktester med förväntade intervall
```

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
- **Enstaka etapp:** prispengar efter tid (guld, silver, brons, annars en målpeng). Bilen lagas
  gratis efteråt, så bilarna i garaget tar aldrig skada.
- **Mästerskap** (Skogsrallyt, Myrkullarallyt och Vinterrallyt, tre etapper vardera varav en i skymning, gryning respektive natt; prispengarna växer med antalet etapper): man kör mot sju
  slumpade fiktiva förare, och efter varje etapp visas ställningen. Placeringen avgör
  prispengarna, som är större än för enstaka etapper. Fältets bästa kör på guldtid; har man
  egna rekord på etapperna läggs de två snabbaste nära ens takt, och är man snabbare än hela
  fältet hittar en eller två av dem samma fart till nästa etapp (`src/career/rivals.ts`). Skador följer med mellan etapperna; på servicen lagar man för egna
  pengar eller kör vidare skadad. Omstart finns inte. Den som avbryter får bilen lagad gratis
  men inga prispengar. Framsteget sparas i webbläsaren, eftersom sidan laddas om mellan
  etapperna (`?mastarskap` laddar nästa etapp).

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
