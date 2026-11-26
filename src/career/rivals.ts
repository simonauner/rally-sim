/**
 * Motståndarna i ett mästerskap: ett fält fiktiva förare med egen takt, mätt som andel av
 * etappens guldtid (1 = guldtid, lägre = snabbare). Ren logik utan DOM; allt slumpas från ett frö
 * per mästerskap och etapp, så samma framsteg ger samma tider efter en omladdning.
 */

import { rng } from '../physics/rng';
import { STAGE_TARGETS } from './career';

export interface Rival {
  name: string;
  /** Takt som andel av guldtiden. */
  pace: number;
  /** Tid per körd etapp. */
  times: number[];
}

export const RIVAL_COUNT = 7;

const FIRST = ['Agnes', 'Björn', 'Cecilia', 'David', 'Elin', 'Fredrik', 'Greta', 'Hampus', 'Ida', 'Jonas', 'Klara', 'Linus', 'Maja', 'Nils', 'Olivia', 'Pontus', 'Rut', 'Sixten', 'Tilda', 'Viktor'];
const LAST = ['Stenbacka', 'Mossberg', 'Kärrlund', 'Tallroth', 'Hedvall', 'Björkfelt', 'Frostell', 'Älvgren', 'Myrén', 'Snårberg', 'Gransjö', 'Ljungqvist', 'Hällström', 'Rimfors', 'Kvistedt', 'Grusell'];

const pick = <T>(list: readonly T[], r: () => number) => list[Math.floor(r() * list.length)]!;
/** Ungefär normalfördelat brus med standardavvikelse 1. */
const gauss = (r: () => number) => (r() + r() + r() + r() - 2) * 1.73;

/**
 * Ett nytt fält. Den snabbaste kör på mästerskapets grundtakt `base` eller strax över, resten
 * sprids ut mot bronsnivå. Fältet beror inte på spelaren, så en snabbare bil ger en marginal som märks.
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

/** En motståndares tid på en etapp: takten plus brus, och ibland ett misstag. */
function legTime(stage: string, pace: number, r: () => number): number {
  const mistake = r() < 0.1 ? 4 + r() * 14 : 0;
  return Math.round((goldTime(stage) * pace * (1 + gauss(r) * 0.012) + mistake) * 100) / 100;
}

/**
 * Motståndarnas tider på etapp `leg`, och deras takt inför nästa. Är spelaren snabbare än hela
 * fältet hittills (bästa takt över körda etapper) närmar sig en eller två av de snabbaste, oftast till
 * strax efter, så att ledningen inte blir gratis. De blir aldrig snabbare än golvet `floor`, så den
 * som har en bil som räcker under golvet vinner om den kör jämnt.
 */
export function raceLeg(rivals: Rival[], legs: string[], leg: number, playerTimes: number[], seed: number, slowdown: number[] = [], floor = 0.97): Rival[] {
  const r = rng(seed + 7919 * (leg + 1));
  // Vädret gör alla långsammare; spelarens takt räknas utan vädret, så ett regnigt åk inte ser långsamt ut.
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
  /** Tid på senaste etappen. */
  last: number;
  player: boolean;
}

/** Ställningen efter de etapper spelaren kört, snabbast först. */
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
