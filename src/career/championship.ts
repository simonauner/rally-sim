/**
 * Championships: several stages in a row with the same car. Damage carries over between stages and is repaired
 * for money at service; a player who retires gets the car repaired for free but no prize money. Pure logic
 * without DOM; progress is saved in the browser because the game reloads the page between stages.
 */

import type { CareerState } from '../account/protocol';
import type { DamageState } from '../physics/car';
import { STAGE_TARGETS, TIER_PACE, TIER_PRIZE, tierOf, type Tier } from './career';
import { isRival, newRivals, raceLeg, standings, type Rival } from './rivals';
import { rng } from '../physics/rng';
import { STAGE_LENGTHS } from '../physics/real/lengths';
import { STAGES } from '../physics/stage';
import { rollWeather, WEATHER_SLOWDOWN, type Weather } from '../physics/weather';

export interface ChampionshipDef {
  id: string;
  name: string;
  /** The stage names, in running order (StageDef.name). */
  legs: string[];
  /** The field's base pace as a fraction of the gold time; no rival gets faster than just below it. */
  pace: number;
  /** The car class allowed to enter. */
  tier: Tier;
}

export const CHAMPIONSHIPS: ChampionshipDef[] = [
  { id: 'skogsrallyt', name: 'Skogsrallyt', legs: ['Grinsbol', 'Tollesrud', 'Åsterud'], pace: 0.985, tier: 1 },
  { id: 'myrkullarallyt', name: 'Myrkullarallyt', legs: ['Botten', 'Rannsjön', 'Larssäter', 'Stor-Jangen'], pace: 0.965, tier: 1 },
  // Five stages give the field more chances to catch up, so the base pace is a bit lower than for three stages.
  { id: 'vinterrallyt', name: 'Vinterrallyt', legs: ['Åsjön', 'Altarliden', 'Bergtjärnen', 'Torpet', 'Trollberget'], pace: 0.95, tier: 1 },
  // Class 2 has its own real roads and a faster field.
  { id: 'tallmoklassikern', name: 'Tallmoklassikern', legs: ['Södra Hulteby', 'Ämten', 'Lindås', 'Lungsund'], pace: 0.985, tier: 2 },
  { id: 'ljunghedsrallyt', name: 'Ljunghedsrallyt', legs: ['Sundstorp', 'Bäckelid', 'Niklasdamm', 'Broby'], pace: 0.965, tier: 2 },
  { id: 'israllyt', name: 'Israllyt', legs: ['Storberget', 'Hösjöälven', 'Röjmyrberget', 'Flarkån'], pace: 0.945, tier: 2 },
  // Placed last so that class 2 is still unlocked by the first three class 1 championships.
  { id: 'forsrallyt', name: 'Forsrallyt', legs: ['Näs', 'Rickleån', 'Valsfäboda'], pace: 0.945, tier: 1 },
];

/** The field's pace in class 1 gold times: class 2 drives faster. */
const fieldPace = (def: ChampionshipDef) => def.pace * TIER_PACE[def.tier];

/** Won on any difficulty; wins from before `won` are read from the history. */
const wonAny = (career: CareerState, def: ChampionshipDef) =>
  !!career.won?.includes(def.id) || !!career.history?.some((e) => e.kind === 'championship' && e.place === 1 && e.name === def.name);

/** The difficulties the championship is won on; wins from before `wonOn` count as easy. */
export const wonDifficulties = (career: CareerState, def: ChampionshipDef): Difficulty[] =>
  career.wonOn?.[def.id] ?? (wonAny(career, def) ? ['easy'] : []);

/** Won on the difficulty, or on any difficulty without one. */
export const hasWon = (career: CareerState, def: ChampionshipDef, difficulty?: Difficulty) =>
  difficulty ? wonDifficulties(career, def).includes(difficulty) : wonAny(career, def);

/**
 * The best position in the championship, or null if it was never driven.
 * shortcut: read from the history, which only keeps the latest rows; wins remain in `won`.
 */
export function bestPlace(career: CareerState, def: ChampionshipDef): number | null {
  const places = (career.history ?? []).filter((e) => e.kind === 'championship' && e.name === def.name && e.place).map((e) => e.place!);
  if (hasWon(career, def)) places.push(1);
  return places.length ? Math.min(...places) : null;
}

/** The championships in the same class that come before it in the list. */
const earlierInTier = (def: ChampionshipDef) => CHAMPIONSHIPS.slice(0, CHAMPIONSHIPS.indexOf(def)).filter((c) => c.tier === def.tier);

/** The class is unlocked when the championships before the class's first one in the list are won. */
export const tierUnlocked = (career: CareerState, tier: Tier) =>
  CHAMPIONSHIPS.slice(0, CHAMPIONSHIPS.findIndex((c) => c.tier === tier)).every((c) => hasWon(career, c));

/** Class 2 cars that are only sold once all class 2 championships are won on medium or hard. */
const LATE_CARS = ['Sora 2.0 Turbo', 'Hoshi 2.0 4WD', 'Volpe 2.0 Turbo 16V', 'Brenner 5T Coupé'];

/** Whether the dealer sells the car: the class must be unlocked, and the late cars require all of class 2 won on medium or hard. */
export const carUnlocked = (career: CareerState, car: string) =>
  tierUnlocked(career, tierOf(car)) && (!LATE_CARS.includes(car) || CHAMPIONSHIPS.filter((c) => c.tier === 2).every((c) => hasWon(career, c, 'medium') || hasWon(career, c, 'hard')));

/** What unlocks the car, for the dealer's button. */
export const carUnlockHint = (car: string) => (LATE_CARS.includes(car) ? 'Vinn alla mästerskap i klass 2 på medel eller svår' : 'Vinn alla mästerskap i klass 1');

/** Skogsrallyt is always open; after that the class must be unlocked and the class's earlier championships won. */
export const championshipUnlocked = (career: CareerState, def: ChampionshipDef) =>
  tierUnlocked(career, def.tier) && earlierInTier(def).every((c) => hasWon(career, c));

/**
 * What unlocks the championship, for the menu: only the last unwon one before it, the earlier ones follow from it.
 * The class's first championship has none before it in the class; there it is the championships that unlock the class.
 */
export const unlockHint = (career: CareerState, def: ChampionshipDef) => {
  const opensTier = CHAMPIONSHIPS.slice(0, CHAMPIONSHIPS.findIndex((c) => c.tier === def.tier));
  return `vinn ${[...opensTier, ...earlierInTier(def)].filter((c) => !hasWon(career, c)).at(-1)?.name}`;
};

/** The career with the championship won on the difficulty; `won` keeps any-difficulty wins for unlocking. */
export const withWin = (career: CareerState, def: ChampionshipDef, difficulty: Difficulty = 'easy'): CareerState => {
  if (hasWon(career, def, difficulty) && career.won?.includes(def.id)) return career;
  const on = DIFFICULTIES.filter((d) => d === difficulty || hasWon(career, def, d));
  return { ...career, won: career.won?.includes(def.id) ? career.won : [...(career.won ?? []), def.id], wonOn: { ...career.wonOn, [def.id]: on } };
};

/** What carries over with the car between stages. */
export interface CarDamage {
  body: DamageState;
  /** Damage per wheel, 0..1. */
  wheels: number[];
  /** The engine's remaining power, 0..1. */
  powerFactor: number;
  /** Headlight damage [left, right], 0..1. Missing in progress saved before the lamps. */
  lamps?: number[];
}

export interface ChampionshipProgress {
  id: string;
  /** The car's name (CarParams.name). */
  car: string;
  /** The stage to drive next, index in legs. */
  leg: number;
  /** Times for stages driven. */
  times: number[];
  damage: CarDamage | null;
  /** Seed for the rivals' randomness, and the field with times for the stages the player has driven. */
  seed?: number;
  rivals?: Rival[];
  /** The difficulty's pace (DIFFICULTY_PACE); missing in progress saved before it, meaning easy. */
  difficulty?: number;
}

/** The field's pace per difficulty, as a factor on the championship's base pace (lower = faster). */
export const DIFFICULTY_PACE = { easy: 1, medium: 0.97, hard: 0.94 } as const;
export type Difficulty = keyof typeof DIFFICULTY_PACE;
export const DIFFICULTIES = Object.keys(DIFFICULTY_PACE) as Difficulty[];
/** Medal money per difficulty: harder fields pay more, easier less (Skogsrallyt: 15 500 / 20 500 / 25 500). */
export const DIFFICULTY_PRIZE: Record<Difficulty, number> = { easy: 0.75, medium: 1, hard: 1.25 };
/** The difficulty the championship was started with; progress saved before it counts as easy. */
export const difficultyOf = (p: ChampionshipProgress) =>
  DIFFICULTIES.find((k) => DIFFICULTY_PACE[k] === (p.difficulty ?? 1))!;

/** Prize money per kilometre and position: considerably more than for single stages. */
const CHAMPIONSHIP_MEDALS = [
  { name: 'guld', prize: 1500 },
  { name: 'silver', prize: 1000 },
  { name: 'brons', prize: 625 },
] as const;
export const CHAMPIONSHIP_FINISH_PRIZE = 1000;
/** Medal money for a championship already won on the difficulty: the first win on each difficulty pays in full, so repeating it is no shortcut to money. */
export const REPEAT_PRIZE = 0.4;

/** The championship's stages combined (km), from the precomputed lengths. */
export const championshipKm = (def: ChampionshipDef) => def.legs.reduce((sum, leg) => sum + (STAGE_LENGTHS[leg] ?? 0), 0) / 1000;

/** The medals with prize money that grows with distance, so long championships pay for their repairs. `won`: already won on this difficulty. */
export const championshipMedals = (def: ChampionshipDef, difficulty: Difficulty, won = false) =>
  CHAMPIONSHIP_MEDALS.map((m) => ({
    name: m.name,
    prize: Math.round((m.prize * championshipKm(def) * DIFFICULTY_PRIZE[difficulty] * (won ? REPEAT_PRIZE : 1)) / 500) * 500 * TIER_PRIZE[def.tier],
  }));

export const championshipById = (id: string) => CHAMPIONSHIPS.find((c) => c.id === id) ?? null;

/** Medal thresholds for the total time: the sum of the stages' thresholds. */
export function championshipTargets(def: ChampionshipDef): [number, number, number] | null {
  const all = def.legs.map((name) => STAGE_TARGETS[name]);
  if (all.some((t) => !t)) return null;
  return [0, 1, 2].map((i) => Math.round(all.reduce((sum, t) => sum + t![i]!, 0) * TIER_PACE[def.tier])) as [number, number, number];
}

/** The prize money by championship position (1 = win); `won` if already won on this difficulty. */
export function championshipPrize(def: ChampionshipDef, place: number, difficulty: Difficulty, won = false): { medal: string | null; prize: number } {
  const medal = championshipMedals(def, difficulty, won)[place - 1];
  return medal ? { medal: medal.name, prize: medal.prize } : { medal: null, prize: CHAMPIONSHIP_FINISH_PRIZE * TIER_PRIZE[def.tier] };
}

/** The weather on the stage to drive next; the same seed gives the same weather after a reload. */
export function legWeather(p: ChampionshipProgress, leg = p.leg): Weather {
  const def = championshipById(p.id)!;
  const stage = STAGES.find((s) => s.name === def.legs[leg]);
  return stage ? rollWeather(stage, rng((p.seed ?? 0) + 31 * (leg + 1))()) : 'clear';
}

/** A new championship with a random field of rivals. */
export function newProgress(def: ChampionshipDef, car: string, seed: number, difficulty: Difficulty = 'easy'): ChampionshipProgress {
  const d = DIFFICULTY_PACE[difficulty];
  return { id: def.id, car, leg: 0, times: [], damage: null, seed, rivals: newRivals(seed, fieldPace(def) * d), difficulty: d };
}

/**
 * The rivals' times on the stage the player just drove in `time`. Progress saved before
 * the rivals gets a field whose earlier stages are raced afterwards.
 */
export function raceRivals(p: ChampionshipProgress, time: number): ChampionshipProgress {
  const def = championshipById(p.id)!;
  const seed = p.seed ?? p.times.length * 1000 + Math.round(time * 100);
  const pace = fieldPace(def) * (p.difficulty ?? 1);
  let rivals = p.rivals ?? newRivals(seed, pace);
  const times = [...p.times, time];
  const slowdown = legSlowdown({ ...p, seed });
  for (let leg = p.rivals ? p.leg : 0; leg <= p.leg; leg++) rivals = raceLeg(rivals, def.legs, leg, times.slice(0, leg + 1), seed, slowdown, pace - 0.015);
  return { ...p, seed, rivals };
}

/** How much the weather slows the field on each stage. */
const legSlowdown = (p: ChampionshipProgress) => championshipById(p.id)!.legs.map((_, i) => WEATHER_SLOWDOWN[legWeather(p, i)]);

/**
 * The start order on the next stage, name by name ('Du' is the player). The first stage is seeded fastest
 * first with the player last, as an unseeded newcomer; after that the field starts in reverse order of
 * the standings, so the leader goes last and gets the road swept by the others, as in the WRC.
 */
export function startOrder(p: ChampionshipProgress): string[] {
  if (!p.rivals) return ['Du'];
  if (p.leg === 0) return [...[...p.rivals].sort((a, b) => a.pace - b.pace).map((v) => v.name), 'Du'];
  return standings(p.rivals, p.times).map((s) => s.name).reverse();
}

/**
 * The drivers starting before the player on the next stage, with their times there. The times depend only on the seed,
 * the pace and the weather, not on the player's run, so they match what raceRivals gives after the finish.
 */
export function aheadOnRoad(p: ChampionshipProgress): { name: string; time: number }[] {
  if (!p.rivals || p.seed === undefined) return [];
  const def = championshipById(p.id)!;
  const raced = raceLeg(p.rivals, def.legs, p.leg, p.times, p.seed, legSlowdown(p));
  const order = startOrder(p);
  return order.slice(0, order.indexOf('Du')).map((name) => ({ name, time: raced.find((v) => v.name === name)!.times[p.leg]! }));
}

export type RepairPart = 'body' | 'wheels' | 'engine' | 'lamps';

/** What it costs to repair each part: body, wheels, engine and headlights. Rounded to 50 kr. */
export function partCosts(d: CarDamage): Record<RepairPart, number> {
  const round = (kr: number) => Math.round(kr / 50) * 50;
  return {
    body: round((d.body.front + d.body.rear + d.body.left + d.body.right + d.body.roof) * 1500),
    wheels: round(d.wheels.reduce((a, b) => a + b, 0) * 800),
    engine: round((1 - d.powerFactor) * 4000),
    lamps: round((d.lamps ?? []).reduce((a, b) => a + b, 0) * 600),
  };
}

/** What it costs to repair everything. */
export function repairCost(d: CarDamage): number {
  const c = partCosts(d);
  return c.body + c.wheels + c.engine + c.lamps;
}

/** The damage after one part is repaired; the rest is as before. */
export function repairPart(d: CarDamage, part: RepairPart): CarDamage {
  if (part === 'body') return { ...d, body: { front: 0, rear: 0, left: 0, right: 0, roof: 0 } };
  if (part === 'wheels') return { ...d, wheels: d.wheels.map(() => 0) };
  if (part === 'engine') return { ...d, powerFactor: 1 };
  return { ...d, lamps: [0, 0] };
}

export const hasDamage = (d: CarDamage | null) => !!d && repairCost(d) > 0;

/** The progress after a stage driven. With `repaired` the car leaves service intact. */
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
