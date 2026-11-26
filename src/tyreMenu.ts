import { showMenu } from './menu';
import { bestTyre, surfaceShares, type StageDef } from './physics/stage';
import { SURFACES, TYRE_GRIP, TYRE_NAMES, type SurfaceId, type TyreType } from './physics/surfaces';

/** Däckval före start, med etappens underlag och det däck som greppar bäst i snitt förvalt. */
export async function pickTyre(stage: StageDef): Promise<TyreType> {
  const shares = Object.entries(surfaceShares(stage)) as [SurfaceId, number][];
  shares.sort((a, b) => b[1] - a[1]);
  const best = bestTyre(stage);
  const tyres = (Object.keys(TYRE_GRIP) as TyreType[]).sort((a, b) => (a === best ? -1 : b === best ? 1 : 0));
  return showMenu<TyreType>({
    title: 'Däck',
    subtitle: stage.name,
    solid: true,
    body: `<div>Underlag: ${shares.map(([s, k]) => `${SURFACES[s].name.toLowerCase()} ${Math.round(k * 100)} %`).join(', ')}.</div>`,
    items: tyres.map((t) => ({
      label: TYRE_NAMES[t],
      detail: [t === best ? 'rekommenderas' : '', ...shares.map(([s]) => `${SURFACES[s].name.toLowerCase()} ${TYRE_GRIP[t][s].toFixed(2)}`)].filter(Boolean).join(' · '),
      value: t,
    })),
    cancel: best,
  });
}
