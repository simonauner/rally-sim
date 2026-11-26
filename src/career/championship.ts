/**
 * Mästerskap: flera etapper i följd med samma bil. Skador följer med mellan etapperna och lagas
 * för pengar på servicen; den som avbryter får bilen lagad gratis men inga prispengar. Ren logik
 * utan DOM; framsteget sparas i webbläsaren eftersom spelet laddar om sidan mellan etapperna.
 */

import type { DamageState } from '../physics/car';
import { STAGE_TARGETS } from './career';
import { isRival, newRivals, raceLeg, type Rival } from './rivals';

export interface ChampionshipDef {
  id: string;
  name: string;
  /** Etappernas namn, i körordning (StageDef.name). */
  legs: string[];
}

export const CHAMPIONSHIPS: ChampionshipDef[] = [
  { id: 'skogsrallyt', name: 'Skogsrallyt', legs: ['Skogsberg', 'Skogsberg baklänges', 'Tallmon'] },
  { id: 'myrkullarallyt', name: 'Myrkullarallyt', legs: ['Ljungheden', 'Myrkulla', 'Myrkulla baklänges'] },
  { id: 'vinterrallyt', name: 'Vinterrallyt', legs: ['Frostberga', 'Frostberga baklänges', 'Isvallen'] },
];

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
export const championshipMedals = (def: ChampionshipDef) => CHAMPIONSHIP_MEDALS.map((m) => ({ name: m.name, prize: (m.prize * def.legs.length) / 2 }));

export const championshipById = (id: string) => CHAMPIONSHIPS.find((c) => c.id === id) ?? null;

/** Medaljgränser för totaltiden: summan av etappernas gränser. */
export function championshipTargets(def: ChampionshipDef): [number, number, number] | null {
  const all = def.legs.map((name) => STAGE_TARGETS[name]);
  if (all.some((t) => !t)) return null;
  return [0, 1, 2].map((i) => all.reduce((sum, t) => sum + t![i]!, 0)) as [number, number, number];
}

/** Prispengarna efter placering i mästerskapet (1 = vinst). */
export function championshipPrize(def: ChampionshipDef, place: number): { medal: string | null; prize: number } {
  const medal = championshipMedals(def)[place - 1];
  return medal ? { medal: medal.name, prize: medal.prize } : { medal: null, prize: CHAMPIONSHIP_FINISH_PRIZE };
}

/** Ett nytt mästerskap med ett slumpat fält motståndare. */
export function newProgress(def: ChampionshipDef, car: string, seed: number, playerPace?: number): ChampionshipProgress {
  return { id: def.id, car, leg: 0, times: [], damage: null, seed, rivals: newRivals(seed, playerPace) };
}

/**
 * Motståndarnas tider på etappen spelaren just kört på `time`. Framsteg sparade före
 * motståndarna får ett fält vars tidigare etapper körs i efterhand.
 */
export function raceRivals(p: ChampionshipProgress, time: number): ChampionshipProgress {
  const def = championshipById(p.id)!;
  const seed = p.seed ?? p.times.length * 1000 + Math.round(time * 100);
  let rivals = p.rivals ?? newRivals(seed);
  const times = [...p.times, time];
  for (let leg = p.rivals ? p.leg : 0; leg <= p.leg; leg++) rivals = raceLeg(rivals, def.legs, leg, times.slice(0, leg + 1), seed);
  return { ...p, seed, rivals };
}

/** Vad det kostar att laga allt: kaross, hjul, motor och strålkastare. Avrundat till 50 kr. */
export function repairCost(d: CarDamage): number {
  const body = d.body.front + d.body.rear + d.body.left + d.body.right + d.body.roof;
  const wheels = d.wheels.reduce((a, b) => a + b, 0);
  const engine = 1 - d.powerFactor;
  const lamps = (d.lamps ?? []).reduce((a, b) => a + b, 0);
  return Math.round((body * 1500 + wheels * 800 + engine * 4000 + lamps * 600) / 50) * 50;
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
