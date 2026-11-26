/** Karriärens menyer: översikt med dagsbonus, garage med uppgraderingar och bilhandlare. */

import type { CareerState } from '../account/protocol';
import { localChanged } from '../account/sync';
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

/** Ägda bilar, med karriärens uppgraderingar inbyggda. */
function ownedModels(career: CareerState): CarModel[] {
  return CARS.filter((m) => career.garage[nameOf(m)]).map((m) => ({
    ...m,
    make: () => applyUpgrades(m.make(), career.garage[nameOf(m)]!.upgrades),
  }));
}

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
 * köras, eller null om spelaren backar.
 */
export async function careerMenu(pick: (models: CarModel[]) => Promise<CarModel | null>): Promise<Launch | null> {
  let career = loadCareer().career;
  const bonus = claimDailyBonus(career, localDay());
  let message = '';
  if (bonus.bonus > 0) {
    career = bonus.career;
    commit(career);
    message = `Dagens besök: <span class="ahead">+${formatMoney(bonus.bonus)}</span>`;
  }
  for (;;) {
    const champ = CHAMPIONSHIPS[0]!;
    const ongoing = loadChampionship();
    const c = await showMenu<'stage' | 'championship' | 'garage' | 'dealer' | 'back'>({
      title: 'Karriär',
      subtitle: `Kassa: ${formatMoney(career.money)}`,
      solid: true,
      body: `${message ? `<div>${message}</div>` : ''}<div>Enstaka etapp: prispengar efter tid, och bilen lagas gratis efteråt. Mästerskap: flera etapper i följd där skadorna följer med och lagas för pengar, men prispengarna är större.</div>`,
      items: [
        { label: 'Enstaka etapp', detail: `upp till ${formatMoney(MEDALS[0].prize)}`, value: 'stage' },
        {
          label: ongoing ? `Fortsätt mästerskap: ${championshipById(ongoing.id)?.name}` : `Mästerskap: ${champ.name}`,
          detail: ongoing ? `etapp ${ongoing.leg + 1} av ${championshipById(ongoing.id)?.legs.length}` : `${champ.legs.length} etapper, upp till ${formatMoney(CHAMPIONSHIP_MEDALS[0].prize)}`,
          value: 'championship',
        },
        { label: 'Garage', detail: Object.keys(career.garage).length === 1 ? '1 bil' : `${Object.keys(career.garage).length} bilar`, value: 'garage' },
        { label: 'Bilhandlare', value: 'dealer' },
        { label: 'Tillbaka', value: 'back' },
      ],
      cancel: 'back',
    });
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
    if (c === 'championship') {
      const launch = ongoing ? await ongoingMenu() : await startChampionship(career, pick);
      if (launch) return launch;
    }
    if (c === 'garage') await garage();
    if (c === 'dealer') await dealer();
    career = loadCareer().career;
  }
}

async function garage() {
  for (;;) {
    const career = loadCareer().career;
    const cars = Object.keys(career.garage);
    const car =
      cars.length === 1
        ? cars[0]!
        : await showMenu<string>({
            title: 'Garage',
            subtitle: `Kassa: ${formatMoney(career.money)}`,
            solid: true,
            items: [...cars.map((name) => ({ label: name, value: name })), { label: 'Tillbaka', value: '' }],
            cancel: '',
          });
    if (!car) return;
    await upgrades(car);
    if (cars.length === 1) return;
  }
}

async function upgrades(car: string) {
  let message = '';
  for (;;) {
    const career = loadCareer().career;
    const id = await showMenu<string>({
      title: car,
      subtitle: `Kassa: ${formatMoney(career.money)}`,
      solid: true,
      body: `${message}<table class="specs">${UPGRADES.map((u) => `<tr><th>${u.name}</th><td>${u.effect}</td></tr>`).join('')}</table>`,
      items: [
        ...UPGRADES.map((u) => {
          const level = levelOf(career, car, u.id);
          const price = u.prices[level];
          return {
            label: `${u.name} ${'●'.repeat(level)}${'○'.repeat(u.prices.length - level)}`,
            detail: price === undefined ? 'max' : formatMoney(price),
            value: u.id,
          };
        }),
        { label: 'Tillbaka', value: '' },
      ],
      cancel: '',
    });
    if (!id) return;
    const u = UPGRADES.find((x) => x.id === id)!;
    const result = buyUpgrade(career, car, id);
    if (typeof result === 'object') commit(result);
    message = buyMessage(result, u.prices[levelOf(career, car, id)], `<div class="ahead">${u.name} nivå ${levelOf(career, car, id) + 1} köpt.</div>`);
  }
}

async function dealer() {
  let message = '';
  for (;;) {
    const career = loadCareer().career;
    const forSale = CARS.filter((m) => !career.garage[nameOf(m)]);
    const name = await showMenu<string>({
      title: 'Bilhandlare',
      subtitle: `Kassa: ${formatMoney(career.money)}`,
      solid: true,
      body: `${message}${forSale.length ? forSale.map((m) => `<div><b>${nameOf(m)}</b>: ${m.blurb}</div>`).join('') : '<div>Du äger redan alla bilar.</div>'}`,
      items: [...forSale.map((m) => ({ label: nameOf(m), detail: formatMoney(CAR_PRICES[nameOf(m)] ?? 0), value: nameOf(m) })), { label: 'Tillbaka', value: '' }],
      cancel: '',
    });
    if (!name) return;
    const result = buyCar(career, name);
    if (typeof result === 'object') commit(result);
    message = buyMessage(result, CAR_PRICES[name], `<div class="ahead">${name} står nu i garaget.</div>`);
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
      { label: 'Tillbaka', value: 'back' },
    ],
    cancel: 'back',
  });
  if (c === 'go') return launch;
  if (c === 'abort') await confirmAbort();
  return null;
}

async function startChampionship(career: CareerState, pick: (models: CarModel[]) => Promise<CarModel | null>): Promise<Launch | null> {
  const def = CHAMPIONSHIPS[0]!;
  const targets = championshipTargets(def);
  const c = await showMenu<'go' | 'back'>({
    title: def.name,
    solid: true,
    body: `<div>Etapper: ${def.legs.join(', ')}.</div><div>Totaltiden avgör: ${
      targets ? CHAMPIONSHIP_MEDALS.map((m, i) => `${m.name} under ${targets[i]} s ger ${formatMoney(m.prize)}`).join(', ') : ''
    }. Skador följer med mellan etapperna; på servicen lagar du för egna pengar eller kör vidare. Omstart finns inte.</div>`,
    items: [
      { label: 'Välj bil och starta', value: 'go' },
      { label: 'Tillbaka', value: 'back' },
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
 * nästa etapp ska laddas och 'menu' för huvudmenyn.
 */
export async function championshipLegDone(p: ChampionshipProgress, time: number, resultBody: string, damage: CarDamage): Promise<'next' | 'menu'> {
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
      items: [{ label: 'Huvudmeny', value: 0 }],
    });
    return 'menu';
  }

  await showMenu({
    title: `Etapp ${times.length} av ${def.legs.length}`,
    side: true,
    body: `${resultBody}<div>Totalt hittills: <b>${formatTime(total)}</b></div>`,
    items: [{ label: 'Till service', value: 0 }],
  });

  let message = '';
  for (;;) {
    const cost = repairCost(damage);
    const money = loadCareer().career.money;
    const c = await showMenu<'repair' | 'go' | 'abort'>({
      title: 'Service',
      subtitle: `Kassa: ${formatMoney(money)} · nästa: ${def.legs[times.length]}`,
      solid: true,
      body: `${message}${damageHtml(damage)}${cost > 0 ? `<div>Att laga allt kostar ${formatMoney(cost)}.</div>` : '<div>Bilen är hel.</div>'}`,
      items: [
        ...(cost > 0 ? [{ label: 'Laga allt', detail: formatMoney(cost), value: 'repair' as const }] : []),
        { label: cost > 0 ? 'Kör vidare utan att laga' : 'Kör nästa etapp', value: 'go' },
        { label: 'Avbryt mästerskapet', value: 'abort' },
      ],
    });
    if (c === 'abort') {
      if (await confirmAbort()) return 'menu';
      continue;
    }
    if (c === 'repair') {
      if (money < cost) {
        message = `<div class="behind">Du har inte råd: det kostar ${formatMoney(cost)}.</div>`;
        continue;
      }
      commit({ ...loadCareer().career, money: money - cost });
    }
    saveChampionship(afterLeg(p, time, damage, c === 'repair'));
    return 'next';
  }
}
