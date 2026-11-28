import { Quaternion, Vector3 } from 'three';
import { collide, type DamageEvent } from './collision';
import { Drivetrain, splitDiff } from './drivetrain';
import type { CarParams } from './params';
import { SURFACES, TYRE_GRIP, type SurfaceId } from './surfaces';
import { WEATHER_GRIP } from './weather';
import { tyreForce, type TyreOut } from './tires';
import type { World } from './world';

export interface Input {
  throttle: number;
  brake: number;
  /** -1..1, left positive. */
  steer: number;
  handbrake: number;
}

export interface Assists {
  abs: boolean;
  tc: boolean;
  /** 0..1 counter-steer assist. */
  steerAssist: number;
}

export class WheelState {
  omega = 0;
  spin = 0;
  steer = 0;
  /** Spring length (mount to wheel centre). */
  length = 0.13;
  contact = false;
  fz = 0;
  fx = 0;
  fy = 0;
  kappa = 0;
  tanAlpha = 0;
  usage = 0;
  surface: SurfaceId = 'gravel';
  absFactor = 1;
  damage = 0;
  mountW = new Vector3();
  centerW = new Vector3();
  contactW = new Vector3();
  tyreForceW = new Vector3();
}

export interface DamageState {
  front: number;
  rear: number;
  left: number;
  right: number;
  roof: number;
}

const G = 9.81;
const V_MIN = 1.5;

const _fwd = new Vector3();
const _up = new Vector3();
const _left = new Vector3();
const _n = new Vector3();
const _fw = new Vector3();
const _lw = new Vector3();
const _vP = new Vector3();
const _r = new Vector3();
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _local = new Vector3();
const _vMount = new Vector3();
const _force = new Vector3();
const _qInv = new Quaternion();

/** From this damage level a headlight is fully out. */
export const LAMP_BROKEN = 0.5;

export class Car {
  pos = new Vector3(0, 1, 0);
  quat = new Quaternion();
  quatInv = new Quaternion();
  vel = new Vector3();
  angVel = new Vector3();
  wheels: WheelState[];
  drivetrain: Drivetrain;
  assists: Assists = { abs: true, tc: true, steerAssist: 1 };
  damage: DamageState = { front: 0, rear: 0, left: 0, right: 0, roof: 0 };
  /** Headlight damage [left, right], 0..1. From LAMP_BROKEN the lamp is fully out. */
  lamps = [0, 0];
  damageEvents: DamageEvent[] = [];
  collisionPoints: Vector3[] = [];

  // Read-out values for the HUD and tests.
  forwardSpeed = 0;
  lateralSpeed = 0;
  speed = 0;
  gLong = 0;
  gLat = 0;
  steerAngle = 0;
  tcActive = false;
  absActive = false;
  time = 0;
  /** Accumulated force and torque during a step. */
  private force = new Vector3();
  private torque = new Vector3();
  private lastVel = new Vector3();

  constructor(
    public params: CarParams,
    public world: World,
  ) {
    this.wheels = params.wheels.map(() => new WheelState());
    this.drivetrain = new Drivetrain(params.engine, params.gearbox);
    const b = params.body;
    const cz = b.centerZ ?? 0;
    for (const x of [-b.halfX, 0, b.halfX])
      for (const y of [b.bottomY, (b.bottomY + b.topY) / 2, b.topY])
        for (const z of [-b.halfZ, -b.halfZ / 2, 0, b.halfZ / 2, b.halfZ]) {
          const interior = Math.abs(x) < 1e-6 && y > b.bottomY && y < b.topY && Math.abs(z) < b.halfZ - 1e-6;
          if (!interior) this.collisionPoints.push(new Vector3(x, y, z + cz));
        }
    this.reset(0, 0, 0, 0);
  }

  /** Places the car on the ground. Heading in radians (0 = +Z, positive towards the left). */
  reset(x: number, z: number, heading: number, speed: number, keepDamage = false) {
    const p = this.params;
    this.quat.setFromAxisAngle(_tmp.set(0, 1, 0), heading);
    this.quatInv.copy(this.quat).invert();
    const h = this.world.heightAt(x, z);
    this.pos.set(x, h + p.cgHeight + 0.02, z);
    this.vel.set(0, 0, speed).applyQuaternion(this.quat);
    this.angVel.set(0, 0, 0);
    this.lastVel.copy(this.vel);
    for (const w of this.wheels) {
      w.omega = speed / p.wheelRadius;
      w.steer = 0;
      w.absFactor = 1;
    }
    this.steerAngle = 0;
    this.drivetrain.reset();
    // Pick a gear that suits the speed, so a teleport at speed doesn't start in first.
    const gb = p.gearbox;
    let gear = 1;
    while (gear < gb.ratios.length) {
      const rpm = ((speed / p.wheelRadius) * gb.ratios[gear - 1]! * gb.final * 60) / (2 * Math.PI);
      if (rpm < 5200) break;
      gear++;
    }
    this.drivetrain.gear = gear;
    this.drivetrain.rpm = Math.max(p.engine.idleRpm, ((speed / p.wheelRadius) * gb.ratios[gear - 1]! * gb.final * 60) / (2 * Math.PI));
    if (!keepDamage) {
      this.damage = { front: 0, rear: 0, left: 0, right: 0, roof: 0 };
      for (const w of this.wheels) w.damage = 0;
      this.drivetrain.powerFactor = 1;
      this.lamps = [0, 0];
    }
    this.updateWheelGeometry();
  }

  invInertiaWorld(v: Vector3, out: Vector3): Vector3 {
    const [ix, iy, iz] = this.params.inertia;
    _qInv.copy(this.quat).invert();
    out.copy(v).applyQuaternion(_qInv);
    out.set(out.x / ix, out.y / iy, out.z / iz);
    return out.applyQuaternion(this.quat);
  }

  pointVelocity(r: Vector3, out: Vector3): Vector3 {
    return out.crossVectors(this.angVel, r).add(this.vel);
  }

  applyImpulse(J: Vector3, r: Vector3) {
    this.vel.addScaledVector(J, 1 / this.params.mass);
    _tmp2.crossVectors(r, J);
    this.invInertiaWorld(_tmp2, _tmp);
    this.angVel.add(_tmp);
  }

  private addForceAt(F: Vector3, point: Vector3) {
    this.force.add(F);
    _r.copy(point).sub(this.pos);
    this.torque.add(_tmp.crossVectors(_r, F));
  }

  registerDamage(local: Vector3, impulse: number, kind: 'object' | 'ground') {
    const scale = (kind === 'ground' ? 0.35 : 1) * impulse / (this.params.mass * 14);
    const d = this.damage;
    const b = this.params.body;
    const lz = local.z - (b.centerZ ?? 0);
    if (lz > b.halfZ * 0.6) d.front = Math.min(1, d.front + scale);
    else if (lz < -b.halfZ * 0.6) d.rear = Math.min(1, d.rear + scale);
    else if (local.y > b.topY * 0.8) d.roof = Math.min(1, d.roof + scale);
    else if (local.x > 0) d.left = Math.min(1, d.left + scale);
    else d.right = Math.min(1, d.right + scale);
    // Corner damage that affects the wheels: the nearest wheel takes damage.
    let best = 0;
    let bd = Infinity;
    this.params.wheels.forEach((w, i) => {
      const dd = Math.hypot(w.mount[0] - local.x, w.mount[2] - local.z);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    const wheel = this.wheels[best]!;
    wheel.damage = Math.min(1, wheel.damage + scale * 0.8);
    // Hits from the front take out the headlight on that side, and a little of the other.
    if (lz > b.halfZ * 0.6) {
      const side = local.x > 0 ? 0 : 1;
      this.lamps[side] = Math.min(1, this.lamps[side]! + scale * 3);
      this.lamps[1 - side] = Math.min(1, this.lamps[1 - side]! + scale * 0.8);
    }
    this.drivetrain.powerFactor = 1 - 0.4 * d.front;
  }

  private updateWheelGeometry() {
    this.quatInv.copy(this.quat).invert();
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    const p = this.params;
    this.params.wheels.forEach((def, i) => {
      const w = this.wheels[i]!;
      _local.set(...def.mount).applyQuaternion(this.quat);
      w.mountW.copy(this.pos).add(_local);
      w.centerW.copy(w.mountW).addScaledVector(_up, -w.length);
      w.contactW.copy(w.centerW).addScaledVector(_up, -p.wheelRadius);
    });
  }

  step(dt: number, input: Input) {
    const p = this.params;
    const R = p.wheelRadius;
    const wheels = this.wheels;
    this.time += dt;
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
    this.quatInv.copy(this.quat).invert();

    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _left.set(1, 0, 0).applyQuaternion(this.quat);
    this.forwardSpeed = this.vel.dot(_fwd);
    this.lateralSpeed = this.vel.dot(_left);
    this.speed = this.vel.length();

    const dtn = this.drivetrain;

    // --- Reverse and pedals ----------------------------------------------------
    if (dtn.autoShift && Math.abs(this.forwardSpeed) < 1.2) {
      if (input.brake > 0.2 && input.throttle < 0.05 && dtn.gear >= 0) dtn.gear = -1;
      else if (input.throttle > 0.2 && input.brake < 0.05 && dtn.gear <= 0) dtn.gear = 1;
    }
    const reversing = dtn.gear < 0;
    let gas = reversing ? input.brake : input.throttle;
    const brakePedal = reversing ? input.throttle : input.brake;

    // --- Steering --------------------------------------------------------------
    const v = Math.abs(this.forwardSpeed);
    const maxAngle = p.steer.maxAngle / (1 + (v / p.steer.speedRef) ** 2);
    const driverAngle = input.steer * maxAngle;
    let target = driverAngle;
    if (this.assists.steerAssist > 0 && v > 4) {
      // Point the front wheels in the direction of travel: helps in a slide.
      const beta = Math.atan2(this.lateralSpeed, Math.abs(this.forwardSpeed)) * (this.forwardSpeed >= 0 ? 1 : -1);
      target += clamp(beta, 0.3) * this.assists.steerAssist;
      // Yaw damper: counter-steers when the car rotates faster than the driver steers (or grip allows).
      const yaw = this.angVel.dot(_up);
      const mu = TYRE_GRIP[p.tyre][wheels[0]!.surface] * p.gripScale * (WEATHER_GRIP[this.world.weather][wheels[0]!.surface] ?? 1);
      const wanted = clamp((this.forwardSpeed * Math.tan(driverAngle)) / p.wheelbase, (mu * G) / v);
      const excess = yaw - wanted;
      if (excess * yaw > 0) target -= clamp(excess * 0.3, 0.35) * this.assists.steerAssist;
    }
    const rateBase = Math.abs(target) > Math.abs(this.steerAngle) ? p.steer.rate : p.steer.centerRate;
    const rate = rateBase / (1 + v / 30);
    const dS = target - this.steerAngle;
    this.steerAngle += Math.max(-rate * dt, Math.min(rate * dt, dS));

    // Ackermann
    const tanD = Math.tan(this.steerAngle);
    const L = p.wheelbase;
    const T = p.trackFront;
    const innerOffset = L - (T / 2) * Math.abs(tanD);
    const outerOffset = L + (T / 2) * Math.abs(tanD);
    for (let i = 0; i < wheels.length; i++) {
      const def = p.wheels[i]!;
      const w = wheels[i]!;
      if (!def.front) {
        w.steer = 0;
        continue;
      }
      const inner = def.left === this.steerAngle > 0;
      const ang = Math.atan2(L * Math.abs(tanD), inner ? innerOffset : outerOffset) * Math.sign(this.steerAngle);
      w.steer = ang + (def.left ? 1 : -1) * w.damage * 0.1;
    }

    // --- Suspension: geometry and forces ---------------------------------------
    const s = p.susp;
    const comp: number[] = [];
    const tDist: number[] = [];
    const vComp: number[] = [];
    for (let i = 0; i < wheels.length; i++) {
      const def = p.wheels[i]!;
      const w = wheels[i]!;
      _local.set(...def.mount).applyQuaternion(this.quat);
      w.mountW.copy(this.pos).add(_local);

      let t = w.mountW.y - this.world.heightAt(w.mountW.x, w.mountW.z);
      if (_up.y > 0.15) {
        for (let k = 0; k < 3; k++) {
          _tmp.copy(w.mountW).addScaledVector(_up, -t);
          const err = _tmp.y - this.world.heightAt(_tmp.x, _tmp.z);
          t += err / Math.max(0.5, _up.y);
        }
      } else {
        t = 99;
      }
      tDist.push(t);
      const len = t - R;
      w.contact = len <= s.maxLen;
      w.length = Math.min(s.maxLen, Math.max(s.minLen, len));
      comp.push(w.contact ? s.freeLen - len : 0);
      this.pointVelocity(_r.copy(_local), _vMount);
      vComp.push(-_vMount.dot(_up));
    }

    const normalForce: number[] = [];
    for (let i = 0; i < wheels.length; i++) {
      const def = p.wheels[i]!;
      const w = wheels[i]!;
      if (!w.contact) {
        normalForce.push(0);
        continue;
      }
      const k = def.front ? s.kFront : s.kRear;
      const travel = s.freeLen - s.minLen;
      const x = comp[i]!;
      let F = k * Math.min(x, travel) + s.bumpStopK * Math.max(0, x - travel);
      const vc = vComp[i]!;
      F += (vc > 0 ? s.bump : s.rebound) * vc;
      // Anti-roll bar between left and right on the same axle
      const other = i ^ 1;
      const arb = def.front ? s.arbFront : s.arbRear;
      F += arb * (x - comp[other]!);
      F = Math.max(0, F);
      normalForce.push(F);
      this.addForceAt(_force.copy(_up).multiplyScalar(F), w.mountW);
    }

    // --- Drivetrain ------------------------------------------------------------
    const driven: number[] = [];
    p.wheels.forEach((def, i) => {
      if (p.frontShare > 0 && def.front) driven.push(i);
      if (p.frontShare < 1 && !def.front) driven.push(i);
    });
    let shaftOmega = 0;
    for (const i of driven) shaftOmega += wheels[i]!.omega;
    shaftOmega /= Math.max(1, driven.length);

    // Traction control: limit the throttle when the driven wheels' combined slip (longitudinal + lateral) reaches peak grip,
    // otherwise wheelspin eats up the lateral grip and the rear steps out.
    this.tcActive = false;
    if (this.assists.tc && v > 1) {
      let worst = 0;
      for (const i of driven) {
        const w = wheels[i]!;
        const sp = SURFACES[w.surface];
        const sx = w.kappa / sp.peakSlipRatio;
        if (sx > 0.3) worst = Math.max(worst, Math.hypot(sx, w.tanAlpha / sp.peakTanSlipAngle) - 0.95);
      }
      if (worst > 0) {
        gas *= Math.max(0.1, 1 - worst * 2);
        this.tcActive = true;
      }
    }

    // The handbrake locks the rear wheels; with driven rear wheels the driver declutches, otherwise the engine drags the speed down and the gearbox shifts down to first.
    const declutch = p.frontShare < 1 && input.handbrake > 0.1;
    const shaftTorque = dtn.update(dt, gas, shaftOmega, input.throttle, declutch);
    const iRef = p.engine.inertia * dtn.ratio * dtn.ratio * dtn.engage * dtn.engage;

    const axleTorque = [0, 0, 0, 0];
    // Four-wheel drive: the centre diff locks against the spinning axle, so a wheel in the air doesn't take everything.
    const [frontT, rearT] = p.centerDiff
      ? splitDiff(shaftTorque, (wheels[0]!.omega + wheels[1]!.omega) / 2, (wheels[2]!.omega + wheels[3]!.omega) / 2, p.centerDiff, p.frontShare)
      : [shaftTorque * p.frontShare, shaftTorque * (1 - p.frontShare)];
    if (p.frontShare > 0) {
      const [l, r] = splitDiff(frontT, wheels[0]!.omega, wheels[1]!.omega, p.diff);
      axleTorque[0] = l;
      axleTorque[1] = r;
    }
    if (p.frontShare < 1) {
      const [l, r] = splitDiff(rearT, wheels[2]!.omega, wheels[3]!.omega, p.diff);
      axleTorque[2] = l;
      axleTorque[3] = r;
    }

    // --- Tyres and wheels ------------------------------------------------------
    const out: TyreOut = { fx: 0, fy: 0, usage: 0 };
    this.absActive = false;
    for (let i = 0; i < wheels.length; i++) {
      const def = p.wheels[i]!;
      const w = wheels[i]!;
      const fz = normalForce[i]!;
      const isDriven = driven.includes(i);
      let Iw = p.wheelInertia + (isDriven ? iRef / driven.length : 0);

      let brake = brakePedal * p.brake.total * (def.front ? p.brake.bias / 2 : (1 - p.brake.bias) / 2);
      if (!def.front) brake += input.handbrake * p.brake.handbrake / 2;
      if (this.assists.abs && brakePedal > 0 && v > 3 && input.handbrake < 0.1) {
        const peak = SURFACES[w.surface].peakSlipRatio;
        if (w.kappa < -peak * 1.25) {
          w.absFactor = Math.max(0.05, w.absFactor - dt * 25);
          this.absActive = true;
        } else {
          w.absFactor = Math.min(1, w.absFactor + dt * 12);
        }
        brake *= w.absFactor;
      } else {
        w.absFactor = 1;
      }

      if (!w.contact) {
        // Wheel in the air: only drive, brake and a little bearing friction.
        const resist = brake + 2;
        let om = w.omega + (dt * axleTorque[i]!) / Iw;
        const dec = (dt * resist) / Iw;
        om = Math.abs(om) <= dec ? 0 : om - Math.sign(om) * dec;
        w.omega = om;
        w.spin += om * dt;
        w.fz = 0;
        w.fx = 0;
        w.fy = 0;
        w.kappa = 0;
        w.tanAlpha = 0;
        w.usage = 0;
        w.tyreForceW.set(0, 0, 0);
        continue;
      }

      // Contact point and ground plane
      w.contactW.copy(w.mountW).addScaledVector(_up, -(w.length + R));
      const gy = this.world.heightAt(w.contactW.x, w.contactW.z);
      const surf = this.world.surfaceAt(w.contactW.x, w.contactW.z);
      w.surface = surf;
      this.world.normalAt(w.contactW.x, w.contactW.z, _n);
      // The wheel's direction projected onto the ground plane
      const sa = w.steer;
      _fw.copy(_fwd).multiplyScalar(Math.cos(sa)).addScaledVector(_left, Math.sin(sa));
      _fw.addScaledVector(_n, -_fw.dot(_n)).normalize();
      _lw.crossVectors(_n, _fw);

      _r.copy(w.contactW).sub(this.pos);
      this.pointVelocity(_r, _vP);
      const vx = _vP.dot(_fw);
      const vy = _vP.dot(_lw);
      const den = Math.max(Math.abs(vx), V_MIN);
      const sp = SURFACES[surf];
      const mu = TYRE_GRIP[p.tyre][surf] * p.gripScale * (WEATHER_GRIP[this.world.weather][surf] ?? 1) * (1 - 0.15 * w.damage);
      const tanA = vy / den;

      const fxAt = (om: number) => {
        const kappa = (om * R - vx) / den;
        return tyreForce(kappa, tanA, fz, sp, mu, out).fx;
      };
      const om0 = w.omega;
      const fx0 = fxAt(om0);
      const kSlope = Math.max(0, (fxAt(om0 + 0.5) - fx0) / 0.5);
      let om = om0 + (dt * (axleTorque[i]! - R * fx0)) / (Iw + dt * R * kSlope);
      const resist = brake + sp.rolling * fz * R;
      const dec = (dt * resist) / Iw;
      om = Math.abs(om) <= dec ? 0 : om - Math.sign(om) * dec;
      w.omega = om;
      w.spin += om * dt;

      const kappa = (om * R - vx) / den;
      tyreForce(kappa, tanA, fz, sp, mu, out);
      let fy = out.fy;
      const maxFy = ((fz / G) * Math.abs(vy)) / dt * 0.5;
      if (Math.abs(fy) > maxFy) fy = Math.sign(fy) * maxFy;
      w.fx = out.fx;
      w.fy = fy;
      w.fz = fz;
      w.kappa = kappa;
      w.tanAlpha = tanA;
      w.usage = out.usage;

      w.tyreForceW.copy(_fw).multiplyScalar(out.fx).addScaledVector(_lw, fy);
      this.addForceAt(w.tyreForceW, w.contactW);
      if (sp.sink) {
        // The wheel ploughs through deep snow: resistance to the contact point's speed along the ground.
        _vP.addScaledVector(_n, -_vP.dot(_n)).multiplyScalar(-sp.sink * fz);
        this.addForceAt(_vP, w.contactW);
      }
      void gy;
      void def;
    }

    // --- Aerodynamic drag, gravity, integration --------------------------------
    const vl = this.speed;
    if (vl > 0.01) this.force.addScaledVector(this.vel, -0.5 * p.aero.rho * p.aero.cdA * vl);
    this.force.y -= p.mass * G;

    // Gyroscopic contribution
    _tmp.copy(this.angVel).applyQuaternion(this.quatInv);
    const [ix, iy, iz] = p.inertia;
    _tmp2.set(ix * _tmp.x, iy * _tmp.y, iz * _tmp.z);
    _tmp.cross(_tmp2).applyQuaternion(this.quat);
    this.torque.sub(_tmp);

    this.vel.addScaledVector(this.force, dt / p.mass);
    this.invInertiaWorld(this.torque, _tmp);
    this.angVel.addScaledVector(_tmp, dt);
    // Angular velocity damping against numerical noise
    this.angVel.multiplyScalar(1 - 0.02 * dt);

    this.pos.addScaledVector(this.vel, dt);
    const wq = new Quaternion(this.angVel.x * dt * 0.5, this.angVel.y * dt * 0.5, this.angVel.z * dt * 0.5, 0);
    wq.multiply(this.quat);
    this.quat.set(this.quat.x + wq.x, this.quat.y + wq.y, this.quat.z + wq.z, this.quat.w + wq.w).normalize();
    this.quatInv.copy(this.quat).invert();

    collide(this, this.world, dt);

    // g-forces (low-pass)
    _tmp.copy(this.vel).sub(this.lastVel).multiplyScalar(1 / (dt * G));
    this.lastVel.copy(this.vel);
    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    _left.set(1, 0, 0).applyQuaternion(this.quat);
    const a = Math.min(1, dt * 8);
    this.gLong += (_tmp.dot(_fwd) - this.gLong) * a;
    this.gLat += (_tmp.dot(_left) - this.gLat) * a;

    this.updateWheelGeometry();
  }
}

function clamp(x: number, limit: number) {
  return Math.max(-limit, Math.min(limit, x));
}
