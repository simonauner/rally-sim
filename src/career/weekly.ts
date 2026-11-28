/**
 * The weekly challenge: the same stage, factory car and weather for everyone during a week, with a shared
 * leaderboard on the sync server. The placing pays out to the career once the week is over. Pure logic without DOM.
 */

import type { CareerState } from '../account/protocol';
import { CARS, type CarModel } from '../physics/params';
import { rng } from '../physics/rng';
import { STAGE_CORRIDOR, STAGES, type StageDef } from '../physics/stage';
import { rollWeather, type Weather } from '../physics/weather';
import type { GhostData } from '../physics/ghost';
import { logged, stageTargets, tierOf } from './career';

export interface WeeklyChallenge {
  week: number;
  stage: StageDef;
  /** A factory car without upgrades, so everyone drives the same; any class, owned or not. */
  model: CarModel;
  weather: Weather;
}

/** The week's challenge; the week number alone decides it, so every player gets the same. */
export function weeklyChallenge(week: number): WeeklyChallenge {
  const r = rng(week * 7919 + 13);
  r();
  const stage = STAGES[Math.floor(r() * STAGES.length)]!;
  const model = CARS[Math.floor(r() * CARS.length)]!;
  return { week, stage, model, weather: rollWeather(stage, r()) };
}

/** What a placing pays: the podium most, the top ten something extra, and everyone who took part a little. */
export const weeklyPrize = (place: number) => [10000, 7000, 5000][place - 1] ?? (place <= 10 ? 3000 : 1500);

/**
 * The career after last week's result is settled: prize money if the player took part, and the week marked
 * as paid either way so it is only settled once.
 * shortcut: only the week just ended is settled; a player who stays away longer misses older results.
 */
export function settleWeek(career: CareerState, week: number, you: { place: number; time: number } | null, count: number, at = Date.now()): CareerState {
  const paid = { ...career, weeklyPaid: week };
  if (!you) return paid;
  const c = weeklyChallenge(week);
  const amount = weeklyPrize(you.place);
  return logged(
    { ...paid, money: paid.money + amount },
    { kind: 'stage', name: 'Veckans utmaning', car: c.model.make().name, time: you.time, medal: `${you.place}:a av ${count}`, amount },
    at,
  );
}

/** Samples per second in the run's trace: enough to follow the road, small enough to send (about 5 kB for a stage). */
export const TRACE_HZ = 4;
/** The fastest a run may be, as a share of the class's gold time; the menu autopilot, which knows the road, reaches about 0.87. */
export const MIN_SHARE = 0.8;
/** The most the trace may advance along the road per second (m/s), well above any car's top speed. */
const MAX_PACE = 70;

/** The run's path for the server: x and z in decimetres at TRACE_HZ, each as the change from the sample before. */
export function traceOf(ghost: GhostData): number[] {
  const step = Math.max(1, Math.round(ghost.hz / TRACE_HZ));
  const out: number[] = [];
  let px = 0;
  let pz = 0;
  for (let i = 0; i * 7 < ghost.frames.length; i += step) {
    const x = Math.round(ghost.frames[i * 7]! * 10);
    const z = Math.round(ghost.frames[i * 7 + 2]! * 10);
    out.push(x - px, z - pz);
    px = x;
    pz = z;
  }
  return out;
}

export type RunVerdict = 'ok' | 'too-fast' | 'bad-trace';

/**
 * Whether a submitted run is plausible: not faster than the class allows, and a trace that lasts as long as the time,
 * stays by the road from the start to the finish and never advances faster than a car can drive. The road is the
 * stage's points (about 20 m apart), so the server does not have to build the whole stage.
 * shortcut: a trace made up from the stage's own points at a believable pace passes; validate inputs by
 * replaying the physics if that happens.
 */
export function checkRun(c: WeeklyChallenge, time: number, trace: unknown): RunVerdict {
  const gold = stageTargets(c.stage.name, tierOf(c.model.make().name))?.[0];
  if (gold !== undefined && time < gold * MIN_SHARE) return 'too-fast';
  if (!Array.isArray(trace) || trace.length % 2 || !trace.every((v) => Number.isInteger(v))) return 'bad-trace';
  const n = trace.length / 2;
  if (Math.abs(n - (Math.floor(time * TRACE_HZ) + 1)) > 2) return 'bad-trace';
  const pts = c.stage.points;
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  const finish = along.at(-1)! - (c.stage.runout ?? 80);
  let x = 0;
  let z = 0;
  let seg = 0;
  let reached = 0;
  for (let k = 0; k < n; k++) {
    x += (trace[2 * k] as number) / 10;
    z += (trace[2 * k + 1] as number) / 10;
    // The nearest segment near the previous one: a little back (recovering onto the road) and further ahead.
    let best = Infinity;
    let at = 0;
    const from = Math.max(0, seg - 5);
    const to = Math.min(pts.length - 1, seg + 15);
    for (let i = from; i < to; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const u = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
      const d = Math.hypot(x - a.x - u * dx, z - a.z - u * dz);
      if (d < best) {
        best = d;
        seg = i;
        at = along[i]! + u * Math.sqrt(len2);
      }
    }
    if (best > STAGE_CORRIDOR + 5) return 'bad-trace';
    if (k === 0 ? at > 60 : at - reached > MAX_PACE / TRACE_HZ + 20) return 'bad-trace';
    reached = Math.max(reached, at);
  }
  return reached >= finish - 60 ? 'ok' : 'bad-trace';
}
