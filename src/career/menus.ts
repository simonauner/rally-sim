/** Karriärens menyer: översikt med dagsbonus, garage med uppgraderingar och bilhandlare. */

import type { CareerState } from '../account/protocol';
import { localChanged } from '../account/sync';
import type { PickOptions, Showroom } from '../carSelect';
import { showMenu } from '../menu';
import { CARS, type CarModel } from '../physics/params';
import { STAGES, type StageDef } from '../physics/stage';
import { pickStage } from '../stageMenu';
import {
  applyUpgrades,
  buyCar,
  buyUpgrade,
  CAR_PRICES,
  claimDailyBonus,
  formatMoney,
  levelOf,
  localDay,
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
  championshipTargets,
  CHAMPIONSHIP_MEDALS,
  repairCost,
  type CarDamage,
  type ChampionshipDef,
  type ChampionshipProgress,
} from './championship';
import { formatTime } from '../hud';
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
 * räknar kassan upp från det gamla beloppet första gången menyn visas.
 */
export async function careerMenu(pick: Pick, gained = 0): Promise<Launch | null> {
  let career = loadCareer().career;
  const bonus = claimDailyBonus(career, localDay());
  let message = '';
  if (bonus.bonus > 0) {
    career = bonus.career;
    commit(career);
    message = `Dagens besök: <span class="ahead">+${formatMoney(bonus.bonus)}</span>`;
  }
  let countFrom = career.money - gained;
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
          : '<div>Enstaka etapp: prispengar efter tid, och bilen lagas gratis efteråt. Mästerskap: flera etapper i följd där skadorna följer med och lagas för pengar, men prispengarna är större.</div>'
      }`,
      items: firstCar
        ? [
            { label: 'Bilhandlare: köp din första bil', value: 'dealer' },
            { label: '← Tillbaka', value: 'back' },
          ]
        : [
            { label: 'Enstaka etapp', detail: `upp till ${formatMoney(MEDALS[0].prize)}`, value: 'stage' },
            ...(ongoing
              ? [{ label: `Fortsätt mästerskap: ${championshipById(ongoing.id)?.name}`, detail: `etapp ${ongoing.leg + 1} av ${championshipById(ongoing.id)?.legs.length}`, value: 'ongoing' }]
              : CHAMPIONSHIPS.map((ch) => ({ label: `Mästerskap: ${ch.name}`, detail: `${ch.legs.length} etapper, upp till ${formatMoney(CHAMPIONSHIP_MEDALS[0].prize)}`, value: `champ:${ch.id}` }))),
            { label: 'Garage', detail: Object.keys(career.garage).length === 1 ? '1 bil' : `${Object.keys(career.garage).length} bilar`, value: 'garage' },
            { label: 'Bilhandlare', value: 'dealer' },
            { label: '← Tillbaka', value: 'back' },
          ],
      cancel: 'back',
    });
    if (countFrom !== career.money) countUp(countFrom, career.money);
    countFrom = career.money;
    const c = await menu;
    message = '';
    if (c === 'back') return null;
    if (c === 'stage') {
      const stage = await pickStage('Enstaka etapp', (s) => {
        const t = STAGE_TARGETS[s.name];
        return t ? `guld under ${t[0]} s` : '';
      });
      const model = stage && (await pick(ownedModels(career)));
      if (stage && model) return { model, stage, championship: null };
    }
    const def = c.startsWith('champ:') ? championshipById(c.slice('champ:'.length)) : null;
    if (c === 'ongoing' || def) {
      const launch = def ? await startChampionship(def, career, pick) : await ongoingMenu();
      if (launch) return launch;
    }
    if (c === 'garage') await garage(pick);
    if (c === 'dealer') await dealer(pick);
    career = loadCareer().career;
  }
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
        ...parts.map((u) => ({ label: u.name, note: u.effect, detail: levelOf(career, car, u.id) ? 'monterad' : formatMoney(u.price), value: u.id })),
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
    if (typeof result === 'object') commit(result);
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
        run: async (m) => {
          const name = nameOf(m);
          const result = buyCar(loadCareer().career, name);
          if (typeof result === 'object') commit(result);
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
export function awardPrize(stageName: string, time: number): string {
  const { medal, prize } = prizeFor(stageName, time);
  const career = loadCareer().career;
  commit({ ...career, money: career.money + prize });
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

async function startChampionship(def: ChampionshipDef, career: CareerState, pick: Pick): Promise<Launch | null> {
  const targets = championshipTargets(def);
  const c = await showMenu<'go' | 'back'>({
    title: def.name,
    solid: true,
    body: `<div>Etapper: ${def.legs.join(', ')}.</div><div>Totaltiden avgör: ${
      targets ? CHAMPIONSHIP_MEDALS.map((m, i) => `${m.name} under ${targets[i]} s ger ${formatMoney(m.prize)}`).join(', ') : ''
    }. Skador följer med mellan etapperna; på servicen lagar du för egna pengar eller kör vidare. Omstart finns inte.</div>`,
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
  const progress: ChampionshipProgress = { id: def.id, car: nameOf(model), leg: 0, times: [], damage: null };
  saveChampionship(progress);
  return { model, stage, championship: progress };
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

function damageHtml(d: CarDamage) {
  const b = d.body;
  const worstWheel = Math.max(...d.wheels);
  return `<table class="specs">
    <tr><th>Kaross</th><td>fram ${pct(b.front)} · bak ${pct(b.rear)} · vänster ${pct(b.left)} · höger ${pct(b.right)} · tak ${pct(b.roof)}</td></tr>
    <tr><th>Hjul</th><td>${worstWheel > 0 ? `värsta hjulet ${pct(worstWheel)} skadat` : 'hela'}</td></tr>
    <tr><th>Motor</th><td>${pct(d.powerFactor)} effekt</td></tr>
  </table>`;
}

/**
 * Efter en etapp i mästerskapet. Mellan etapperna: service där spelaren lagar för egna pengar,
 * kör vidare skadad eller avbryter. Efter sista: totaltid och prispengar. Returnerar 'next' när
 * nästa etapp ska laddas, annars prispengarna (0 om spelaren avbryter) på väg till karriären. På servicen står bilen med sina skador på
 * vridbordet från showCar.
 */
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
  const legRows = times.map((t, i) => `<tr><th>${def.legs[i]}</th><td>${formatTime(t)}</td></tr>`).join('');

  if (times.length === def.legs.length) {
    const { medal, prize } = championshipPrize(def, total);
    const career = loadCareer().career;
    commit({ ...career, money: career.money + prize });
    saveChampionship(null);
    await showMenu({
      title: `${def.name}: klart`,
      side: true,
      body: `<table class="specs">${legRows}<tr><th>Totalt</th><td><b>${formatTime(total)}</b></td></tr></table><div class="prize">Prispengar: <span class="ahead">+${formatMoney(prize)}</span>${medal ? ` (${medal})` : ''}</div><div>Bilen lagas och står hel i garaget.</div>`,
      items: [{ label: 'Till karriären', value: 0 }],
    });
    return { prize };
  }

  await showMenu({
    title: `Etapp ${times.length} av ${def.legs.length}`,
    side: true,
    body: `${resultBody}<div>Totalt hittills: <b>${formatTime(total)}</b></div>`,
    items: [{ label: 'Fortsätt, till service', value: 0 }],
  });

  const room = showCar(damage);
  let message = '';
  let repaired = false;
  for (;;) {
    const cost = repaired ? 0 : repairCost(damage);
    const money = loadCareer().career.money;
    const c = await showMenu<'repair' | 'go' | 'abort'>({
      title: 'Service',
      subtitle: `Kassa: ${formatMoney(money)} · nästa: ${def.legs[times.length]}`,
      side: true,
      body: `${message}${repaired ? '' : damageHtml(damage)}${cost > 0 ? `<div>Att laga allt kostar ${formatMoney(cost)}.</div>` : '<div>Bilen är hel.</div>'}`,
      items: [
        ...(cost > 0 ? [{ label: 'Laga allt', detail: formatMoney(cost), value: 'repair' as const }] : []),
        { label: cost > 0 ? 'Kör vidare utan att laga' : 'Kör nästa etapp', value: 'go' },
        { label: 'Avbryt mästerskapet', value: 'abort' },
      ],
    });
    if (c === 'abort') {
      if (await confirmAbort()) {
        room.close();
        return { prize: 0 };
      }
      continue;
    }
    if (c === 'repair') {
      if (money < cost) {
        message = `<div class="behind">Du har inte råd: det kostar ${formatMoney(cost)}.</div>`;
        continue;
      }
      commit({ ...loadCareer().career, money: money - cost });
      repaired = true;
      room.repair();
      message = `<div class="ahead">Lagad för ${formatMoney(cost)}.</div>`;
      continue;
    }
    room.close();
    saveChampionship(afterLeg(p, time, damage, repaired));
    return 'next';
  }
}
