/** The weekly challenge's menu: the week's stage, car and weather, the leaderboard and last week's payout. */

import { isDriverName, weekEnd, weekOf, type WeeklyResponse } from './account/protocol';
import { syncAvailable, weeklyBoard, type WeeklyResult } from './account/sync';
import { commit } from './career/menus';
import { loadCareer } from './career/store';
import { formatMoney } from './career/career';
import { settleWeek, weeklyChallenge, weeklyPrize, type WeeklyChallenge } from './career/weekly';
import { formatTime } from './hud';
import { coins, showMenu } from './menu';
import { WEATHER_NAMES } from './physics/weather';
import { stagePreviewHtml } from './stageMenu';

/** Why a run did not count, for the finish screen. */
const REFUSED: Record<Exclude<WeeklyResult, { board: WeeklyResponse }>['error'], string> = {
  'too-fast': 'Tiden underkändes: den är snabbare än vad som går att köra på etappen.',
  'bad-trace': 'Tiden underkändes: körningen följde inte vägen från start till mål.',
  'too-often': 'Tiden underkändes: för tätt efter förra tiden. Vänta en stund och kör igen.',
  'week-over': 'Veckan hann ta slut innan tiden skickades, så den räknas inte.',
  failed: 'Tiden kunde inte skickas: servern svarade inte.',
};

/** The leaderboard as a table, with the player's own row below if outside the top ten. */
export function boardHtml(board: WeeklyResponse | null): string {
  if (!board) return '<div class="behind">Topplistan kunde inte hämtas.</div>';
  if (!board.count) return '<div>Ingen har kört än den här veckan.</div>';
  // The server only stores names that pass isDriverName, which never contain HTML; checked again here.
  const rows = board.top
    .slice(0, 10)
    .map((e, i) => `<tr${board.you?.place === i + 1 ? ' class="ahead"' : ''}><th>${i + 1}. ${isDriverName(e.name) ? e.name : '?'}</th><td>${formatTime(e.time)}</td></tr>`)
    .join('');
  const you = board.you && board.you.place > 10 ? `<tr class="ahead"><th>${board.you.place}. Du</th><td>${formatTime(board.you.time)}</td></tr>` : '';
  return `<table class="specs">${rows}${you}</table><div>${board.count} förare har kört.</div>`;
}

/** The finish screen's verdict on a submitted run of `time` seconds, with the leaderboard if it counted. */
export function runResultHtml(result: WeeklyResult, time: number): string {
  if ('error' in result) return `<div class="behind">${REFUSED[result.error]}</div>`;
  const { you, count } = result.board;
  const kept = you && you.time < time - 0.005 ? ` Din bästa tid ${formatTime(you.time)} gäller.` : '';
  return `<div class="ahead">✓ Godkänd av servern.</div>${you ? `<div>Du ligger ${you.place}:a av ${count} den här veckan.${kept}</div>` : ''}${boardHtml(result.board)}`;
}

/**
 * The finish screen's weekly part: a spinner while the run is uploaded and checked, then the verdict. Shown for at
 * least a moment, so the check does not flash past. `body` is the menu body the part is in.
 */
export function showRunResult(body: Element | null, result: Promise<WeeklyResult>, time: number) {
  const el = body?.querySelector('.weekly-result');
  if (!el) return;
  const step = setTimeout(() => {
    const text = el.querySelector('.loading > span:last-child');
    if (text) text.textContent = 'Servern kontrollerar körningen…';
  }, 600);
  void Promise.all([result, new Promise((r) => setTimeout(r, 1400))]).then(([r]) => {
    clearTimeout(step);
    el.innerHTML = runResultHtml(r, time);
  });
}

/** The placeholder the finish screen shows until showRunResult has the verdict. */
export const RUN_RESULT_PENDING =
  '<div><b>Veckans utmaning</b></div><div class="weekly-result"><div class="loading"><span class="spinner"></span><span>Laddar upp körningen…</span></div></div>';

/** Last week's result, paid out once to the career. Returns a line for the menu, or ''. */
async function settleLastWeek(): Promise<string> {
  const last = weekOf() - 1;
  const career = loadCareer().career;
  if ((career.weeklyPaid ?? -1) >= last) return '';
  const result = await weeklyBoard({ week: last });
  if ('error' in result) return '';
  const board = result.board;
  const settled = settleWeek(loadCareer().career, last, board.you, board.count);
  commit(settled);
  if (!board.you) return '';
  coins();
  return `<div>Förra veckan: ${board.you.place}:a av ${board.count}, <span class="ahead">+${formatMoney(weeklyPrize(board.you.place))}</span> till karriären.</div>`;
}

/** Asks for the leaderboard name; saved in the career so it follows the account. Null = cancelled. */
async function askName(): Promise<string | null> {
  let wrong = false;
  for (;;) {
    let typed = '';
    const c = await showMenu<'ok' | 'cancel'>({
      title: 'Förarnamn',
      solid: true,
      body: `Namnet syns för alla på topplistan.${wrong ? '<div class="behind">2–16 tecken: bokstäver, siffror, mellanslag och . _ -</div>' : ''}`,
      input: { placeholder: 'Ditt namn', onDone: (v) => (typed = v.trim()) },
      items: [
        { label: 'Spara', value: 'ok' },
        { label: 'Avbryt', value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    if (c === 'cancel') return null;
    if (!isDriverName(typed)) {
      wrong = true;
      continue;
    }
    commit({ ...loadCareer().career, driver: typed });
    return typed;
  }
}

/** The weekly challenge; returns the challenge to drive, or null for Tillbaka. */
export async function weeklyMenu(): Promise<WeeklyChallenge | null> {
  const c = weeklyChallenge(weekOf());
  const [paid, board] = await Promise.all([settleLastWeek(), weeklyBoard({ week: c.week })]);
  const ends = new Date(weekEnd(c.week)).toLocaleString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  for (;;) {
    const driver = loadCareer().career.driver;
    const choice = await showMenu<'go' | 'name' | 'back'>({
      title: 'Veckans utmaning',
      subtitle: `slutar ${ends}`,
      solid: true,
      body: `${paid}<div>Alla kör samma etapp med samma standardbil och väder hela veckan. Kör hur många gånger du vill; bästa tiden räknas. När veckan är slut betalar placeringen ut till karriären: ${formatMoney(weeklyPrize(1))} för segern, ${formatMoney(weeklyPrize(10))} för topp tio och ${formatMoney(weeklyPrize(11))} för att ha kört.</div><div><b>${c.stage.name}</b> med <b>${c.model.make().name}</b>. Väder: ${WEATHER_NAMES[c.weather]}.</div>${stagePreviewHtml(c.stage)}${syncAvailable ? boardHtml('board' in board ? board.board : null) : '<div>Topplistan kräver synkservern; utan den räknas bara dina egna tider.</div>'}`,
      items: [
        { label: 'Kör', detail: driver ? `som ${driver}` : 'välj förarnamn först', value: 'go' },
        ...(driver ? [{ label: 'Byt förarnamn', value: 'name' as const }] : []),
        { label: '← Tillbaka', value: 'back' },
      ],
      cancel: 'back',
    });
    if (choice === 'back') return null;
    if (choice === 'name') await askName();
    if (choice === 'go' && (driver || (await askName()))) return c;
  }
}
