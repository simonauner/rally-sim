import { Quaternion, Vector3 } from 'three';
import { Car, LAMP_BROKEN, type Input } from '../src/physics/car';
import { CARS, kvarn240, kvarn240Turbo, kvarnTurbo4x4 } from '../src/physics/params';
import { Drivetrain, splitDiff } from '../src/physics/drivetrain';
import { tierOf } from '../src/career/career';
import { Barriers } from '../src/physics/barriers';
import { rollWeather, type Weather } from '../src/physics/weather';
import { bestTyre, lightAt, surfaceShares, STAGE_CORRIDOR, START_S, Stage, STAGE_ASJON, STAGES } from '../src/physics/stage';
import { STAGE_LENGTHS } from '../src/physics/real/lengths';
import { STAGE_MYRKULLA, STAGE_SKOGSBERG } from './stages';
import { TYRE_GRIP, TYRE_NAMES, type SurfaceId, type TyreType } from '../src/physics/surfaces';
import { brakeAlongRoad, driveAlongRoad } from '../src/physics/autopilot';
import { GhostRecorder, sampleGhost } from '../src/physics/ghost';
import { generateNotes, NoteCaller, type PaceNote } from '../src/physics/pacenotes';
import { StageTimer } from '../src/physics/timing';
import { World } from '../src/physics/world';
import { carSpecs, FlatWorld } from '../src/physics/specs';
import { recordValid } from '../src/records';

const DT = 1 / 240;
let failures = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}

const idle: Input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

function run(car: Car, seconds: number, input: (t: number, car: Car) => Input, onStep?: (t: number) => void) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    car.step(DT, input(t, car));
    onStep?.(t);
    if (!Number.isFinite(car.pos.x + car.pos.y + car.pos.z + car.vel.length())) throw new Error(`NaN at t=${t.toFixed(3)}`);
  }
}

function makeCar(world: World, tyre: TyreType) {
  const p = kvarn240();
  p.tyre = tyre;
  const car = new Car(p, world);
  return car;
}

// 1. Standstill: correct load and weight distribution, no drift.
{
  const car = makeCar(new FlatWorld('asphalt'), 'tarmac');
  run(car, 4, () => idle);
  const fz = car.wheels.map((w) => w.fz);
  const total = fz.reduce((a, b) => a + b, 0);
  const front = (fz[0]! + fz[1]!) / total;
  check('rest: total load', Math.abs(total / (car.params.mass * 9.81) - 1) < 0.03, `${(total / 9.81).toFixed(0)} kg of ${car.params.mass}`);
  check('rest: front weight distribution', Math.abs(front - 0.55) < 0.02, `${(front * 100).toFixed(1)} %`);
  check('rest: still', car.speed < 0.05, `${car.speed.toFixed(4)} m/s`);
  check('rest: centre of mass height', Math.abs(car.pos.y - car.params.cgHeight + 0.02) < 0.12, `y=${car.pos.y.toFixed(3)} (suspension sinks a little)`);
}

// 2. Acceleration 0-100 km/h
for (const [surface, tyre, lo, hi] of [
  ['asphalt', 'tarmac', 6.5, 10.5],
  ['gravel', 'gravel', 8, 13],
  ['snow', 'gravel', 14, 40],
] as const) {
  const car = makeCar(new FlatWorld(surface), tyre);
  let t100 = NaN;
  run(car, 40, () => ({ ...idle, throttle: 1 }), (t) => {
    if (Number.isNaN(t100) && car.forwardSpeed >= 100 / 3.6) t100 = t;
  });
  check(`0-100 ${surface}/${tyre}`, t100 >= lo && t100 <= hi, `${Number.isNaN(t100) ? 'not reached' : t100.toFixed(2) + ' s'} (expected ${lo}-${hi}), top speed ${(car.forwardSpeed * 3.6).toFixed(0)} km/h, gear ${car.drivetrain.gear}`);
}

// 2b. Car specs in the car picker: reasonable values for a heavy 80s saloon.
{
  const t0 = performance.now();
  const s = carSpecs(kvarn240());
  const ms = performance.now() - t0;
  const hp = s.powerKw * 1.36;
  check('specs: power', hp > 90 && hp < 160, `${hp.toFixed(0)} hp at ${s.powerRpm} rpm, ${s.torqueNm} Nm at ${s.torqueRpm} rpm`);
  check('specs: 0-100 gravel', s.zeroTo100 > 8 && s.zeroTo100 < 13, `${s.zeroTo100.toFixed(1)} s`);
  check('specs: top speed', s.topSpeedKmh > 150 && s.topSpeedKmh < 200, `${s.topSpeedKmh.toFixed(0)} km/h`);
  check('specs: weight distribution', Math.abs(s.frontWeight - 0.55) < 0.01, `${(s.frontWeight * 100).toFixed(0)} % front`);
  check('specs: fast enough for the menu', ms < 400, `${ms.toFixed(0)} ms`);
}
// Every selectable car must be drivable: reaches 100 and has a reasonable top speed.
for (const m of CARS) {
  const p = m.make();
  const s = carSpecs(p);
  check(`specs: ${p.name}`, s.zeroTo100 < 15 && s.topSpeedKmh > 150 && s.topSpeedKmh < 240, `${(s.powerKw * 1.36).toFixed(0)} hp, 0-100 ${s.zeroTo100.toFixed(1)} s, ${s.topSpeedKmh.toFixed(0)} km/h`);
}

// Class 2 is a clear step up: 4–5 kg/hp and quicker to 100 than every class 1 car.
{
  const all = CARS.map((m) => ({ p: m.make(), tier: tierOf(m.make().name) }));
  const specs = all.map(({ p, tier }) => ({ name: p.name, tier, s: carSpecs(p), kgHp: p.mass / (carSpecs(p).powerKw * 1.36) }));
  const two = specs.filter((x) => x.tier === 2);
  const slowestTwo = Math.max(...two.map((x) => x.s.zeroTo100));
  const fastestOne = Math.min(...specs.filter((x) => x.tier === 1).map((x) => x.s.zeroTo100));
  check('class 2: step up', two.length === 7 && two.every((x) => x.kgHp > 4 && x.kgHp < 5) && slowestTwo < fastestOne - 1, two.map((x) => `${x.name} ${x.kgHp.toFixed(1)} kg/hp, ${x.s.zeroTo100.toFixed(1)} s`).join(' · '));
}

// Centre diff: the base split when the axles turn equally fast, and more torque to the rear when the front axle spins.
{
  const d = { lock: 0.5, preload: 100 };
  const [f0, r0] = splitDiff(1000, 50, 50, d, 0.4);
  const [f1, r1] = splitDiff(1000, 60, 50, d, 0.4);
  const [l, r] = splitDiff(800, 50, 50, d);
  check('centre diff', f0 === 400 && r0 === 600 && f1 < 400 && r1 > 600 && f1 + r1 === 1000 && l === 400 && r === 400, `equal ${f0}/${r0}, front axle spinning ${f1}/${r1}`);
  const awd = kvarnTurbo4x4();
  const s = carSpecs(awd);
  const fixed = carSpecs({ ...awd, centerDiff: undefined });
  check('four-wheel drive: quickest off the line', s.zeroTo100 < carSpecs(kvarn240Turbo()).zeroTo100 - 2 && Math.abs(s.zeroTo100 - fixed.zeroTo100) < 1, `0–100 ${s.zeroTo100.toFixed(1)} s (fixed split ${fixed.zeroTo100.toFixed(1)} s)`);
}

// 3. Braking distance 100 -> 0
for (const [surface, tyre, lo, hi] of [
  ['asphalt', 'tarmac', 34, 50],
  ['gravel', 'gravel', 48, 75],
] as const) {
  for (const abs of [true, false]) {
    const car = makeCar(new FlatWorld(surface), tyre);
    car.assists.abs = abs;
    car.reset(0, 0, 0, 100 / 3.6);
    const z0 = car.pos.z;
    let dist = 0;
    let stopped = false;
    run(car, 12, () => ({ ...idle, brake: stopped ? 0 : 1 }), () => {
      if (!stopped && car.forwardSpeed < 0.3) {
        stopped = true;
        dist = car.pos.z - z0;
      }
    });
    const ok = abs ? dist >= lo && dist <= hi : dist > 30 && dist < 110;
    check(`brake 100-0 ${surface} ABS ${abs ? 'on' : 'off'}`, ok, `${dist.toFixed(1)} m, remaining speed ${car.speed.toFixed(2)} m/s`);
  }
}

// 4. Lateral grip (g) in a circle: hold the throttle so the speed stays around 18 m/s, with full steering.
for (const [surface, tyre, lo, hi] of [
  ['asphalt', 'tarmac', 0.8, 1.25],
  ['gravel', 'gravel', 0.65, 1.0],
] as const) {
  const car = makeCar(new FlatWorld(surface), tyre);
  car.assists.steerAssist = 0;
  car.reset(0, 0, 0, 18);
  let peak = 0;
  run(car, 8, (t, c) => ({ ...idle, steer: t > 0.5 ? 1 : 0, throttle: c.speed < 18 ? 0.5 : 0 }), (t) => {
    if (t > 3) peak = Math.max(peak, Math.abs(car.gLat));
  });
  check(`lateral grip ${surface}`, peak >= lo && peak <= hi, `${peak.toFixed(2)} g (expected ${lo}-${hi})`);
}

// 5. Handbrake slide: the car must be able to rotate without becoming unstable.
{
  const car = makeCar(new FlatWorld('gravel'), 'gravel');
  car.reset(0, 0, 0, 22);
  car.assists.steerAssist = 0;
  let maxYawRate = 0;
  run(car, 4, (t) => ({ ...idle, steer: t < 0.6 ? 1 : -0.2, handbrake: t > 0.4 && t < 1.0 ? 1 : 0, throttle: 0.3 }), () => {
    maxYawRate = Math.max(maxYawRate, Math.abs(car.angVel.y));
  });
  check('handbrake: can rotate', maxYawRate > 0.8 && maxYawRate < 6, `max yaw rate ${maxYawRate.toFixed(2)} rad/s`);
}

// 5a. Short handbrake pull at speed off throttle in a rear-wheel-drive car: the clutch disengages, so the engine
// doesn't drag the speed down and the gearbox doesn't drop to first when the rear wheels lock.
{
  const speedAfter = (handbrake: number) => {
    const car = makeCar(new FlatWorld('gravel'), 'gravel');
    car.reset(0, 0, 0, 25);
    car.drivetrain.gear = 3;
    let gear = 3;
    run(car, 1.5, (t) => ({ ...idle, throttle: t < 0.5 ? 0 : 1, steer: t < 0.8 ? 0.35 : 0, handbrake: t < 0.5 ? handbrake : 0 }), () => {
      gear = Math.min(gear, car.drivetrain.gear);
    });
    return { kmh: car.speed * 3.6, gear };
  };
  const free = speedAfter(0);
  const hb = speedAfter(1);
  const loss = free.kmh - hb.kmh;
  check('handbrake: speed loss', loss < 13, `${loss.toFixed(1)} km/h vs. without handbrake (expected < 13)`);
  check('handbrake: no downshift to first', hb.gear >= 2, `lowest gear ${hb.gear}`);
}

// 5b. Full throttle in a gravel corner with assists on (as on a keyboard): the car must not spin.
for (const [v0, steer] of [[15, 0.6], [20, 0.5], [25, 0.4]] as const) {
  const car = makeCar(new FlatWorld('gravel'), 'gravel');
  car.reset(0, 0, 0, v0);
  let maxBeta = 0;
  run(car, 5, (t) => ({ ...idle, steer, throttle: t > 0.5 ? 1 : 0.3 }), () => {
    if (car.speed > 3) maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(car.lateralSpeed, car.forwardSpeed)));
  });
  const deg = (maxBeta * 180) / Math.PI;
  check(`full throttle in corner ${v0} m/s`, deg < 30, `max slip angle ${deg.toFixed(0)}° (expected < 30)`);
}

// 6. Test track: washboard, jump and landing without falling apart.
{
  const world = new World();
  const car = makeCar(world, 'gravel');
  car.reset(0, 100, 0, 22);
  let maxAir = 0;
  let air = 0;
  let maxSpeed = 0;
  run(car, 6, (_t, c) => ({ ...idle, throttle: c.forwardSpeed < 22 ? 0.6 : 0.1 }), () => {
    const inAir = car.wheels.every((w) => !w.contact);
    air = inAir ? air + DT : 0;
    maxAir = Math.max(maxAir, air);
    maxSpeed = Math.max(maxSpeed, car.speed);
  });
  check('washboard + jump', maxSpeed < 40 && car.pos.y < 6 && Math.abs(car.pos.x) < 20, `max speed ${maxSpeed.toFixed(1)} m/s, longest airtime ${maxAir.toFixed(2)} s, z=${car.pos.z.toFixed(0)}, y=${car.pos.y.toFixed(2)}`);
  check('jump: car is on its wheels afterwards', car.wheels.filter((w) => w.contact).length >= 3 || car.pos.z < 185, `contact ${car.wheels.filter((w) => w.contact).length}/4`);
}

// 7. Crash test against the concrete wall at z=260
{
  const world = new World();
  const car = makeCar(world, 'gravel');
  car.reset(0, 235, 0, 20);
  let maxJ = 0;
  let events = 0;
  run(car, 4, () => idle, () => {
    for (const e of car.damageEvents) {
      maxJ = Math.max(maxJ, e.impulse);
      events++;
    }
    car.damageEvents.length = 0;
  });
  check('crash: the wall stops the car', car.pos.z < 261 && car.speed < 3, `z=${car.pos.z.toFixed(2)} speed ${car.speed.toFixed(2)}`);
  check('crash: damage registered', car.damage.front > 0.1 && events > 3, `front damage ${car.damage.front.toFixed(2)}, ${events} contact events, largest ${maxJ.toFixed(0)} Ns`);
  check('crash: power reduced', car.drivetrain.powerFactor < 1, `power factor ${car.drivetrain.powerFactor.toFixed(2)}`);
}

// 8. Stage: geometry and surface per control point.
{
  const stage = new Stage(STAGE_SKOGSBERG);
  const pts = STAGE_SKOGSBERG.points;
  const onPoints = pts.slice(1, -1).every((p) => {
    const hit = stage.project(p.x, p.z);
    return hit.d < 0.5 && Math.abs(stage.heightAt(p.x, p.z) - p.y) < 0.3;
  });
  check('stage: road passes through the control points', onPoints, `length ${stage.length} m`);
  const seen = new Set(stage.surfaces);
  const wanted = new Set(pts.slice(0, -1).map((p) => p.surface));
  check('stage: surface per point', [...wanted].every((x) => seen.has(x)), [...seen].join(', '));
  const p = stage.poseAt(START_S);
  const lx = Math.cos(p.heading);
  const lz = -Math.sin(p.heading);
  const verge = stage.surfaceAt(p.x + lx * 6, p.z + lz * 6);
  check('stage: road edge is mud', verge === 'mud', verge);
}

// 8b. The barriers give way: the car loses a little speed, takes a small hit and the parts fly off.
{
  const stage = new Stage(STAGE_SKOGSBERG);
  const barriers = new Barriers(stage);
  const results = stage.barriers.map((r) => {
    barriers.reset();
    const car = makeCar(stage, 'gravel');
    const fx = Math.sin(r.yaw);
    const fz = Math.cos(r.yaw);
    car.reset(r.x - fx * 6, r.z - fz * 6, r.yaw, 15);
    let before = 0;
    let after = 0;
    run(car, 2, () => idle, (t) => {
      barriers.update(car, DT);
      const along = (car.pos.x - r.x) * fx + (car.pos.z - r.z) * fz;
      if (along < -4) before = car.forwardSpeed;
      if (t < 0.9) after = car.forwardSpeed;
    });
    const past = (car.pos.x - r.x) * fx + (car.pos.z - r.z) * fz > 2;
    const flown = barriers.parts.filter((p) => p.pos.distanceTo(p.home.pos) > 3).length;
    return { past, loss: 1 - after / before, flown, front: car.damage.front };
  });
  const ok = results.every((x) => x.past && x.loss > 0.01 && x.loss < 0.15 && x.flown >= 4 && x.front < 0.1);
  const r0 = results[0]!;
  check('stage: barriers give way', ok, `${results.filter((x) => x.past).length}/${results.length} through, speed loss ${(r0.loss * 100).toFixed(1)} %, ${r0.flown} parts flown, front damage ${(r0.front * 100).toFixed(0)} %`);
}

// 8c. The trees stay put: the car stops against the trunk and takes damage, even when the trunk hits
// between the collision points.
{
  const stage = new Stage(STAGE_SKOGSBERG);
  const results = [0, 0.4, -0.7].map((offset) => {
    const t = stage.trunks[0]!;
    // Drive at the trunk from the road, offset sideways.
    const hit = stage.project(t.x, t.z);
    const p = stage.poseAt(hit.s);
    const heading = Math.atan2(t.x - p.x, t.z - p.z);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const car = makeCar(stage, 'gravel');
    car.reset(t.x - fx * 8 - fz * offset, t.z - fz * 8 + fx * offset, heading, 15);
    run(car, 2, () => idle);
    const past = (car.pos.x - t.x) * fx + (car.pos.z - t.z) * fz;
    return { past, damage: car.damage.front };
  });
  const ok = results.every((x) => x.past < 0 && x.damage > 0.2);
  check('stage: trees do not give way', ok && stage.trunks.length > 1000, results.map((x) => `${x.past.toFixed(1)} m, front damage ${(x.damage * 100).toFixed(0)} %`).join(' · '));
}

// 9. Stage: a simple driver drives the whole way without ending up in the ditch.
{
  const stage = new Stage(STAGE_SKOGSBERG);
  const car = makeCar(stage, 'gravel');
  const p0 = stage.poseAt(START_S - 8);
  car.reset(p0.x, p0.z, p0.heading, 0);
  const finish = stage.finish;
  const timer = new StageTimer(START_S, finish);
  const recorder = new GhostRecorder();
  const caller = new NoteCaller(generateNotes(stage, START_S, finish));
  caller.seek(START_S - 8);
  const calls: [PaceNote, number][] = [];
  const checkpoints: [number, Vector3, Quaternion][] = [];
  let startT = NaN;
  let s = START_S - 8;
  let maxOver = 0;
  let time = NaN;
  run(car, 200, (_t, c) => {
    const hit = stage.project(c.pos.x, c.pos.z);
    if (!Number.isNaN(time)) return brakeAlongRoad(stage, c);
    s = hit.s;
    maxOver = Math.max(maxOver, hit.d - hit.width / 2);
    const look = stage.poseAt(s + 6 + c.speed * 0.6);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(c.quat);
    const err = Math.atan2(look.x - c.pos.x, look.z - c.pos.z) - Math.atan2(fwd.x, fwd.z);
    const a = stage.poseAt(s + 10).heading;
    const b = stage.poseAt(s + 40).heading;
    const target = Math.max(9, 24 - Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) * 18);
    return {
      ...idle,
      steer: Math.max(-1, Math.min(1, Math.atan2(Math.sin(err), Math.cos(err)) * 4)),
      throttle: c.forwardSpeed < target ? 1 : 0,
      brake: c.forwardSpeed > target + 2 ? 0.6 : 0,
    };
  }, (t) => {
    timer.update(stage.project(car.pos.x, car.pos.z).s, DT);
    for (const n of caller.update(stage.project(car.pos.x, car.pos.z).s, car.speed)) calls.push([n, stage.project(car.pos.x, car.pos.z).s]);
    if (Number.isNaN(startT) && timer.state === 'running') startT = t;
    if (timer.state === 'running') {
      recorder.record(timer.time, car.pos, car.quat);
      // Store the car's pose now and then, midway between two ghost frames, to compare with playback.
      if (Math.abs((timer.time % 7.025) - 7) < DT / 2) checkpoints.push([timer.time, car.pos.clone(), car.quat.clone()]);
    }
    if (Number.isNaN(time) && s >= finish) time = t;
  });
  check('stage: driver reaches the finish', time > 60 && time < 150, `${Number.isNaN(time) ? 'not reached' : time.toFixed(1) + ' s'}, got ${s.toFixed(0)} of ${finish.toFixed(0)} m`);
  check('stage: stays on the road', maxOver < 1, `at most ${maxOver.toFixed(2)} m past the edge`);
  const after = stage.project(car.pos.x, car.pos.z);
  check('after finish: car stops on the road', car.speed < 0.5 && after.d < after.width / 2 && after.s < stage.length - 5, `speed ${car.speed.toFixed(2)} m/s, ${(after.s - finish).toFixed(0)} m after the finish, ${after.d.toFixed(2)} m from the centre`);
  const expected = time - startT;
  check('timing: start to finish', timer.state === 'finished' && Math.abs(timer.time - expected) < 0.05, `${timer.time.toFixed(2)} s (driver ${expected.toFixed(2)} s), state ${timer.state}`);
  const ghost = recorder.data();
  const gp = new Vector3();
  const gq = new Quaternion();
  let worstPos = 0;
  let worstAng = 0;
  for (const [t, p, q] of checkpoints) {
    sampleGhost(ghost, t, gp, gq);
    worstPos = Math.max(worstPos, gp.distanceTo(p));
    worstAng = Math.max(worstAng, gq.angleTo(q));
  }
  const ended = !sampleGhost(ghost, timer.time + 1, gp, gq);
  const kb = JSON.stringify(ghost).length / 1024;
  check('ghost: follows the car', checkpoints.length > 8 && worstPos < 0.25 && worstAng < 0.02 && ended, `${checkpoints.length} points, max ${(worstPos * 100).toFixed(1)} cm / ${((worstAng * 180) / Math.PI).toFixed(2)}°, ends after the finish ${ended}`);
  const inOrder = calls.every(([n], i) => n === caller.notes[i]);
  const early = Math.min(...calls.map(([n, at]) => n.s - at));
  check('pacenotes: called once, in order, before the corner', calls.length === caller.notes.length && inOrder && early > 20, `${calls.length}/${caller.notes.length} notes, at least ${early.toFixed(0)} m ahead`);
  check('ghost: save size', kb < 200, `${kb.toFixed(0)} kB for ${timer.time.toFixed(0)} s`);
  check('timing: splits', timer.splits.length === 2 && timer.splits[0]! < timer.splits[1]! && timer.splits[1]! < timer.time, timer.splits.map((x) => x.toFixed(1)).join(', '));
}

// 10. Timing: a teleport across the line doesn't count, and after the finish the clock stops.
{
  const timer = new StageTimer(20, 1000);
  timer.update(0, DT);
  timer.update(500, DT);
  const teleportIgnored = timer.state === 'ready';
  timer.reset();
  for (let s = 10; s <= 1010; s += 0.1) timer.update(s, DT);
  const frozen = timer.time;
  timer.update(1011, DT);
  check('timing: teleport and finish', teleportIgnored && timer.state === 'finished' && timer.time === frozen, `teleport ignored ${teleportIgnored}, ${timer.state} ${frozen.toFixed(2)} s`);
}

// 11. Pace notes from the geometry.
{
  const stage = new Stage(STAGE_SKOGSBERG);
  const notes = generateNotes(stage, START_S, stage.finish);
  const corners = notes.filter((n) => n.kind === 'corner');
  const sorted = notes.every((n, i) => i === 0 || notes[i - 1]!.s <= n.s);
  // The tight corner onto the asphalt (control points 285,334 → 309,368) turns right.
  const tight = corners.find((n) => n.grade! <= 2 && n.dir === -1 && n.s < 700);
  check('pacenotes: corners and order', sorted && corners.length >= 8 && !!tight, `${corners.length} corners, tight: ${tight?.label ?? 'missing'}`);
  const surfaces = notes.filter((n) => n.kind === 'surface').map((n) => n.label.split(' · ')[0]);
  check('pacenotes: surface changes at junctions and the finish', surfaces.join(', ') === 'korsning asfalt, korsning grus, korsning lera, korsning grus' && notes[notes.length - 1]!.kind === 'finish', surfaces.join(', '));
  const english = notes.map((n) => n.speech.en).join(' | ');
  check('pacenotes: English when no Swedish voice is available', notes.every((n) => n.speech.sv && n.speech.en && !/undefined/.test(n.speech.sv + n.speech.en)) && /junction, tarmac/.test(english), notes[0]!.speech.en);
  const caller = new NoteCaller(notes);
  caller.seek(1000);
  const firstAfter = caller.update(1000, 50)[0];
  check('pacenotes: skips ahead on teleport', !!firstAfter && firstAfter.s > 1000, `first ${firstAfter?.s.toFixed(0)} m`);
  // A tight corner is called five seconds ahead, and the note before it comes along so the order holds.
  const note = (kind: PaceNote['kind'], at: number, grade?: number): PaceNote => ({ kind, s: at, end: at, speech: { sv: '', en: '' }, label: '', grade });
  const early = new NoteCaller([note('crest', 280), note('corner', 300, 2), note('corner', 400, 4)]).update(110, 40);
  check('pacenotes: tight corners are called early', early.map((n) => n.s).join() === '280,300', `at 110 m at 40 m/s: ${early.map((n) => n.s).join(', ')}`);
}

{
  const stage = { ...STAGE_SKOGSBERG, version: '2.3.1', recordsSince: '2.2.0' };
  const cases: [string | undefined, boolean][] = [[undefined, false], ['1.9.0', false], ['2.1.5', false], ['2.2.0', true], ['2.3.0', true], ['2.3.1', true], ['3.0.0', false]];
  const wrong = cases.filter(([v, want]) => recordValid(v, stage) !== want);
  check('records: stage version', wrong.length === 0, wrong.length ? `wrong for ${wrong.map(([v]) => v).join(', ')}` : `${cases.length} cases`);
}

// 13. Every stage: the road doesn't cross itself and a simple driver reaches the finish on the road.
// Reversed, the surface changes must mirror (within a few metres) the forward direction.
const surfaceChanges = (st: Stage) => st.surfaces.flatMap((x, i) => (i > 0 && x !== st.surfaces[i - 1] ? [[i, st.surfaces[i - 1]!, x] as const] : []));
for (const def of STAGES) {
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
}

// 14. Tyre advice: gravel tyres on the gravel stages, winter tyres on snow and tarmac tyres where it's mostly asphalt.
{
  const advice = STAGES.map((d) => `${d.name}: ${bestTyre(d)}`);
  const ok = STAGES.every((d) => bestTyre(d) === (d.winter ? 'snow' : (surfaceShares(d).asphalt ?? 0) > 0.7 ? 'tarmac' : 'gravel'));
  check('tyre advice per stage', ok, advice.join(', '));
}

// 15. Snowbanks: a car driving into the bank is slowed hard, takes a little damage and doesn't roll.
{
  const stage = new Stage(STAGE_ASJON);
  const results = [12, 22].map((v0) => {
    const car = makeCar(stage, 'snow');
    const p = stage.poseAt(START_S + 30);
    // 25° out towards the left road edge from the middle of the road.
    car.reset(p.x, p.z, p.heading + 0.44, v0);
    let maxSpeedOut = 0;
    let rolled = false;
    run(car, 2, () => idle, () => {
      if (new Vector3(0, 1, 0).applyQuaternion(car.quat).y < 0.3) rolled = true;
    });
    maxSpeedOut = car.speed;
    const dmg = Object.values(car.damage).reduce((a, b) => a + b, 0);
    const hit = stage.project(car.pos.x, car.pos.z);
    return { v0, out: maxSpeedOut, dmg, rolled, off: hit.d - hit.width / 2 };
  });
  const ok = results.every((r) => !r.rolled && r.out < r.v0 * 0.45 && r.off < 8) && results[1]!.dmg > 0.01 && results.every((r) => r.dmg < 0.25);
  check('snowbanks slow the car and damage it mildly', ok, results.map((r) => `${r.v0} m/s → ${r.out.toFixed(1)} m/s after 2 s, damage ${(r.dmg * 100).toFixed(0)} %, ${r.off.toFixed(1)} m off${r.rolled ? ', ROLLED' : ''}`).join(' · '));
}

// 16. Headlights: a light nudge from the front damages the lamp slightly, a hard hit on the left corner
// breaks the left one but not the right.
{
  const car = makeCar(new FlatWorld('gravel'), 'gravel');
  const nose = new Vector3(0.6, 0, car.params.body.halfZ);
  car.registerDamage(nose, car.params.mass * 14 * 0.03, 'object');
  const light = [...car.lamps];
  car.registerDamage(nose, car.params.mass * 14 * 0.2, 'object');
  const ok = light[0]! > 0 && light[0]! < LAMP_BROKEN && car.lamps[0]! >= LAMP_BROKEN && car.lamps[1]! < LAMP_BROKEN;
  check('headlights break', ok, `nudge ${light.map((l) => l.toFixed(2)).join('/')}, hit ${car.lamps.map((l) => l.toFixed(2)).join('/')}`);
  car.reset(0, 0, 0, 0);
  check('headlights are repaired on restart', car.lamps.every((l) => l === 0), car.lamps.join('/'));
}

// 16a. Kickdown: flooring the throttle at low rpm shifts down, but not while the throttle has been held floored since the upshift.
{
  const p = kvarn240();
  const d = new Drivetrain(p.engine, p.gearbox);
  d.gear = 4;
  d.rpm = 2700;
  const omega = (2700 / d.totalRatio(4)) * (2 * Math.PI / 60);
  d.update(DT, 0.3, omega, 0.3);
  const held = d.gear;
  d.update(DT, 1, omega, 1);
  const kicked = d.gear;
  d.kickdownArmed = false;
  d.gear = 4;
  d.shiftTimer = 0;
  d.update(DT, 1, omega, 1);
  check('kickdown', held === 4 && kicked === 3 && d.gear === 4, `part throttle ${held}, floored ${kicked}, without lift ${d.gear}`);
}

// 16b. Turbo: boost builds after applying throttle, drops when lifting, and anti-lag holds it.
{
  const p = kvarnTurbo4x4();
  const torqueAfter = (antilag: number, offFor: number) => {
    const d = new Drivetrain({ ...p.engine, turbo: { ...p.engine.turbo!, antilag } }, p.gearbox);
    d.autoShift = false;
    d.gear = 3;
    const omega = (4500 / d.totalRatio(3)) * (2 * Math.PI / 60);
    for (let t = 0; t < 3; t += DT) d.update(DT, 1, omega, 1);
    for (let t = 0; t < offFor; t += DT) d.update(DT, 0, omega, 0);
    const first = d.update(DT, 1, omega, 1);
    for (let t = 0; t < 0.1; t += DT) d.update(DT, 1, omega, 1);
    return { first, full: (() => { for (let t = 0; t < 3; t += DT) d.update(DT, 1, omega, 1); return d.update(DT, 1, omega, 1); })() };
  };
  const plain = torqueAfter(0, 1);
  const al = torqueAfter(0.8, 1);
  check('turbo: turbo lag after lift', plain.first < plain.full * 0.7 && al.first > plain.first * 1.25 && Math.abs(al.full - plain.full) < plain.full * 0.01, `${Math.round(plain.first)} → ${Math.round(plain.full)} Nm, antilag ${Math.round(al.first)} Nm`);
}

// 17. Main menu autopilot: every car drives through Myrkulla's gravel corner (s ≈ 1750) without leaving the road.
{
  const stage = new Stage(STAGE_MYRKULLA);
  const runs = CARS.map((m) => {
    const car = new Car(m.make(), stage);
    const p = stage.poseAt(1600);
    car.reset(p.x, p.z, p.heading, 20);
    let off = 0;
    let t = 0;
    for (; t < 40 && stage.project(car.pos.x, car.pos.z).s < 1970; t += 1 / 240) {
      car.step(1 / 240, driveAlongRoad(stage, car));
      const h = stage.project(car.pos.x, car.pos.z);
      off = Math.max(off, h.d - h.width / 2);
    }
    return { t, off };
  });
  check('menu autopilot stays on the road', runs.every((r) => r.t < 40 && r.off < 1), runs.map((r) => `${r.t.toFixed(1)} s, ${r.off.toFixed(1)} m off`).join(' · '));
}

// 17. Weather: rain clearly lengthens the braking distance on asphalt, fog changes nothing, and about three
// in four stages are dry. Snowfall only on winter stages, rain only on the others.
{
  const brakeDist = (weather: Weather) => {
    const world = new FlatWorld('asphalt');
    world.weather = weather;
    const car = makeCar(world, 'tarmac');
    car.reset(0, 0, 0, 100 / 3.6);
    let dist = 0;
    let stopped = false;
    run(car, 12, () => ({ ...idle, brake: stopped ? 0 : 1 }), () => {
      if (!stopped && car.forwardSpeed < 0.3) {
        stopped = true;
        dist = car.pos.z;
      }
    });
    return dist;
  };
  const dry = brakeDist('clear');
  const wet = brakeDist('rain');
  const foggy = brakeDist('fog');
  check('weather: rain gives a longer braking distance', wet > dry * 1.2 && Math.abs(foggy - dry) < 0.01, `dry ${dry.toFixed(1)} m, rain ${wet.toFixed(1)} m, fog ${foggy.toFixed(1)} m`);
  const rolls = (def: (typeof STAGES)[number]) => Array.from({ length: 1000 }, (_, i) => rollWeather(def, (i + 0.5) / 1000));
  const summer = rolls(STAGE_SKOGSBERG);
  const winter = rolls(STAGE_ASJON);
  const share = (list: Weather[], w: Weather) => list.filter((x) => x === w).length / list.length;
  const ok = share(summer, 'clear') > 0.7 && share(summer, 'clear') < 0.85 && share(summer, 'snowfall') === 0 && share(winter, 'rain') === 0 && share(winter, 'snowfall') > 0.05;
  check('weather: usually dry', ok, `summer: dry ${(share(summer, 'clear') * 100).toFixed(0)} %, rain ${(share(summer, 'rain') * 100).toFixed(0)} %, fog ${(share(summer, 'fog') * 100).toFixed(0)} % · winter: snowfall ${(share(winter, 'snowfall') * 100).toFixed(0)} %`);
}

{
  // Must hold in both UTC and Swedish time.
  const at = (iso: string) => lightAt(new Date(iso));
  const got = [at('2026-11-27T01:27Z'), at('2026-06-21T11:00Z'), at('2026-11-27T14:30Z'), at('2026-11-27T07:50Z')];
  check('light: follows the clock and the season', got.join() === 'night,day,dusk,dawn', got.join());
}

if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll physics tests passed');
