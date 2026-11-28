import * as THREE from 'three/webgpu';
import { abs, attribute, color, select, uniform, vec3 } from 'three/tsl';
import { LAMP_BROKEN, type Car, type DamageState } from '../physics/car';
import type { DamageEvent } from '../physics/collision';
import type { CarModel, WheelDef } from '../physics/params';
import { tierOf } from '../career/career';
import { bodyDecals, decalTexture, roofDecals, startNumber } from './decals';
import type { BodyShape, Range } from './bodies/shape';
import { kvarn240 } from './bodies/kvarn240';
import { kvarn240Turbo } from './bodies/kvarn240Turbo';
import { strandTurbo4x4 } from './bodies/strandTurbo4x4';
import { soraTurbo } from './bodies/soraTurbo';
import { ljung1600 } from './bodies/ljung1600';
import { ljung2000 } from './bodies/ljung2000';
import { strand1800 } from './bodies/strand1800';
import { brenner5t } from './bodies/brenner5t';
import { volpeTurbo } from './bodies/volpeTurbo';
import { hoshi4wd } from './bodies/hoshi4wd';
import { partGeometry, type ModelData } from './models/model';


const GLASS = new THREE.Color(0x2b3a42);
const DARK = new THREE.Color(0x3a3a3a);
const BLACK = new THREE.Color(0x1b1b1b);
const CHROME = new THREE.Color(0xb9bec2);
const LAMP = new THREE.Color(0xf3e7a1);
const AMBER = new THREE.Color(0xe8902a);
const TAIL = new THREE.Color(0xa01818);
const REVERSE = new THREE.Color(0xd9d4cc);
const PLATE = new THREE.Color(0xeeeeea);


function hash(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth spatial noise (value noise on a grid with cell size `cell`), 0..1. */
function valueNoise(x: number, y: number, z: number, cell: number): number {
  const fx = x / cell, fy = y / cell, fz = z / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const s = (t: number) => t * t * (3 - 2 * t);
  const tx = s(fx - ix), ty = s(fy - iy), tz = s(fz - iz);
  const h = (a: number, b: number, c: number) => hash(((ix + a) * 73 + (iy + b) * 179 + (iz + c) * 283) % 100003);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const plane = (c: number) => lerp(lerp(h(0, 0, c), h(1, 0, c), tx), lerp(h(0, 1, c), h(1, 1, c), tx), ty);
  return lerp(plane(0), plane(1), tz);
}

/** Deepest dent: the panel folds or dents coarsely, it doesn't crumple up like an accordion. */
const MAX_DENT = 0.15;
/** Dent strength varies smoothly over the panel in cells of this size, so it gets uneven but coarse. */
const DENT_CELL = 0.35;

/** A body part whose vertices can move when the car is damaged. */
class DeformablePart {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private orig: Float32Array;
  private disp: Float32Array;
  /** Dent strength per vertex, from smooth spatial noise: vertices at the same position (at a colour edge) get the same. */
  private noise: Float32Array;

  /** `side` (0..1) scales dents from hits straight from the side: a stiffer long side. */
  constructor(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    private side = 1,
  ) {
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.pos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.orig = new Float32Array(this.pos.array as Float32Array);
    this.disp = new Float32Array(this.orig.length);
    const o = this.orig;
    this.noise = new Float32Array(this.pos.count);
    for (let i = 0; i < this.pos.count; i++) this.noise[i] = valueNoise(o[i * 3]!, o[i * 3 + 1]!, o[i * 3 + 2]!, DENT_CELL);
  }

  dent(local: THREE.Vector3, dir: THREE.Vector3, amount: number, radius: number) {
    const r2 = radius * radius;
    amount *= 1 + (this.side - 1) * Math.abs(dir.x);
    for (let i = 0; i < this.pos.count; i++) {
      // Distance from the undamaged surface, so repeated hits deepen the same dent instead of creeping inward.
      const dx = this.orig[i * 3]! - local.x;
      const dy = this.orig[i * 3 + 1]! - local.y;
      const dz = this.orig[i * 3 + 2]! - local.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2 * 5) continue;
      const k = amount * Math.exp(-d2 / r2) * (0.7 + 0.6 * this.noise[i]!);
      let x = this.disp[i * 3]! + dir.x * k;
      let y = this.disp[i * 3 + 1]! + dir.y * k;
      let z = this.disp[i * 3 + 2]! + dir.z * k;
      const len = Math.hypot(x, y, z);
      if (len > MAX_DENT) {
        const s = MAX_DENT / len;
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

  /** Shrinks the dents towards k (0 = intact), for a visible repair. */
  scale(k: number) {
    for (let i = 0; i < this.disp.length; i++) this.disp[i]! *= k;
    this.commit();
  }
}

const BODIES: Record<CarModel['body'], BodyShape> = {
  kvarn240,
  kvarn240Turbo,
  strandTurbo4x4,
  soraTurbo,
  ljung1600,
  ljung2000,
  strand1800,
  brenner5t,
  volpeTurbo,
  hoshi4wd,
};

/** Every car's model from Blender (blender/); the shapes in bodies/ place the decals, dents and tail lights. */
// Separate chunks: a model is several hundred kB, so it is fetched only when the car is to be shown.
const MODEL_LOADERS: Record<CarModel['body'], () => Promise<ModelData>> = {
  soraTurbo: () => import('./models/soraTurbo').then((m) => m.soraTurbo),
  hoshi4wd: () => import('./models/hoshi4wd').then((m) => m.hoshi4wd),
  kvarn240: () => import('./models/kvarn240').then((m) => m.kvarn240),
  kvarn240Turbo: () => import('./models/kvarn240').then((m) => m.kvarn240),
  volpeTurbo: () => import('./models/volpeTurbo').then((m) => m.volpeTurbo),
  ljung1600: () => import('./models/ljung1600').then((m) => m.ljung1600),
  ljung2000: () => import('./models/ljung2000').then((m) => m.ljung2000),
  brenner5t: () => import('./models/brenner5t').then((m) => m.brenner5t),
  strand1800: () => import('./models/strand1800').then((m) => m.strand1800),
  strandTurbo4x4: () => import('./models/strandTurbo4x4').then((m) => m.strandTurbo4x4),
};
const MODELS: Partial<Record<CarModel['body'], ModelData>> = {};
const loading: Partial<Record<CarModel['body'], Promise<void>>> = {};

/** True when the car's Blender model is fetched. */
export function carModelReady(model: CarModel): boolean {
  return !!MODELS[model.body];
}

/** Fetches the car's Blender model; must be done before its CarMesh is built. */
export function loadCarModel(model: CarModel): Promise<void> {
  if (MODELS[model.body]) return Promise.resolve();
  return (loading[model.body] ??= MODEL_LOADERS[model.body]().then(
    (data) => void (MODELS[model.body] = data),
    (e: unknown) => {
      delete loading[model.body]; // The next attempt fetches again, e.g. after a network error.
      throw e;
    },
  ));
}

const PALETTE: Record<string, THREE.Color> = {
  glass: GLASS,
  black: BLACK,
  dark: DARK,
  chrome: CHROME,
  lamp: LAMP,
  amber: AMBER,
  tail: TAIL,
  reverse: REVERSE,
  plate: PLATE,
  gold: new THREE.Color(0xc9a243),
  rubber: new THREE.Color(0x242424),
  white: new THREE.Color(0xf2f2ee),
};

/**
 * Material for a part of a Blender model: the colour from the vertex's material, the paint (with decals on the body)
 * and the seams in the paint colour. The headlights and tail lights glow with `lamp` and `tail`.
 */
function modelMaterial(data: ModelData, paint: THREE.Color, lamp: THREE.Node<'float'>, tail: FloatUniform, painted: THREE.Node<'color'> = color(paint)) {
  const m = attribute('mat', 'float');
  const is = (name: string) => abs(m.sub(data.materials.indexOf(name))).lessThan(0.5);
  const colorOf = (name: string): THREE.Node<'color'> => {
    if (name === 'paint') return painted;
    if (name === 'shade') return color(paint.clone().multiplyScalar(0.72));
    const c = PALETTE[name];
    if (!c) throw new Error(`Unknown material in the car model: ${name}`);
    return color(c);
  };
  const mat = new THREE.MeshToonNodeMaterial();
  mat.colorNode = data.materials.reduce<THREE.Node<'color'>>((acc, name) => select(is(name), colorOf(name), acc), color(BLACK));
  mat.emissiveNode = select(is('lamp'), color(LAMP).mul(lamp), select(is('tail'), color(TAIL).mul(tail), vec3(0)));
  return mat;
}

/**
 * The parts of a Blender model. 'body' and 'body_…' (doors, bumpers, boot lid) are panels that dent
 * separately and carry the decals, 'wheel' is the whole wheel (outside towards +x), 'rim'
 * only the rim (fitted in a tyre built in code) and the rest are loose details that fall
 * off. The auxiliary light pod ('pod…') only if `pod`.
 */
function buildModel(data: ModelData, b: BodyShape, paint: THREE.Color, lampGlow: LampGlow, tailGlow: FloatUniform, decals: THREE.Texture, pod: boolean) {
  // Decals on the paint: the sides below the belt line, the hood, the boot lid and the roof.
  const p = attribute('rest', 'vec3');
  const side = abs(p.x).greaterThan(0.7).and(p.y.lessThan(b.belt));
  const roof = p.y.greaterThan(b.roof - 0.04);
  const painted = roofDecals(bodyDecals(color(paint), p, side, b, decals, paint), p.x, p.z, roof, b, decals, paint);
  const panelMaterial = modelMaterial(data, paint, select(p.x.greaterThan(0), lampGlow[0], lampGlow[1]), tailGlow, painted);
  const panels: DeformablePart[] = [];
  let rim: THREE.Mesh | undefined;
  const details = new THREE.Group();
  let wheel: THREE.Mesh | null = null;
  for (const part of data.parts) {
    if (part.name.startsWith('pod') && !pod) continue;
    const g = partGeometry(part);
    if (part.name === 'rim') {
      // Flat faces: the rim's sharp edges shouldn't be rounded off by smooth normals.
      const flat = g.toNonIndexed();
      flat.computeVertexNormals();
      rim = new THREE.Mesh(flat, modelMaterial(data, paint, lampGlow[0], tailGlow));
      rim.castShadow = true;
      continue;
    }
    if (part.name === 'body' || part.name.startsWith('body_')) {
      // Decals and dents are computed in car coordinates, so the panels have their origin at the car's.
      if (part.at.some((c) => c !== 0)) throw new Error(`${part.name}: the panel's origin must be at the car's origin`);
      panels.push(new DeformablePart(g, panelMaterial, 0.35));
      continue;
    }
    const mesh = new THREE.Mesh(g, modelMaterial(data, paint, lampGlow[part.at[0] > 0 ? 0 : 1], tailGlow));
    mesh.castShadow = true;
    if (part.name === 'wheel') {
      wheel = mesh;
      continue;
    }
    mesh.name = part.name;
    mesh.position.set(...part.at);
    details.add(mesh);
  }
  if (!panels.length) throw new Error('The car model has no body');
  if (!wheel && !rim) throw new Error('The car model has neither a wheel nor a rim');
  return { panels, details, wheel, rim };
}

/** A wheel from the model's wheel; mirrored on the right side, so the rim's outside faces outward. */
function modelWheel(wheel: THREE.Mesh, left: boolean): THREE.Group {
  const g = new THREE.Group();
  const m = wheel.clone();
  m.scale.x = left ? 1 : -1;
  g.add(m);
  return g;
}

type Hit = [x: number, y: number, z: number, nx: number, ny: number, nz: number];

/** Where the damage zones are hit when the dents are drawn from the numbers: point and the direction the panel is pushed. */
function zoneHits(b: BodyShape): Record<keyof DamageState, Hit[]> {
  const { nose, tail, halfX: x, roof } = b;
  return {
    front: [[0.45, -0.1, nose, 0, 0, -1], [-0.35, 0.05, nose, 0, 0, -1]],
    rear: [[-0.4, -0.05, tail, 0, 0, 1], [0.35, 0.1, tail, 0, 0, 1]],
    left: [[x, 0.1, 0.9, -1, 0, 0], [x, 0, -1.1, -1, 0, 0]],
    right: [[-x, 0.1, 0.7, 1, 0, 0], [-x, 0, -1.3, 1, 0, 0]],
    roof: [[0.2, roof, -0.4, 0, -1, 0], [-0.25, roof, -0.9, 0, -1, 0]],
  };
}

/** A detail that comes loose when the body under it has been dented in, and then falls to the ground. */
interface Detail {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  dent: number;
  /** Mud flap: hangs below the body, so hits above it count and it comes loose more easily. */
  flap: boolean;
  loose: boolean;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

/** Dent depth (m) at a detail before it comes loose. */
const DETACH_DENT = 0.12;

/**
 * A simple underside for every car: dark floor pan, engine and gearbox, crossmember, axles to the hubs
 * (at rest height), propshaft and diff when the rear is driven, fuel tank and an exhaust pipe unless the model has one.
 */
function buildUnderbody(b: BodyShape, wheels: WheelDef[], frontShare: number, exhaust: boolean): THREE.Group {
  const g = new THREE.Group();
  const floor = new THREE.MeshToonMaterial({ color: 0x262626 });
  const metal = new THREE.MeshToonMaterial({ color: 0x3e3f40 });
  const pipe = new THREE.MeshToonMaterial({ color: 0x55524e });
  const y0 = b.bottom;
  const box = (w: number, h: number, l: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
  };
  // A rod of radius r from a to b.
  const rod = (r: number, a: THREE.Vector3, c: THREE.Vector3, m: THREE.Material) => {
    const d = c.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), m);
    mesh.position.copy(a).add(c).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(mesh);
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const front = wheels.filter((w) => w.front);
  const rear = wheels.filter((w) => !w.front);
  const zF = front[0]!.mount[2];
  const zR = rear[0]!.mount[2];
  // The hub sits about 0.125 m below the mount at rest (see yMount in params.ts).
  const hubY = wheels[0]!.mount[1] - 0.125;
  // Nothing may hang more than 3 cm below the floor, or it reaches the ground on low cars.
  const low = y0 - 0.03;
  const axleY = Math.max(hubY, low + 0.035);

  box(2 * b.halfX - 0.14, 0.02, b.nose - b.tail - 0.2, 0, y0 - 0.012, (b.nose + b.tail) / 2, floor);
  box(0.5, 0.06, 0.55, 0, y0, zF - 0.05, metal); // engine sump
  box(0.28, 0.05, 0.5, 0, y0, zF - 0.55, metal); // gearbox
  box(2 * b.halfX - 0.5, 0.04, 0.1, 0, y0, zF + 0.05, metal); // front crossmember
  for (const w of front) rod(0.025, v(0, axleY, zF), v(w.mount[0] * 0.9, axleY, zF), frontShare > 0 ? metal : pipe);
  // Rear axle tube between the hubs; a diff and a propshaft when the rear is driven.
  rod(0.035, v(rear[0]!.mount[0] * 0.9, axleY, zR), v(rear[1]!.mount[0] * 0.9, axleY, zR), metal);
  if (frontShare < 1) {
    box(0.26, 0.2, 0.24, 0, Math.max(axleY, low + 0.1), zR, metal);
    rod(0.035, v(0, y0 - 0.005, zF - 0.8), v(0, axleY, zR + 0.12), pipe);
  }
  box(0.8, 0.06, 0.42, 0, y0, (zR + b.tail) / 2 + 0.05, metal); // fuel tank
  if (exhaust) rod(0.02, v(-0.32, y0 - 0.01, zF - 0.3), v(-0.32, y0 - 0.01, b.tail - 0.05), pipe);
  return g;
}

/** A hollow tyre around a modelled rim (inner radius 0.205 m), so the recessed spokes show. */
function buildModelWheel(radius: number, rim: THREE.Mesh): THREE.Group {
  const inner = 0.205;
  const profile = [
    [inner, -0.105], [0.25, -0.11], [radius - 0.02, -0.108], [radius, -0.09],
    [radius, 0.09], [radius - 0.02, 0.108], [0.25, 0.11], [inner, 0.105], [inner, -0.105],
  ].map(([r, x]) => new THREE.Vector2(r, x));
  const tyre = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 28).rotateZ(Math.PI / 2),
    new THREE.MeshToonMaterial({ color: 0x242424, side: THREE.DoubleSide }),
  );
  tyre.castShadow = true;
  const g = new THREE.Group();
  g.add(tyre, rim.clone());
  return g;
}

/** Lamp lens self-illumination [left, right]; local x > 0 is left. */
type FloatUniform = THREE.UniformNode<'float', number>;
type LampGlow = [FloatUniform, FloatUniform];

export class CarMesh {
  readonly group = new THREE.Group();
  private lampGlow: LampGlow = [uniform(0.5), uniform(0.5)];
  /** The tail lights' red glow: always on, brighter with the headlights and much brighter under braking. */
  private tailGlow: FloatUniform = uniform(0.9);
  /** The tail lights' red glow on the ground behind the car, one per lamp; aimed backwards so it doesn't tint the body. */
  private tailLights = [0, 1].map(() => new THREE.SpotLight(0xff1a0a, 0, 10, 1.2, 0.8, 2));
  /** Narrow cone from behind towards the bumper under each lamp, so the area between the lamps stays dark. */
  private bumperLights = [0, 1].map(() => new THREE.SpotLight(0xff1a0a, 0, 1.2, 0.3, 0.5, 2));
  readonly wheels: THREE.Group[] = [];
  private parts: DeformablePart[];
  private hits: Record<keyof DamageState, Hit[]>;
  private qSteer = new THREE.Quaternion();
  private qSpin = new THREE.Quaternion();
  private yAxis = new THREE.Vector3(0, 1, 0);
  private xAxis = new THREE.Vector3(1, 0, 0);
  private detailGroup: THREE.Group;
  private details: Detail[];
  /** The exhaust pipe (model part 'exhaust') and its outlet in car coordinates; absent when the model has no pipe. */
  private exhaust?: { detail: Detail; tip: THREE.Vector3 };
  private lastUpdate = 0;

  constructor(
    private car: Car,
    model: CarModel,
  ) {
    const c = new THREE.Color(model.paint);
    const b = BODIES[model.body];
    this.hits = zoneHits(b);
    const wheels = car.params.wheels;
    const wheelZ: Range = [wheels.find((w) => w.front)!.mount[2], wheels.find((w) => !w.front)!.mount[2]];
    const decals = decalTexture(b, wheelZ, c, startNumber(car.params.name), model.sponsors?.() ?? []);
    const data = MODELS[model.body];
    if (!data) throw new Error(`Car model ${model.body} is not fetched (loadCarModel)`);
    const built = buildModel(data, b, c, this.lampGlow, this.tailGlow, decals, tierOf(car.params.name) === 2);
    this.parts = built.panels;
    this.parts.forEach((p) => this.group.add(p.mesh));
    this.detailGroup = built.details;
    this.group.add(this.detailGroup);
    this.details = (this.detailGroup.children as THREE.Mesh[]).map((mesh) => ({
      mesh,
      home: mesh.position.clone(),
      dent: 0,
      flap: mesh.name.startsWith('flap'),
      loose: false,
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
    }));
    const pipe = this.details.find((d) => d.mesh.name === 'exhaust');
    if (pipe) {
      // The outlet: the centre of the pipe's rearmost vertices (the pipe may be bent, so not the whole pipe's centre).
      const pos = pipe.mesh.geometry.getAttribute('position');
      let minZ = Infinity;
      for (let i = 0; i < pos.count; i++) minZ = Math.min(minZ, pos.getZ(i));
      const tip = new THREE.Vector3();
      let n = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) > minZ + 0.02) continue;
        tip.x += pos.getX(i);
        tip.y += pos.getY(i);
        tip.z += pos.getZ(i);
        n++;
      }
      tip.divideScalar(n).add(pipe.home);
      this.exhaust = { detail: pipe, tip };
    }
    this.group.add(buildUnderbody(b, wheels, car.params.frontShare, !pipe));
    // Just behind the tail, so the body lies behind the light cone.
    // A pair of lights per tail light, in line with the lamp out at the corner.
    const tailLightY = (b.tailY[0] + b.tailY[1]) / 2;
    const tailLightX = (b.tailX + b.halfX) / 2;
    [1, -1].forEach((s, i) => {
      const spot = this.tailLights[i]!;
      spot.position.set(s * tailLightX, tailLightY, b.tail - 0.25);
      spot.target.position.set(s * tailLightX, tailLightY - 1.5, b.tail - 4);
      const bumper = this.bumperLights[i]!;
      bumper.position.set(s * tailLightX, b.bumperY[1], b.tail - 0.6);
      bumper.target.position.set(s * tailLightX, b.bumperY[1], b.tail);
      this.group.add(spot, spot.target, bumper, bumper.target);
    });
    for (let i = 0; i < 4; i++) {
      const w = built.wheel
        ? modelWheel(built.wheel, car.params.wheels[i]!.mount[0] > 0)
        : buildModelWheel(car.params.wheelRadius, built.rim!);
      this.wheels.push(w);
    }
  }

  /** The exhaust outlet in the world; false when the car has no visible pipe or the pipe has come off. */
  exhaustTip(out: THREE.Vector3): boolean {
    if (!this.exhaust || this.exhaust.detail.loose) return false;
    out.copy(this.exhaust.tip).applyQuaternion(this.car.quat).add(this.car.pos);
    return true;
  }

  addTo(scene: THREE.Object3D) {
    scene.add(this.group);
    this.wheels.forEach((w) => scene.add(w));
  }

  /** `fall` = false when the damage is recreated (dentFrom): loose details are then just missing, they don't fall. */
  applyDamage(events: DamageEvent[], fall = true) {
    if (events.length === 0) return;
    for (const e of events) {
      const amount = Math.min(0.32, e.impulse * 0.00009);
      const radius = e.kind === 'ground' ? 0.5 : 0.75;
      for (const part of this.parts) part.dent(e.local, e.normal, amount, radius);
      for (const d of this.details) {
        if (d.loose) continue;
        // The mud flap sits at the body's lower edge: measure only sideways and lengthways.
        const d2 = d.flap ? (d.home.x - e.local.x) ** 2 + (d.home.z - e.local.z) ** 2 : d.home.distanceToSquared(e.local);
        d.dent += amount * Math.exp(-d2 / (radius * radius));
        if (d.dent > (d.flap ? DETACH_DENT * 0.6 : DETACH_DENT)) this.detach(d, fall);
      }
    }
    for (const part of this.parts) part.commit();
  }

  private detach(d: Detail, fall: boolean) {
    d.loose = true;
    const scene = this.group.parent;
    if (!fall || !scene) {
      d.mesh.visible = false;
      return;
    }
    this.group.updateMatrixWorld();
    d.mesh.applyMatrix4(this.group.matrixWorld);
    scene.add(d.mesh);
    d.vel.copy(this.car.vel).add(new THREE.Vector3(Math.random() - 0.5, Math.random() + 0.5, Math.random() - 0.5));
    d.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12);
  }

  repair() {
    for (const p of this.parts) p.reset();
    for (const d of this.details) {
      d.dent = 0;
      d.loose = false;
      d.mesh.visible = true;
      d.mesh.position.copy(d.home);
      d.mesh.quaternion.identity();
      this.detailGroup.add(d.mesh);
    }
  }

  /** The lamp lens: faint glow by day, bright with the headlights on, off when the lamp is broken. The tail lights are always lit. */
  setLamps(on: boolean, lamps: number[], braking: boolean) {
    lamps.forEach((l, i) => (this.lampGlow[i]!.value = l >= LAMP_BROKEN ? 0 : on ? 2.4 * (1 - 0.6 * l) : 0.5));
    // The lens glows brightly with the headlights on; even brighter under braking.
    this.tailGlow.value = braking ? 4 : on ? 2.5 : 0.9;
    // The glow on the bumper, ground, smoke and dust shows only under braking in the dark (headlights on).
    const tail = on && braking ? 2 : 0;
    this.tailLights.forEach((l) => (l.intensity = tail));
    this.bumperLights.forEach((l) => (l.intensity = tail * 0.8));
  }

  /**
   * Dents matching the damage numbers, when the real hits are no longer available
   * (e.g. after the reload between stages). The same impulse that gave the number in Car.registerDamage.
   */
  dentFrom(d: DamageState) {
    const events: DamageEvent[] = [];
    for (const zone of Object.keys(this.hits) as (keyof DamageState)[]) {
      if (d[zone] <= 0) continue;
      const hits = this.hits[zone];
      const impulse = (d[zone] * this.car.params.mass * 14) / hits.length;
      for (const [x, y, z, nx, ny, nz] of hits) {
        events.push({ local: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(nx, ny, nz), impulse, kind: 'object' });
      }
    }
    this.applyDamage(events, false);
  }

  /** Shrinks the dents towards k; called every frame during a repair. */
  heal(k: number) {
    for (const p of this.parts) p.scale(k);
  }

  /** Loose detail: falls, bounces a little on the ground and slides to a standstill. */
  private fallStep(d: Detail, dt: number) {
    const m = d.mesh;
    d.vel.y -= 9.81 * dt;
    m.position.addScaledVector(d.vel, dt);
    m.rotateX(d.spin.x * dt).rotateY(d.spin.y * dt).rotateZ(d.spin.z * dt);
    const ground = this.car.world.heightAt(m.position.x, m.position.z) + 0.02;
    if (m.position.y < ground) {
      m.position.y = ground;
      d.vel.set(d.vel.x * 0.6, Math.abs(d.vel.y) * 0.25, d.vel.z * 0.6);
      d.spin.multiplyScalar(0.6);
    }
  }

  update() {
    const car = this.car;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;
    for (const d of this.details) if (d.loose && d.mesh.visible) this.fallStep(d, dt);
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
