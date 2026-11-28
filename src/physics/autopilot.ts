import { Vector3 } from 'three';
import type { Car, Input } from './car';
import type { Stage } from './stage';

const _fwd = new Vector3();

/**
 * Brings the car to a stop along the road after the finish: steers towards a point ahead of the car on the centre line,
 * brakes fully (ABS keeps it on the road) and pulls the handbrake once stopped (otherwise the automatic gearbox selects reverse).
 */
export function brakeAlongRoad(stage: Stage, car: Car): Input {
  const s = stage.project(car.pos.x, car.pos.z).s;
  const rolling = car.speed > 1;
  return { throttle: 0, brake: rolling ? 1 : 0, handbrake: rolling ? 0 : 1, steer: steerAlongRoad(stage, car, s) };
}

/** Steers towards a point ahead of the car on the centre line. */
function steerAlongRoad(stage: Stage, car: Car, s: number) {
  const look = stage.poseAt(s + 8 + car.speed * 0.5);
  _fwd.set(0, 0, 1).applyQuaternion(car.quat);
  const err = Math.atan2(look.x - car.pos.x, look.z - car.pos.z) - Math.atan2(_fwd.x, _fwd.z);
  return Math.max(-1, Math.min(1, Math.atan2(Math.sin(err), Math.cos(err)) * 4));
}

/** How much the road turns (rad) over 20 m around s. */
export function turnAt(stage: Stage, s: number) {
  const d = stage.poseAt(s + 10).heading - stage.poseAt(s - 10).heading;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/**
 * Drives along the road at a moderate pace, for the main menu background: the sharpest corner in the
 * next 70 m sets the speed, with lateral acceleration `grip` (m/s²).
 */
export function driveAlongRoad(stage: Stage, car: Car, grip = 7): Input {
  const s = stage.project(car.pos.x, car.pos.z).s;
  let turn = 0;
  for (let d = 0; d <= 70; d += 10) turn = Math.max(turn, Math.abs(turnAt(stage, s + d)));
  const want = Math.min(30, Math.sqrt((grip * 20) / Math.max(turn, 1e-3)));
  const err = want - car.speed;
  return { throttle: Math.max(0, Math.min(1, err * 0.4)), brake: Math.max(0, Math.min(1, -err * 0.25)), handbrake: 0, steer: steerAlongRoad(stage, car, s) };
}
