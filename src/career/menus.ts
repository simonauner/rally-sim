/** Karriärens menyer: översikt med dagsbonus, garage med uppgraderingar och bilhandlare. */

import type { CareerState, HistoryEntry } from '../account/protocol';
import { localChanged } from '../account/sync';
import type { PickOptions, Showroom } from '../carSelect';
import { applause, coins, showMenu } from '../menu';
import skogsrallytImg from '../assets/champ-skogsrallyt.webp';
import myrkullarallytImg from '../assets/champ-myrkullarallyt.webp';
import vinterrallytImg from '../assets/champ-vinterrallyt.webp';
import { CARS, type CarModel } from '../physics/params';
import { STAGES, type StageDef } from '../physics/stage';
import { pickStage, stagePreviewHtml } from '../stageMenu';
import { loadRecord } from '../records';
import { WEATHER_NAMES, type Weather } from '../physics/weather';
import {
  applyUpgrades,
  buyCar,
  buyUpgrade,
  CAR_PRICES,
  claimDailyBonus,
  formatMoney,
  levelOf,
  localDay,
  logged,
  MEDALS,
  prizeFor,
  STAGE_TARGETS,
  UPGRADES,
  type BuyResult,
  type Upgrade,
} from './career';
import {
  afterLeg,
  CHAMPIONSHIPS,
  championshipById,
  championshipPrize,
  championshipUnlocked,
  unlockHint,
  withWin,
  legWeather,
  newProgress,
  raceRivals,
  championshipMedals,
  partCosts,
  repairCost,
  repairPart,
  type RepairPart,
  type CarDamage,
  type ChampionshipDef,
  type ChampionshipProgress,
} from './championship';
import { goldTime, RIVAL_COUNT, standings, type Standing } from './rivals';
import { formatTime, lampStatus } from '../hud';
import { loadCareer, loadChampionship, saveCareer, saveChampionship } from './store';

const nameOf = (m: CarModel) => m.make().name;

/** Sparar en ändrad karriär och synkar den med kontot. */
export function commit(career: CareerState) {
  saveCareer(career);
  localChanged();
}

/** Ägda bilar. Uppgraderingarna läses när bilen byggs, så köp i garaget syns direkt. */
function ownedModels(career: CareerState): CarModel[] {
  return CARS.filter((m) => career.garage[nameOf(m)]).map((m) => ({
    ...m,
    make: () => applyUpgrades(m.make(), loadCareer().career.garage[nameOf(m)]!.upgrades),
  }));
}

type Pick = (models: CarModel[], opts?: PickOptions) => Promise<CarModel | null>;
/** Öppnar vridbordet med bilen och dess skador. */
export type ShowCar = (model: CarModel, damage: CarDamage) => Showroom;

const buyMessage = (result: BuyResult, price: number | undefined, done: string) =>
  result === 'poor' ? `<div class="behind">Du har inte råd: det kostar ${formatMoney(price ?? 0)}.</div>` : typeof result === 'object' ? done : '';

/** Vad som ska köras: bil, etapp och (för mästerskap) framsteget. */
export interface Launch {
  model: CarModel;
  stage: StageDef;
  championship: ChampionshipProgress | null;
}

/** Nästa etapp i ett pågående mästerskap, med bilen och dess uppgraderingar, eller null. */
export function resumeChampionship(): Launch | null {
  const p = loadChampionship();
  const def = p && championshipById(p.id);
  const stage = def && STAGES.find((s) => s.name === def.legs[p.leg]);
  const model = p && ownedModels(loadCareer().career).find((m) => nameOf(m) === p.car);
  return p && stage && model ? { model, stage, championship: p } : null;
}

/** Bekräftar att mästerskapet avbryts. Bilen lagas gratis, men det blir inga prispengar. */
export async function confirmAbort(): Promise<boolean> {
  const c = await showMenu<'abort' | 'stay'>({
    title: 'Avbryta mästerskapet?',
    body: 'Du får inga prispengar för mästerskapet. Bilen lagas gratis och står hel i garaget.',
    items: [
      { label: 'Fortsätt mästerskapet', value: 'stay' },
      { label: 'Avbryt och laga bilen gratis', value: 'abort' },
    ],
    cancel: 'stay',
  });
  if (c === 'abort') saveChampionship(null);
  return c === 'abort';
}

/**
 * Karriärens huvudmeny. Delar ut dagsbonusen första gången per dag. Returnerar vad som ska
 * köras, eller null om spelaren backar. Med `gained` (t.ex. prispengar från ett avslutat mästerskap)
 * och dagsbonusen räknar kassan upp från det gamla beloppet, med pengaljud, första gången menyn visas.
 */
export async function careerMenu(pick: Pick, showCar: ShowCar, gained = 0): Promise<Launch | null> {
  let career = loadCareer().career;
  const bonus = claimDailyBonus(career, localDay());
  let message = '';
  if (bonus.bonus > 0) {
    career = bonus.career;
    commit(career);
    message = `Dagens besök: <span class="ahead">+${formatMoney(bonus.bonus)}</span>`;
  }
  let countFrom = career.money - gained - bonus.bonus;
  for (;;) {
    const ongoing = loadChampionship();
    // En ny karriär börjar utan bil: då finns bara bilhandlaren.
    const firstCar = Object.keys(career.garage).length === 0;
    const menu = showMenu<string>({
      title: 'Karriär',
      subtitle: `Kassa: ${formatMoney(countFrom)}`,
      solid: true,
      body: `${message ? `<div>${message}</div>` : ''}${
        firstCar
          ? '<div>Du har ingen bil än. Köp din första hos bilhandlaren; det som blir över räcker till delar.</div>'
          : `${lastRace(career)}<div>Enstaka lopp: prispengar efter tid, och bilen lagas gratis efteråt. Mästerskap: flera etapper i följd där skadorna följer med och lagas för pengar, men prispengarna är större.</div>`
      }`,
      items: firstCar
        ? [
            { label: 'Bilhandlare: köp din första bil', value: 'dealer' },
            { label: '← Tillbaka', value: 'back' },
          ]
        : [
            { label: 'Enstaka lopp', detail: `upp till ${formatMoney(MEDALS[0].prize)}`, value: 'stage' },
            ongoing
              ? { label: 'Mästerskap', detail: `pågår: ${championshipById(ongoing.id)?.name}, etapp ${ongoing.leg + 1} av ${championshipById(ongoing.id)?.legs.length}`, value: 'champ' }
              : { label: 'Mästerskap', detail: `upp till ${formatMoney(Math.max(...CHAMPIONSHIPS.map((ch) => championshipMedals(ch)[0]!.prize)))}`, value: 'champ' },
            { label: 'Historik', detail: career.history?.length ? `${career.history.length} händelser` : undefined, value: 'history' },
            { label: 'Garage', detail: Object.keys(career.garage).length === 1 ? '1 bil' : `${Object.keys(career.garage).length} bilar`, value: 'garage' },
            { label: 'Bilhandlare', value: 'dealer' },
            { label: '← Tillbaka', value: 'back' },
          ],
      cancel: 'back',
    });
    if (countFrom !== career.money) {
      coins();
      countUp(countFrom, career.money);
    }
    countFrom = career.money;
    const c = await menu;
    message = '';
    if (c === 'back') return null;
    if (c === 'stage') {
      const stage = await pickStage('Enstaka lopp', (s) => {
        const t = STAGE_TARGETS[s.name];
        return t ? `guld under ${t[0]} s` : '';
      });
      const model = stage && (await pick(ownedModels(career)));
      if (stage && model) return { model, stage, championship: null };
    }
    if (c === 'champ') {
      const launch = ongoing ? await ongoingMenu() : await championshipMenu(career, pick, showCar);
      if (launch) return launch;
    }
    if (c === 'history') await history(career);
    if (c === 'garage') await garage(pick);
    if (c === 'dealer') await dealer(pick);
    career = loadCareer().career;
  }
}

/** En vy från en etapp i varje mästerskap, tagen i spelet. */
const CHAMPIONSHIP_IMAGES: Record<string, string> = {
  skogsrallyt: skogsrallytImg,
  myrkullarallyt: myrkullarallytImg,
  vinterrallyt: vinterrallytImg,
};

/** Mästerskapen att välja mellan. */
async function championshipMenu(career: CareerState, pick: Pick, showCar: ShowCar): Promise<Launch | null> {
  for (;;) {
    const id = await showMenu<string>({
      title: 'Mästerskap',
      subtitle: `Kassa: ${formatMoney(career.money)}`,
      solid: true,
      body: '<div>Flera etapper i följd med samma bil mot ett fält av andra förare. Skador följer med mellan etapperna; du kan göra service mellan etapperna och laga bilen om du behöver.</div>',
      items: [
        ...CHAMPIONSHIPS.map((ch) =>
          championshipUnlocked(career, ch)
            ? { label: ch.name, image: CHAMPIONSHIP_IMAGES[ch.id], detail: `upp till ${formatMoney(championshipMedals(ch)[0]!.prize)}`, value: ch.id }
            : { label: ch.name, image: CHAMPIONSHIP_IMAGES[ch.id], detail: unlockHint(career, ch), value: ch.id, locked: true },
        ),
        { label: '← Tillbaka', value: '' },
      ],
      cancel: '',
    });
    const def = championshipById(id);
    if (!def) return null;
    if (!championshipUnlocked(career, def)) continue;
    const launch = await startChampionship(def, career, pick, showCar);
    if (launch) return launch;
  }
}

/** En historikrad som [vad, detaljer]. */
function describe(e: HistoryEntry): [string, string] {
  const money = e.amount > 0 ? `<span class="ahead">+${formatMoney(e.amount)}</span>` : e.amount < 0 ? `−${formatMoney(-e.amount)}` : '';
  const parts = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' · ');
  if (e.kind === 'stage') return [e.name, parts(e.time !== undefined && formatTime(e.time), e.medal ?? 'i mål', e.car, money)];
  if (e.kind === 'championship') return [e.name, parts(!!e.place && `${trophy(e.place)}${e.place}:a av ${e.of}`, e.time !== undefined && formatTime(e.time), e.car, money)];
  if (e.kind === 'upgrade') return [e.name, parts(e.car, money)];
  return [`Köpte ${e.name}`, money];
}

/** Senaste enstaka etappen eller mästerskapet, för karriärens översikt. */
function lastRace(career: CareerState) {
  const e = [...(career.history ?? [])].reverse().find((x) => x.kind === 'stage' || x.kind === 'championship');
  if (!e) return '';
  const [what, detail] = describe(e);
  return `<div>Senast: <b>${what}</b> · ${detail}</div>`;
}

const dateOf = (at: number) => new Date(at).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });

/** Allt spelaren gjort i karriären, nyast först. */
async function history(career: CareerState) {
  const list = [...(career.history ?? [])].reverse();
  const rows = list.map((e) => {
    const [what, detail] = describe(e);
    return `<tr><th>${dateOf(e.at)}</th><td><b>${what}</b><br>${detail}</td></tr>`;
  });
  await showMenu({
    title: 'Historik',
    subtitle: `Kassa: ${formatMoney(career.money)}`,
    solid: true,
    body: rows.length ? `<table class="specs">${rows.join('')}</table>` : '<div>Inget än. Kör en etapp eller köp något så hamnar det här.</div>',
    items: [{ label: '← Tillbaka', value: 0 }],
    cancel: 0,
  });
}

/** Räknar upp kassan i menyns underrubrik under 1,5 s, snabbt först och långsamt mot slutet. */
function countUp(from: number, to: number) {
  const el = document.querySelector('#menu .subtitle');
  const start = performance.now();
  const tick = (now: number) => {
    if (!el?.isConnected) return;
    const t = Math.min(1, (now - start) / 1500);
    el.textContent = `Kassa: ${formatMoney(Math.round(from + (to - from) * (1 - (1 - t) ** 3)))}`;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Garaget: samma vridbord som bilväljaren, med uppgraderingarna som undermeny. */
async function garage(pick: Pick) {
  await pick(ownedModels(loadCareer().career), {
    title: 'Garage',
    subtitle: () => `Kassa: ${formatMoney(loadCareer().career.money)}`,
    action: { label: 'Uppgradera', run: (m) => upgrades(nameOf(m)) },
  });
}

async function upgrades(car: string) {
  for (;;) {
    const career = loadCareer().career;
    const groups = [...new Set(UPGRADES.map((u) => u.group))];
    const group = await showMenu<string>({
      title: car,
      subtitle: `Kassa: ${formatMoney(career.money)}`,
      side: true,
      items: [
        ...groups.map((g) => {
          const parts = UPGRADES.filter((u) => u.group === g);
          return { label: g, detail: `${parts.filter((u) => levelOf(career, car, u.id)).length}/${parts.length} monterade`, value: g };
        }),
        { label: '← Tillbaka', value: '' },
      ],
      cancel: '',
    });
    if (!group) return;
    await parts(car, group);
  }
}

async function parts(car: string, group: string) {
  const parts = UPGRADES.filter((u) => u.group === group);
  let message = '';
  for (;;) {
    const career = loadCareer().career;
    const id = await showMenu<string>({
      title: group,
      subtitle: `${car} · Kassa: ${formatMoney(career.money)}`,
      side: true,
      body: message,
      items: [
        ...parts.map((u) => ({ label: u.name, note: u.effect, detail: levelOf(career, car, u.id) ? 'monterad' : formatMoney(u.price), value: u.id, denied: () => buyUpgrade(career, car, u.id) === 'poor' })),
        { label: '← Tillbaka', value: '' },
      ],
      cancel: '',
    });
    if (!id) return;
    const u = parts.find((x) => x.id === id)!;
    const result = buyUpgrade(career, car, id);
    if (typeof result === 'object' && !(await confirmPart(u, career.money))) {
      message = '';
      continue;
    }
    if (typeof result === 'object') {
      commit(result);
      coins();
    }
    message = buyMessage(result, u.price, `<div class="ahead">${u.name} monterad.</div>`);
  }
}

/** Frågar om köpet: pris, kassa, vad som blir kvar och vad delen gör. */
const confirmPart = (u: Upgrade, money: number) =>
  showMenu<boolean>({
    title: u.name,
    subtitle: u.group,
    side: true,
    body: `<div>${u.effect}</div><table class="specs">
      <tr><th>Pris</th><td>${formatMoney(u.price)}</td></tr>
      <tr><th>Kassa</th><td>${formatMoney(money)}</td></tr>
      <tr><th>Kvar efter köpet</th><td>${formatMoney(money - u.price)}</td></tr>
    </table>`,
    items: [
      { label: `Köp för ${formatMoney(u.price)}`, value: true },
      { label: '← Tillbaka', value: false },
    ],
    cancel: false,
  });

/** Bilhandlaren: samma vridbord som bilväljaren, med ägda bilar att jämföra med. */
async function dealer(pick: Pick) {
  for (;;) {
    const career = loadCareer().career;
    const first = Object.keys(career.garage).length === 0;
    const forSale = CARS.filter((m) => !career.garage[nameOf(m)]);
    if (!forSale.length) {
      await showMenu({ title: 'Bilhandlare', solid: true, body: 'Du äger redan alla bilar.', items: [{ label: '← Tillbaka', value: 0 }], cancel: 0 });
      return;
    }
    const bought = await pick(forSale, {
      title: 'Bilhandlare',
      subtitle: () => `Kassa: ${formatMoney(loadCareer().career.money)}`,
      detail: (m) => formatMoney(CAR_PRICES[nameOf(m)] ?? 0),
      compare: ownedModels(career),
      action: {
        label: 'Köp',
        denied: (m) => buyCar(loadCareer().career, nameOf(m)) === 'poor',
        run: async (m) => {
          const name = nameOf(m);
          const result = buyCar(loadCareer().career, name);
          if (typeof result === 'object') {
            commit(result);
            coins();
          }
          await showMenu({
            title: typeof result === 'object' ? 'Köpt' : 'Inget köp',
            side: true,
            body: buyMessage(result, CAR_PRICES[name], `<div class="ahead">${name} står nu i garaget.</div>`),
            items: [{ label: 'OK', value: 0 }],
            cancel: 0,
          });
          return typeof result === 'object';
        },
      },
    });
    // Efter ett köp visas handlaren igen utan den köpta bilen; efter den första tillbaka till karriären.
    if (!bought || first) return;
  }
}

/** Delar ut prispengar för ett enstaka åk och returnerar en rad till målskärmen. */
export function awardPrize(stageName: string, time: number, car: string): string {
  const { medal, prize } = prizeFor(stageName, time);
  const career = loadCareer().career;
  commit(logged({ ...career, money: career.money + prize }, { kind: 'stage', name: stageName, car, time, medal, amount: prize }));
  return `<div class="prize">Prispengar: <span class="ahead">+${formatMoney(prize)}</span>${medal ? ` (${medal})` : ''}</div><div>Bilen lagas gratis efter enstaka lopp.</div>`;
}

async function ongoingMenu(): Promise<Launch | null> {
  const launch = resumeChampionship();
  if (!launch) {
    saveChampionship(null);
    return null;
  }
  const c = await showMenu<'go' | 'abort' | 'back'>({
    title: championshipById(launch.championship!.id)!.name,
    solid: true,
    body: `Nästa etapp: ${launch.stage.name} med ${nameOf(launch.model)}.`,
    items: [
      { label: 'Kör nästa etapp', value: 'go' },
      { label: 'Avbryt mästerskapet', value: 'abort' },
      { label: '← Tillbaka', value: 'back' },
    ],
    cancel: 'back',
  });
  if (c === 'go') return launch;
  if (c === 'abort') await confirmAbort();
  return null;
}

async function startChampionship(def: ChampionshipDef, career: CareerState, pick: Pick, showCar: ShowCar): Promise<Launch | null> {
  const c = await showMenu<'go' | 'back'>({
    title: def.name,
    solid: true,
    body: `<img class="banner" src="${CHAMPIONSHIP_IMAGES[def.id]}" alt=""><div>Etapper: ${def.legs.join(', ')}.</div><div>Du kör mot ${RIVAL_COUNT} andra förare, och totaltiden avgör placeringen. Omstart finns inte.</div><table class="specs">${championshipMedals(def)
      .map((m, i) => `<tr><th>${trophy(i + 1)}${i + 1}:a</th><td>${formatMoney(m.prize)}</td></tr>`)
      .join('')}</table>`,
    items: [
      { label: 'Välj bil och starta', value: 'go' },
      { label: '← Tillbaka', value: 'back' },
    ],
    cancel: 'back',
  });
  if (c !== 'go') return null;
  const model = await pick(ownedModels(career));
  const stage = STAGES.find((s) => s.name === def.legs[0]);
  if (!model || !stage) return null;
  // Samma förhandsvisning och service som mellan etapperna, med hel bil.
  const whole: CarDamage = { body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 }, wheels: [0, 0, 0, 0], powerFactor: 1, lamps: [0, 0] };
  // Spelarens bästa takt på mästerskapets etapper, från egna rekord, så fältet möter den.
  const paces = def.legs.flatMap((leg) => {
    const s = STAGES.find((x) => x.name === leg);
    const best = s && loadRecord(s);
    return best ? [best.time / goldTime(leg)] : [];
  });
  // Framsteget skapas före förhandsvisningen, så första etappens väder går att visa; det sparas först vid start.
  const progress = newProgress(def, nameOf(model), Math.floor(Math.random() * 2 ** 31), paces.length ? Math.min(...paces) : undefined);
  if (!(await beforeLeg(def, 0, whole, (d) => showCar(model, d), legWeather(progress, 0)))) return null;
  saveChampionship(progress);
  return { model, stage, championship: progress };
}

const PART_NAMES: Record<RepairPart, string> = { body: 'karossen', wheels: 'hjulen', engine: 'motorn', lamps: 'strålkastarna' };

const pct = (x: number) => `${Math.round(x * 100)} %`;

function damageHtml(d: CarDamage) {
  const b = d.body;
  const worstWheel = Math.max(...d.wheels);
  return `<table class="specs">
    <tr><th>Kaross</th><td>fram ${pct(b.front)} · bak ${pct(b.rear)} · vänster ${pct(b.left)} · höger ${pct(b.right)} · tak ${pct(b.roof)}</td></tr>
    <tr><th>Hjul</th><td>${worstWheel > 0 ? `värsta hjulet ${pct(worstWheel)} skadat` : 'hela'}</td></tr>
    <tr><th>Motor</th><td>${pct(d.powerFactor)} effekt</td></tr>
    <tr><th>Strålkastare</th><td>${lampStatus(d.lamps ?? [0, 0])}</td></tr>
  </table>`;
}

/**
 * Efter en etapp i mästerskapet. Mellan etapperna: förhandsvisning av nästa etapp och sedan service där spelaren lagar för egna pengar,
 * kör vidare skadad eller avbryter. Efter sista: totaltid och prispengar. Returnerar 'next' när
 * nästa etapp ska laddas, annars prispengarna (0 om spelaren avbryter) på väg till karriären. På servicen står bilen med sina skador på
 * vridbordet från showCar.
 */
const MEDAL_COLORS = [
  ['#fff6b0', '#f2c200', '#a87b00'],
  ['#ffffff', '#c9ced6', '#7d848f'],
  ['#ffd9b0', '#d4884a', '#8a4f1f'],
];

/** Glänsande pokal i guld, silver eller brons för plats 1–3, annars bara siffran. */
function trophy(place: number) {
  const c = MEDAL_COLORS[place - 1];
  if (!c) return `<span class="trophy">${place}.</span>`;
  const id = `trophy${place}`;
  return `<svg class="trophy" viewBox="0 0 24 24" role="img" aria-label="${place}:a"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset=".45" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient></defs><path d="M6 5H3.5v1.5A3.5 3.5 0 0 0 7 10M18 5h2.5v1.5A3.5 3.5 0 0 1 17 10" fill="none" stroke="url(#${id})" stroke-width="1.6"/><path d="M6 3h12v4a6 6 0 0 1-4.5 5.8V16h2.5v2.5H8V16h2.5v-3.2A6 6 0 0 1 6 7zM6.5 19.5h11v2h-11z" fill="url(#${id})" stroke="${c[2]}" stroke-width=".6"/><path d="M8.3 4.5v2.5a4 4 0 0 0 1.6 3.2" fill="none" stroke="#fff" stroke-opacity=".8" stroke-linecap="round"/></svg>`;
}

/** Placering på en etapp som en rund bricka, i guld, silver och brons för 1–3. */
const posBadge = (place: number) => `<span class="pos p${place}">${place}</span>`;
/** Placeringen för tiden `t` bland `all` (som inkluderar t). */
const rankOf = (t: number, all: number[]) => 1 + all.filter((x) => x < t).length;

/** Ställningen: placering, namn, totaltid, lucka till ledaren och tid och placering på senaste etappen. */
function standingsHtml(table: Standing[]) {
  const lead = table[0]!.total;
  const lasts = table.map((s) => s.last);
  const rows = table
    .map((s, i) => {
      const name = s.player ? `<b>${s.name}</b>` : s.name;
      const gap = i === 0 ? formatTime(s.total) : `+${(s.total - lead).toFixed(2)}`;
      return `<tr${s.player ? ' class="ahead"' : ''}><th>${trophy(i + 1)}${name}</th><td>${gap}</td><td>${formatTime(s.last)}${posBadge(rankOf(s.last, lasts))}</td></tr>`;
    })
    .join('');
  return `<table class="specs standings"><tr><th></th><td>totalt</td><td>etappen</td></tr>${rows}</table>`;
}

export async function championshipLegDone(
  p: ChampionshipProgress,
  time: number,
  resultBody: string,
  damage: CarDamage,
  showCar: (d: CarDamage) => Showroom,
): Promise<'next' | { prize: number }> {
  const def = championshipById(p.id)!;
  const times = [...p.times, time];
  const total = times.reduce((a, b) => a + b, 0);
  p = raceRivals(p, time);
  const legRows = times
    .map((t, i) => `<tr><th>${def.legs[i]}</th><td>${formatTime(t)}${posBadge(rankOf(t, [t, ...p.rivals!.map((v) => v.times[i]!)]))}</td></tr>`)
    .join('');
  const table = standings(p.rivals!, times);
  const place = table.findIndex((s) => s.player) + 1;

  if (times.length === def.legs.length) {
    const { medal, prize } = championshipPrize(def, place);
    const career = loadCareer().career;
    commit(logged({ ...(place === 1 ? withWin(career, def) : career), money: career.money + prize }, { kind: 'championship', name: def.name, car: p.car, place, of: table.length, time: total, amount: prize }));
    saveChampionship(null);
    applause();
    await showMenu({
      title: `${def.name}: klart`,
      side: true,
      body: `<div>${place === 1 ? '<b class="ahead">Du vann mästerskapet!</b>' : `Du kom <b>${place}:a</b> av ${table.length}.`}</div>${standingsHtml(table)}<table class="specs">${legRows}<tr><th>Totalt</th><td><b>${formatTime(total)}</b></td></tr></table><div class="prize">Prispengar: <span class="ahead">+${formatMoney(prize)}</span>${medal ? ` (${medal})` : ''}</div><div>Bilen lagas och står hel i garaget.</div>`,
      items: [{ label: 'Avsluta mästerskapet', value: 0 }],
    });
    return { prize };
  }

  await showMenu({
    title: `Etapp ${times.length} av ${def.legs.length}`,
    side: true,
    body: `${resultBody}<div>Du ligger <b>${place}:a</b> av ${table.length} efter ${times.length} av ${def.legs.length} etapper.</div>${standingsHtml(table)}`,
    items: [{ label: 'Fortsätt', value: 0 }],
  });

  const left = await beforeLeg(def, times.length, damage, showCar, legWeather(p, times.length));
  if (!left) return { prize: 0 };
  saveChampionship(afterLeg(p, time, left, repairCost(left) === 0));
  return 'next';
}

/**
 * Före etapp `leg` (0-baserad): förhandsvisning av etappen och service där spelaren lagar för egna pengar,
 * kör vidare skadad eller avbryter. Returnerar skadan bilen startar med, eller null om mästerskapet avbröts.
 */
async function beforeLeg(def: ChampionshipDef, leg: number, damage: CarDamage, showCar: (d: CarDamage) => Showroom, weather: Weather): Promise<CarDamage | null> {
  const nextName = def.legs[leg]!;
  const nextStage = STAGES.find((s) => s.name === nextName);
  // Vridbordet öppnas vid första besöket på servicen och står kvar bakom förhandsvisningen.
  let room: Showroom | null = null;
  let message = '';
  let atService = false;
  for (;;) {
    const cost = repairCost(damage);
    if (!atService) {
      const c = await showMenu<'service' | 'go' | 'abort'>({
        title: leg === 0 ? nextName : `Nästa: ${nextName}`,
        subtitle: `Etapp ${leg + 1} av ${def.legs.length}`,
        side: true,
        body: `<div>Väder: ${WEATHER_NAMES[weather]}.</div>${nextStage ? stagePreviewHtml(nextStage) : ''}`,
        items: [
          // Före första etappen är bilen ny, så ingen service.
          ...(leg > 0 ? [{ label: 'Till service', value: 'service' as const }] : []),
          { label: 'Starta etappen', detail: cost > 0 ? 'utan att laga' : undefined, value: 'go' },
          { label: 'Avbryt mästerskapet', value: 'abort' },
        ],
        cancel: leg > 0 ? 'service' : 'abort',
      });
      if (c === 'go') break;
      if (c === 'abort') {
        if (await confirmAbort()) {
          room?.close();
          return null;
        }
        continue;
      }
      atService = true;
      room ??= showCar(damage);
      continue;
    }
    const money = loadCareer().career.money;
    const parts = partCosts(damage);
    const broken = (Object.keys(parts) as RepairPart[]).filter((k) => parts[k] > 0);
    const c = await showMenu<RepairPart | 'all' | 'go' | 'back'>({
      title: 'Service',
      subtitle: `Kassa: ${formatMoney(money)} · nästa: ${nextName}`,
      side: true,
      body: `${message}${cost > 0 ? `${damageHtml(damage)}<div>Att laga allt kostar ${formatMoney(cost)}.</div>` : '<div>Bilen är hel.</div>'}`,
      items: [
        ...(broken.length > 1 ? [{ label: 'Laga allt', detail: formatMoney(cost), value: 'all' as const, denied: () => money < cost }] : []),
        ...broken.map((k) => ({ label: `Laga ${PART_NAMES[k]}`, detail: formatMoney(parts[k]), value: k, denied: () => money < parts[k] })),
        { label: cost > 0 ? 'Kör vidare utan att laga' : 'Kör nästa etapp', value: 'go' },
        { label: '← Tillbaka', value: 'back' },
      ],
      cancel: 'back',
    });
    if (c === 'back') {
      atService = false;
      message = '';
      continue;
    }
    if (c !== 'go') {
      const fix = c === 'all' ? broken : [c];
      const price = c === 'all' ? cost : parts[c];
      if (money < price) {
        message = `<div class="behind">Du har inte råd: det kostar ${formatMoney(price)}.</div>`;
        continue;
      }
      commit({ ...loadCareer().career, money: money - price });
      coins();
      damage = fix.reduce(repairPart, damage);
      room?.repair(fix.includes('body'), fix.includes('wheels'));
      message = `<div class="ahead">${c === 'all' ? 'Lagad' : `Lagade ${PART_NAMES[c]}`} för ${formatMoney(price)}.</div>`;
      continue;
    }
    break;
  }
  room?.close();
  return damage;
}
