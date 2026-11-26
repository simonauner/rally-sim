import { Car, type Input } from '../src/physics/car';
import { kvarn240 } from '../src/physics/params';
import type { SurfaceId, TyreType } from '../src/physics/surfaces';
import { World } from '../src/physics/world';

const DT = 1 / 240;
let failures = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}

/** Plan testyta med ett enda underlag och inga hinder. */
class FlatWorld extends World {
  constructor(private surface: SurfaceId) {
    super();
    this.boxes.length = 0;
  }
  override heightAt() {
    return 0;
  }
  override surfaceAt(): SurfaceId {
    return this.surface;
  }
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

if (failures) {
  console.log(`\n${failures} test(er) misslyckades`);
  process.exit(1);
}
console.log('\nAlla fysiktester gick bra');
