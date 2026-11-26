import { CHAMPIONSHIPS, championshipUnlocked, unlockHint } from './career/championship';
import { loadCareer } from './career/store';
import { formatTime } from './hud';
import { showMenu } from './menu';
import { FINISH_MARGIN, Stage, STAGES, START_S, surfaceShares, type Light, type StageDef } from './physics/stage';
import { SURFACES, type SurfaceId } from './physics/surfaces';
import { loadRecord } from './records';

const LIGHT_NAMES: Record<Light, string> = { day: '', dawn: 'gryning', dusk: 'skymning', night: 'natt' };

/**
 * Väljer etapp i två steg: först mästerskapet den hör till, sedan etappen, med bästa tid per
 * etapp. `extra` lägger till text efter tiden. Null = Tillbaka från första steget.
 * Etapperna i mästerskap som inte är upplåsta i karriären visas låsta.
 */
export async function pickStage(title: string, extra?: (s: StageDef) => string): Promise<StageDef | null> {
  const career = loadCareer().career;
  for (;;) {
    const id = await showMenu<string>({
      title,
      solid: true,
      items: [
        ...CHAMPIONSHIPS.map((c) =>
          championshipUnlocked(career, c)
            ? { label: c.name, detail: `${c.legs.length} etapper`, value: c.id }
            : { label: c.name, note: c.legs.join(', '), detail: `${unlockHint(career, c)} i karriären`, value: c.id, locked: true },
        ),
        { label: '← Tillbaka', value: '' },
      ],
      cancel: '',
    });
    const champ = CHAMPIONSHIPS.find((c) => c.id === id);
    if (!champ) return null;
    if (!championshipUnlocked(career, champ)) continue;
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

const MAP_COLORS: Record<SurfaceId, string> = { asphalt: '#9aa4b0', gravel: '#d9a55b', mud: '#8a5a2b', snow: '#7fa8d6', snowbank: '#7fa8d6' };

/** Förhandsvisning av en etapp: tid på dygnet, längd, underlag och karta ovanifrån färgad efter underlag. */
export function stagePreviewHtml(def: StageDef): string {
  const st = new Stage(def);
  const end = st.length - FINISH_MARGIN;
  const shares = (Object.entries(surfaceShares(def)) as [SurfaceId, number][]).sort((a, b) => b[1] - a[1]);
  // Ovanifrån med z uppåt; lokalt x är vänster, så x speglas.
  const px = (i: number) => -st.xs[i]!;
  const pz = (i: number) => -st.zs[i]!;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = START_S; i <= end; i++) {
    minX = Math.min(minX, px(i)); maxX = Math.max(maxX, px(i));
    minZ = Math.min(minZ, pz(i)); maxZ = Math.max(maxZ, pz(i));
  }
  const pad = 30;
  const lines: string[] = [];
  let run: string[] = [];
  for (let i = START_S; ; ) {
    run.push(`${px(i).toFixed(0)},${pz(i).toFixed(0)}`);
    if (i === end) break;
    const next = Math.min(i + 4, end);
    if (st.surfaces[next] !== st.surfaces[i]) {
      run.push(`${px(next).toFixed(0)},${pz(next).toFixed(0)}`);
      lines.push(`<polyline points="${run.join(' ')}" stroke="${MAP_COLORS[st.surfaces[i]!]}"/>`);
      run = [];
    }
    i = next;
  }
  if (run.length > 1) lines.push(`<polyline points="${run.join(' ')}" stroke="${MAP_COLORS[st.surfaces[end]!]}"/>`);
  const sw = Math.max(maxX - minX, maxZ - minZ) / 60;
  const dot = (i: number, c: string) => `<circle cx="${px(i).toFixed(0)}" cy="${pz(i).toFixed(0)}" r="${(sw * 1.3).toFixed(1)}" fill="${c}"/>`;
  return `<table class="specs">
    <tr><th>Tid på dygnet</th><td>${LIGHT_NAMES[def.light ?? 'day'] || 'dag'}</td></tr>
    <tr><th>Längd</th><td>${((end - START_S) / 1000).toFixed(1).replace('.', ',')} km</td></tr>
    <tr><th>Underlag</th><td>${shares.map(([s, k]) => `${SURFACES[s].name.toLowerCase()} ${Math.round(k * 100)} %`).join(', ')}${def.winter ? ' · vinter' : ''}</td></tr>
  </table>
  <svg viewBox="${minX - pad} ${minZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}" style="display:block;width:100%;max-height:40vh;margin-top:10px">
    <g fill="none" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round">${lines.join('')}</g>
    ${dot(START_S, '#4caf50')}${dot(end, '#e53935')}
  </svg>`;
}
