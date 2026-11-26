import { CHAMPIONSHIPS } from './career/championship';
import { formatTime } from './hud';
import { showMenu } from './menu';
import { STAGES, type Light, type StageDef } from './physics/stage';
import { loadRecord } from './records';

const LIGHT_NAMES: Record<Light, string> = { day: '', dawn: 'gryning', dusk: 'skymning', night: 'natt' };

/**
 * Väljer etapp i två steg: först mästerskapet den hör till, sedan etappen, med bästa tid per
 * etapp. `extra` lägger till text efter tiden. Null = Tillbaka från första steget.
 */
export async function pickStage(title: string, extra?: (s: StageDef) => string): Promise<StageDef | null> {
  for (;;) {
    const id = await showMenu<string>({
      title,
      solid: true,
      items: [
        ...CHAMPIONSHIPS.map((c) => ({ label: c.name, detail: `${c.legs.length} etapper`, value: c.id })),
        { label: '← Tillbaka', value: '' },
      ],
      cancel: '',
    });
    const champ = CHAMPIONSHIPS.find((c) => c.id === id);
    if (!champ) return null;
    const name = await showMenu<string>({
      title: champ.name,
      solid: true,
      items: [
        ...champ.legs.flatMap((leg) => {
          const s = STAGES.find((x) => x.name === leg);
          if (!s) return [];
          const best = loadRecord(s);
          const detail = [LIGHT_NAMES[s.light ?? 'day'], best ? `bästa ${formatTime(best.time)}` : '', extra?.(s) ?? ''].filter(Boolean).join(' · ');
          return [{ label: s.name, detail: detail || undefined, value: s.name }];
        }),
        { label: '← Tillbaka', value: '' },
      ],
      cancel: '',
    });
    const stage = STAGES.find((s) => s.name === name);
    if (stage) return stage;
  }
}
