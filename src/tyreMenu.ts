import { showMenu } from './menu';
import { WEATHER_GRIP, WEATHER_NAMES, type Weather } from './physics/weather';
import { bestTyre, surfaceShares, type StageDef } from './physics/stage';
import { SURFACES, TYRE_GRIP, TYRE_NAMES, type SurfaceId, type TyreType } from './physics/surfaces';

/** Däckval före start, med etappens underlag och det däck som greppar bäst i snitt förvalt. Null = Tillbaka. */
export async function pickTyre(stage: StageDef, weather: Weather): Promise<TyreType | null> {
  const grip = (t: TyreType, s: SurfaceId) => TYRE_GRIP[t][s] * (WEATHER_GRIP[weather][s] ?? 1);
  const shares = Object.entries(surfaceShares(stage)) as [SurfaceId, number][];
  shares.sort((a, b) => b[1] - a[1]);
  const best = bestTyre(stage);
  const tyres = (Object.keys(TYRE_GRIP) as TyreType[]).sort((a, b) => (a === best ? -1 : b === best ? 1 : 0));
  return showMenu<TyreType | null>({
    title: 'Däck',
    subtitle: stage.name,
    solid: true,
    body: `${weather === 'clear' ? '' : `<div><b>Väder: ${WEATHER_NAMES[weather]}.</b> ${weather === 'fog' ? 'Sikten är kort.' : 'Vägen är halare än vanligt.'}</div>`}<div>Underlag: ${shares.map(([s, k]) => `${SURFACES[s].name.toLowerCase()} ${Math.round(k * 100)} %`).join(', ')}.</div>`,
    items: [
      ...tyres.map((t) => ({
        label: TYRE_NAMES[t],
        detail: [t === best ? 'rekommenderas' : '', ...shares.map(([s]) => `${SURFACES[s].name.toLowerCase()} ${grip(t, s).toFixed(2)}`)].filter(Boolean).join(' · '),
        value: t,
      })),
      { label: '← Tillbaka', value: null },
    ],
    cancel: null,
  });
}
