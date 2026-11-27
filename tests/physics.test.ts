import { Quaternion, Vector3 } from 'three';
import { Car, LAMP_BROKEN, type Input } from '../src/physics/car';
import { CARS, kvarn240, kvarn240Turbo, kvarnTurbo4x4 } from '../src/physics/params';
import { splitDiff } from '../src/physics/drivetrain';
import { tierOf } from '../src/career/career';
import { Barriers } from '../src/physics/barriers';
import { rollWeather, type Weather } from '../src/physics/weather';
import { bestTyre, lightAt, surfaceShares, STAGE_CORRIDOR, START_S, Stage, STAGE_FROSTBERGA, STAGE_MYRKULLA, STAGE_SKOGSBERG, STAGES } from '../src/physics/stage';
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
    if (!Number.isFinite(car.pos.x + car.pos.y + car.pos.z + car.vel.length())) throw new Error(`NaN vid t=${t.toFixed(3)}`);
  }
}

function makeCar(world: World, tyre: TyreType) {
  const p = kvarn240();
  p.tyre = tyre;
  const car = new Car(p, world);
  return car;
}

// 1. Stillastående: rätt last och viktfördelning, ingen drift.
{
  const car = makeCar(new FlatWorld('asphalt'), 'tarmac');
  run(car, 4, () => idle);
  const fz = car.wheels.map((w) => w.fz);
  const total = fz.reduce((a, b) => a + b, 0);
  const front = (fz[0]! + fz[1]!) / total;
  check('vila: total last', Math.abs(total / (car.params.mass * 9.81) - 1) < 0.03, `${(total / 9.81).toFixed(0)} kg av ${car.params.mass}`);
  check('vila: viktfördelning fram', Math.abs(front - 0.55) < 0.02, `${(front * 100).toFixed(1)} %`);
  check('vila: stilla', car.speed < 0.05, `${car.speed.toFixed(4)} m/s`);
  check('vila: tyngdpunktshöjd', Math.abs(car.pos.y - car.params.cgHeight + 0.02) < 0.12, `y=${car.pos.y.toFixed(3)} (fjädring sjunker lite)`);
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
  check(`0-100 ${surface}/${tyre}`, t100 >= lo && t100 <= hi, `${Number.isNaN(t100) ? 'nådde inte' : t100.toFixed(2) + ' s'} (förväntat ${lo}-${hi}), toppfart ${(car.forwardSpeed * 3.6).toFixed(0)} km/h, växel ${car.drivetrain.gear}`);
}

// 2b. Bildata i bilväljaren: rimliga värden för en tung 80-talssedan.
{
  const t0 = performance.now();
  const s = carSpecs(kvarn240());
  const ms = performance.now() - t0;
  const hp = s.powerKw * 1.36;
  check('data: effekt', hp > 90 && hp < 160, `${hp.toFixed(0)} hk vid ${s.powerRpm} rpm, ${s.torqueNm} Nm vid ${s.torqueRpm} rpm`);
  check('data: 0-100 grus', s.zeroTo100 > 8 && s.zeroTo100 < 13, `${s.zeroTo100.toFixed(1)} s`);
  check('data: toppfart', s.topSpeedKmh > 150 && s.topSpeedKmh < 200, `${s.topSpeedKmh.toFixed(0)} km/h`);
  check('data: viktfördelning', Math.abs(s.frontWeight - 0.55) < 0.01, `${(s.frontWeight * 100).toFixed(0)} % fram`);
  check('data: snabb nog för menyn', ms < 400, `${ms.toFixed(0)} ms`);
}
// Alla valbara bilar ska gå att köra: når 100 och har rimlig toppfart.
for (const m of CARS) {
  const p = m.make();
  const s = carSpecs(p);
  check(`data: ${p.name}`, s.zeroTo100 < 15 && s.topSpeedKmh > 150 && s.topSpeedKmh < 240, `${(s.powerKw * 1.36).toFixed(0)} hk, 0-100 ${s.zeroTo100.toFixed(1)} s, ${s.topSpeedKmh.toFixed(0)} km/h`);
}

// Klass 2 är ett tydligt steg upp: 4–5 kg/hk och snabbare till 100 än alla klass 1-bilar.
{
  const all = CARS.map((m) => ({ p: m.make(), tier: tierOf(m.make().name) }));
  const specs = all.map(({ p, tier }) => ({ name: p.name, tier, s: carSpecs(p), kgHp: p.mass / (carSpecs(p).powerKw * 1.36) }));
  const two = specs.filter((x) => x.tier === 2);
  const slowestTwo = Math.max(...two.map((x) => x.s.zeroTo100));
  const fastestOne = Math.min(...specs.filter((x) => x.tier === 1).map((x) => x.s.zeroTo100));
  check('klass 2: steg upp', two.length === 3 && two.every((x) => x.kgHp > 4 && x.kgHp < 5) && slowestTwo < fastestOne - 1, two.map((x) => `${x.name} ${x.kgHp.toFixed(1)} kg/hk, ${x.s.zeroTo100.toFixed(1)} s`).join(' · '));
}

// Mittdiffen: grundfördelningen när axlarna går lika fort, och mer moment bak när framaxeln spinner.
{
  const d = { lock: 0.5, preload: 100 };
  const [f0, r0] = splitDiff(1000, 50, 50, d, 0.4);
  const [f1, r1] = splitDiff(1000, 60, 50, d, 0.4);
  const [l, r] = splitDiff(800, 50, 50, d);
  check('mittdiff', f0 === 400 && r0 === 600 && f1 < 400 && r1 > 600 && f1 + r1 === 1000 && l === 400 && r === 400, `lika ${f0}/${r0}, framaxeln spinner ${f1}/${r1}`);
  const awd = kvarnTurbo4x4();
  const s = carSpecs(awd);
  const fixed = carSpecs({ ...awd, centerDiff: undefined });
  check('fyrhjulsdrift: snabbast från start', s.zeroTo100 < carSpecs(kvarn240Turbo()).zeroTo100 - 2 && Math.abs(s.zeroTo100 - fixed.zeroTo100) < 1, `0–100 ${s.zeroTo100.toFixed(1)} s (fast fördelning ${fixed.zeroTo100.toFixed(1)} s)`);
}

// 3. Bromssträcka 100 -> 0
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
    check(`broms 100-0 ${surface} ABS ${abs ? 'på' : 'av'}`, ok, `${dist.toFixed(1)} m, kvarvarande fart ${car.speed.toFixed(2)} m/s`);
  }
}

// 4. Sidgrepp (g) i en cirkel: håll gasen så farten ligger kring 18 m/s och full styrning.
for (const [surface, tyre, lo, hi] of [
  ['asphalt', 'tarmac', 0.85, 1.25],
  ['gravel', 'gravel', 0.65, 1.0],
] as const) {
  const car = makeCar(new FlatWorld(surface), tyre);
  car.assists.steerAssist = 0;
  car.reset(0, 0, 0, 18);
  let peak = 0;
  run(car, 8, (t, c) => ({ ...idle, steer: t > 0.5 ? 1 : 0, throttle: c.speed < 18 ? 0.5 : 0 }), (t) => {
    if (t > 3) peak = Math.max(peak, Math.abs(car.gLat));
  });
  check(`sidgrepp ${surface}`, peak >= lo && peak <= hi, `${peak.toFixed(2)} g (förväntat ${lo}-${hi})`);
}

// 5. Handbroms-sladd: bilen ska kunna rotera utan att bli instabil.
{
  const car = makeCar(new FlatWorld('gravel'), 'gravel');
  car.reset(0, 0, 0, 22);
  car.assists.steerAssist = 0;
  let maxYawRate = 0;
  run(car, 4, (t) => ({ ...idle, steer: t < 0.6 ? 1 : -0.2, handbrake: t > 0.4 && t < 1.0 ? 1 : 0, throttle: 0.3 }), () => {
    maxYawRate = Math.max(maxYawRate, Math.abs(car.angVel.y));
  });
  check('handbroms: kan rotera', maxYawRate > 0.8 && maxYawRate < 6, `maxgirhastighet ${maxYawRate.toFixed(2)} rad/s`);
}

// 5b. Fullgas i kurva på grus med hjälpmedel på (som på tangentbord): bilen ska inte snurra.
for (const [v0, steer] of [[15, 0.6], [20, 0.5], [25, 0.4]] as const) {
  const car = makeCar(new FlatWorld('gravel'), 'gravel');
  car.reset(0, 0, 0, v0);
  let maxBeta = 0;
  run(car, 5, (t) => ({ ...idle, steer, throttle: t > 0.5 ? 1 : 0.3 }), () => {
    if (car.speed > 3) maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(car.lateralSpeed, car.forwardSpeed)));
  });
  const deg = (maxBeta * 180) / Math.PI;
  check(`fullgas i kurva ${v0} m/s`, deg < 30, `max sladdvinkel ${deg.toFixed(0)}° (förväntat < 30)`);
}

// 6. Testbanan: tvättbräda, hopp och landning utan sönderfall.
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
  check('tvättbräda + hopp', maxSpeed < 40 && car.pos.y < 6 && Math.abs(car.pos.x) < 20, `max fart ${maxSpeed.toFixed(1)} m/s, längsta flygtid ${maxAir.toFixed(2)} s, z=${car.pos.z.toFixed(0)}, y=${car.pos.y.toFixed(2)}`);
  check('hopp: bilen står på hjul efteråt', car.wheels.filter((w) => w.contact).length >= 3 || car.pos.z < 185, `kontakt ${car.wheels.filter((w) => w.contact).length}/4`);
}

// 7. Krocktest mot betongväggen vid z=260
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
  check('krasch: bilen stoppas av väggen', car.pos.z < 261 && car.speed < 3, `z=${car.pos.z.toFixed(2)} fart ${car.speed.toFixed(2)}`);
  check('krasch: skada registrerad', car.damage.front > 0.1 && events > 3, `framskada ${car.damage.front.toFixed(2)}, ${events} kontakthändelser, störst ${maxJ.toFixed(0)} Ns`);
  check('krasch: effekt minskad', car.drivetrain.powerFactor < 1, `effektfaktor ${car.drivetrain.powerFactor.toFixed(2)}`);
}

// 8. Etapp: geometri och underlag per stödpunkt.
{
  const stage = new Stage(STAGE_SKOGSBERG);
  const pts = STAGE_SKOGSBERG.points;
  const onPoints = pts.slice(1, -1).every((p) => {
    const hit = stage.project(p.x, p.z);
    return hit.d < 0.5 && Math.abs(stage.heightAt(p.x, p.z) - p.y) < 0.3;
  });
  check('etapp: vägen går genom stödpunkterna', onPoints, `längd ${stage.length} m`);
  const seen = new Set(stage.surfaces);
  const wanted = new Set(pts.slice(0, -1).map((p) => p.surface));
  check('etapp: underlag per punkt', [...wanted].every((x) => seen.has(x)), [...seen].join(', '));
  const p = stage.poseAt(START_S);
  const lx = Math.cos(p.heading);
  const lz = -Math.sin(p.heading);
  const verge = stage.surfaceAt(p.x + lx * 6, p.z + lz * 6);
  check('etapp: vägkant är lera', verge === 'mud', verge);
}

// 8b. Avspärrningarna ger efter: bilen tappar lite fart, tar en liten smäll och delarna flyger iväg.
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
  check('etapp: avspärrningar ger efter', ok, `${results.filter((x) => x.past).length}/${results.length} genom, fartförlust ${(r0.loss * 100).toFixed(1)} %, ${r0.flown} delar iväg, framskada ${(r0.front * 100).toFixed(0)} %`);
}

// 8c. Träden står kvar: bilen stannar mot stammen och tar skada, även när stammen träffar
// mellan kollisionspunkterna.
{
  const stage = new Stage(STAGE_SKOGSBERG);
  const results = [0, 0.4, -0.7].map((offset) => {
    const t = stage.trunks[0]!;
    // Kör mot stammen från vägen, förskjuten i sidled.
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
  check('etapp: träd ger inte vika', ok && stage.trunks.length > 1000, results.map((x) => `${x.past.toFixed(1)} m, framskada ${(x.damage * 100).toFixed(0)} %`).join(' · '));
}

// 9. Etapp: en enkel förare kör hela vägen utan att hamna i diket.
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
      // Spara bilens läge ibland, mitt mellan två ghostbilder, för att jämföra med uppspelningen.
      if (Math.abs((timer.time % 7.025) - 7) < DT / 2) checkpoints.push([timer.time, car.pos.clone(), car.quat.clone()]);
    }
    if (Number.isNaN(time) && s >= finish) time = t;
  });
  check('etapp: förare når målet', time > 60 && time < 150, `${Number.isNaN(time) ? 'nådde inte' : time.toFixed(1) + ' s'}, kom ${s.toFixed(0)} av ${finish.toFixed(0)} m`);
  check('etapp: håller sig på vägen', maxOver < 1, `som mest ${maxOver.toFixed(2)} m utanför kanten`);
  const after = stage.project(car.pos.x, car.pos.z);
  check('efter mål: bilen stannar på vägen', car.speed < 0.5 && after.d < after.width / 2 && after.s < stage.length - 5, `fart ${car.speed.toFixed(2)} m/s, ${(after.s - finish).toFixed(0)} m efter mål, ${after.d.toFixed(2)} m från mitten`);
  const expected = time - startT;
  check('tidtagning: start till mål', timer.state === 'finished' && Math.abs(timer.time - expected) < 0.05, `${timer.time.toFixed(2)} s (förare ${expected.toFixed(2)} s), tillstånd ${timer.state}`);
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
  check('ghost: följer bilen', checkpoints.length > 8 && worstPos < 0.25 && worstAng < 0.02 && ended, `${checkpoints.length} punkter, max ${(worstPos * 100).toFixed(1)} cm / ${((worstAng * 180) / Math.PI).toFixed(2)}°, slut efter målet ${ended}`);
  const inOrder = calls.every(([n], i) => n === caller.notes[i]);
  const early = Math.min(...calls.map(([n, at]) => n.s - at));
  check('pacenotes: läses upp en gång i ordning, före kurvan', calls.length === caller.notes.length && inOrder && early > 20, `${calls.length}/${caller.notes.length} noter, minst ${early.toFixed(0)} m i förväg`);
  check('ghost: sparstorlek', kb < 200, `${kb.toFixed(0)} kB för ${timer.time.toFixed(0)} s`);
  check('tidtagning: mellantider', timer.splits.length === 2 && timer.splits[0]! < timer.splits[1]! && timer.splits[1]! < timer.time, timer.splits.map((x) => x.toFixed(1)).join(', '));
}

// 10. Tidtagning: teleport över linjen räknas inte, och efter mål står klockan still.
{
  const timer = new StageTimer(20, 1000);
  timer.update(0, DT);
  timer.update(500, DT);
  const teleportIgnored = timer.state === 'ready';
  timer.reset();
  for (let s = 10; s <= 1010; s += 0.1) timer.update(s, DT);
  const frozen = timer.time;
  timer.update(1011, DT);
  check('tidtagning: teleport och mål', teleportIgnored && timer.state === 'finished' && timer.time === frozen, `teleport ignorerad ${teleportIgnored}, ${timer.state} ${frozen.toFixed(2)} s`);
}

// 11. Pacenotes ur geometrin.
{
  const stage = new Stage(STAGE_SKOGSBERG);
  const notes = generateNotes(stage, START_S, stage.finish);
  const corners = notes.filter((n) => n.kind === 'corner');
  const sorted = notes.every((n, i) => i === 0 || notes[i - 1]!.s <= n.s);
  // Den snäva kurvan in mot asfalten (stödpunkterna 285,334 → 309,368) svänger höger.
  const tight = corners.find((n) => n.grade! <= 2 && n.dir === -1 && n.s < 700);
  check('pacenotes: kurvor och ordning', sorted && corners.length >= 8 && !!tight, `${corners.length} kurvor, snäv: ${tight?.label ?? 'saknas'}`);
  const surfaces = notes.filter((n) => n.kind === 'surface').map((n) => n.label.split(' · ')[0]);
  check('pacenotes: underlagsbyten i korsningar och mål', surfaces.join(', ') === 'korsning asfalt, korsning grus, korsning lera, korsning grus' && notes[notes.length - 1]!.kind === 'finish', surfaces.join(', '));
  const english = notes.map((n) => n.speech.en).join(' | ');
  check('pacenotes: engelska när svensk röst saknas', notes.every((n) => n.speech.sv && n.speech.en && !/undefined/.test(n.speech.sv + n.speech.en)) && /junction, tarmac/.test(english), notes[0]!.speech.en);
  const caller = new NoteCaller(notes);
  caller.seek(1000);
  const firstAfter = caller.update(1000, 50)[0];
  check('pacenotes: hoppar fram vid teleport', !!firstAfter && firstAfter.s > 1000, `första ${firstAfter?.s.toFixed(0)} m`);
}

{
  const stage = { ...STAGE_SKOGSBERG, version: '2.3.1', recordsSince: '2.2.0' };
  const cases: [string | undefined, boolean][] = [[undefined, false], ['1.9.0', false], ['2.1.5', false], ['2.2.0', true], ['2.3.0', true], ['2.3.1', true], ['3.0.0', false]];
  const wrong = cases.filter(([v, want]) => recordValid(v, stage) !== want);
  check('rekord: banversion', wrong.length === 0, wrong.length ? `fel för ${wrong.map(([v]) => v).join(', ')}` : `${cases.length} fall`);
}

// 13. Varje etapp: vägen korsar inte sig själv och en enkel förare når målet på vägen.
// Baklänges ska underlaget byta speglat (inom några meter) mot framlänges.
const surfaceChanges = (st: Stage) => st.surfaces.flatMap((x, i) => (i > 0 && x !== st.surfaces[i - 1] ? [[i, st.surfaces[i - 1]!, x] as const] : []));
for (const def of STAGES) {
  const stage = new Stage(def);
  let minSep = Infinity;
  for (let i = 0; i < stage.xs.length; i += 2)
    for (let j = i + 150; j < stage.xs.length; j += 2)
      minSep = Math.min(minSep, Math.hypot(stage.xs[i]! - stage.xs[j]!, stage.zs[i]! - stage.zs[j]!));
  // Verkliga vägar kan svänga tätare än två korridorer, som i en hårnål; terrängen blandas då
  // mellan vägdelarna. Vägarna får bara inte mötas.
  check(`${def.name}: vägen korsar inte sig själv`, minSep > STAGE_CORRIDOR, `${stage.length} m lång, minsta avstånd ${minSep.toFixed(0)} m`);
  // Terrängen hänger ihop: inga kanter i korridoren, inte heller på insidan av snäva kurvor och
  // hårnålar eller vid korsande vägar. Vallarna vid vintervägar ger upp till ca 0,8 m per 2 m.
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
  check(`${def.name}: terrängen saknar kanter`, step < 1.5, `största höjdsteg ${step.toFixed(2)} m på 2 m`);
  const sideRoads = (def.spurs ?? []).every((sp) => {
    const [a, b] = sp.points as [{ x: number; z: number }, { x: number; z: number }];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    return stage.surfaceAt(mx, mz) === sp.surface && stage.project(mx, mz).d > sp.width;
  });
  check(`${def.name}: korsande vägar har eget underlag`, sideRoads, `${def.spurs?.length ?? 0} vägar`);

  const fwdDef = STAGES.find((x) => def.name === `${x.name} baklänges`);
  if (fwdDef) {
    const fwd = new Stage(fwdDef);
    const back = surfaceChanges(stage);
    const ahead = surfaceChanges(fwd).reverse();
    const mirrored = back.length === ahead.length && back.every(([i, from, to], k) => Math.abs(i - (fwd.length - ahead[k]![0])) < 4 && from === ahead[k]![2] && to === ahead[k]![1]);
    check(`${def.name}: underlaget speglat`, mirrored, back.map(([i, , to]) => `${to}@${i}`).join(' '));
  }

  const tyre = bestTyre(def);
  const car = makeCar(stage, tyre);
  // Lägre fart där greppet är sämre, som en förare som anpassar sig efter underlaget.
  const gripK = (surf: SurfaceId) => Math.sqrt(TYRE_GRIP[tyre][surf] / TYRE_GRIP.gravel.gravel);
  const p0 = stage.poseAt(START_S - 8);
  car.reset(p0.x, p0.z, p0.heading, 0);
  const finish = stage.finish;
  let maxOver = 0;
  let time = NaN;
  // Testföraren håller i snitt minst 10 m/s, så etappens längd ger en övre gräns för tiden.
  const maxTime = Math.max(200, finish / 10);
  run(car, maxTime + 50, (t, c) => {
    const hit = stage.project(c.pos.x, c.pos.z);
    if (Number.isNaN(time) && hit.s >= finish) time = t;
    if (!Number.isNaN(time)) return brakeAlongRoad(stage, c);
    maxOver = Math.max(maxOver, hit.d - hit.width / 2);
    const look = stage.poseAt(hit.s + 6 + c.speed * 0.6);
    const f = new Vector3(0, 0, 1).applyQuaternion(c.quat);
    const err = Math.atan2(look.x - c.pos.x, look.z - c.pos.z) - Math.atan2(f.x, f.z);
    const a = stage.poseAt(hit.s + 10).heading;
    const b = stage.poseAt(hit.s + 40).heading;
    const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    // Hårnålar (över ca 90° på 30 m) tas i krypfart, annars aldrig under 9 m/s.
    const target = Math.max(turn > 1.5 ? 5 : 9, 24 - turn * 18) * gripK(hit.surface);
    return {
      ...idle,
      steer: Math.max(-1, Math.min(1, Math.atan2(Math.sin(err), Math.cos(err)) * 4)),
      throttle: c.forwardSpeed < target ? 1 : 0,
      brake: c.forwardSpeed > target + 2 ? 0.6 : 0,
    };
  });
  check(`${def.name}: förare når målet på vägen`, time > 60 && time < maxTime && maxOver < 1, `${TYRE_NAMES[tyre]}, ${Number.isNaN(time) ? 'nådde inte' : time.toFixed(1) + ' s'}, som mest ${maxOver.toFixed(2)} m utanför kanten`);
}

// 14. Däckrådet: grusdäck på grusetapperna, vinterdäck på snön och asfaltsdäck där det mest är asfalt.
{
  const advice = STAGES.map((d) => `${d.name}: ${bestTyre(d)}`);
  const ok = STAGES.every((d) => bestTyre(d) === (d.winter ? 'snow' : (surfaceShares(d).asphalt ?? 0) > 0.7 ? 'tarmac' : 'gravel'));
  check('däckråd per etapp', ok, advice.join(', '));
}

// 15. Snövallarna: bilen som kör in i vallen bromsas kraftigt, tar lite skada och välter inte.
{
  const stage = new Stage(STAGE_FROSTBERGA);
  const results = [12, 22].map((v0) => {
    const car = makeCar(stage, 'snow');
    const p = stage.poseAt(START_S + 30);
    // 25° ut mot vänster vägkant från vägens mitt.
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
  check('snövallar bromsar och skadar milt', ok, results.map((r) => `${r.v0} m/s → ${r.out.toFixed(1)} m/s efter 2 s, skada ${(r.dmg * 100).toFixed(0)} %, ${r.off.toFixed(1)} m utanför${r.rolled ? ', VÄLTE' : ''}`).join(' · '));
}

// 16. Strålkastarna: en lätt knuff framifrån skadar lyktan lite, en hård smäll mot vänster hörn
// slår sönder den vänstra men inte den högra.
{
  const car = makeCar(new FlatWorld('gravel'), 'gravel');
  const nose = new Vector3(0.6, 0, car.params.body.halfZ);
  car.registerDamage(nose, car.params.mass * 14 * 0.03, 'object');
  const light = [...car.lamps];
  car.registerDamage(nose, car.params.mass * 14 * 0.2, 'object');
  const ok = light[0]! > 0 && light[0]! < LAMP_BROKEN && car.lamps[0]! >= LAMP_BROKEN && car.lamps[1]! < LAMP_BROKEN;
  check('strålkastare går sönder', ok, `knuff ${light.map((l) => l.toFixed(2)).join('/')}, smäll ${car.lamps.map((l) => l.toFixed(2)).join('/')}`);
  car.reset(0, 0, 0, 0);
  check('strålkastare lagas vid omstart', car.lamps.every((l) => l === 0), car.lamps.join('/'));
}

// 17. Huvudmenyns autopilot: alla bilar kör genom Myrkullas gruskurva (s ≈ 1750) utan att lämna vägen.
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
  check('menyns autopilot håller vägen', runs.every((r) => r.t < 40 && r.off < 1), runs.map((r) => `${r.t.toFixed(1)} s, ${r.off.toFixed(1)} m utanför`).join(' · '));
}

// 17. Väder: regn förlänger bromssträckan på asfalt tydligt, dimma ändrar inget, och ungefär tre
// av fyra etapper har uppehåll. Snöfall bara på vinteretapper, regn bara på de andra.
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
  check('väder: regn ger längre bromssträcka', wet > dry * 1.2 && Math.abs(foggy - dry) < 0.01, `torrt ${dry.toFixed(1)} m, regn ${wet.toFixed(1)} m, dimma ${foggy.toFixed(1)} m`);
  const rolls = (def: (typeof STAGES)[number]) => Array.from({ length: 1000 }, (_, i) => rollWeather(def, (i + 0.5) / 1000));
  const summer = rolls(STAGE_SKOGSBERG);
  const winter = rolls(STAGE_FROSTBERGA);
  const share = (list: Weather[], w: Weather) => list.filter((x) => x === w).length / list.length;
  const ok = share(summer, 'clear') > 0.7 && share(summer, 'clear') < 0.85 && share(summer, 'snowfall') === 0 && share(winter, 'rain') === 0 && share(winter, 'snowfall') > 0.05;
  check('väder: oftast uppehåll', ok, `sommar: uppehåll ${(share(summer, 'clear') * 100).toFixed(0)} %, regn ${(share(summer, 'rain') * 100).toFixed(0)} %, dimma ${(share(summer, 'fog') * 100).toFixed(0)} % · vinter: snöfall ${(share(winter, 'snowfall') * 100).toFixed(0)} %`);
}

{
  // Ska stämma i både UTC och svensk tid.
  const at = (iso: string) => lightAt(new Date(iso));
  const got = [at('2026-11-27T01:27Z'), at('2026-06-21T11:00Z'), at('2026-11-27T14:30Z'), at('2026-11-27T07:50Z')];
  check('ljus: följer klockan och årstiden', got.join() === 'night,day,dusk,dawn', got.join());
}

if (failures) {
  console.log(`\n${failures} test(er) misslyckades`);
  process.exit(1);
}
console.log('\nAlla fysiktester gick bra');
