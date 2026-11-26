/** Karriärens menyer: översikt med dagsbonus, garage med uppgraderingar och bilhandlare. */

import type { CareerState } from '../account/protocol';
import { localChanged } from '../account/sync';
import { showMenu } from '../menu';
import { CARS, type CarModel } from '../physics/params';
import { STAGE_SKOGSBERG } from '../physics/stage';
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
import { loadCareer, saveCareer } from './store';

const nameOf = (m: CarModel) => m.make().name;

/** Sparar en ändrad karriär och synkar den med kontot. */
function commit(career: CareerState) {
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

/**
 * Karriärens huvudmeny. Delar ut dagsbonusen första gången per dag. Returnerar bilen som ska
 * köra en enstaka etapp, eller null om spelaren backar.
 */
export async function careerMenu(pick: (models: CarModel[]) => Promise<CarModel | null>): Promise<CarModel | null> {
  let career = loadCareer().career;
  const bonus = claimDailyBonus(career, localDay());
  let message = '';
  if (bonus.bonus > 0) {
    career = bonus.career;
    commit(career);
    message = `Dagens besök: <span class="ahead">+${formatMoney(bonus.bonus)}</span>`;
  }
  for (;;) {
    const [gold, silver, bronze] = STAGE_TARGETS[STAGE_SKOGSBERG.name]!;
    const c = await showMenu<'stage' | 'garage' | 'dealer' | 'back'>({
      title: 'Karriär',
      subtitle: `Kassa: ${formatMoney(career.money)}`,
      solid: true,
      body: `${message ? `<div>${message}</div>` : ''}<div>Enstaka etapp: prispengar efter tid (guld under ${gold} s, silver ${silver} s, brons ${bronze} s). Bilen lagas gratis efteråt.</div>`,
      items: [
        { label: `Enstaka etapp: ${STAGE_SKOGSBERG.name}`, detail: `upp till ${formatMoney(MEDALS[0].prize)}`, value: 'stage' },
        { label: 'Garage', detail: Object.keys(career.garage).length === 1 ? '1 bil' : `${Object.keys(career.garage).length} bilar`, value: 'garage' },
        { label: 'Bilhandlare', value: 'dealer' },
        { label: 'Tillbaka', value: 'back' },
      ],
      cancel: 'back',
    });
    message = '';
    if (c === 'back') return null;
    if (c === 'stage') {
      const model = await pick(ownedModels(career));
      if (model) return model;
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
