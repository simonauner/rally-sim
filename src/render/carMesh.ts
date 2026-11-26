import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { abs, attribute, color, fract, select, vec3 } from 'three/tsl';
import type { Car } from '../physics/car';
import type { DamageEvent } from '../physics/collision';

const PAINT = new THREE.Color(0xc4553a);
const PAINT_SEAM = new THREE.Color(0x8e3b27);
const GLASS = new THREE.Color(0x2b3a42);
const DARK = new THREE.Color(0x3a3a3a);
const BLACK = new THREE.Color(0x1b1b1b);
const CHROME = new THREE.Color(0xb9bec2);
const LAMP = new THREE.Color(0xf3e7a1);
const AMBER = new THREE.Color(0xe8902a);
const TAIL = new THREE.Color(0xa01818);
const REVERSE = new THREE.Color(0xd9d4cc);
const PLATE = new THREE.Color(0xeeeeea);

// Hjulens läge i karossen (axlar från kvarn240, hjulcentrum vid normal fjädring).
const WHEEL_Z = [1.19, -1.45] as const;
const ARCH_Y = -0.23;
const ARCH_R = 0.41;

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

/** Uppdelad låda med rundade kanter. `rest` sparar formen före ev. extra formning. */
function roundedBox(w: number, h: number, l: number, segs: [number, number, number], r: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(w, h, l, ...segs);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  roundBox(pos, w / 2, h / 2, l / 2, r);
  g.setAttribute('rest', pos.clone());
  return g;
}

/** Fiktiv kantig 80-talssedan: platt motorhuv och baklucka, stora fyrkantiga lyktor. */
function buildBody(): DeformablePart {
  const g = roundedBox(1.7, 0.62, 4.6, [12, 10, 60], 0.07);
  // Hjulhus: lyft plåten ytterst över hjulen upp till en båge, så hela hjulet syns.
  // Bara |x| > 0.5 lyfts, så kvarvarande plåt innanför bildar hjulhusets innervägg.
  // `rest` behålls, så de lyfta ytorna målas mörka av `archs` nedan.
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) < 0.5) continue;
    for (const zw of WHEEL_Z) {
      const dz = pos.getZ(i) - zw;
      if (Math.abs(dz) >= ARCH_R) continue;
      pos.setY(i, Math.max(pos.getY(i), ARCH_Y + Math.sqrt(ARCH_R * ARCH_R - dz * dz)));
    }
  }
  g.computeVertexNormals();
  // Färgen räknas per pixel från vilopositionen, så lyktornas kanter blir skarpa
  // (hörnfärger tonas ut över en hel ruta) och följer med när plåten bucklas.
  const p = attribute('rest', 'vec3');
  const ax = abs(p.x);
  const band = (lo: number, hi: number) => p.y.greaterThan(lo).and(p.y.lessThan(hi));
  const front = p.z.greaterThan(2.25);
  const rear = p.z.lessThan(-2.25);
  const side = ax.greaterThan(0.8);

  // Fram: grill med kromram och rutmönster, breda rektangulära strålkastare, blinkers runt hörnen.
  const grilleBox = front.and(ax.lessThan(0.34)).and(band(-0.05, 0.2));
  const grilleFrame = grilleBox.and(ax.greaterThan(0.31).or(p.y.lessThan(-0.025)).or(p.y.greaterThan(0.175)));
  const crate = fract(p.x.mul(11)).lessThan(0.22).or(fract(p.y.mul(13)).lessThan(0.22));
  const lamp = front.and(ax.greaterThan(0.37)).and(ax.lessThan(0.72)).and(band(-0.01, 0.18));
  const lampRim = front.and(ax.greaterThan(0.355)).and(ax.lessThan(0.735)).and(band(-0.025, 0.195));
  const indicator = band(-0.01, 0.18).and(front.and(ax.greaterThan(0.745)).or(side.and(p.z.greaterThan(2.08))));

  // Bak: höga lyktor som går runt hörnen, röd med blinkersband överst och backljus inåt.
  const tailZone = band(-0.09, 0.21).and(rear.and(ax.greaterThan(0.46)).or(side.and(p.z.lessThan(-2.1))));
  const tailAmber = tailZone.and(p.y.greaterThan(0.13));
  const tailReverse = tailZone.and(rear).and(ax.lessThan(0.56));
  const plate = rear.and(ax.lessThan(0.26)).and(band(-0.07, 0.07));

  // Sidor: skyddslist, dörrspringor, mörka hjulhus och svarta trösklar.
  const strip = side.and(band(0.0, 0.05)).and(abs(p.z).lessThan(2.12));
  const seamAt = (z: number) => abs(p.z.sub(z)).lessThan(0.01);
  const seam = side.and(p.y.greaterThan(-0.22)).and(seamAt(0.95).or(seamAt(-0.2)).or(seamAt(-1.05)));
  const arch = (z: number) => p.z.sub(z).mul(p.z.sub(z)).add(p.y.sub(ARCH_Y).mul(p.y.sub(ARCH_Y))).lessThan(ARCH_R * ARCH_R);
  const archs = ax.greaterThan(0.45).and(arch(WHEEL_Z[0]).or(arch(WHEEL_Z[1])));
  // Motorhuvens skarv framför vindrutan.
  const hoodSeam = p.y.greaterThan(0.29).and(abs(p.z.sub(1.04)).lessThan(0.01));

  const paint = select(seam.or(hoodSeam), color(PAINT_SEAM), color(PAINT));
  const body = select(p.y.lessThan(-0.22).or(strip).or(archs), color(BLACK), paint);
  const tail = select(tailReverse, color(REVERSE), select(tailAmber, color(AMBER), color(TAIL)));
  const mat = new THREE.MeshToonNodeMaterial();
  mat.colorNode = select(
    grilleBox,
    select(grilleFrame, color(CHROME), select(crate, color(DARK), color(BLACK))),
    select(
      lamp,
      color(LAMP),
      select(
        lampRim,
        color(CHROME),
        select(indicator, color(AMBER), select(tailZone, tail, select(plate, color(PLATE), body))),
      ),
    ),
  );
  // Lyktorna lyser lite själva, så de inte blir mörka i skugga.
  mat.emissiveNode = select(
    lamp,
    color(LAMP).mul(0.5),
    select(indicator, color(AMBER).mul(0.3), select(tailZone, tail.mul(0.6), vec3(0))),
  );
  return new DeformablePart(g, mat);
}

/** Upprätt kupé med tunna stolpar, svarta fönsterlister och tjock C-stolpe. */
function buildCabin(): DeformablePart {
  const g = roundedBox(1.48, 0.56, 2.3, [10, 5, 16], 0.1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const t = (y + 0.28) / 0.56; // 0 nere, 1 uppe
    x *= 1 - 0.08 * t;
    // Lutande vindruta, nästan stående bakruta.
    z *= 1 - (z > 0 ? 0.26 : 0.1) * t;
    // flytta upp och bakåt: ovanpå kroppen
    y += 0.31 + 0.26;
    z += -0.18;
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  // Rutor räknas i lådans koordinater före avsmalningen, se buildBody.
  const p = attribute('rest', 'vec3');
  const t = p.y.add(0.28).div(0.56);
  const tIn = (lo: number, hi: number) => t.greaterThan(lo).and(t.lessThan(hi));
  const ax = abs(p.x);
  const side = ax.greaterThan(0.64);
  const ends = abs(p.z).greaterThan(1.05);
  const zIn = (lo: number, hi: number) => p.z.greaterThan(lo).and(p.z.lessThan(hi));
  // Sidorutor: framdörr och bakdörr delade av B-stolpen, C-stolpen bak är bred.
  const sideGlass = side.and(tIn(0.2, 0.88)).and(zIn(-0.04, 1.04).or(zIn(-0.78, -0.12)));
  const sideTrim = side.and(tIn(0.15, 0.92)).and(zIn(-0.82, 1.08));
  const endGlass = ends.and(ax.lessThan(0.6)).and(tIn(0.16, 0.9));
  const endTrim = ends.and(ax.lessThan(0.64)).and(tIn(0.12, 0.93));
  const glass = sideGlass.or(endGlass);
  const trim = sideTrim.or(endTrim);
  const mat = new THREE.MeshToonNodeMaterial();
  mat.colorNode = select(glass, color(GLASS), select(trim, color(BLACK), color(PAINT)));
  return new DeformablePart(g, mat);
}

/** Stor svart stötfångare som går en bit runt hörnen. */
function buildBumper(z: number): DeformablePart {
  const g = roundedBox(1.78, 0.17, 0.3, [8, 2, 3], 0.05);
  g.translate(0, -0.15, z);
  g.computeVertexNormals();
  return new DeformablePart(g, new THREE.MeshToonMaterial({ color: BLACK }));
}

/** Små odeformerbara detaljer: speglar, främre nummerplåt, stänkskydd. */
function buildDetails(): THREE.Group {
  const g = new THREE.Group();
  const black = new THREE.MeshToonMaterial({ color: BLACK });
  const add = (w: number, h: number, l: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(0.5, 0.11, 0.02, 0, -0.15, 2.49, new THREE.MeshToonMaterial({ color: PLATE }));
  for (const s of [1, -1]) {
    add(0.06, 0.04, 0.05, s * 0.82, 0.4, 0.78, black); // spegelfot
    add(0.12, 0.09, 0.05, s * 0.89, 0.42, 0.78, black); // spegel
    add(0.3, 0.26, 0.015, s * 0.72, -0.38, 0.76, black); // stänkskydd fram
    add(0.3, 0.26, 0.015, s * 0.72, -0.38, -1.9, black); // stänkskydd bak
  }
  return g;
}

function buildWheel(radius: number): THREE.Group {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.22, 28).rotateZ(Math.PI / 2),
    new THREE.MeshToonMaterial({ color: 0x242424 }),
  );
  const hubMat = new THREE.MeshToonMaterial({ color: 0xd6d6d6 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.235, 20).rotateZ(Math.PI / 2), hubMat);
  g.add(tyre, hub);
  // Ekrar visar rotationen
  const spokeMat = new THREE.MeshToonMaterial({ color: 0x8a8a8a });
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
    this.parts = [buildBody(), buildCabin(), buildBumper(2.33), buildBumper(-2.33)];
    this.parts.forEach((p) => this.group.add(p.mesh));
    this.group.add(buildDetails());
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
