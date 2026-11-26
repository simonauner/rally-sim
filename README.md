# Rally – fysikprototyp (fas 0)

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
| C | Byt kamera (bakifrån, förarvy, uppifrån, sidovy för skador) |
| M, E / Q | Manuell växellåda |
| F3 | Kraftvektorer av/på (röd = däckkraft, blå = hjullast, grön = färdriktning) |
| H | Dölj/visa hjälptext |

Gamepad: vänsterspak, RT/LT, A = handbroms. Panelen till höger trimmar bilen medan du kör.

## Etappen

Spelet startar på etappen *Skogsberg* (ca 1,8 km): grus, en asfaltsbit och en lerig skogsdel.
Vägen är en spline genom stödpunkter, och varje punkt har höjd, bredd och underlag
(underlaget gäller fram till nästa punkt). Utanför vägen kommer ett dike och sedan lera.

Klockan startar när bilen passerar startportalen och stannar vid målportalen, med två mellantider.
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
2. Fas 1: kamera (spline-etapp, ljud och dammpartiklar är klara).
3. Fas 2: tidtagning, ghost, pacenotes.
4. Konto och sparning, upplägget från season-o-meter:
   128-bitars hemlighet skapas automatiskt i webbläsaren, listans id = SHA-256 av hemligheten,
   servern (Cloudflare Worker med Durable Objects) lagrar bara id, återställningsnyckel i
   Crockford base32 med checksumma, parkoppling med kod. Skillnaden här är att kontot skapas
   automatiskt vid första besöket.
