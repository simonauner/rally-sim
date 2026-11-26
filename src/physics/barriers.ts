import { Quaternion, Vector3 } from 'three';
import type { Car } from './car';
import type { Stage } from './stage';

/** En hel avspärrning: två trästolpar och bräder (kg). Lätt mot bilen, men märks. */
const MASS = 40;
const HEIGHT = 1.1;
const POST = 0.12;
const BOARD_Y = 0.85;
const BOARD_H = 0.3;
const BOARD_T = 0.06;
/** Halva djupet där en träff räknas; tjockare än brädan så bilen inte hoppar över den i ett steg. */
const HIT_DEPTH = 0.3;
const GRAVITY = 9.81;

export interface BarrierPart {
  size: Vector3;
  color: 'post' | 'red' | 'white';
  pos: Vector3;
  quat: Quaternion;
  vel: Vector3;
  spin: Vector3;
  home: { pos: Vector3; quat: Quaternion };
  resting: boolean;
}

const tmpP = new Vector3();
const tmpR = new Vector3();
const tmpJ = new Vector3();
const tmpQ = new Quaternion();
const tmpAxis = new Vector3();

/**
 * Avspärrningarna vid korsningarna. De står kvar tills bilen kör in i dem; då tar bilen en
 * smäll motsvarande avspärrningens massa och delarna flyger iväg.
 */
export class Barriers {
  readonly parts: BarrierPart[] = [];
  /** Delarna i parts som hör till varje avspärrning, och om den är nerkörd. */
  private groups: { from: number; to: number; down: boolean }[] = [];

  constructor(private stage: Stage) {
    for (const r of stage.barriers) {
      const from = this.parts.length;
      const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), r.yaw);
      const add = (lx: number, ly: number, size: Vector3, color: BarrierPart['color']) => {
        const pos = new Vector3(lx, ly, 0).applyQuaternion(rot).add(new Vector3(r.x, r.y, r.z));
        this.parts.push({ size, color, pos: pos.clone(), quat: rot.clone(), vel: new Vector3(), spin: new Vector3(), home: { pos, quat: rot }, resting: true });
      };
      for (const k of [-1, 1]) add(r.halfWidth * k, HEIGHT / 2, new Vector3(POST, HEIGHT, POST), 'post');
      const n = Math.round(r.halfWidth * 2);
      for (let i = 0; i < n; i++)
        add(-r.halfWidth + ((i + 0.5) * r.halfWidth * 2) / n, BOARD_Y, new Vector3((r.halfWidth * 2) / n, BOARD_H, BOARD_T), i % 2 ? 'white' : 'red');
      this.groups.push({ from, to: this.parts.length, down: false });
    }
    this.reset();
  }

  /** Ställer upp alla avspärrningar igen. */
  reset() {
    for (const p of this.parts) {
      p.pos.copy(p.home.pos);
      p.quat.copy(p.home.quat);
      p.vel.set(0, 0, 0);
      p.spin.set(0, 0, 0);
      p.resting = true;
    }
    for (const g of this.groups) g.down = false;
  }

  /** Ett fysiksteg: träffar från bilen och delar i luften. */
  update(car: Car, dt: number) {
    this.stage.barriers.forEach((r, i) => {
      const g = this.groups[i]!;
      if (g.down) return;
      const cos = Math.cos(r.yaw);
      const sin = Math.sin(r.yaw);
      for (const lp of car.collisionPoints) {
        tmpP.copy(lp).applyQuaternion(car.quat).add(car.pos);
        const dx = tmpP.x - r.x;
        const dz = tmpP.z - r.z;
        const across = dx * cos - dz * sin;
        const along = dx * sin + dz * cos;
        const up = tmpP.y - r.y;
        if (Math.abs(across) > r.halfWidth || Math.abs(along) > HIT_DEPTH || up < 0 || up > HEIGHT) continue;
        this.knock(g, car, tmpP);
        return;
      }
    });

    for (const p of this.parts) {
      if (p.resting) continue;
      p.vel.y -= GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      const w = p.spin.length();
      if (w > 1e-4) p.quat.premultiply(tmpQ.setFromAxisAngle(tmpAxis.copy(p.spin).divideScalar(w), w * dt));
      const ground = this.stage.heightAt(p.pos.x, p.pos.z) + Math.min(p.size.x, p.size.y, p.size.z) / 2;
      if (p.pos.y < ground) {
        p.pos.y = ground;
        if (p.vel.y < 0) p.vel.y *= -0.3;
        const f = Math.max(0, 1 - 4 * dt);
        p.vel.x *= f;
        p.vel.z *= f;
        p.spin.multiplyScalar(Math.max(0, 1 - 6 * dt));
        if (p.vel.lengthSq() < 0.05 && w < 0.3) p.resting = true;
      }
    }
  }

  private knock(g: { from: number; to: number; down: boolean }, car: Car, at: Vector3) {
    g.down = true;
    // Fullständigt oelastisk stöt längs bilens rörelse: bilen ger avspärrningen sin fart.
    const m = car.params.mass;
    tmpR.copy(at).sub(car.pos);
    const v = car.pointVelocity(tmpR, new Vector3());
    tmpJ.copy(v).multiplyScalar((-MASS * m) / (MASS + m));
    tmpJ.y = 0;
    car.applyImpulse(tmpJ, tmpR);
    const impulse = tmpJ.length();
    const local = tmpR.clone().applyQuaternion(car.quat.clone().invert());
    if (impulse >= 250) {
      const normal = tmpJ.clone().normalize().applyQuaternion(car.quat.clone().invert());
      car.damageEvents.push({ local, normal, impulse, kind: 'object' });
      car.registerDamage(local, impulse, 'object');
    }
    for (let i = g.from; i < g.to; i++) {
      const p = this.parts[i]!;
      const k = 0.9 + Math.random() * 0.5;
      p.vel.set(v.x * k + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 3 + v.length() * 0.1, v.z * k + (Math.random() - 0.5) * 3);
      p.spin.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 16);
      p.resting = false;
    }
  }
}
