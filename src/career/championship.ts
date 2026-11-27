/**
 * Mästerskap: flera etapper i följd med samma bil. Skador följer med mellan etapperna och lagas
 * för pengar på servicen; den som avbryter får bilen lagad gratis men inga prispengar. Ren logik
 * utan DOM; framsteget sparas i webbläsaren eftersom spelet laddar om sidan mellan etapperna.
 */

import type { CareerState } from '../account/protocol';
import type { DamageState } from '../physics/car';
import { STAGE_TARGETS, TIER_PACE, TIER_PRIZE, type Tier } from './career';
import { isRival, newRivals, raceLeg, type Rival } from './rivals';
import { rng } from '../physics/rng';
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
  { id: 'skogsrallyt', name: 'Skogsrallyt', legs: ['Skogsberg', 'Skogsberg baklänges', 'Tallmon'], pace: 0.985, tier: 1 },
  { id: 'myrkullarallyt', name: 'Myrkullarallyt', legs: ['Ljungheden', 'Myrkulla', 'Myrkulla baklänges'], pace: 0.965, tier: 1 },
  { id: 'vinterrallyt', name: 'Vinterrallyt', legs: ['Frostberga', 'Frostberga baklänges', 'Isvallen'], pace: 0.945, tier: 1 },
  // Klass 2 kör samma etapper i nya kombinationer, mot ett snabbare fält.
  { id: 'tallmoklassikern', name: 'Tallmoklassikern', legs: ['Tallmon', 'Skogsberg', 'Myrkulla'], pace: 0.985, tier: 2 },
  { id: 'ljunghedsrallyt', name: 'Ljunghedsrallyt', legs: ['Ljungheden', 'Myrkulla baklänges', 'Skogsberg baklänges'], pace: 0.965, tier: 2 },
  { id: 'israllyt', name: 'Israllyt', legs: ['Isvallen', 'Frostberga baklänges', 'Frostberga'], pace: 0.945, tier: 2 },
];

/** Fältets takt i klass 1-guldtider: klass 2 kör fortare. */
const fieldPace = (def: ChampionshipDef) => def.pace * TIER_PACE[def.tier];

/** Vunnet; vinster från före `won` läses ur historiken. */
export const hasWon = (career: CareerState, def: ChampionshipDef) =>
  !!career.won?.includes(def.id) || !!career.history?.some((e) => e.kind === 'championship' && e.place === 1 && e.name === def.name);

/** Skogsrallyt är alltid öppet; varje mästerskap därefter kräver att alla före det är vunna. */
export const championshipUnlocked = (career: CareerState, def: ChampionshipDef) =>
  CHAMPIONSHIPS.slice(0, CHAMPIONSHIPS.indexOf(def)).every((c) => hasWon(career, c));

/** Klassen är öppen när alla mästerskap i klasserna under är vunna. */
export const tierUnlocked = (career: CareerState, tier: Tier) => CHAMPIONSHIPS.filter((c) => c.tier < tier).every((c) => hasWon(career, c));

/** Vad som låser upp mästerskapet, för menyn. */
export const unlockHint = (career: CareerState, def: ChampionshipDef) =>
  `vinn ${CHAMPIONSHIPS.slice(0, CHAMPIONSHIPS.indexOf(def)).filter((c) => !hasWon(career, c)).map((c) => c.name).join(' och ')}`;

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
}

/** Prispengar per placering för ett mästerskap med två etapper: betydligt mer än för enstaka etapper. */
const CHAMPIONSHIP_MEDALS = [
  { name: 'guld', prize: 6000 },
  { name: 'silver', prize: 4000 },
  { name: 'brons', prize: 2500 },
] as const;
export const CHAMPIONSHIP_FINISH_PRIZE = 1000;

/** Medaljerna med prispengar som växer med antalet etapper. */
export const championshipMedals = (def: ChampionshipDef) =>
  CHAMPIONSHIP_MEDALS.map((m) => ({ name: m.name, prize: (m.prize * def.legs.length * TIER_PRIZE[def.tier]) / 2 }));

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
export function newProgress(def: ChampionshipDef, car: string, seed: number): ChampionshipProgress {
  return { id: def.id, car, leg: 0, times: [], damage: null, seed, rivals: newRivals(seed, fieldPace(def)) };
}

/**
 * Motståndarnas tider på etappen spelaren just kört på `time`. Framsteg sparade före
 * motståndarna får ett fält vars tidigare etapper körs i efterhand.
 */
export function raceRivals(p: ChampionshipProgress, time: number): ChampionshipProgress {
  const def = championshipById(p.id)!;
  const seed = p.seed ?? p.times.length * 1000 + Math.round(time * 100);
  let rivals = p.rivals ?? newRivals(seed, fieldPace(def));
  const times = [...p.times, time];
  const slowdown = def.legs.map((_, i) => WEATHER_SLOWDOWN[legWeather({ ...p, seed }, i)]);
  for (let leg = p.rivals ? p.leg : 0; leg <= p.leg; leg++) rivals = raceLeg(rivals, def.legs, leg, times.slice(0, leg + 1), seed, slowdown, fieldPace(def) - 0.015);
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
  if (p.damage === null) return true;
  const d = p.damage;
  const parts = d && d.body ? [d.body.front, d.body.rear, d.body.left, d.body.right, d.body.roof] : [];
  const lamps = d.lamps === undefined ? [] : Array.isArray(d.lamps) && d.lamps.length === 2 ? d.lamps : [NaN];
  return parts.length === 5 && [...parts, ...(Array.isArray(d.wheels) ? d.wheels : [NaN]), d.powerFactor, ...lamps].every((x) => Number.isFinite(x) && x >= 0 && x <= 1);
}
