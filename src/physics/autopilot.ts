import { Vector3 } from 'three';
import type { Car, Input } from './car';
import type { Stage } from './stage';

const _fwd = new Vector3();

/**
 * Bromsar in bilen längs vägen efter mål: styr mot en punkt framför bilen på mittlinjen,
 * bromsar fullt (ABS håller den på vägen) och drar handbromsen när den står still (annars lägger automatlådan i backen).
 */
export function brakeAlongRoad(stage: Stage, car: Car): Input {
  const s = stage.project(car.pos.x, car.pos.z).s;
  const look = stage.poseAt(s + 8 + car.speed * 0.5);
  _fwd.set(0, 0, 1).applyQuaternion(car.quat);
  const err = Math.atan2(look.x - car.pos.x, look.z - car.pos.z) - Math.atan2(_fwd.x, _fwd.z);
  const steer = Math.max(-1, Math.min(1, Math.atan2(Math.sin(err), Math.cos(err)) * 4));
  const rolling = car.speed > 1;
  return { throttle: 0, brake: rolling ? 1 : 0, handbrake: rolling ? 0 : 1, steer };
}
