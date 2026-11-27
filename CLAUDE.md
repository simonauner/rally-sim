# Rally – anteckningar för Claude Code

Webbläsarspel: rallysimulator med Colin McRae 2005-känsla (realistisk fysik, förlåtande hjälpmedel),
karriär med pengar/uppgraderingar, fiktiva bilar och märken. Se README.md för arkitektur och styrning.

## Kommandon

```sh
npm install
npm run dev           # Vite på :5173
npm run typecheck
npm run test:physics  # körs i Node, ska alltid vara grön
npm run test:account  # konto: nyckel, sanering, sammanslagning
npm run test:career   # karriär: köp, dagsbonus, priser, uppgraderingar
(cd sync && npm run typecheck)  # synkservern; kör `npm run types` efter ändrad wrangler.jsonc
npm run build:single  # en HTML-fil i dist-single/
```

Kör `typecheck`, `test:physics`, `test:account` och `test:career` innan commit (och synkserverns typecheck om `sync/` eller `src/account/protocol.ts` ändrats). Ändrar du fysiken, kontrollera att
testernas intervall (0–100, bromssträcka, sidgrepp, krasch) fortfarande stämmer, och justera
dem bara medvetet.

## Regler

- `src/physics/` är ren TypeScript. Importera bara `three` (matte), aldrig `three/webgpu`, DOM eller `window`.
- Fast fysiksteg 240 Hz, frikopplat från rendering.
- Koordinater: bilens lokala x = vänster, y = upp, z = framåt. Styrvinkel positiv = vänster.
- Bilar, märken och banor är fiktiva. Använd aldrig verkliga märkes- eller modellnamn.
- Språk i UI och kommentarer: svenska.
- Grafik: WebGPU enbart. `?webgl` finns bara för felsökning i miljöer utan WebGPU.

## Tips

- WebGPU-canvas syns inte i headless-skärmdumpar. Använd `?webgl` för att verifiera scenen visuellt.
- På långsamma datorer begränsas bildtiden till 50 ms, så simuleringen går då i slow motion.

## Nästa steg (fas 1)

Fas 1 är klar: spline-etappen (`src/physics/stage.ts`), tidtagningen (`src/physics/timing.ts`), ghosten (`src/physics/ghost.ts`), dammet (`src/render/dust.ts`), pacenotes (`src/physics/pacenotes.ts`) och motorljudet.
Huvud- och pausmeny finns (`src/menu.ts`). Konto och synk av rekord finns (`src/account/`, `sync/`). Karriär med kassa, garage, bilhandlare och mästerskap finns (`src/career/`). Etapper: Skogsberg, Myrkulla och vinteretappen Frostberga (även baklänges), plus Tallmon i skymning, Ljungheden i gryning och Isvallen på natten (med strålkastare); däcken väljs före start (`src/tyreMenu.ts`). Klass 2 (tre snabbare bilar, egna delar och mästerskap) låses upp när klass 1 är vunnen. Nästa: se README.
