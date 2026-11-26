import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Car } from '../physics/car';
import type { DamageEvent } from '../physics/collision';

const PAINT = new THREE.Color(0xc4553a);
const GLASS = new THREE.Color(0x2b3a42);
const DARK = new THREE.Color(0x3a3a3a);
const LAMP = new THREE.Color(0xf3e7a1);
const TAIL = new THREE.Color(0xa01818);

/** Rundar kanterna på en uppdelad låda ("clay"-look). */
function roundBox(pos: THREE.BufferAttribute, hx: number, hy: number, hz: number, r: number) {
  const p = new THREE.Vector3();
  const inner = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    inner.set(
      Math.max(-(hx - r), Math.min(hx - r, p.x)),
      Math.max(-(hy - r), Math.min(hy - r, p.y)),
      Math.max(-(hz - r), Math.min(hz - r, p.z)),
    );
    const d = p.sub(inner);
    if (d.lengthSq() > 1e-9) d.normalize().multiplyScalar(r);
    pos.setXYZ(i, inner.x + d.x, inner.y + d.y, inner.z + d.z);
  }
}

function hash(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** En kroppsdel vars hörn kan flyttas när bilen skadas. */
class DeformablePart {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private orig: Float32Array;
  private disp: Float32Array;

  constructor(geo: THREE.BufferGeometry, material: THREE.Material) {
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.pos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.orig = new Float32Array(this.pos.array as Float32Array);
    this.disp = new Float32Array(this.orig.length);
  }

  dent(local: THREE.Vector3, dir: THREE.Vector3, amount: number, radius: number) {
    const MAX = 0.55;
    const r2 = radius * radius;
    for (let i = 0; i < this.pos.count; i++) {
      const dx = this.orig[i * 3]! + this.disp[i * 3]! - local.x;
      const dy = this.orig[i * 3 + 1]! + this.disp[i * 3 + 1]! - local.y;
      const dz = this.orig[i * 3 + 2]! + this.disp[i * 3 + 2]! - local.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2 * 5) continue;
      const w = Math.exp(-d2 / r2);
      const k = amount * w * (0.8 + 0.4 * hash(i));
      let x = this.disp[i * 3]! + dir.x * k + (hash(i + 7) - 0.5) * 0.12 * k;
      let y = this.disp[i * 3 + 1]! + dir.y * k + (hash(i + 13) - 0.5) * 0.12 * k;
      let z = this.disp[i * 3 + 2]! + dir.z * k + (hash(i + 19) - 0.5) * 0.12 * k;
      const len = Math.hypot(x, y, z);
      if (len > MAX) {
        const s = MAX / len;
        x *= s;
        y *= s;
        z *= s;
      }
      this.disp[i * 3] = x;
      this.disp[i * 3 + 1] = y;
      this.disp[i * 3 + 2] = z;
    }
  }

  commit() {
    const a = this.pos.array as Float32Array;
    for (let i = 0; i < a.length; i++) a[i] = this.orig[i]! + this.disp[i]!;
    this.pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  reset() {
    this.disp.fill(0);
    this.commit();
  }
}

function buildBody(): DeformablePart {
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(1.7, 0.62, 4.6, 12, 5, 30);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  roundBox(pos, 0.85, 0.31, 2.3, 0.2);
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) - 0.0;
    const z = pos.getZ(i);
    pos.setY(i, y);
    c.copy(PAINT);
    if (y < -0.14) c.copy(DARK);
    if (z > 2.12 && Math.abs(x) > 0.45 && y > -0.1 && y < 0.18) c.copy(LAMP);
    if (z < -2.12 && Math.abs(x) > 0.4 && y > -0.1 && y < 0.2) c.copy(TAIL);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return new DeformablePart(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
}

function buildCabin(): DeformablePart {
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(1.5, 0.56, 2.4, 10, 5, 16);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  roundBox(pos, 0.75, 0.28, 1.2, 0.16);
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const t = (y + 0.28) / 0.56; // 0 nere, 1 uppe
    x *= 1 - 0.14 * t;
    z *= 1 - 0.16 * t;
    // flytta upp och lite bakåt: ovanpå kroppen
    y += 0.31 + 0.26;
    z += -0.2;
    pos.setXYZ(i, x, y, z);
    c.copy(PAINT);
    const side = Math.abs(x) > 0.58 * (1 - 0.14 * t);
    const endFace = Math.abs(z + 0.2) > 1.0 * (1 - 0.16 * t);
    if ((side || endFace) && t > 0.2 && t < 0.88) c.copy(GLASS);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return new DeformablePart(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
}

function buildWheel(radius: number): THREE.Group {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.22, 28).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x242424, roughness: 1 }),
  );
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xd6d6d6, roughness: 0.7 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.235, 20).rotateZ(Math.PI / 2), hubMat);
  g.add(tyre, hub);
  // Ekrar visar rotationen
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.8 });
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.245, radius * 1.1, 0.05), spokeMat);
    s.rotation.x = (i / 5) * Math.PI;
    g.add(s);
  }
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

export class CarMesh {
  readonly group = new THREE.Group();
  readonly wheels: THREE.Group[] = [];
  private parts: DeformablePart[];
  private qSteer = new THREE.Quaternion();
  private qSpin = new THREE.Quaternion();
  private yAxis = new THREE.Vector3(0, 1, 0);
  private xAxis = new THREE.Vector3(1, 0, 0);

  constructor(private car: Car) {
    this.parts = [buildBody(), buildCabin()];
    this.parts.forEach((p) => this.group.add(p.mesh));
    for (let i = 0; i < 4; i++) {
      const w = buildWheel(car.params.wheelRadius);
      this.wheels.push(w);
    }
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.group);
    this.wheels.forEach((w) => scene.add(w));
  }

  applyDamage(events: DamageEvent[]) {
    if (events.length === 0) return;
    for (const e of events) {
      const amount = Math.min(0.32, e.impulse * 0.00009);
      for (const part of this.parts) part.dent(e.local, e.normal, amount, e.kind === 'ground' ? 0.5 : 0.75);
    }
    for (const part of this.parts) part.commit();
  }

  repair() {
    for (const p of this.parts) p.reset();
  }

  update() {
    const car = this.car;
    this.group.position.copy(car.pos);
    this.group.quaternion.copy(car.quat);
    car.wheels.forEach((w, i) => {
      const m = this.wheels[i]!;
      m.position.copy(w.centerW);
      this.qSteer.setFromAxisAngle(this.yAxis, w.steer);
      this.qSpin.setFromAxisAngle(this.xAxis, w.spin);
      m.quaternion.copy(car.quat).multiply(this.qSteer).multiply(this.qSpin);
    });
  }
}
