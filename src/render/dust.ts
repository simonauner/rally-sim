import * as THREE from 'three/webgpu';
import type { Car } from '../physics/car';
import type { SurfaceId } from '../physics/surfaces';
import type { World } from '../physics/world';

interface DustStyle {
  color: number;
  /** Partiklar per sekund och hjul per m/s fart. */
  perSpeed: number;
  /** Partiklar per sekund och hjul per m/s slip (spinn eller sladd). */
  perSlip: number;
  /** Slip under detta (m/s) ger inget slipdamm. */
  slipMin: number;
  life: number;
  size: number;
  /** Hur mycket puffen växer under sin livstid (m). */
  grow: number;
  /** Positiv = faller, negativ = stiger. */
  gravity: number;
  drag: number;
  lift: number;
}

/** Utseende per underlag: grus ger moln, lera stänk, snö puder och asfalt bara rök vid spinn. */
const STYLES: Record<SurfaceId, DustStyle> = {
  gravel: { color: 0xcdb892, perSpeed: 0.7, perSlip: 4, slipMin: 0.5, life: 1.5, size: 0.12, grow: 0.55, gravity: -0.05, drag: 2, lift: 0.5 },
  mud: { color: 0x5a4130, perSpeed: 0.5, perSlip: 9, slipMin: 0.5, life: 0.8, size: 0.12, grow: 0.15, gravity: 9, drag: 0.8, lift: 2.5 },
  snow: { color: 0xf3f6f9, perSpeed: 0.8, perSlip: 4, slipMin: 0.5, life: 1.2, size: 0.1, grow: 0.45, gravity: 0.3, drag: 2, lift: 0.7 },
  // Vallarna yr upp ett stort pudermoln, som när en bil plöjer i snökanten.
  snowbank: { color: 0xf3f6f9, perSpeed: 2.5, perSlip: 6, slipMin: 0.3, life: 1.8, size: 0.16, grow: 0.9, gravity: 0.2, drag: 2.2, lift: 1.6 },
  asphalt: { color: 0xd9d9d9, perSpeed: 0, perSlip: 3, slipMin: 4, life: 1.4, size: 0.15, grow: 0.6, gravity: -0.2, drag: 1.6, lift: 0.3 },
};

const MAX = 1200;
const MAX_RATE = 60;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Damm, stänk och rök från hjulen. Ren grafik, påverkar inte fysiken. */
export class Dust {
  readonly mesh: THREE.InstancedMesh;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private age = new Float32Array(MAX).fill(Infinity);
  private style: DustStyle[] = new Array(MAX).fill(STYLES.gravel);
  private next = 0;
  private debt = [0, 0, 0, 0];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private fwd = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshToonMaterial({ color: 0xffffff }), MAX);
    // Partiklarna rör sig över hela banan; nätets egen gränssfär säger inget om var de är.
    this.mesh.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.setHex(0xffffff));
    }
  }

  update(car: Car, world: World, dt: number) {
    this.emit(car, dt);
    this.simulate(world, dt);
  }

  private emit(car: Car, dt: number) {
    this.fwd.set(0, 0, 1).applyQuaternion(car.quat);
    const R = car.params.wheelRadius;
    car.wheels.forEach((w, i) => {
      if (!w.contact) {
        this.debt[i] = 0;
        return;
      }
      const st = STYLES[w.surface];
      const vx = Math.max(Math.abs(car.forwardSpeed), 1.5);
      const slipLong = w.omega * R - car.forwardSpeed;
      const slip = Math.hypot(slipLong, w.tanAlpha * vx);
      const rate = Math.min(MAX_RATE, st.perSpeed * car.speed + (slip > st.slipMin ? st.perSlip * slip : 0));
      this.debt[i]! += rate * dt;
      while (this.debt[i]! >= 1) {
        this.debt[i]! -= 1;
        this.spawn(st, w.contactW, car, slipLong);
      }
    });
  }

  private spawn(st: DustStyle, at: THREE.Vector3, car: Car, slipLong: number) {
    const k = this.next;
    this.next = (this.next + 1) % MAX;
    const r = () => Math.random() * 2 - 1;
    const spread = 0.5 + Math.abs(slipLong) * 0.1;
    // Behåll en del av bilens fart, kasta bakåt vid hjulspinn, sprid slumpmässigt och lyft.
    this.v.copy(car.vel).multiplyScalar(0.3).addScaledVector(this.fwd, -slipLong * 0.35);
    this.pos.set([at.x + r() * 0.15, at.y + 0.05, at.z + r() * 0.15], k * 3);
    this.vel.set([this.v.x + r() * spread, this.v.y + st.lift * (0.6 + Math.random() * 0.8), this.v.z + r() * spread], k * 3);
    this.age[k] = 0;
    this.style[k] = st;
    this.mesh.setColorAt(k, this.c.setHex(st.color).multiplyScalar(0.9 + Math.random() * 0.2));
    this.mesh.instanceColor!.needsUpdate = true;
  }

  private simulate(world: World, dt: number) {
    for (let k = 0; k < MAX; k++) {
      const st = this.style[k]!;
      if (this.age[k]! >= st.life) continue;
      const a = (this.age[k]! += dt);
      const i = k * 3;
      if (a >= st.life) {
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(k, this.m);
        continue;
      }
      const damp = Math.exp(-st.drag * dt);
      this.vel[i + 1]! -= st.gravity * dt;
      for (let j = 0; j < 3; j++) {
        this.vel[i + j]! *= damp;
        this.pos[i + j]! += this.vel[i + j]! * dt;
      }
      const ground = world.heightAt(this.pos[i]!, this.pos[i + 2]!);
      if (this.pos[i + 1]! < ground) {
        this.pos[i + 1] = ground;
        this.vel[i + 1] = 0;
      }
      const t = a / st.life;
      const size = (st.size + st.grow * Math.sqrt(t)) * (1 - smooth(0.6, 1, t));
      this.m.compose(this.v.set(this.pos[i]!, this.pos[i + 1]!, this.pos[i + 2]!), this.q, this.s.setScalar(size));
      this.mesh.setMatrixAt(k, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
