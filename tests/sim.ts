/** What the physics tests share: stepping a car at the fixed physics step. */

import { Car, type Input } from '../src/physics/car';
import { kvarn240 } from '../src/physics/params';
import type { TyreType } from '../src/physics/surfaces';
import type { World } from '../src/physics/world';

export const DT = 1 / 240;

export const idle: Input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

export function run(car: Car, seconds: number, input: (t: number, car: Car) => Input, onStep?: (t: number) => void) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    car.step(DT, input(t, car));
    onStep?.(t);
    if (!Number.isFinite(car.pos.x + car.pos.y + car.pos.z + car.vel.length())) throw new Error(`NaN at t=${t.toFixed(3)}`);
  }
}

export function makeCar(world: World, tyre: TyreType) {
  const p = kvarn240();
  p.tyre = tyre;
  const car = new Car(p, world);
  return car;
}
