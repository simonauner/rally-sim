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
  const rolling = car.speed > 1;
  return { throttle: 0, brake: rolling ? 1 : 0, handbrake: rolling ? 0 : 1, steer: steerAlongRoad(stage, car, s) };
}

/** Styr mot en punkt framför bilen på mittlinjen. */
function steerAlongRoad(stage: Stage, car: Car, s: number) {
  const look = stage.poseAt(s + 8 + car.speed * 0.5);
  _fwd.set(0, 0, 1).applyQuaternion(car.quat);
  const err = Math.atan2(look.x - car.pos.x, look.z - car.pos.z) - Math.atan2(_fwd.x, _fwd.z);
  return Math.max(-1, Math.min(1, Math.atan2(Math.sin(err), Math.cos(err)) * 4));
}

/** Hur mycket vägen svänger (rad) över 20 m kring s. */
export function turnAt(stage: Stage, s: number) {
  const d = stage.poseAt(s + 10).heading - stage.poseAt(s - 10).heading;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/**
 * Kör längs vägen i lagom fart, för huvudmenyns bakgrund: den skarpaste kurvan de närmaste
 * 70 m bestämmer farten, med sidacceleration `grip` (m/s²).
 */
export function driveAlongRoad(stage: Stage, car: Car, grip = 7): Input {
  const s = stage.project(car.pos.x, car.pos.z).s;
  let turn = 0;
  for (let d = 0; d <= 70; d += 10) turn = Math.max(turn, Math.abs(turnAt(stage, s + d)));
  const want = Math.min(30, Math.sqrt((grip * 20) / Math.max(turn, 1e-3)));
  const err = want - car.speed;
  return { throttle: Math.max(0, Math.min(1, err * 0.4)), brake: Math.max(0, Math.min(1, -err * 0.25)), handbrake: 0, steer: steerAlongRoad(stage, car, s) };
}
