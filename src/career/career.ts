/**
 * Karriärens regler: ekonomi, uppgraderingar och bilpriser. Ren logik utan DOM; sparas av
 * store.ts och synkas med kontot. Alla funktioner returnerar ett nytt tillstånd.
 */

import type { CareerState } from '../account/protocol';
import type { CarParams } from '../physics/params';

/** Pengar man börjar med. */
export const START_MONEY = 2000;
export const DAILY_BONUS = 500;
/** Bilen man börjar med, och vad de andra kostar hos bilhandlaren. */
export const STARTER_CAR = 'Kvarn 240 GL';
export const CAR_PRICES: Record<string, number> = {
  'Kvarn 240 GL': 6000,
  'Kvarn 240 Turbo': 15000,
};

export interface Upgrade {
  id: string;
  name: string;
  /** Pris för varje nivå, i ordning. Nivå 0 är standard. */
  prices: number[];
  /** Vad en nivå gör, för menyn. */
  effect: string;
  apply: (p: CarParams, level: number) => void;
}

/** Uppgraderingarna. Effekterna är måttliga, så en uppgraderad 240 GL fortfarande är en 240 GL. */
export const UPGRADES: Upgrade[] = [
  {
    id: 'engine',
    name: 'Motor',
    prices: [2000, 4500, 8000],
    effect: '+6 % vridmoment per nivå',
    apply: (p, l) => {
      p.engine = { ...p.engine, curveNm: p.engine.curveNm.map((nm) => nm * (1 + 0.06 * l)) };
    },
  },
  {
    id: 'brakes',
    name: 'Bromsar',
    prices: [1000, 2500, 4000],
    effect: '+10 % bromsmoment per nivå',
    apply: (p, l) => {
      p.brake = { ...p.brake, total: p.brake.total * (1 + 0.1 * l) };
    },
  },
  {
    id: 'suspension',
    name: 'Fjädring',
    prices: [1500, 3000, 5000],
    effect: '+8 % dämpning och krängningshämmare per nivå',
    apply: (p, l) => {
      const k = 1 + 0.08 * l;
      p.susp = { ...p.susp, bump: p.susp.bump * k, rebound: p.susp.rebound * k, arbFront: p.susp.arbFront * k, arbRear: p.susp.arbRear * k };
    },
  },
  {
    id: 'tyres',
    name: 'Däck',
    prices: [1500, 3500, 6000],
    effect: '+3 % grepp per nivå',
    apply: (p, l) => {
      p.gripScale *= 1 + 0.03 * l;
    },
  },
];

export function newCareer(): CareerState {
  return { money: START_MONEY, garage: { [STARTER_CAR]: { upgrades: {} } } };
}

export const levelOf = (career: CareerState, car: string, upgrade: string) => career.garage[car]?.upgrades[upgrade] ?? 0;

/** Bilens parametrar med karriärens uppgraderingar. */
export function applyUpgrades(params: CarParams, upgrades: Record<string, number>): CarParams {
  const p = { ...params };
  for (const u of UPGRADES) {
    const level = Math.min(upgrades[u.id] ?? 0, u.prices.length);
    if (level > 0) u.apply(p, level);
  }
  return p;
}

export type BuyResult = CareerState | 'poor' | 'maxed' | 'unknown';

export function buyUpgrade(career: CareerState, car: string, upgradeId: string): BuyResult {
  const u = UPGRADES.find((x) => x.id === upgradeId);
  const owned = career.garage[car];
  if (!u || !owned) return 'unknown';
  const level = levelOf(career, car, upgradeId);
  const price = u.prices[level];
  if (price === undefined) return 'maxed';
  if (career.money < price) return 'poor';
  return {
    ...career,
    money: career.money - price,
    garage: { ...career.garage, [car]: { upgrades: { ...owned.upgrades, [upgradeId]: level + 1 } } },
  };
}

export function buyCar(career: CareerState, car: string): BuyResult {
  const price = CAR_PRICES[car];
  if (price === undefined || career.garage[car]) return 'unknown';
  if (career.money < price) return 'poor';
  return { ...career, money: career.money - price, garage: { ...career.garage, [car]: { upgrades: {} } } };
}

/** Dagsbonusen, en gång per dag. `today` är YYYY-MM-DD i lokal tid. */
export function claimDailyBonus(career: CareerState, today: string): { career: CareerState; bonus: number } {
  if (career.bonusDay === today) return { career, bonus: 0 };
  return { career: { ...career, money: career.money + DAILY_BONUS, bonusDay: today }, bonus: DAILY_BONUS };
}

export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Medaljgränser per etapp (sekunder) och prispengar. Den som går i mål får alltid något. */
export const MEDALS = [
  { name: 'guld', prize: 1200 },
  { name: 'silver', prize: 800 },
  { name: 'brons', prize: 500 },
] as const;
export const FINISH_PRIZE = 250;
export const STAGE_TARGETS: Record<string, [gold: number, silver: number, bronze: number]> = {
  // Testföraren i tests/physics.test.ts tar cirka 89 s framlänges och 92 s baklänges utan att pressa bilen.
  Skogsberg: [90, 100, 115],
  'Skogsberg baklänges': [93, 103, 118],
};

/** Prispengarna för ett enstaka åk. */
export function prizeFor(stageName: string, time: number): { medal: string | null; prize: number } {
  const targets = STAGE_TARGETS[stageName];
  const i = targets ? targets.findIndex((t) => time <= t) : -1;
  return i >= 0 ? { medal: MEDALS[i]!.name, prize: MEDALS[i]!.prize } : { medal: null, prize: FINISH_PRIZE };
}

export const formatMoney = (kr: number) => `${kr.toLocaleString('sv-SE')} kr`;
