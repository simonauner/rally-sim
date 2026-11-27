import { CHAMPIONSHIPS, championshipUnlocked, unlockHint } from './career/championship';
import { loadCareer } from './career/store';
import { formatTime } from './hud';
import { showMenu } from './menu';
import { STAGE_LENGTHS } from './physics/real/lengths';
import { STAGES, START_S, surfaceShares, type Light, type StageDef } from './physics/stage';
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
  // Varje etapp listas under det första mästerskapet den körs i; klass 2 visas bara med sina nya etapper.
  const listed = new Set<string>();
  const groups = CHAMPIONSHIPS.map((c) => {
    const legs = c.legs.filter((leg) => !listed.has(leg));
    legs.forEach((leg) => listed.add(leg));
    return { c, legs };
  }).filter((g) => g.legs.length > 0);
  for (;;) {
    const id = await showMenu<string>({
      title,
      solid: true,
      items: [
        ...groups.map(({ c, legs }) =>
          championshipUnlocked(career, c)
            ? { label: c.name, detail: legs.length === 1 ? '1 etapp' : `${legs.length} etapper`, value: c.id }
            : { label: c.name, note: legs.join(', '), detail: `${unlockHint(career, c)} i karriären`, value: c.id, locked: true },
        ),
        { label: '← Tillbaka', value: '' },
      ],
      cancel: '',
    });
    const group = groups.find((g) => g.c.id === id);
    if (!group) return null;
    const champ = group.c;
    if (!championshipUnlocked(career, champ)) continue;
    const name = await showMenu<string>({
      title: champ.name,
      solid: true,
      items: [
        ...group.legs.flatMap((leg) => {
          const s = STAGES.find((x) => x.name === leg);
          if (!s) return [];
          const best = loadRecord(s);
          const detail = [LIGHT_NAMES[s.light ?? 'day'], best ? `bästa ${formatTime(best.time)}` : '', extra?.(s) ?? ''].filter(Boolean).join(' · ');
          return [{ label: s.name, note: s.credit ? 'verklig väg · kartdata © OpenStreetMap contributors' : undefined, detail: detail || undefined, value: s.name }];
        }),
        { label: '← Tillbaka', value: '' },
      ],
      cancel: '',
    });
    const stage = STAGES.find((s) => s.name === name);
    if (stage) return stage;
  }
}

const MAP_COLORS: Record<SurfaceId, string> = { asphalt: '#9aa4b0', gravel: '#d9a55b', mud: '#8a5a2b', snow: '#7fa8d6', snowbank: '#7fa8d6', water: '#2fb8d8' };

/** Förhandsvisning av en etapp: tid på dygnet, längd, underlag och karta ovanifrån färgad efter underlag. */
export function stagePreviewHtml(def: StageDef): string {
  // Kartan ritas direkt ur etappens punkter (var 20:e meter), utan att bygga hela etappen.
  const pts = def.points;
  const shares = (Object.entries(surfaceShares(def)) as [SurfaceId, number][]).sort((a, b) => b[1] - a[1]);
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  const length = STAGE_LENGTHS[def.name] ?? at[at.length - 1]! - START_S;
  const end = START_S + length;
  // Ovanifrån med z uppåt; lokalt x är vänster, så x speglas. Punkten på sträckan s mellan två punkter.
  const point = (s: number) => {
    let i = 0;
    while (i < pts.length - 2 && at[i + 1]! < s) i++;
    const u = Math.min(1, Math.max(0, (s - at[i]!) / (at[i + 1]! - at[i]! || 1)));
    return { x: -(pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * u), z: -(pts[i]!.z + (pts[i + 1]!.z - pts[i]!.z) * u), surface: pts[i]!.surface };
  };
  const path = [point(START_S), ...pts.flatMap((p, i) => (at[i]! > START_S && at[i]! < end ? [{ x: -p.x, z: -p.z, surface: p.surface }] : [])), point(end)];
  const xs = path.map((p) => p.x);
  const zs = path.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const xy = (p: { x: number; z: number }) => `${p.x.toFixed(0)},${p.z.toFixed(0)}`;
  // En linje per sträcka med samma underlag; varje punkts underlag gäller fram till nästa punkt.
  const lines: string[] = [];
  let run = [xy(path[0]!)];
  for (let i = 1; i < path.length; i++) {
    run.push(xy(path[i]!));
    if (i === path.length - 1 || path[i]!.surface !== path[i - 1]!.surface) {
      lines.push(`<polyline points="${run.join(' ')}" stroke="${MAP_COLORS[path[i - 1]!.surface]}"/>`);
      run = [xy(path[i]!)];
    }
  }
  const sw = Math.max(maxX - minX, maxZ - minZ) / 60;
  const pad = sw * 1.5; // rymmer start-/målpunkten (r = 1,3 sw)
  const dot = (p: { x: number; z: number }, c: string) => `<circle cx="${p.x.toFixed(0)}" cy="${p.z.toFixed(0)}" r="${(sw * 1.3).toFixed(1)}" fill="${c}"/>`;
  return `<table class="specs">
    <tr><th>Tid på dygnet</th><td>${LIGHT_NAMES[def.light ?? 'day'] || 'dag'}</td></tr>
    <tr><th>Längd</th><td>${(length / 1000).toFixed(1).replace('.', ',')} km</td></tr>
    <tr><th>Underlag</th><td>${shares.map(([s, k]) => `${SURFACES[s].name.toLowerCase()} ${Math.round(k * 100)} %`).join(', ')}${def.winter ? ' · vinter' : ''}</td></tr>
    ${def.credit ? `<tr><th>Källa</th><td>${def.credit}</td></tr>` : ''}
  </table>
  <svg viewBox="${minX - pad} ${minZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}" style="display:block;width:100%;max-height:40vh;margin-top:10px">
    <g fill="none" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round">${lines.join('')}</g>
    ${dot(path[0]!, '#4caf50')}${dot(path[path.length - 1]!, '#e53935')}
  </svg>`;
}
