/**
 * Mästerskap: flera etapper i följd med samma bil. Skador följer med mellan etapperna och lagas
 * för pengar på servicen; den som avbryter får bilen lagad gratis men inga prispengar. Ren logik
 * utan DOM; framsteget sparas i webbläsaren eftersom spelet laddar om sidan mellan etapperna.
 */

import type { CareerState } from '../account/protocol';
import type { DamageState } from '../physics/car';
import { STAGE_TARGETS, TIER_PACE, TIER_PRIZE, tierOf, type Tier } from './career';
import { isRival, newRivals, raceLeg, type Rival } from './rivals';
import { rng } from '../physics/rng';
import { STAGE_LENGTHS } from '../physics/real/lengths';
import { STAGES } from '../physics/stage';
import { rollWeather, WEATHER_SLOWDOWN, type Weather } from '../physics/weather';

export interface ChampionshipDef {
  id: string;
  name: string;
  /** Etappernas namn, i körordning (StageDef.name). */
  legs: string[];
  /** Fältets grundtakt som andel av guldtiden; ingen motståndare blir snabbare än strax under den. */
  pace: number;
  /** Bilklassen som får köra. */
  tier: Tier;
}

export const CHAMPIONSHIPS: ChampionshipDef[] = [
  { id: 'skogsrallyt', name: 'Skogsrallyt', legs: ['Grinsbol', 'Tollesrud', 'Åsterud'], pace: 0.985, tier: 1 },
  { id: 'myrkullarallyt', name: 'Myrkullarallyt', legs: ['Botten', 'Rannsjön', 'Larssäter', 'Stor-Jangen'], pace: 0.965, tier: 1 },
  // Fem etapper ger fältet fler chanser att hinna ikapp, så grundtakten är lite lägre än tre etappers.
  { id: 'vinterrallyt', name: 'Vinterrallyt', legs: ['Åsjön', 'Altarliden', 'Bergtjärnen', 'Torpet', 'Trollberget'], pace: 0.95, tier: 1 },
  // Klass 2 har egna verkliga sträckor och ett snabbare fält.
  { id: 'tallmoklassikern', name: 'Tallmoklassikern', legs: ['Södra Hulteby', 'Ämten', 'Lindås', 'Lungsund'], pace: 0.985, tier: 2 },
  { id: 'ljunghedsrallyt', name: 'Ljunghedsrallyt', legs: ['Sundstorp', 'Bäckelid', 'Niklasdamm', 'Broby'], pace: 0.965, tier: 2 },
  { id: 'israllyt', name: 'Israllyt', legs: ['Storberget', 'Hösjöälven', 'Röjmyrberget', 'Flarkån'], pace: 0.945, tier: 2 },
  // Ligger sist så att klass 2 fortfarande öppnas av de tre första klass 1-mästerskapen.
  { id: 'forsrallyt', name: 'Forsrallyt', legs: ['Näs', 'Rickleån', 'Valsfäboda'], pace: 0.945, tier: 1 },
];

/** Fältets takt i klass 1-guldtider: klass 2 kör fortare. */
const fieldPace = (def: ChampionshipDef) => def.pace * TIER_PACE[def.tier];

/** Vunnet; vinster från före `won` läses ur historiken. */
export const hasWon = (career: CareerState, def: ChampionshipDef) =>
  !!career.won?.includes(def.id) || !!career.history?.some((e) => e.kind === 'championship' && e.place === 1 && e.name === def.name);

/**
 * Bästa placeringen i mästerskapet, eller null om det aldrig körts.
 * shortcut: läses ur historiken, som bara sparar de senaste raderna; vinster finns kvar i `won`.
 */
export function bestPlace(career: CareerState, def: ChampionshipDef): number | null {
  const places = (career.history ?? []).filter((e) => e.kind === 'championship' && e.name === def.name && e.place).map((e) => e.place!);
  if (hasWon(career, def)) places.push(1);
  return places.length ? Math.min(...places) : null;
}

/** Mästerskapen i samma klass som står före det i listan. */
const earlierInTier = (def: ChampionshipDef) => CHAMPIONSHIPS.slice(0, CHAMPIONSHIPS.indexOf(def)).filter((c) => c.tier === def.tier);

/** Klassen är öppen när mästerskapen före klassens första i listan är vunna. */
export const tierUnlocked = (career: CareerState, tier: Tier) =>
  CHAMPIONSHIPS.slice(0, CHAMPIONSHIPS.findIndex((c) => c.tier === tier)).every((c) => hasWon(career, c));

/** Klass 2-bilar som säljs först när alla mästerskap i klass 2 är vunna. */
const LATE_CARS = ['Sora 2.0 Turbo', 'Hoshi 2.0 4WD', 'Volpe 2.0 Turbo 16V', 'Brenner 5T Coupé'];

/** Om bilhandlaren säljer bilen: klassen ska vara öppen, och de sena bilarna kräver hela klass 2 vunnen. */
export const carUnlocked = (career: CareerState, car: string) =>
  tierUnlocked(career, tierOf(car)) && (!LATE_CARS.includes(car) || CHAMPIONSHIPS.filter((c) => c.tier === 2).every((c) => hasWon(career, c)));

/** Vad som låser upp bilen, för bilhandlarens knapp. */
export const carUnlockHint = (car: string) => (LATE_CARS.includes(car) ? 'Vinn alla mästerskap i klass 2' : 'Vinn alla mästerskap i klass 1');

/** Skogsrallyt är alltid öppet; därefter krävs öppen klass och att klassens tidigare mästerskap är vunna. */
export const championshipUnlocked = (career: CareerState, def: ChampionshipDef) =>
  tierUnlocked(career, def.tier) && earlierInTier(def).every((c) => hasWon(career, c));

/**
 * Vad som låser upp mästerskapet, för menyn: bara det sista ovunna före det, de tidigare följer av det.
 * Klassens första mästerskap har inga före sig i klassen; där är det mästerskapen som öppnar klassen.
 */
export const unlockHint = (career: CareerState, def: ChampionshipDef) => {
  const opensTier = CHAMPIONSHIPS.slice(0, CHAMPIONSHIPS.findIndex((c) => c.tier === def.tier));
  return `vinn ${[...opensTier, ...earlierInTier(def)].filter((c) => !hasWon(career, c)).at(-1)?.name}`;
};

/** Karriären med mästerskapet vunnet. */
export const withWin = (career: CareerState, def: ChampionshipDef): CareerState =>
  career.won?.includes(def.id) ? career : { ...career, won: [...(career.won ?? []), def.id] };

/** Det som följer med bilen mellan etapperna. */
export interface CarDamage {
  body: DamageState;
  /** Skada per hjul, 0..1. */
  wheels: number[];
  /** Motorns kvarvarande effekt, 0..1. */
  powerFactor: number;
  /** Strålkastarnas skada [vänster, höger], 0..1. Saknas i framsteg sparade före lyktorna. */
  lamps?: number[];
}

export interface ChampionshipProgress {
  id: string;
  /** Bilens namn (CarParams.name). */
  car: string;
  /** Etappen som ska köras härnäst, index i legs. */
  leg: number;
  /** Tider för körda etapper. */
  times: number[];
  damage: CarDamage | null;
  /** Frö för motståndarnas slump, och fältet med tider för de etapper spelaren kört. */
  seed?: number;
  rivals?: Rival[];
  /** Svårighetsgradens takt (DIFFICULTY_PACE); saknas i framsteg sparade före den och betyder lätt. */
  difficulty?: number;
}

/** Fältets takt per svårighetsgrad, som faktor på mästerskapets grundtakt (lägre = snabbare). */
export const DIFFICULTY_PACE = { easy: 1, medium: 0.97, hard: 0.94 } as const;
export type Difficulty = keyof typeof DIFFICULTY_PACE;

/** Prispengar per kilometer och placering: betydligt mer än för enstaka etapper. */
const CHAMPIONSHIP_MEDALS = [
  { name: 'guld', prize: 1500 },
  { name: 'silver', prize: 1000 },
  { name: 'brons', prize: 625 },
] as const;
export const CHAMPIONSHIP_FINISH_PRIZE = 1000;

/** Mästerskapets etapper sammanlagt (km), ur de förberäknade längderna. */
export const championshipKm = (def: ChampionshipDef) => def.legs.reduce((sum, leg) => sum + (STAGE_LENGTHS[leg] ?? 0), 0) / 1000;

/** Medaljerna med prispengar som växer med sträckan, så att långa mästerskap bär sina reparationer. */
export const championshipMedals = (def: ChampionshipDef) =>
  CHAMPIONSHIP_MEDALS.map((m) => ({ name: m.name, prize: Math.round((m.prize * championshipKm(def)) / 500) * 500 * TIER_PRIZE[def.tier] }));

export const championshipById = (id: string) => CHAMPIONSHIPS.find((c) => c.id === id) ?? null;

/** Medaljgränser för totaltiden: summan av etappernas gränser. */
export function championshipTargets(def: ChampionshipDef): [number, number, number] | null {
  const all = def.legs.map((name) => STAGE_TARGETS[name]);
  if (all.some((t) => !t)) return null;
  return [0, 1, 2].map((i) => Math.round(all.reduce((sum, t) => sum + t![i]!, 0) * TIER_PACE[def.tier])) as [number, number, number];
}

/** Prispengarna efter placering i mästerskapet (1 = vinst). */
export function championshipPrize(def: ChampionshipDef, place: number): { medal: string | null; prize: number } {
  const medal = championshipMedals(def)[place - 1];
  return medal ? { medal: medal.name, prize: medal.prize } : { medal: null, prize: CHAMPIONSHIP_FINISH_PRIZE * TIER_PRIZE[def.tier] };
}

/** Vädret på etappen som ska köras härnäst; samma frö ger samma väder efter en omladdning. */
export function legWeather(p: ChampionshipProgress, leg = p.leg): Weather {
  const def = championshipById(p.id)!;
  const stage = STAGES.find((s) => s.name === def.legs[leg]);
  return stage ? rollWeather(stage, rng((p.seed ?? 0) + 31 * (leg + 1))()) : 'clear';
}

/** Ett nytt mästerskap med ett slumpat fält motståndare. */
export function newProgress(def: ChampionshipDef, car: string, seed: number, difficulty: Difficulty = 'easy'): ChampionshipProgress {
  const d = DIFFICULTY_PACE[difficulty];
  return { id: def.id, car, leg: 0, times: [], damage: null, seed, rivals: newRivals(seed, fieldPace(def) * d), difficulty: d };
}

/**
 * Motståndarnas tider på etappen spelaren just kört på `time`. Framsteg sparade före
 * motståndarna får ett fält vars tidigare etapper körs i efterhand.
 */
export function raceRivals(p: ChampionshipProgress, time: number): ChampionshipProgress {
  const def = championshipById(p.id)!;
  const seed = p.seed ?? p.times.length * 1000 + Math.round(time * 100);
  const pace = fieldPace(def) * (p.difficulty ?? 1);
  let rivals = p.rivals ?? newRivals(seed, pace);
  const times = [...p.times, time];
  const slowdown = def.legs.map((_, i) => WEATHER_SLOWDOWN[legWeather({ ...p, seed }, i)]);
  for (let leg = p.rivals ? p.leg : 0; leg <= p.leg; leg++) rivals = raceLeg(rivals, def.legs, leg, times.slice(0, leg + 1), seed, slowdown, pace - 0.015);
  return { ...p, seed, rivals };
}

export type RepairPart = 'body' | 'wheels' | 'engine' | 'lamps';

/** Vad det kostar att laga varje del: kaross, hjul, motor och strålkastare. Avrundat till 50 kr. */
export function partCosts(d: CarDamage): Record<RepairPart, number> {
  const round = (kr: number) => Math.round(kr / 50) * 50;
  return {
    body: round((d.body.front + d.body.rear + d.body.left + d.body.right + d.body.roof) * 1500),
    wheels: round(d.wheels.reduce((a, b) => a + b, 0) * 800),
    engine: round((1 - d.powerFactor) * 4000),
    lamps: round((d.lamps ?? []).reduce((a, b) => a + b, 0) * 600),
  };
}

/** Vad det kostar att laga allt. */
export function repairCost(d: CarDamage): number {
  const c = partCosts(d);
  return c.body + c.wheels + c.engine + c.lamps;
}

/** Skadan efter att en del lagats; resten är som förut. */
export function repairPart(d: CarDamage, part: RepairPart): CarDamage {
  if (part === 'body') return { ...d, body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 } };
  if (part === 'wheels') return { ...d, wheels: d.wheels.map(() => 0) };
  if (part === 'engine') return { ...d, powerFactor: 1 };
  return { ...d, lamps: [0, 0] };
}

export const hasDamage = (d: CarDamage | null) => !!d && repairCost(d) > 0;

/** Framsteget efter en körd etapp. Med `repaired` lämnar bilen servicen hel. */
export function afterLeg(p: ChampionshipProgress, time: number, damage: CarDamage, repaired: boolean): ChampionshipProgress {
  return { ...p, leg: p.leg + 1, times: [...p.times, time], damage: repaired ? null : damage };
}

export function isProgress(value: unknown): value is ChampionshipProgress {
  const p = value as ChampionshipProgress;
  if (typeof p !== 'object' || p === null || typeof p.id !== 'string' || typeof p.car !== 'string') return false;
  const def = championshipById(p.id);
  if (!def || !Number.isInteger(p.leg) || p.leg < 0 || p.leg >= def.legs.length) return false;
  if (!Array.isArray(p.times) || p.times.length !== p.leg || !p.times.every((t) => Number.isFinite(t) && t > 0)) return false;
  if (p.rivals !== undefined && !(Array.isArray(p.rivals) && p.rivals.every((v) => isRival(v) && v.times.length === p.leg))) return false;
  if (p.seed !== undefined && !Number.isFinite(p.seed)) return false;
  if (p.difficulty !== undefined && !Object.values(DIFFICULTY_PACE).includes(p.difficulty as never)) return false;
  if (p.damage === null) return true;
  const d = p.damage;
  const parts = d && d.body ? [d.body.front, d.body.rear, d.body.left, d.body.right, d.body.roof] : [];
  const lamps = d.lamps === undefined ? [] : Array.isArray(d.lamps) && d.lamps.length === 2 ? d.lamps : [NaN];
  return parts.length === 5 && [...parts, ...(Array.isArray(d.wheels) ? d.wheels : [NaN]), d.powerFactor, ...lamps].every((x) => Number.isFinite(x) && x >= 0 && x <= 1);
}
