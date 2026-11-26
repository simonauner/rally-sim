/**
 * Mästerskap: flera etapper i följd med samma bil. Skador följer med mellan etapperna och lagas
 * för pengar på servicen; den som avbryter får bilen lagad gratis men inga prispengar. Ren logik
 * utan DOM; framsteget sparas i webbläsaren eftersom spelet laddar om sidan mellan etapperna.
 */

import type { DamageState } from '../physics/car';
import { STAGE_TARGETS } from './career';

export interface ChampionshipDef {
  id: string;
  name: string;
  /** Etappernas namn, i körordning (StageDef.name). */
  legs: string[];
}

export const CHAMPIONSHIPS: ChampionshipDef[] = [
  { id: 'skogsrallyt', name: 'Skogsrallyt', legs: ['Skogsberg', 'Skogsberg baklänges'] },
  { id: 'myrkullarallyt', name: 'Myrkullarallyt', legs: ['Myrkulla', 'Myrkulla baklänges'] },
  { id: 'vinterrallyt', name: 'Vinterrallyt', legs: ['Frostberga', 'Frostberga baklänges'] },
];

/** Det som följer med bilen mellan etapperna. */
export interface CarDamage {
  body: DamageState;
  /** Skada per hjul, 0..1. */
  wheels: number[];
  /** Motorns kvarvarande effekt, 0..1. */
  powerFactor: number;
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
}

/** Prispengar för hela mästerskapet: betydligt mer än för enstaka etapper. */
export const CHAMPIONSHIP_MEDALS = [
  { name: 'guld', prize: 6000 },
  { name: 'silver', prize: 4000 },
  { name: 'brons', prize: 2500 },
] as const;
export const CHAMPIONSHIP_FINISH_PRIZE = 1000;

export const championshipById = (id: string) => CHAMPIONSHIPS.find((c) => c.id === id) ?? null;

/** Medaljgränser för totaltiden: summan av etappernas gränser. */
export function championshipTargets(def: ChampionshipDef): [number, number, number] | null {
  const all = def.legs.map((name) => STAGE_TARGETS[name]);
  if (all.some((t) => !t)) return null;
  return [0, 1, 2].map((i) => all.reduce((sum, t) => sum + t![i]!, 0)) as [number, number, number];
}

export function championshipPrize(def: ChampionshipDef, total: number): { medal: string | null; prize: number } {
  const targets = championshipTargets(def);
  const i = targets ? targets.findIndex((t) => total <= t) : -1;
  return i >= 0 ? { medal: CHAMPIONSHIP_MEDALS[i]!.name, prize: CHAMPIONSHIP_MEDALS[i]!.prize } : { medal: null, prize: CHAMPIONSHIP_FINISH_PRIZE };
}

/** Vad det kostar att laga allt: kaross, hjul och motor. Avrundat till 50 kr. */
export function repairCost(d: CarDamage): number {
  const body = d.body.front + d.body.rear + d.body.left + d.body.right + d.body.roof;
  const wheels = d.wheels.reduce((a, b) => a + b, 0);
  const engine = 1 - d.powerFactor;
  return Math.round((body * 1500 + wheels * 800 + engine * 4000) / 50) * 50;
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
  if (p.damage === null) return true;
  const d = p.damage;
  const parts = d && d.body ? [d.body.front, d.body.rear, d.body.left, d.body.right, d.body.roof] : [];
  return parts.length === 5 && [...parts, ...(Array.isArray(d.wheels) ? d.wheels : [NaN]), d.powerFactor].every((x) => Number.isFinite(x) && x >= 0 && x <= 1);
}
