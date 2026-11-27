/**
 * Karriärens regler: ekonomi, uppgraderingar och bilpriser. Ren logik utan DOM; sparas av
 * store.ts och synkas med kontot. Alla funktioner returnerar ett nytt tillstånd.
 */

import { MAX_HISTORY, type CareerState, type HistoryEntry } from '../account/protocol';
import { CARS, type CarParams, type Sponsor } from '../physics/params';

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
  'Brenner 5T Coupé': 45000,
  'Sora 2.0 Turbo': 52000,
  'Hoshi 2.0 4WD': 55000,
  'Volpe 2.0 Turbo 16V': 60000,
};

/**
 * Bilarnas klass: 1 är 80-talets amatörbilar, 2 är kitcars och Grupp A-bilar som låses upp
 * när alla mästerskap i klass 1 är vunna. Bilar som saknas här räknas som klass 1.
 */
export type Tier = 1 | 2;
const CAR_TIERS: Record<string, Tier> = {
  'Ljung 2000 16V': 2,
  'Strand 2.0 GT': 2,
  'Kvarn Turbo 4x4': 2,
  'Hoshi 2.0 4WD': 2,
  'Volpe 2.0 Turbo 16V': 2,
  'Brenner 5T Coupé': 2,
  'Sora 2.0 Turbo': 2,
};
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
  /** Fiktiv sponsor vars dekal klistras på bilen när delen är monterad. */
  sponsor: Sponsor;
  price: number;
  /** Vad delen gör, för menyn. */
  effect: string;
  /** Vilka bilar i klassen delen passar; saknas den passar alla. */
  fits?: (p: CarParams) => boolean;
  apply: (p: CarParams) => void;
}

/** Bilarnas fabriksparametrar efter namn. */
const PARAMS = new Map(CARS.map((m) => [m.make().name, m.make()]));
const awd = (p: CarParams) => !!p.centerDiff;
const turbo = (p: CarParams) => !!p.engine.turbo;
const only = (name: string) => (p: CarParams) => p.name === name;
const brenner = only('Brenner 5T Coupé');
/** Ändrar turbons egenskaper; bara för delar med `fits: turbo`. */
const tuneTurbo = (p: CarParams, t: Partial<NonNullable<CarParams['engine']['turbo']>>) => {
  p.engine = { ...p.engine, turbo: { ...p.engine.turbo!, ...t } };
};
const fits = (u: Upgrade, p: CarParams) => u.fits?.(p) ?? true;

/** Tar bort vikt och tröghet i samma andel. */
const lighten = (p: CarParams, kg: number) => {
  const k = (p.mass - kg) / p.mass;
  p.mass -= kg;
  p.inertia = p.inertia.map((i) => i * k) as CarParams['inertia'];
};

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
    apply: (p) => torque(p, (rpm) => (rpm >= 3500 ? 1.08 : 1)),
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
  // Klass 2: tävlingsdelar till kitcars och Grupp A-bilar.
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
    // Låser både fram- och bakaxeln på en fyrhjulsbil och gör den bara mer understyrd.
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
  // Klass 2 efter motor och drivlina.
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
    apply: (p) => torque(p, (rpm) => (rpm >= 3500 ? 1.1 : 1)),
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
  // Delar till en enda bil.
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
  // Brenner: femcylindern och coupékarossen från Grupp B-tiden.
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
      tuneTurbo(p, { spool: p.engine.turbo!.spool * 1.4 });
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

/** De gamla uppgraderingarna i nivåer, och vad varje nivå kostade. Köpta nivåer återbetalas. */
const OLD_UPGRADES: Record<string, number[]> = {
  engine: [2000, 4500, 8000],
  brakes: [1000, 2500, 4000],
  suspension: [1500, 3000, 5000],
  tyres: [1500, 3500, 6000],
};

/** Byter gamla nivåuppgraderingar, och delar som inte längre passar bilen, mot pengarna tillbaka. Samma resultat varje gång, så den kan köras vid varje laddning. */
export function migrateCareer(career: CareerState): CareerState {
  let refund = 0;
  const garage: CareerState['garage'] = {};
  for (const [car, { upgrades }] of Object.entries(career.garage)) {
    const kept: Record<string, number> = {};
    for (const [id, level] of Object.entries(upgrades)) {
      const old = OLD_UPGRADES[id];
      const part = UPGRADES.find((u) => u.id === id);
      const p = PARAMS.get(car);
      if (old) refund += old.slice(0, level).reduce((a, b) => a + b, 0);
      else if (part && p && !fits(part, p)) refund += part.price;
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
export const upgradesFor = (car: string) => {
  const p = PARAMS.get(car);
  return UPGRADES.filter((u) => u.tier === tierOf(car) && (!p || fits(u, p)));
};

/** Dekalerna för bilens monterade delar, i delarnas ordning. */
export const sponsorsOf = (upgrades: Record<string, number>) => UPGRADES.filter((u) => upgrades[u.id]).map((u) => u.sponsor);

/** Bilens parametrar med karriärens uppgraderingar. */
export function applyUpgrades(params: CarParams, upgrades: Record<string, number>): CarParams {
  const p = { ...params };
  for (const u of UPGRADES) if (upgrades[u.id] && fits(u, params)) u.apply(p);
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
  // Värmskog i tre delar. Testföraren med grusdäck: Grinsbol 233 s, Tollesrud 218 s och
  // Åsterud 222 s i skymning.
  Grinsbol: [235, 260, 298],
  Tollesrud: [219, 242, 278],
  Åsterud: [226, 250, 287],
  // Gårdsjö och Colins. Testföraren: Botten 280 s i gryning, Rannsjön 268 s, Larssäter 208 s och
  // Stor-Jangen 214 s.
  Botten: [286, 316, 363],
  Rannsjön: [270, 299, 342],
  Larssäter: [210, 232, 266],
  'Stor-Jangen': [216, 239, 274],
  // Royal Forest i fyra delar. Testföraren: Södra Hulteby 236 s, Ämten 223 s, Lindås 226 s och
  // Lungsund 240 s.
  'Södra Hulteby': [238, 263, 302],
  Ämten: [225, 249, 285],
  Lindås: [228, 252, 289],
  Lungsund: [242, 268, 307],
  // Ängebäckstorp och Ölme. Testföraren: Sundstorp 262 s, Bäckelid 270 s, Niklasdamm 217 s och
  // Broby 202 s i skymning.
  Sundstorp: [264, 292, 335],
  Bäckelid: [272, 301, 345],
  Niklasdamm: [219, 242, 278],
  Broby: [207, 229, 262],
  // Bygdsiljum i fem delar på drygt 5 km. Testföraren med vinterdäck: Åsjön 290 s, Altarliden
  // 292 s, Bergtjärnen 293 s, Torpet 303 s (T-korsningen i krypfart) och Trollberget 293 s på natten.
  Åsjön: [292, 323, 370],
  Altarliden: [293, 324, 372],
  Bergtjärnen: [296, 327, 375],
  Torpet: [305, 337, 387],
  Trollberget: [304, 336, 385],
  // Bäck i tre delar på cirka 3,4 km. Testföraren med vinterdäck: Näs 190 s, Rickleån 195 s och
  // Valsfäboda 195 s i skymning.
  Näs: [191, 211, 242],
  Rickleån: [196, 217, 249],
  Valsfäboda: [199, 220, 252],
  // Andersvattnet i fyra delar på drygt 5 km. Testföraren med vinterdäck: Storberget 291 s,
  // Hösjöälven 303 s (hårnålen i krypfart), Röjmyrberget 323 s och Flarkån 314 s i skymning.
  Storberget: [293, 324, 371],
  Hösjöälven: [306, 338, 388],
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
