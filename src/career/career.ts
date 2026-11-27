/**
 * Karriärens regler: ekonomi, uppgraderingar och bilpriser. Ren logik utan DOM; sparas av
 * store.ts och synkas med kontot. Alla funktioner returnerar ett nytt tillstånd.
 */

import { MAX_HISTORY, type CareerState, type HistoryEntry } from '../account/protocol';
import type { CarParams } from '../physics/params';

/**
 * Pengar man börjar med, utan bil. Räcker till en av de billiga bilarna hos bilhandlaren:
 * 240 GL med pengar över till delar, eller Ljungen och nästan inget mer.
 */
export const START_MONEY = 10000;
export const DAILY_BONUS = 500;
/** Vad bilarna kostar hos bilhandlaren. */
export const CAR_PRICES: Record<string, number> = {
  'Kvarn 240 GL': 6000,
  'Kvarn 240 Turbo': 15000,
  'Ljung 1600 S': 9000,
  'Ljung 2000 16V': 30000,
  'Strand 2.0 GT': 38000,
  'Kvarn Turbo 4x4': 50000,
};

/**
 * Bilarnas klass: 1 är 80-talets amatörbilar, 2 är kitcars och Grupp A-bilar som låses upp
 * när alla mästerskap i klass 1 är vunna. Bilar som saknas här räknas som klass 1.
 */
export type Tier = 1 | 2;
const CAR_TIERS: Record<string, Tier> = { 'Ljung 2000 16V': 2, 'Strand 2.0 GT': 2, 'Kvarn Turbo 4x4': 2 };
export const tierOf = (car: string): Tier => CAR_TIERS[car] ?? 1;

/**
 * Klassens takt mot klass 1 (guldtider och motståndare) och hur mycket mer prispengarna är värda.
 * shortcut: 0,92 är uppskattat från verkligheten (Rally4/Rally2 mot Rally5), inte uppmätt;
 * testföraren kör inte fort nog för att mäta skillnaden. Justera efter provkörning.
 */
export const TIER_PACE: Record<Tier, number> = { 1: 1, 2: 0.92 };
export const TIER_PRIZE: Record<Tier, number> = { 1: 1, 2: 2 };

export type UpgradeGroup = 'Motor' | 'Drivlina' | 'Bromsar' | 'Fjädring' | 'Kaross' | 'Däck';

/** En del man kan köpa och montera, en gång per bil. Sparas som nivå 1 i garaget. */
export interface Upgrade {
  id: string;
  /** Bilklassen delen passar; klass 2 har egna, dyrare delar. */
  tier: Tier;
  group: UpgradeGroup;
  name: string;
  price: number;
  /** Vad delen gör, för menyn. */
  effect: string;
  apply: (p: CarParams) => void;
}

/** Skalar vridmomentkurvan med en faktor som beror på varvtalet. */
const torque = (p: CarParams, factor: (rpm: number) => number) => {
  p.engine = { ...p.engine, curveNm: p.engine.curveNm.map((nm, i) => nm * factor(p.engine.curveRpm[i]!)) };
};

/**
 * Delarna. Effekterna är måttliga och staplas, så en fullt byggd 240 GL fortfarande är en 240 GL.
 * shortcut: fysiken har ingen bromsfading eller motorvärme, så borrade skivor och luftfilter ger bara
 * mer moment; ge dem egna effekter om det modelleras.
 */
export const UPGRADES: Upgrade[] = [
  {
    tier: 1,
    id: 'airfilter',
    group: 'Motor',
    name: 'Sportluftfilter',
    price: 800,
    effect: '+2 % vridmoment',
    apply: (p) => torque(p, () => 1.02),
  },
  {
    tier: 1,
    id: 'exhaust',
    group: 'Motor',
    name: 'Sportavgassystem',
    price: 2000,
    effect: '+4 % vridmoment över 3 500 rpm',
    apply: (p) => torque(p, (rpm) => (rpm >= 3500 ? 1.04 : 1.01)),
  },
  {
    tier: 1,
    id: 'racecat',
    group: 'Motor',
    name: 'Racekatalysator',
    price: 1500,
    effect: '+3 % vridmoment över 3 500 rpm',
    apply: (p) => torque(p, (rpm) => (rpm >= 3500 ? 1.03 : 1)),
  },
  {
    tier: 1,
    id: 'cams',
    group: 'Motor',
    name: 'Vassare kamaxlar',
    price: 3500,
    effect: '+8 % vridmoment över 4 500 rpm, −4 % under 2 500',
    apply: (p) => torque(p, (rpm) => (rpm >= 4500 ? 1.08 : rpm < 2500 ? 0.96 : 1.02)),
  },
  {
    tier: 1,
    id: 'pistons',
    group: 'Motor',
    name: 'Smidda kolvar',
    price: 4500,
    effect: 'Varvtaket höjs 500 rpm',
    apply: (p) => {
      p.engine = { ...p.engine, limiterRpm: p.engine.limiterRpm + 500 };
      p.gearbox = { ...p.gearbox, upshiftRpm: p.gearbox.upshiftRpm + 400 };
    },
  },
  {
    tier: 1,
    id: 'gearbox',
    group: 'Drivlina',
    name: 'Racelåda',
    price: 5000,
    effect: 'Snabbare växlingar och 6 % kortare slutväxel',
    apply: (p) => {
      p.gearbox = { ...p.gearbox, shiftTime: p.gearbox.shiftTime * 0.6, final: p.gearbox.final * 1.06 };
    },
  },
  {
    tier: 1,
    id: 'lsd',
    group: 'Drivlina',
    name: 'Spärrdiff',
    price: 4000,
    effect: 'Hårdare låsning: mindre spinn på innerhjulet ut ur kurvor',
    apply: (p) => {
      p.diff = { lock: Math.max(p.diff.lock, 0.6), preload: Math.max(p.diff.preload, 80) };
    },
  },
  {
    tier: 1,
    id: 'pads',
    group: 'Bromsar',
    name: 'Racebelägg',
    price: 1000,
    effect: '+8 % bromsmoment',
    apply: (p) => {
      p.brake = { ...p.brake, total: p.brake.total * 1.08 };
    },
  },
  {
    tier: 1,
    id: 'drilled',
    group: 'Bromsar',
    name: 'Borrade bromsskivor',
    price: 1500,
    effect: '+5 % bromsmoment',
    apply: (p) => {
      p.brake = { ...p.brake, total: p.brake.total * 1.05 };
    },
  },
  {
    tier: 1,
    id: 'bigdiscs',
    group: 'Bromsar',
    name: 'Större bromsskivor',
    price: 3000,
    effect: '+12 % bromsmoment',
    apply: (p) => {
      p.brake = { ...p.brake, total: p.brake.total * 1.12 };
    },
  },
  {
    tier: 1,
    id: 'dampers',
    group: 'Fjädring',
    name: 'Gasstötdämpare',
    price: 2500,
    effect: '+15 % dämpning',
    apply: (p) => {
      p.susp = { ...p.susp, bump: p.susp.bump * 1.15, rebound: p.susp.rebound * 1.15 };
    },
  },
  {
    tier: 1,
    id: 'springs',
    group: 'Fjädring',
    name: 'Sportfjädrar',
    price: 2000,
    effect: '+12 % fjäderkonstant',
    apply: (p) => {
      p.susp = { ...p.susp, kFront: p.susp.kFront * 1.12, kRear: p.susp.kRear * 1.12 };
    },
  },
  {
    tier: 1,
    id: 'arb',
    group: 'Fjädring',
    name: 'Kraftigare krängningshämmare',
    price: 1500,
    effect: '+25 % krängningsstyvhet',
    apply: (p) => {
      p.susp = { ...p.susp, arbFront: p.susp.arbFront * 1.25, arbRear: p.susp.arbRear * 1.25 };
    },
  },
  {
    tier: 1,
    id: 'rallytyres',
    group: 'Däck',
    name: 'Rallydäck',
    price: 3500,
    effect: '+6 % grepp',
    apply: (p) => {
      p.gripScale *= 1.06;
    },
  },
  // Klass 2: tävlingsdelar till kitcars och Grupp A-bilar.
  {
    tier: 2,
    id: 'ecu',
    group: 'Motor',
    name: 'Programmerbar motorstyrning',
    price: 6000,
    effect: '+5 % vridmoment över 3 000 rpm',
    apply: (p) => torque(p, (rpm) => (rpm >= 3000 ? 1.05 : 1)),
  },
  {
    tier: 2,
    id: 'intake',
    group: 'Motor',
    name: 'Tävlingsinsug',
    price: 4000,
    effect: '+3 % vridmoment',
    apply: (p) => torque(p, () => 1.03),
  },
  {
    tier: 2,
    id: 'flywheel',
    group: 'Motor',
    name: 'Lätt svänghjul',
    price: 3500,
    effect: 'Motorn varvar upp och ner 30 % snabbare',
    apply: (p) => {
      p.engine = { ...p.engine, inertia: p.engine.inertia * 0.7 };
    },
  },
  {
    tier: 2,
    id: 'dogbox',
    group: 'Drivlina',
    name: 'Klolåda',
    price: 9000,
    effect: 'Växlar på halva tiden',
    apply: (p) => {
      p.gearbox = { ...p.gearbox, shiftTime: p.gearbox.shiftTime * 0.5 };
    },
  },
  {
    tier: 2,
    id: 'platelsd',
    group: 'Drivlina',
    name: 'Lamellspärr',
    price: 7000,
    effect: 'Nästan låst diff: drar rakt ut ur kurvorna men vill gå rakt fram',
    apply: (p) => {
      p.diff = { lock: Math.max(p.diff.lock, 0.75), preload: Math.max(p.diff.preload, 120) };
    },
  },
  {
    tier: 2,
    id: 'calipers',
    group: 'Bromsar',
    name: 'Fyrkolvsok',
    price: 5000,
    effect: '+15 % bromsmoment',
    apply: (p) => {
      p.brake = { ...p.brake, total: p.brake.total * 1.15 };
    },
  },
  {
    tier: 2,
    id: 'hydrohandbrake',
    group: 'Bromsar',
    name: 'Hydraulisk handbroms',
    price: 2500,
    effect: '+40 % handbroms: låser bakhjulen direkt',
    apply: (p) => {
      p.brake = { ...p.brake, handbrake: p.brake.handbrake * 1.4 };
    },
  },
  {
    tier: 2,
    id: 'coilovers',
    group: 'Fjädring',
    name: 'Justerbara coilovers',
    price: 8000,
    effect: '+10 % fjäderkonstant och +20 % dämpning',
    apply: (p) => {
      p.susp = { ...p.susp, kFront: p.susp.kFront * 1.1, kRear: p.susp.kRear * 1.1, bump: p.susp.bump * 1.2, rebound: p.susp.rebound * 1.2 };
    },
  },
  {
    tier: 2,
    id: 'lightweight',
    group: 'Kaross',
    name: 'Lättviktskaross',
    price: 7000,
    effect: '−50 kg: tunnare plåt och plexiglasrutor',
    apply: (p) => {
      const k = (p.mass - 50) / p.mass;
      p.mass -= 50;
      p.inertia = p.inertia.map((i) => i * k) as CarParams['inertia'];
    },
  },
  {
    tier: 2,
    id: 'gravelslicks',
    group: 'Däck',
    name: 'Tävlingsdäck',
    price: 6000,
    effect: '+6 % grepp',
    apply: (p) => {
      p.gripScale *= 1.06;
    },
  },
];

/** De gamla uppgraderingarna i nivåer, och vad varje nivå kostade. Köpta nivåer återbetalas. */
const OLD_UPGRADES: Record<string, number[]> = {
  engine: [2000, 4500, 8000],
  brakes: [1000, 2500, 4000],
  suspension: [1500, 3000, 5000],
  tyres: [1500, 3500, 6000],
};

/** Byter gamla nivåuppgraderingar mot pengarna tillbaka. Samma resultat varje gång, så den kan köras vid varje laddning. */
export function migrateCareer(career: CareerState): CareerState {
  let refund = 0;
  const garage: CareerState['garage'] = {};
  for (const [car, { upgrades }] of Object.entries(career.garage)) {
    const kept: Record<string, number> = {};
    for (const [id, level] of Object.entries(upgrades)) {
      const old = OLD_UPGRADES[id];
      if (old) refund += old.slice(0, level).reduce((a, b) => a + b, 0);
      else kept[id] = level;
    }
    garage[car] = { upgrades: kept };
  }
  return refund ? { ...career, money: career.money + refund, garage } : career;
}

export function newCareer(): CareerState {
  return { money: START_MONEY, garage: {} };
}

export const levelOf = (career: CareerState, car: string, upgrade: string) => career.garage[car]?.upgrades[upgrade] ?? 0;

/** Delarna som passar bilen. */
export const upgradesFor = (car: string) => UPGRADES.filter((u) => u.tier === tierOf(car));

/** Bilens parametrar med karriärens uppgraderingar. */
export function applyUpgrades(params: CarParams, upgrades: Record<string, number>): CarParams {
  const p = { ...params };
  for (const u of UPGRADES) if (upgrades[u.id]) u.apply(p);
  return p;
}

/** Lägger till en rad i historiken; de äldsta faller bort när den är full. */
export function logged(career: CareerState, entry: Omit<HistoryEntry, 'at'>, at = Date.now()): CareerState {
  return { ...career, history: [...(career.history ?? []), { ...entry, at }].slice(-MAX_HISTORY) };
}

export type BuyResult = CareerState | 'poor' | 'maxed' | 'unknown';

export function buyUpgrade(career: CareerState, car: string, upgradeId: string): BuyResult {
  const u = upgradesFor(car).find((x) => x.id === upgradeId);
  const owned = career.garage[car];
  if (!u || !owned) return 'unknown';
  if (levelOf(career, car, upgradeId)) return 'maxed';
  if (career.money < u.price) return 'poor';
  return logged(
    { ...career, money: career.money - u.price, garage: { ...career.garage, [car]: { upgrades: { ...owned.upgrades, [upgradeId]: 1 } } } },
    { kind: 'upgrade', name: u.name, car, amount: -u.price },
  );
}

export function buyCar(career: CareerState, car: string): BuyResult {
  const price = CAR_PRICES[car];
  if (price === undefined || career.garage[car]) return 'unknown';
  if (career.money < price) return 'poor';
  return logged({ ...career, money: career.money - price, garage: { ...career.garage, [car]: { upgrades: {} } } }, { kind: 'car', name: car, amount: -price });
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
  // Testföraren i tests/physics.test.ts tar cirka 89–92 s på Skogsberg och 127 s på Myrkulla
  // åt båda hållen, utan att pressa bilen.
  Skogsberg: [90, 100, 115],
  'Skogsberg baklänges': [93, 103, 118],
  Myrkulla: [128, 142, 163],
  'Myrkulla baklänges': [128, 142, 163],
  // Med vinterdäck tar testföraren cirka 122 s åt båda hållen.
  Frostberga: [123, 136, 156],
  'Frostberga baklänges': [123, 136, 156],
  // Testföraren: Tallmon 94 s, Ljungheden 87 s och Isvallen 108 s. Gränserna är lite
  // generösare i dåligt ljus, mest i mörker.
  Tallmon: [96, 107, 122],
  Ljungheden: [88, 98, 112],
  Isvallen: [112, 124, 142],
  // Testföraren: Forsbäcken 80 s, Hamnudden 87 s (asfaltsdäck) och Vadmyra 97 s.
  Forsbäcken: [81, 90, 104],
  Hamnudden: [88, 98, 112],
  Vadmyra: [98, 109, 125],
  // Andersvattnet i fyra delar på drygt 5 km. Testföraren med vinterdäck: Storberget 289 s,
  // Hösjöälven 300 s (hårnålen i krypfart), Röjmyrberget 323 s och Flarkån 314 s i skymning.
  Storberget: [290, 321, 368],
  Hösjöälven: [302, 334, 383],
  Röjmyrberget: [324, 358, 411],
  Flarkån: [318, 352, 403],
};

/** Medaljgränserna för en etapp i bilens klass, eller undefined för en okänd etapp. */
export const stageTargets = (stageName: string, tier: Tier = 1) =>
  STAGE_TARGETS[stageName]?.map((t) => Math.round(t * TIER_PACE[tier])) as [number, number, number] | undefined;

/** Prispengarna för ett enstaka åk; klass 2 har snävare gränser och större priser. */
export function prizeFor(stageName: string, time: number, tier: Tier = 1): { medal: string | null; prize: number } {
  const targets = stageTargets(stageName, tier);
  const i = targets ? targets.findIndex((t) => time <= t) : -1;
  const prize = i >= 0 ? MEDALS[i]!.prize : FINISH_PRIZE;
  return { medal: i >= 0 ? MEDALS[i]!.name : null, prize: prize * TIER_PRIZE[tier] };
}

export const formatMoney = (kr: number) => `${kr.toLocaleString('sv-SE')} kr`;
