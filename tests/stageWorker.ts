/**
 * Test 13 for some of the stages, run in a worker thread so the stages are checked in parallel (the driver on
 * every stage is most of the physics tests' time). Posts the checks back to tests/physics.test.ts in stage order.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { Vector3 } from 'three';
import { brakeAlongRoad } from '../src/physics/autopilot';
import { STAGE_LENGTHS } from '../src/physics/real/lengths';
import { bestTyre, STAGE_CORRIDOR, START_S, Stage, STAGES, type StageDef } from '../src/physics/stage';
import { TYRE_GRIP, TYRE_NAMES, type SurfaceId } from '../src/physics/surfaces';
import { idle, makeCar, run } from './sim';

export interface StageCheck {
  name: string;
  ok: boolean;
  detail: string;
}

// Every stage: the road doesn't cross itself and a simple driver reaches the finish on the road.
// Reversed, the surface changes must mirror (within a few metres) the forward direction.
const surfaceChanges = (st: Stage) => st.surfaces.flatMap((x, i) => (i > 0 && x !== st.surfaces[i - 1] ? [[i, st.surfaces[i - 1]!, x] as const] : []));

function checkStage(def: StageDef): StageCheck[] {
  const out: StageCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail });
  const stage = new Stage(def);
  let minSep = Infinity;
  for (let i = 0; i < stage.xs.length; i += 2)
    for (let j = i + 150; j < stage.xs.length; j += 2)
      minSep = Math.min(minSep, Math.hypot(stage.xs[i]! - stage.xs[j]!, stage.zs[i]! - stage.zs[j]!));
  // Real roads can bend tighter than two corridors, as in a hairpin; the terrain is then blended
  // between the road sections. The roads just must not meet.
  const length = Math.round(stage.finish - START_S);
  check(`${def.name}: precomputed length`, STAGE_LENGTHS[def.name] === length, `'${def.name}': ${length} in real/lengths.ts, which has ${STAGE_LENGTHS[def.name]}`);
  check(`${def.name}: road doesn't cross itself`, minSep > STAGE_CORRIDOR, `${stage.length} m long, minimum separation ${minSep.toFixed(0)} m`);
  // The terrain is continuous: no ridges in the corridor, not even on the inside of tight corners and
  // hairpins or at crossing roads. The banks on winter roads give up to about 0.8 m per 2 m.
  let step = 0;
  for (let i = 0; i < stage.xs.length; i += 100)
    for (let a = -40; a <= 40; a += 4)
      for (let b = -40; b <= 40; b += 4) {
        const x = stage.xs[i]! + a;
        const z = stage.zs[i]! + b;
        if (stage.project(x, z, STAGE_CORRIDOR).d > STAGE_CORRIDOR - 2) continue;
        const h = stage.heightAt(x, z);
        step = Math.max(step, Math.abs(stage.heightAt(x + 2, z) - h), Math.abs(stage.heightAt(x, z + 2) - h));
      }
  check(`${def.name}: terrain has no ridges`, step < 1.5, `largest height step ${step.toFixed(2)} m over 2 m`);
  const sideRoads = (def.spurs ?? []).every((sp) => {
    const [a, b] = sp.points as [{ x: number; z: number }, { x: number; z: number }];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    return stage.surfaceAt(mx, mz) === sp.surface && stage.project(mx, mz).d > sp.width;
  });
  check(`${def.name}: crossing roads have their own surface`, sideRoads, `${def.spurs?.length ?? 0} roads`);

  const fwdDef = STAGES.find((x) => def.name === `${x.name} baklänges`);
  if (fwdDef) {
    const fwd = new Stage(fwdDef);
    const back = surfaceChanges(stage);
    const ahead = surfaceChanges(fwd).reverse();
    const mirrored = back.length === ahead.length && back.every(([i, from, to], k) => Math.abs(i - (fwd.length - ahead[k]![0])) < 4 && from === ahead[k]![2] && to === ahead[k]![1]);
    check(`${def.name}: surface mirrored`, mirrored, back.map(([i, , to]) => `${to}@${i}`).join(' '));
  }

  const tyre = bestTyre(def);
  const car = makeCar(stage, tyre);
  // Lower speed where grip is worse, like a driver adapting to the surface.
  const gripK = (surf: SurfaceId) => Math.sqrt(TYRE_GRIP[tyre][surf] / TYRE_GRIP.gravel.gravel);
  const p0 = stage.poseAt(START_S - 8);
  car.reset(p0.x, p0.z, p0.heading, 0);
  const finish = stage.finish;
  let maxOver = 0;
  let time = NaN;
  // The test driver averages at least 10 m/s, so the stage length gives an upper bound on the time.
  const maxTime = Math.max(200, finish / 10);
  run(car, maxTime + 50, (t, c) => {
    const hit = stage.project(c.pos.x, c.pos.z);
    if (Number.isNaN(time) && hit.s >= finish) time = t;
    if (!Number.isNaN(time)) return brakeAlongRoad(stage, c);
    maxOver = Math.max(maxOver, hit.d - hit.width / 2);
    const look = stage.poseAt(hit.s + 6 + c.speed * 0.6);
    const f = new Vector3(0, 0, 1).applyQuaternion(c.quat);
    const err = Math.atan2(look.x - c.pos.x, look.z - c.pos.z) - Math.atan2(f.x, f.z);
    const turnAt = (at: number) => {
      const a = stage.poseAt(at).heading;
      const b = stage.poseAt(at + 30).heading;
      return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    };
    const turn = turnAt(hit.s + 10);
    // Hairpins (over about 90° in 30 m) are taken at a crawl, otherwise never below 8 m/s. Before a hairpin
    // the driver brakes in time, up to 80 m ahead (about 3 m/s²); other corners it sees 10–40 m ahead.
    let hairpin = Infinity;
    for (let d = 10; d <= 80; d += 10) if (turnAt(hit.s + 10 + d) > 1.5) hairpin = Math.min(hairpin, Math.sqrt(25 + 6 * d));
    const target = Math.min(hairpin, Math.max(turn > 1.5 ? 5 : 8, 24 - turn * 18)) * gripK(hit.surface);
    return {
      ...idle,
      steer: Math.max(-1, Math.min(1, Math.atan2(Math.sin(err), Math.cos(err)) * 4)),
      throttle: c.forwardSpeed < target ? 1 : 0,
      brake: c.forwardSpeed > target + 2 ? 0.6 : 0,
    };
  });
  check(`${def.name}: driver reaches the finish on the road`, time > 60 && time < maxTime && maxOver < 1, `${TYRE_NAMES[tyre]}, ${Number.isNaN(time) ? 'not reached' : time.toFixed(1) + ' s'}, at most ${maxOver.toFixed(2)} m past the edge`);
  return out;
}

const names: string[] = workerData;
parentPort!.postMessage(names.map((n) => checkStage(STAGES.find((d) => d.name === n)!)));
