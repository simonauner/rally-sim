/**
 * The career's rules: economy, upgrades and car prices. Pure logic without DOM; saved by
 * store.ts and synced with the account. All functions return a new state.
 */

import { MAX_HISTORY, type CareerState, type HistoryEntry } from '../account/protocol';
import { CARS, type CarParams, type Livery, type Sponsor } from '../physics/params';

/**
 * Starting money, without a car. Enough for one of the cheap cars at the dealer:
 * the 240 GL with money left for parts, or the Ljung and almost nothing more.
 */
export const START_MONEY = 10000;
export const DAILY_BONUS = 500;
/** What the cars cost at the dealer. Class 2 is priced so that a player who also upgraded in class 1 has to save up after unlocking it. */
export const CAR_PRICES: Record<string, number> = {
  'Kvarn 240 GL': 6000,
  'Kvarn 240 Turbo': 15000,
  'Ljung 1600 S': 9000,
  'Ljung 2000 16V': 50000,
  'Strand 1800': 58000,
  'Strand 2.0 Turbo 4x4': 70000,
  'Brenner 5T Coupé': 65000,
  'Sora 2.0 Turbo': 72000,
  'Hoshi 2.0 4WD': 75000,
  'Volpe 2.0 Turbo 16V': 80000,
};

/**
 * The cars' class: 1 is 80s amateur cars, 2 is kit cars and Group A cars that unlock
 * when all class 1 championships are won. Cars missing here count as class 1.
 */
export type Tier = 1 | 2;
const CAR_TIERS: Record<string, Tier> = {
  'Ljung 2000 16V': 2,
  'Strand 1800': 2,
  'Strand 2.0 Turbo 4x4': 2,
  'Hoshi 2.0 4WD': 2,
  'Volpe 2.0 Turbo 16V': 2,
  'Brenner 5T Coupé': 2,
  'Sora 2.0 Turbo': 2,
};
export const tierOf = (car: string): Tier => CAR_TIERS[car] ?? 1;

/**
 * The class's pace relative to class 1 (gold times and rivals) and how much more the prize money is worth.
 * shortcut: 0.92 is estimated from the real world (Rally4/Rally2 vs Rally5), not measured;
 * the test driver is not fast enough to measure the difference. Adjust after test drives.
 */
export const TIER_PACE: Record<Tier, number> = { 1: 1, 2: 0.92 };
export const TIER_PRIZE: Record<Tier, number> = { 1: 1, 2: 2 };

export type UpgradeGroup = 'Motor' | 'Drivlina' | 'Bromsar' | 'Fjädring' | 'Kaross' | 'Däck';

/** A part you can buy and fit, once per car. Saved as level 1 in the garage. */
export interface Upgrade {
  id: string;
  /** The car class the part fits; class 2 has its own, more expensive parts. */
  tier: Tier;
  group: UpgradeGroup;
  name: string;
  /** Fictional sponsor whose decal goes on the car when the part is fitted. */
  sponsor: Sponsor;
  price: number;
  /** What the part does, for the menu. */
  effect: string;
  /** Which cars in the class the part fits; if missing, it fits all. */
  fits?: (p: CarParams) => boolean;
  apply: (p: CarParams) => void;
}

/** The cars' factory parameters by name. */
const PARAMS = new Map(CARS.map((m) => [m.make().name, m.make()]));
const awd = (p: CarParams) => !!p.centerDiff;
const turbo = (p: CarParams) => !!p.engine.turbo;
const only = (name: string) => (p: CarParams) => p.name === name;
const brenner = only('Brenner 5T Coupé');
/** Changes the turbo's properties; only for parts with `fits: turbo`. */
const tuneTurbo = (p: CarParams, t: Partial<NonNullable<CarParams['engine']['turbo']>>) => {
  p.engine = { ...p.engine, turbo: { ...p.engine.turbo!, ...t } };
};
const fits = (u: Upgrade, p: CarParams) => u.fits?.(p) ?? true;

/** Removes mass and inertia in the same proportion. */
const lighten = (p: CarParams, kg: number) => {
  const k = (p.mass - kg) / p.mass;
  p.mass -= kg;
  p.inertia = p.inertia.map((i) => i * k) as CarParams['inertia'];
};

/** Scales the torque curve by a factor that depends on rpm. */
const torque = (p: CarParams, factor: (rpm: number) => number) => {
  p.engine = { ...p.engine, curveNm: p.engine.curveNm.map((nm, i) => nm * factor(p.engine.curveRpm[i]!)) };
};

/**
 * The parts. The effects are moderate and stack, so a fully built 240 GL is still a 240 GL.
 * shortcut: the physics has no brake fade or engine heat, so drilled discs and air filters only give
 * more torque; give them their own effects if that gets modelled.
 */
export const UPGRADES: Upgrade[] = [
  {
    tier: 1,
    id: 'airfilter',
    sponsor: { name: 'Andas Filter', fg: '#ffffff', bg: '#1d5fa8' },
    group: 'Motor',
    name: 'Sportluftfilter',
    price: 800,
    effect: '+2 % vridmoment',
    apply: (p) => torque(p, () => 1.02),
  },
  {
    tier: 1,
    id: 'exhaust',
    sponsor: { name: 'BRUMM', fg: '#e8202a' },
    group: 'Motor',
    name: 'Sportavgassystem',
    price: 2000,
    effect: '+4 % vridmoment över 3 500 rpm',
    apply: (p) => torque(p, (rpm) => (rpm >= 3500 ? 1.04 : 1.01)),
  },
  {
    tier: 1,
    id: 'racecat',
    sponsor: { name: 'Kattvik', fg: '#1b1b1b', bg: '#f2d22e' },
    group: 'Motor',
    name: 'Racekatalysator',
    price: 1500,
    effect: '+3 % vridmoment över 3 500 rpm',
    apply: (p) => torque(p, (rpm) => (rpm >= 3500 ? 1.03 : 1)),
  },
  {
    tier: 1,
    id: 'cams',
    sponsor: { name: 'KAMKUNGEN', fg: '#ffffff', bg: '#1b1b1b' },
    group: 'Motor',
    name: 'Vassare kamaxlar',
    price: 3500,
    effect: '+8 % vridmoment över 4 500 rpm, −4 % under 2 500',
    apply: (p) => torque(p, (rpm) => (rpm >= 4500 ? 1.08 : rpm < 2500 ? 0.96 : 1.02)),
  },
  {
    tier: 1,
    id: 'pistons',
    sponsor: { name: 'Kolvex', fg: '#1d5fa8' },
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
    sponsor: { name: 'VäxelVerket', fg: '#ffffff', bg: '#2f7d4f' },
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
    sponsor: { name: 'Spärrbolaget', fg: '#1b1b1b' },
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
    sponsor: { name: 'STOPPA', fg: '#ffffff', bg: '#e8202a' },
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
    sponsor: { name: 'Hålsta Broms', fg: '#1b1b1b', bg: '#ffffff' },
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
    sponsor: { name: 'Skivgården', fg: '#f2d22e', bg: '#1b1b1b' },
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
    sponsor: { name: 'DÄMPA', fg: '#1d5fa8', bg: '#ffffff' },
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
    sponsor: { name: 'Fjädra', fg: '#ffffff', bg: '#e8902a' },
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
    sponsor: { name: 'Stagab', fg: '#1b1b1b' },
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
    sponsor: { name: 'NORDGREPP', fg: '#f2d22e', bg: '#1b1b1b' },
    group: 'Däck',
    name: 'Rallydäck',
    price: 3500,
    effect: '+6 % grepp',
    apply: (p) => {
      p.gripScale *= 1.06;
    },
  },
  {
    tier: 1,
    id: 'wastegate',
    sponsor: { name: 'Ventilen', fg: '#ffffff', bg: '#6a2fa0' },
    group: 'Motor',
    name: 'Justerbar wastegate',
    price: 3000,
    effect: '+8 % vridmoment över 3 500 rpm',
    fits: turbo,
    apply: (p) => {
      torque(p, (rpm) => (rpm >= 3500 ? 1.08 : 1));
      tuneTurbo(p, { bar: p.engine.turbo!.bar * 1.15 });
    },
  },
  {
    tier: 1,
    id: 'turbohose',
    sponsor: { name: 'Slangbolaget', fg: '#1b1b1b', bg: '#ffffff' },
    group: 'Motor',
    name: 'Kortare turboslangar',
    price: 2000,
    effect: 'Laddtrycket byggs upp 20 % snabbare',
    fits: turbo,
    apply: (p) => tuneTurbo(p, { spool: p.engine.turbo!.spool * 0.8 }),
  },
  // Class 2: competition parts for kit cars and Group A cars.
  {
    tier: 2,
    id: 'ecu',
    sponsor: { name: 'Chipkungen', fg: '#ffffff', bg: '#6a2fa0' },
    group: 'Motor',
    name: 'Programmerbar motorstyrning',
    price: 6000,
    effect: '+5 % vridmoment över 3 000 rpm',
    apply: (p) => torque(p, (rpm) => (rpm >= 3000 ? 1.05 : 1)),
  },
  {
    tier: 2,
    id: 'intake',
    sponsor: { name: 'INSUGEN', fg: '#e8202a', bg: '#ffffff' },
    group: 'Motor',
    name: 'Tävlingsinsug',
    price: 4000,
    effect: '+3 % vridmoment',
    apply: (p) => torque(p, () => 1.03),
  },
  {
    tier: 2,
    id: 'flywheel',
    sponsor: { name: 'Svänga', fg: '#1b1b1b', bg: '#f2d22e' },
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
    sponsor: { name: 'KLOTEK', fg: '#ffffff', bg: '#1b1b1b' },
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
    sponsor: { name: 'Lamellab', fg: '#1d5fa8' },
    group: 'Drivlina',
    name: 'Lamellspärr',
    price: 7000,
    effect: 'Nästan låst diff: drar rakt ut ur kurvorna men vill gå rakt fram',
    // Locks both the front and rear axle on a 4WD car and only makes it understeer more.
    fits: (p) => !awd(p),
    apply: (p) => {
      p.diff = { lock: Math.max(p.diff.lock, 0.75), preload: Math.max(p.diff.preload, 120) };
    },
  },
  {
    tier: 2,
    id: 'calipers',
    sponsor: { name: 'FYROK', fg: '#ffffff', bg: '#e8202a' },
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
    sponsor: { name: 'Hydrex', fg: '#ffffff', bg: '#1d5fa8' },
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
    sponsor: { name: 'SPIRALEN', fg: '#1b1b1b', bg: '#ffffff' },
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
    sponsor: { name: 'Lättkaross', fg: '#e8202a' },
    group: 'Kaross',
    name: 'Lättviktskaross',
    price: 7000,
    effect: '−50 kg: tunnare plåt och plexiglasrutor',
    apply: (p) => lighten(p, 50),
  },
  {
    tier: 2,
    id: 'gravelslicks',
    sponsor: { name: 'STENGREPP', fg: '#ffffff', bg: '#2f7d4f' },
    group: 'Däck',
    name: 'Tävlingsdäck',
    price: 6000,
    effect: '+6 % grepp',
    apply: (p) => {
      p.gripScale *= 1.06;
    },
  },
  // Class 2 by engine and drivetrain.
  {
    tier: 2,
    id: 'throttles',
    sponsor: { name: 'Spjällgruppen', fg: '#ffffff', bg: '#2f7d4f' },
    group: 'Motor',
    name: 'Separata gasspjäll',
    price: 6500,
    effect: '+7 % vridmoment över 5 000 rpm',
    fits: (p) => !turbo(p),
    apply: (p) => torque(p, (rpm) => (rpm >= 5000 ? 1.07 : 1.01)),
  },
  {
    tier: 2,
    id: 'intercooler',
    sponsor: { name: 'Kylarn', fg: '#1d5fa8', bg: '#ffffff' },
    group: 'Motor',
    name: 'Större laddluftkylare',
    price: 5000,
    effect: '+6 % vridmoment mellan 3 000 och 6 000 rpm',
    fits: turbo,
    apply: (p) => torque(p, (rpm) => (rpm >= 3000 && rpm <= 6000 ? 1.06 : 1.02)),
  },
  {
    tier: 2,
    id: 'boost',
    sponsor: { name: 'TRYCKET', fg: '#f2d22e', bg: '#1b1b1b' },
    group: 'Motor',
    name: 'Högre laddtryck',
    price: 8000,
    effect: '+10 % vridmoment över 3 500 rpm',
    fits: turbo,
    apply: (p) => {
      torque(p, (rpm) => (rpm >= 3500 ? 1.1 : 1));
      tuneTurbo(p, { bar: p.engine.turbo!.bar * 1.2 });
    },
  },
  {
    tier: 2,
    id: 'antilag',
    sponsor: { name: 'Smällen', fg: '#ffffff', bg: '#e8202a' },
    group: 'Motor',
    name: 'Antilag',
    price: 12000,
    effect: 'Håller laddtrycket när du lyfter av gasen, och +15 % vridmoment under 3 500 rpm',
    fits: turbo,
    apply: (p) => {
      tuneTurbo(p, { antilag: 0.8 });
      torque(p, (rpm) => (rpm < 3500 ? 1.15 : 1));
    },
  },
  {
    tier: 2,
    id: 'centerdiff',
    sponsor: { name: 'Mittpunkt', fg: '#1b1b1b', bg: '#e8902a' },
    group: 'Drivlina',
    name: 'Justerbar mittdiff',
    price: 8000,
    effect: 'Mer moment bak och hårdare låsning: vrider in på gas',
    fits: awd,
    apply: (p) => {
      const c = p.centerDiff!;
      p.frontShare = Math.max(0.3, p.frontShare - 0.08);
      p.centerDiff = { lock: Math.min(0.9, c.lock + 0.15), preload: c.preload + 30 };
    },
  },
  // Parts for a single car.
  {
    tier: 2,
    id: 'headers',
    sponsor: { name: 'Boxerverket', fg: '#ffffff', bg: '#1d5fa8' },
    group: 'Motor',
    name: 'Lika långa grenrör',
    price: 7000,
    effect: '+6 % vridmoment mellan 3 000 och 5 000 rpm, och laddtrycket byggs upp 20 % snabbare',
    fits: only('Sora 2.0 Turbo'),
    apply: (p) => {
      torque(p, (rpm) => (rpm >= 3000 && rpm <= 5000 ? 1.06 : 1));
      tuneTurbo(p, { spool: p.engine.turbo!.spool * 0.8 });
    },
  },
  {
    tier: 2,
    id: 'shortfinal',
    sponsor: { name: 'Kuggen', fg: '#1b1b1b', bg: '#f2d22e' },
    group: 'Drivlina',
    name: 'Kort slutväxelpaket',
    price: 4500,
    effect: '8 % kortare slutväxel: drar starkare men når toppfarten tidigare',
    fits: only('Hoshi 2.0 4WD'),
    apply: (p) => {
      p.gearbox = { ...p.gearbox, final: p.gearbox.final * 1.08 };
    },
  },
  {
    tier: 2,
    id: 'lightrear',
    sponsor: { name: 'Bakvikt', fg: '#e8202a', bg: '#ffffff' },
    group: 'Kaross',
    name: 'Lätt bakparti',
    price: 6000,
    effect: '−35 kg i baklucka och bakre skärmar: vrider sig ännu villigare',
    fits: only('Volpe 2.0 Turbo 16V'),
    apply: (p) => {
      lighten(p, 35);
      p.inertia = [p.inertia[0], p.inertia[1] * 0.94, p.inertia[2]];
    },
  },
  {
    tier: 2,
    id: 'sequential',
    sponsor: { name: 'SEKVENS', fg: '#ffffff', bg: '#1b1b1b' },
    group: 'Drivlina',
    name: 'Sekventiell låda',
    price: 10000,
    effect: 'Växlar på 40 % av tiden',
    fits: only('Ljung 2000 16V'),
    apply: (p) => {
      p.gearbox = { ...p.gearbox, shiftTime: p.gearbox.shiftTime * 0.4 };
    },
  },
  // Brenner: the five-cylinder and the coupé body from the Group B era.
  {
    tier: 2,
    id: 'head20v',
    sponsor: { name: 'Fünfzylinder', fg: '#ffffff', bg: '#1b1b1b' },
    group: 'Motor',
    name: '20-ventilstopp',
    price: 14000,
    effect: '+10 % vridmoment över 4 500 rpm och 500 rpm högre varvtak',
    fits: brenner,
    apply: (p) => {
      torque(p, (rpm) => (rpm >= 4500 ? 1.1 : 1));
      p.engine = { ...p.engine, limiterRpm: p.engine.limiterRpm + 500 };
      p.gearbox = { ...p.gearbox, upshiftRpm: p.gearbox.upshiftRpm + 400 };
    },
  },
  {
    tier: 2,
    id: 'bigturbo',
    sponsor: { name: 'GROSSLADER', fg: '#f2d22e', bg: '#e8202a' },
    group: 'Motor',
    name: 'Stor tävlingsturbo',
    price: 18000,
    effect: '+20 % vridmoment över 4 500 rpm, men −10 % under 3 500 och 40 % längre turbohål',
    fits: brenner,
    apply: (p) => {
      torque(p, (rpm) => (rpm >= 4500 ? 1.2 : rpm < 3500 ? 0.9 : 1.05));
      tuneTurbo(p, { spool: p.engine.turbo!.spool * 1.4, bar: p.engine.turbo!.bar + 0.3 });
    },
  },
  {
    tier: 2,
    id: 'kevlar',
    sponsor: { name: 'Faserwerk', fg: '#1b1b1b', bg: '#f2d22e' },
    group: 'Kaross',
    name: 'Kevlarkaross',
    price: 16000,
    effect: '−90 kg: skärmar, huv och luckor i kevlar',
    fits: brenner,
    apply: (p) => lighten(p, 90),
  },
];

/** The old levelled upgrades, and what each level cost. Bought levels are refunded. */
const OLD_UPGRADES: Record<string, number[]> = {
  engine: [2000, 4500, 8000],
  brakes: [1000, 2500, 4000],
  suspension: [1500, 3000, 5000],
  tyres: [1500, 3500, 6000],
};

/** Cars that changed name: old name → new. Careers and championships saved before are moved over on load. */
export const RENAMED_CARS: Record<string, string> = { 'Strand 2.0 GT': 'Strand 1800', 'Kvarn Turbo 4x4': 'Strand 2.0 Turbo 4x4' };
export const currentCarName = (car: string) => RENAMED_CARS[car] ?? car;

/**
 * Moves renamed cars to their new names, and swaps old levelled upgrades, and parts that no longer fit the
 * car, for a refund. Same result every time, so it can run on every load.
 */
export function migrateCareer(career: CareerState): CareerState {
  let refund = 0;
  const renamed = Object.keys(career.garage).some((car) => car in RENAMED_CARS) || !!career.history?.some((e) => (e.car ?? '') in RENAMED_CARS || (e.kind === 'car' && e.name in RENAMED_CARS));
  const garage: CareerState['garage'] = {};
  for (const [old, owned] of Object.entries(career.garage)) {
    const { upgrades } = owned;
    const car = currentCarName(old);
    const kept: Record<string, number> = {};
    for (const [id, level] of Object.entries(upgrades)) {
      const old = OLD_UPGRADES[id];
      const part = UPGRADES.find((u) => u.id === id);
      const p = PARAMS.get(car);
      if (old) refund += old.slice(0, level).reduce((a, b) => a + b, 0);
      else if (part && p && !fits(part, p)) refund += part.price;
      else kept[id] = level;
    }
    garage[car] = { ...owned, upgrades: { ...garage[car]?.upgrades, ...kept } };
  }
  if (!refund && !renamed) return career;
  const history = career.history?.map((e) => ({
    ...e,
    ...(e.car && { car: currentCarName(e.car) }),
    ...(e.kind === 'car' && { name: currentCarName(e.name) }),
  }));
  return { ...career, money: career.money + refund, garage, ...(history && { history }) };
}

export function newCareer(): CareerState {
  return { money: START_MONEY, garage: {} };
}

export const levelOf = (career: CareerState, car: string, upgrade: string) => career.garage[car]?.upgrades[upgrade] ?? 0;

/** The parts that fit the car. */
export const upgradesFor = (car: string) => {
  const p = PARAMS.get(car);
  return UPGRADES.filter((u) => u.tier === tierOf(car) && (!p || fits(u, p)));
};

/** The decals for the car's fitted parts, in part order. */
export const sponsorsOf = (upgrades: Record<string, number>) => UPGRADES.filter((u) => upgrades[u.id]).map((u) => u.sponsor);

/** The car's parameters with the career's upgrades. */
export function applyUpgrades(params: CarParams, upgrades: Record<string, number>): CarParams {
  const p = { ...params };
  for (const u of UPGRADES) if (upgrades[u.id] && fits(u, params)) u.apply(p);
  return p;
}

/** Adds a row to the history; the oldest drop off when it is full. */
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
    { ...career, money: career.money - u.price, garage: { ...career.garage, [car]: { ...owned, upgrades: { ...owned.upgrades, [upgradeId]: 1 } } } },
    { kind: 'upgrade', name: u.name, car, amount: -u.price },
  );
}

export function buyCar(career: CareerState, car: string): BuyResult {
  const price = CAR_PRICES[car];
  if (price === undefined || career.garage[car]) return 'unknown';
  if (career.money < price) return 'poor';
  return logged({ ...career, money: career.money - price, garage: { ...career.garage, [car]: { upgrades: {} } } }, { kind: 'car', name: car, amount: -price });
}

/** Paint colours in the garage: cosmetic only. Class 2 pays double (TIER_PRIZE). */
export const PAINTS: { name: string; color: number; price: number }[] = [
  { name: 'Polarvit', color: 0xf2f2ee, price: 2000 },
  { name: 'Midnattsblå', color: 0x1c2a4a, price: 2500 },
  { name: 'Racinggrön', color: 0x1f5a3a, price: 3000 },
  { name: 'Signalgul', color: 0xf0c419, price: 3500 },
  { name: 'Tävlingsröd', color: 0xc8141c, price: 3500 },
  { name: 'Lavaorange', color: 0xe8661c, price: 4000 },
  { name: 'Mattsvart', color: 0x18181a, price: 5000 },
  { name: 'Guld', color: 0xc9a227, price: 6000 },
];

export const paintPrice = (car: string, paint: (typeof PAINTS)[number]) => paint.price * TIER_PRIZE[tierOf(car)];

/** Each car's works livery, in the spirit of its era's rally colours but with fictional sponsors. The money sink late in the career. */
export const LIVERIES: Record<string, Livery> = {
  'Kvarn 240 GL': {
    name: 'Fabriksteamet',
    paint: 0xf2f2ee,
    bands: [{ color: '#1d3f7a', top: 0.42, bottom: 0.74 }, { color: '#f0c419', top: 0.78, bottom: 0.85 }],
    sponsor: { name: 'Kvarn Motorsport', fg: '#ffffff', bg: '#1d3f7a' },
  },
  'Kvarn 240 Turbo': {
    name: 'Svarta turbon',
    paint: 0x161618,
    bands: [{ color: '#d0141c', top: 0.5, bottom: 0.6 }, { color: '#f2f2ee', top: 0.63, bottom: 0.67 }],
    stripes: [{ color: '#d0141c', x: 0.18, w: 0.12 }, { color: '#d0141c', x: -0.18, w: 0.12 }],
    sponsor: { name: 'TURBOLAGET', fg: '#ffffff', bg: '#d0141c' },
  },
  'Ljung 1600 S': {
    name: 'Bruksteamet',
    paint: 0xb8141a,
    bands: [{ color: '#f2f2ee', top: 0.12, bottom: 0.3 }],
    stripes: [{ color: '#f2f2ee', x: 0, w: 0.3 }],
    sponsor: { name: 'Ljungby Bil', fg: '#b8141a', bg: '#f2f2ee' },
  },
  'Ljung 2000 16V': {
    name: 'Kitcar',
    paint: 0xf2f2ee,
    bands: [{ color: '#1d3f7a', top: 0.6, bottom: 1.1, rise: 0.2 }, { color: '#d0141c', top: 0.5, bottom: 0.56, rise: 0.2 }],
    stripes: [{ color: '#1d3f7a', x: 0, w: 0.24 }],
    sponsor: { name: 'NORDVOLT', fg: '#ffffff', bg: '#1d3f7a' },
  },
  'Strand 1800': {
    name: 'Klassiker',
    paint: 0xf2f2ee,
    bands: [{ color: '#1b2f6e', top: 0.3, bottom: 0.56 }, { color: '#d0141c', top: 0.6, bottom: 0.65 }],
    stripes: [{ color: '#1b2f6e', x: 0.2, w: 0.14 }, { color: '#1b2f6e', x: -0.2, w: 0.14 }],
    sponsor: { name: 'Nordolja', fg: '#ffffff', bg: '#1b2f6e' },
  },
  'Strand 2.0 Turbo 4x4': {
    name: 'Grupp A',
    paint: 0xf2f2ee,
    bands: [{ color: '#1d5fa8', top: 0.35, bottom: 0.65, rise: 0.35 }, { color: '#d0141c', top: 0.69, bottom: 0.77, rise: 0.35 }],
    sponsor: { name: 'SKOGSGAS', fg: '#ffffff', bg: '#1d5fa8' },
  },
  'Hoshi 2.0 4WD': {
    name: 'Fabriksteamet',
    paint: 0xf2f2ee,
    // Green over red crescents around each wheel arch, pointed towards the doors.
    bands: [
      { color: '#1f9a48', top: 0.05, bottom: 0.45, to: 0.4, rise: -0.17, flare: -0.33, bend: 0.1 },
      { color: '#e0202a', top: 0.45, bottom: 0.85, to: 0.48, rise: -0.05, flare: -0.3, bend: 0.08 },
      { color: '#1f9a48', top: 0.35, bottom: 0.45, from: 0.45, rise: 0.05, flare: 0.3, bend: -0.12 },
      { color: '#e0202a', top: 0.5, bottom: 0.62, from: 0.42, rise: -0.28, flare: 0.38, bend: 0.1 },
    ],
    sponsor: { name: 'HOSHI OIL', fg: '#1f7a3a', bg: '#ffffff' },
  },
  'Volpe 2.0 Turbo 16V': {
    name: 'Tre ränder',
    paint: 0xf2f2ee,
    // Red along the top of the sides and over the rear corner; navy and sky blue stripes under it that bend down to the rear wheel arch.
    bands: [
      { color: '#d8262f', top: 0, bottom: 0.28 },
      { color: '#d8262f', top: 0, bottom: 0.6, from: 0.8 },
      { color: '#14234f', top: 0.32, bottom: 0.37, to: 0.5 },
      { color: '#14234f', top: 0.32, bottom: 0.37, from: 0.5, to: 0.8, rise: -0.4, bend: -0.1 },
      { color: '#3fa6dc', top: 0.39, bottom: 0.44, to: 0.5 },
      { color: '#3fa6dc', top: 0.39, bottom: 0.44, from: 0.5, to: 0.8, rise: -0.4, bend: -0.1 },
      { color: '#14234f', top: 0.46, bottom: 0.51, to: 0.5 },
      { color: '#14234f', top: 0.46, bottom: 0.51, from: 0.5, to: 0.8, rise: -0.4, bend: -0.1 },
      { color: '#3fa6dc', top: 0.53, bottom: 0.58, to: 0.5 },
      { color: '#3fa6dc', top: 0.53, bottom: 0.58, from: 0.5, to: 0.8, rise: -0.4, bend: -0.1 },
    ],
    // Only the hood: the roof stays white.
    stripes: [
      { color: '#d8262f', x: 0, w: 0.5, hoodOnly: true },
      { color: '#14234f', x: 0.3, w: 0.05, hoodOnly: true },
      { color: '#3fa6dc', x: 0.37, w: 0.05, hoodOnly: true },
      { color: '#14234f', x: -0.3, w: 0.05, hoodOnly: true },
      { color: '#3fa6dc', x: -0.37, w: 0.05, hoodOnly: true },
    ],
    sponsor: { name: 'ROSSETTO', fg: '#14234f', bg: '#ffffff' },
  },
  'Brenner 5T Coupé': {
    name: 'Grupp B',
    paint: 0xf2f2ee,
    bands: [{ color: '#d0141c', top: 0.52, bottom: 0.85, rise: 0.25 }, { color: '#d9a520', top: 0.44, bottom: 0.49, rise: 0.25 }],
    stripes: [{ color: '#d0141c', x: 0.22, w: 0.1 }, { color: '#d0141c', x: -0.22, w: 0.1 }],
    sponsor: { name: 'Bergwerk', fg: '#ffffff', bg: '#d0141c' },
  },
  'Sora 2.0 Turbo': {
    name: 'Stjärnblå',
    paint: 0x1a3e9a,
    // A swoosh that starts in a point on the front door and sweeps up wide over the rear wheel arch.
    bands: [{ color: '#f0c419', top: 0.78, bottom: 0.86, from: 0.22, rise: 0.3, flare: 0.5, bend: 0.2 }],
    sponsor: { name: 'STJÄRNAN', fg: '#1a3e9a', bg: '#f0c419' },
  },
};

export const LIVERY_PRICE = 40000;
export const liveryPrice = (car: string) => LIVERY_PRICE * TIER_PRIZE[tierOf(car)];

/** Paints the car and hides its livery; `color` null goes back to the factory paint for free. Earlier colours are not kept. */
export function buyPaint(career: CareerState, car: string, color: number | null): BuyResult {
  const owned = career.garage[car];
  const paint = PAINTS.find((p) => p.color === color);
  if (!owned || (color !== null && !paint)) return 'unknown';
  if ((owned.paint ?? null) === color && !owned.livery) return 'maxed';
  const { paint: _, ...rest } = owned;
  if (owned.livery) rest.livery = false;
  if (!paint) return { ...career, garage: { ...career.garage, [car]: rest } };
  const price = paintPrice(car, paint);
  if (career.money < price) return 'poor';
  // Logged as an upgrade so older clients, which only know the existing kinds, still accept the history.
  return logged({ ...career, money: career.money - price, garage: { ...career.garage, [car]: { ...rest, paint: color! } } }, { kind: 'upgrade', name: `Lack: ${paint.name}`, car, amount: -price });
}

/** Puts the car's livery on: paid once, free to put back after painting over it. */
export function buyLivery(career: CareerState, car: string): BuyResult {
  const owned = career.garage[car];
  const livery = LIVERIES[car];
  if (!owned || !livery) return 'unknown';
  if (owned.livery) return 'maxed';
  const garage = { ...career.garage, [car]: { ...owned, livery: true } };
  if (owned.livery === false) return { ...career, garage };
  const price = liveryPrice(car);
  if (career.money < price) return 'poor';
  return logged({ ...career, money: career.money - price, garage }, { kind: 'upgrade', name: `Tävlingsdekor: ${livery.name}`, car, amount: -price });
}

/** The livery the car shows, if any. */
export const liveryOf = (owned: CareerState['garage'][string] | undefined, car: string) => (owned?.livery ? LIVERIES[car] : undefined);

/** The daily bonus, once per day. `today` is YYYY-MM-DD in local time. */
export function claimDailyBonus(career: CareerState, today: string): { career: CareerState; bonus: number } {
  if (career.bonusDay === today) return { career, bonus: 0 };
  return { career: { ...career, money: career.money + DAILY_BONUS, bonusDay: today }, bonus: DAILY_BONUS };
}

export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Medal thresholds per stage (seconds) and prize money. Finishing always pays something. */
export const MEDALS = [
  { name: 'guld', prize: 1200 },
  { name: 'silver', prize: 800 },
  { name: 'brons', prize: 500 },
] as const;
export const FINISH_PRIZE = 250;
export const STAGE_TARGETS: Record<string, [gold: number, silver: number, bronze: number]> = {
  // Värmskog in three parts. The test driver on gravel tyres: Grinsbol 233 s, Tollesrud 218 s and
  // Åsterud 222 s at dusk.
  Grinsbol: [235, 260, 298],
  Tollesrud: [219, 242, 278],
  Åsterud: [226, 250, 287],
  // Gårdsjö and Colins. The test driver: Botten 280 s at dawn, Rannsjön 268 s, Larssäter 208 s and
  // Stor-Jangen 214 s.
  Botten: [286, 316, 363],
  Rannsjön: [270, 299, 342],
  Larssäter: [210, 232, 266],
  'Stor-Jangen': [216, 239, 274],
  // Royal Forest in four parts. The test driver: Södra Hulteby 236 s, Ämten 223 s, Lindås 226 s and
  // Lungsund 240 s.
  'Södra Hulteby': [238, 263, 302],
  Ämten: [225, 249, 285],
  Lindås: [228, 252, 289],
  Lungsund: [242, 268, 307],
  // Ängebäckstorp and Ölme. The test driver: Sundstorp 262 s, Bäckelid 270 s, Niklasdamm 217 s and
  // Broby 202 s at dusk.
  Sundstorp: [264, 292, 335],
  Bäckelid: [272, 301, 345],
  Niklasdamm: [219, 242, 278],
  Broby: [207, 229, 262],
  // Bygdsiljum in five parts of just over 5 km. The test driver on winter tyres: Åsjön 290 s, Altarliden
  // 292 s, Bergtjärnen 293 s, Torpet 303 s (the T-junction at crawling speed) and Trollberget 293 s at night.
  Åsjön: [292, 323, 370],
  Altarliden: [293, 324, 372],
  Bergtjärnen: [296, 327, 375],
  Torpet: [305, 337, 387],
  Trollberget: [304, 336, 385],
  // Bäck in three parts of about 3.4 km. The test driver on winter tyres: Näs 190 s, Rickleån 195 s and
  // Valsfäboda 195 s at dusk.
  Näs: [191, 211, 242],
  Rickleån: [196, 217, 249],
  Valsfäboda: [199, 220, 252],
  // Andersvattnet in four parts of just over 5 km. The test driver on winter tyres: Storberget 291 s,
  // Hösjöälven 303 s (the hairpin at crawling speed), Röjmyrberget 323 s and Flarkån 314 s at dusk.
  Storberget: [293, 324, 371],
  Hösjöälven: [306, 338, 388],
  Röjmyrberget: [324, 358, 411],
  Flarkån: [318, 352, 403],
};

/** The medal thresholds for a stage in the car's class, or undefined for an unknown stage. */
export const stageTargets = (stageName: string, tier: Tier = 1) =>
  STAGE_TARGETS[stageName]?.map((t) => Math.round(t * TIER_PACE[tier])) as [number, number, number] | undefined;

/** The prize money for a single run; class 2 has tighter thresholds and bigger prizes. */
export function prizeFor(stageName: string, time: number, tier: Tier = 1): { medal: string | null; prize: number } {
  const targets = stageTargets(stageName, tier);
  const i = targets ? targets.findIndex((t) => time <= t) : -1;
  const prize = i >= 0 ? MEDALS[i]!.prize : FINISH_PRIZE;
  return { medal: i >= 0 ? MEDALS[i]!.name : null, prize: prize * TIER_PRIZE[tier] };
}

export const formatMoney = (kr: number) => `${kr.toLocaleString('sv-SE')} kr`;
