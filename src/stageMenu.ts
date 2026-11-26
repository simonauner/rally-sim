import { formatTime } from './hud';
import { showMenu } from './menu';
import { STAGES, type StageDef } from './physics/stage';
import { loadRecord } from './records';

/** Väljer etapp, med bästa tid per etapp. `extra` lägger till text efter tiden. Null = Tillbaka. */
export async function pickStage(title: string, extra?: (s: StageDef) => string): Promise<StageDef | null> {
  const name = await showMenu<string>({
    title,
    solid: true,
    items: [
      ...STAGES.map((s) => {
        const best = loadRecord(s);
        const detail = [best ? `bästa ${formatTime(best.time)}` : '', extra?.(s) ?? ''].filter(Boolean).join(' · ');
        return { label: s.name, detail: detail || undefined, value: s.name };
      }),
      { label: '← Tillbaka', value: '' },
    ],
    cancel: '',
  });
  return STAGES.find((s) => s.name === name) ?? null;
}
