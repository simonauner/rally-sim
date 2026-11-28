import { Car, type Input } from './car';
import { interp } from './drivetrain';
import type { CarParams } from './params';
import type { SurfaceId } from './surfaces';
import { World } from './world';

const DT = 1 / 240;

/** Flat ground with a single surface and no obstacles, for test drives. */
export class FlatWorld extends World {
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

export interface CarSpecs {
  powerKw: number;
  powerRpm: number;
  torqueNm: number;
  torqueRpm: number;
  /** Fraction of the weight on the front axle. */
  frontWeight: number;
  /** Measured at full throttle on flat gravel, with the car's own tyres. NaN if the car never reaches 100. */
  zeroTo100: number;
  /** Top speed on flat asphalt, km/h. */
  topSpeedKmh: number;
}

/** The car's specs: engine figures come from the torque curve, acceleration is test-driven in the physics. */
export function carSpecs(p: CarParams): CarSpecs {
  const e = p.engine;
  let powerKw = 0;
  let powerRpm = 0;
  for (let rpm = e.idleRpm; rpm <= e.limiterRpm; rpm += 25) {
    const kw = (interp(e.curveRpm, e.curveNm, rpm) * rpm * 2 * Math.PI) / 60 / 1000;
    if (kw > powerKw) [powerKw, powerRpm] = [kw, rpm];
  }
  const peak = e.curveNm.indexOf(Math.max(...e.curveNm));
  const zF = p.wheels.find((w) => w.front)!.mount[2];
  const zR = p.wheels.find((w) => !w.front)!.mount[2];
  return {
    powerKw,
    powerRpm,
    torqueNm: e.curveNm[peak]!,
    torqueRpm: e.curveRpm[peak]!,
    frontWeight: -zR / (zF - zR),
    zeroTo100: fullThrottle(p, 'gravel', 30, (car) => car.forwardSpeed >= 100 / 3.6),
    topSpeedKmh: topSpeed(p),
  };
}

const full: Input = { throttle: 1, brake: 0, steer: 0, handbrake: 0 };

/** Time until `done` becomes true at full throttle, or NaN. */
function fullThrottle(p: CarParams, surface: SurfaceId, seconds: number, done: (car: Car) => boolean): number {
  const car = new Car(p, new FlatWorld(surface));
  for (let t = 0; t < seconds; t += DT) {
    car.step(DT, full);
    if (done(car)) return t;
  }
  return NaN;
}

function topSpeed(p: CarParams): number {
  const car = new Car(p, new FlatWorld('asphalt'));
  let best = 0;
  for (let t = 0; t < 90; t += DT) {
    car.step(DT, full);
    best = Math.max(best, car.forwardSpeed);
  }
  return best * 3.6;
}
