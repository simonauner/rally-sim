/**
 * The rivals in a championship: a field of fictional drivers with their own pace, measured as a fraction of
 * the stage's gold time (1 = gold time, lower = faster). Pure logic without DOM; everything is randomized from a seed
 * per championship and stage, so the same progress gives the same times after a reload.
 */

import { rng } from '../physics/rng';
import { STAGE_TARGETS } from './career';

export interface Rival {
  name: string;
  /** Pace as a fraction of the gold time. */
  pace: number;
  /** Time per stage driven. */
  times: number[];
}

export const RIVAL_COUNT = 7;

const FIRST = ['Agnes', 'Björn', 'Cecilia', 'David', 'Elin', 'Fredrik', 'Greta', 'Hampus', 'Ida', 'Jonas', 'Klara', 'Linus', 'Maja', 'Nils', 'Olivia', 'Pontus', 'Rut', 'Sixten', 'Tilda', 'Viktor'];
const LAST = ['Stenbacka', 'Mossberg', 'Kärrlund', 'Tallroth', 'Hedvall', 'Björkfelt', 'Frostell', 'Älvgren', 'Myrén', 'Snårberg', 'Gransjö', 'Ljungqvist', 'Hällström', 'Rimfors', 'Kvistedt', 'Grusell'];

const pick = <T>(list: readonly T[], r: () => number) => list[Math.floor(r() * list.length)]!;
/** Roughly normally distributed noise with standard deviation 1. */
const gauss = (r: () => number) => (r() + r() + r() + r() - 2) * 1.73;

/**
 * A new field. The fastest drives at the championship's base pace `base` or just above, the rest
 * spread out towards bronze level. The field does not depend on the player, so a faster car gives a noticeable margin.
 */
export function newRivals(seed: number, base = 0.985): Rival[] {
  const r = rng(seed);
  const names = new Set<string>();
  while (names.size < RIVAL_COUNT) names.add(`${pick(FIRST, r)} ${pick(LAST, r)}`);
  return [...names].map((name, i) => {
    return { name, pace: base + i * 0.022 + r() * 0.015, times: [] };
  });
}

export const goldTime = (stage: string) => STAGE_TARGETS[stage]?.[0] ?? 100;

/** A rival's time on a stage: the pace plus noise, and sometimes a mistake. */
function legTime(stage: string, pace: number, r: () => number): number {
  const mistake = r() < 0.1 ? 4 + r() * 14 : 0;
  return Math.round((goldTime(stage) * pace * (1 + gauss(r) * 0.012) + mistake) * 100) / 100;
}

/**
 * The rivals' times on stage `leg`, and their pace for the next one. If the player is faster than the whole
 * field so far (best pace over stages driven), one or two of the fastest close in, usually to
 * just behind, so the lead does not come for free. They never get faster than the floor `floor`, so
 * a player whose car is good enough to go below the floor wins by driving consistently.
 */
export function raceLeg(rivals: Rival[], legs: string[], leg: number, playerTimes: number[], seed: number, slowdown: number[] = [], floor = 0.97): Rival[] {
  const r = rng(seed + 7919 * (leg + 1));
  // Weather slows everyone down; the player's pace is computed without the weather, so a rainy run doesn't look slow.
  const raced = rivals.map((v) => ({ ...v, times: [...v.times.slice(0, leg), legTime(legs[leg]!, v.pace * (slowdown[leg] ?? 1), r)] }));
  const playerPace = Math.min(...playerTimes.map((t, i) => t / goldTime(legs[i]!) / (slowdown[i] ?? 1)));
  const best = Math.min(...raced.map((v) => v.pace));
  if (playerPace >= best) return raced;
  const top = [...raced].sort((a, b) => a.pace - b.pace).slice(0, 3);
  const chasers = r() < 0.5 ? 1 : 2;
  for (let k = 0; k < chasers; k++) {
    const v = top.splice(Math.floor(r() * top.length), 1)[0]!;
    v.pace = Math.min(v.pace, Math.max(floor, playerPace * (0.99 + r() * 0.04)));
  }
  return raced;
}

export interface Standing {
  name: string;
  total: number;
  /** Time on the latest stage. */
  last: number;
  player: boolean;
}

/** The standings after the stages the player has driven, fastest first. */
export function standings(rivals: Rival[], playerTimes: number[]): Standing[] {
  const n = playerTimes.length;
  const sum = (t: number[]) => t.slice(0, n).reduce((a, b) => a + b, 0);
  return [
    { name: 'Du', total: sum(playerTimes), last: playerTimes[n - 1] ?? 0, player: true },
    ...rivals.map((v) => ({ name: v.name, total: sum(v.times), last: v.times[n - 1] ?? 0, player: false })),
  ].sort((a, b) => a.total - b.total);
}

export function isRival(v: unknown): v is Rival {
  const x = v as Rival;
  return typeof x === 'object' && x !== null && typeof x.name === 'string' && Number.isFinite(x.pace) && x.pace > 0.3 && x.pace < 3 && Array.isArray(x.times) && x.times.every((t) => Number.isFinite(t) && t > 0);
}
