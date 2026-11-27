import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { abs, attribute, color, fract, positionGeometry, select, uniform, vec3 } from 'three/tsl';
import { LAMP_BROKEN, type Car, type DamageState } from '../physics/car';
import type { DamageEvent } from '../physics/collision';
import type { CarModel } from '../physics/params';
import { tierOf } from '../career/career';
import { bodyDecals, decalTexture, roofDecals, startNumber } from './decals';
import type { BodyShape, Range } from './bodies/shape';
import { kvarn240 } from './bodies/kvarn240';
import { kvarn240Turbo } from './bodies/kvarn240Turbo';
import { kvarnTurbo4x4 } from './bodies/kvarnTurbo4x4';
import { soraTurbo } from './bodies/soraTurbo';
import { arashiRs } from './bodies/arashiRs';
import { ljung1600 } from './bodies/ljung1600';
import { ljung2000 } from './bodies/ljung2000';
import { strandGt } from './bodies/strandGt';
import { brenner5t } from './bodies/brenner5t';
import { volpeTurbo } from './bodies/volpeTurbo';
import { hoshi4wd } from './bodies/hoshi4wd';
import { partGeometry, type ModelData } from './models/model';
import { soraTurbo as soraTurboModel } from './models/soraTurbo';
import { hoshi4wd as hoshi4wdModel } from './models/hoshi4wd';


const GLASS = new THREE.Color(0x2b3a42);
const DARK = new THREE.Color(0x3a3a3a);
const BLACK = new THREE.Color(0x1b1b1b);
const CHROME = new THREE.Color(0xb9bec2);
const LAMP = new THREE.Color(0xf3e7a1);
const AMBER = new THREE.Color(0xe8902a);
const TAIL = new THREE.Color(0xa01818);
const REVERSE = new THREE.Color(0xd9d4cc);
const PLATE = new THREE.Color(0xeeeeea);
const SILL = new THREE.Color(0x4c4f52);


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

/** Mjukt brus i rummet (värdebrus på ett gitter med rutan `cell`), 0..1. Kanal `k` ger ett annat brus. */
function valueNoise(x: number, y: number, z: number, cell: number, k: number): number {
  const fx = x / cell, fy = y / cell, fz = z / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const s = (t: number) => t * t * (3 - 2 * t);
  const tx = s(fx - ix), ty = s(fy - iy), tz = s(fz - iz);
  const h = (a: number, b: number, c: number) => hash(((ix + a) * 73 + (iy + b) * 179 + (iz + c) * 283 + k * 1013) % 100003);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const plane = (c: number) => lerp(lerp(h(0, 0, c), h(1, 0, c), tx), lerp(h(0, 1, c), h(1, 1, c), tx), ty);
  return lerp(plane(0), plane(1), tz);
}

/** En kroppsdel vars hörn kan flyttas när bilen skadas. */
class DeformablePart {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private orig: Float32Array;
  private disp: Float32Array;
  /** Fyra slumptal per hörn: bucklans styrka och skrynklan i x, y och z. */
  private noise: Float32Array;

  /**
   * `noiseCell` > 0 tar slumpen ur ett mjukt brus i rummet i stället för per hörn: för oregelbundna nät
   * (Blendermodeller), där hörn på samma plats vid en färgkant annars glipar och täta hörn blir taggiga.
   */
  /** `side` (0..1) skalar bucklor från träffar rakt från sidan: en styvare långsida. */
  constructor(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    noiseCell = 0,
    private side = 1,
  ) {
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.pos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.orig = new Float32Array(this.pos.array as Float32Array);
    this.disp = new Float32Array(this.orig.length);
    this.noise = new Float32Array(this.pos.count * 4);
    const o = this.orig;
    [0, 7, 13, 19].forEach((off, k) => {
      for (let i = 0; i < this.pos.count; i++) {
        this.noise[i * 4 + k] = noiseCell > 0 ? valueNoise(o[i * 3]!, o[i * 3 + 1]!, o[i * 3 + 2]!, noiseCell, k) : hash(i + off);
      }
    });
  }

  dent(local: THREE.Vector3, dir: THREE.Vector3, amount: number, radius: number) {
    const MAX = 0.55;
    const r2 = radius * radius;
    amount *= 1 + (this.side - 1) * Math.abs(dir.x);
    for (let i = 0; i < this.pos.count; i++) {
      const dx = this.orig[i * 3]! + this.disp[i * 3]! - local.x;
      const dy = this.orig[i * 3 + 1]! + this.disp[i * 3 + 1]! - local.y;
      const dz = this.orig[i * 3 + 2]! + this.disp[i * 3 + 2]! - local.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2 * 5) continue;
      const w = Math.exp(-d2 / r2);
      const n = this.noise;
      const k = amount * w * (0.8 + 0.4 * n[i * 4]!);
      let x = this.disp[i * 3]! + dir.x * k + (n[i * 4 + 1]! - 0.5) * 0.12 * k;
      let y = this.disp[i * 3 + 1]! + dir.y * k + (n[i * 4 + 2]! - 0.5) * 0.12 * k;
      let z = this.disp[i * 3 + 2]! + dir.z * k + (n[i * 4 + 3]! - 0.5) * 0.12 * k;
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

  /** Krymper bucklorna mot k (0 = hel), för en lagning man ser. */
  scale(k: number) {
    for (let i = 0; i < this.disp.length; i++) this.disp[i]! *= k;
    this.commit();
  }
}

/** Uppdelad låda med rundade kanter, centrerad i `c`. */
function roundedBox(
  w: number,
  h: number,
  l: number,
  segs: [number, number, number],
  r: number,
  c: [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(w, h, l, ...segs);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  roundBox(g.getAttribute('position') as THREE.BufferAttribute, w / 2, h / 2, l / 2, r);
  g.translate(...c);
  return g;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const BODIES: Record<CarModel['body'], BodyShape> = {
  kvarn240,
  kvarn240Turbo,
  kvarnTurbo4x4,
  soraTurbo,
  arashiRs,
  ljung1600,
  ljung2000,
  strandGt,
  brenner5t,
  volpeTurbo,
  hoshi4wd,
};

/** Bilar med en egen modell från Blender (blender/). Övriga byggs av formen i bodies/. */
const MODELS: Partial<Record<CarModel['body'], ModelData>> = { soraTurbo: soraTurboModel, hoshi4wd: hoshi4wdModel };

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
 * Material för en del av en Blendermodell: färgen efter hörnets material, lacken (med dekaler på karossen)
 * och skarvarna i lackens färg. Lyktorna lyser som på de byggda bilarna; `left` väljer strålkastarsidan.
 */
function modelMaterial(data: ModelData, paint: THREE.Color, lamp: THREE.Node<'float'>, tail: FloatUniform, painted: THREE.Node<'color'> = color(paint)) {
  const m = attribute('mat', 'float');
  const is = (name: string) => abs(m.sub(data.materials.indexOf(name))).lessThan(0.5);
  const colorOf = (name: string): THREE.Node<'color'> => {
    if (name === 'paint') return painted;
    if (name === 'shade') return color(paint.clone().multiplyScalar(0.72));
    const c = PALETTE[name];
    if (!c) throw new Error(`Okänt material i bilmodellen: ${name}`);
    return color(c);
  };
  const mat = new THREE.MeshToonNodeMaterial();
  mat.colorNode = data.materials.reduce<THREE.Node<'color'>>((acc, name) => select(is(name), colorOf(name), acc), color(BLACK));
  mat.emissiveNode = select(is('lamp'), color(LAMP).mul(lamp), select(is('tail'), color(TAIL).mul(tail), vec3(0)));
  return mat;
}

/**
 * Delarna ur en Blendermodell. 'body' och 'body_…' (dörrar, stötfångare, baklucka) är paneler som bucklas
 * var för sig och bär dekalerna, 'wheel' är hela hjulet (utsidan åt +x), 'rim'
 * bara fälgen (sätts i ett däck byggt i koden) och resten är lösa detaljer som ramlar
 * av. Extraljusrampen ('pod…') bara om `pod`.
 */
function buildModel(data: ModelData, b: BodyShape, paint: THREE.Color, lampGlow: LampGlow, tailGlow: FloatUniform, decals: THREE.Texture, pod: boolean) {
  // Dekaler på lacken: sidorna under gördellinjen, huven, bakluckan och taket.
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
      // Platta ytor: fälgens skarpa kanter ska inte rundas av mjuka normaler.
      const flat = g.toNonIndexed();
      flat.computeVertexNormals();
      rim = new THREE.Mesh(flat, modelMaterial(data, paint, lampGlow[0], tailGlow));
      rim.castShadow = true;
      continue;
    }
    if (part.name === 'body' || part.name.startsWith('body_')) {
      // Dekalerna och bucklorna räknas i bilens koordinater, så panelerna har sitt origo i bilens.
      if (part.at.some((c) => c !== 0)) throw new Error(`${part.name}: panelens origo ska ligga i bilens origo`);
      panels.push(new DeformablePart(g, panelMaterial, 0.12, 0.35));
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
  if (!panels.length) throw new Error('Bilmodellen saknar body');
  return { panels, details, wheel, rim };
}

/** Ett hjul av modellens hjul; på höger sida speglat, så fälgens utsida vänds utåt. */
function modelWheel(wheel: THREE.Mesh, left: boolean): THREE.Group {
  const g = new THREE.Group();
  const m = wheel.clone();
  m.scale.x = left ? 1 : -1;
  g.add(m);
  return g;
}

type Hit = [x: number, y: number, z: number, nx: number, ny: number, nz: number];

/** Var skadezonerna träffas när bucklorna ritas från siffrorna: punkt och riktningen plåten trycks. */
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

/** Karossen med lyktor, grill, lister och hjulhus över hjulen i `wheelZ`. */
function buildBody(
  b: BodyShape,
  wheelZ: Range,
  paint: THREE.Color,
  lampGlow: LampGlow,
  tailGlow: FloatUniform,
  decals: THREE.Texture,
): DeformablePart {
  const { bottom, nose, tail, belt, crease, screen, backlight, archY, archR } = b;
  const g = roundedBox(2 * b.halfX, belt - bottom, nose - tail, [14, 14, Math.round((nose - tail) * 21)], b.round ?? 0.05, [
    0,
    (belt + bottom) / 2,
    (nose + tail) / 2,
  ]);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    // Huven sluttar svagt ner mot fronten, bakluckan rundas av i bakkant.
    const hood = b.hoodDrop * clamp01((z - screen[0]) / (nose - screen[0])) ** 1.4;
    const trunk = b.trunkDrop * clamp01((backlight[0] - z) / (backlight[0] - tail)) ** 1.3;
    const rise = (b.beltRise ?? 0) * clamp01((screen[0] - z) / (screen[0] - tail));
    // Plåten som flyttas räcker dubbelt så djupt som huven sluttar, så en djup nos inte trycks ihop.
    const span = Math.max(0.3, 2 * b.hoodDrop);
    y -= (hood + trunk - rise) * clamp01((y - (belt - span)) / span);
    if (b.taper) {
      // Rundad nos och bakparti sett ovanifrån.
      x *= 1 - b.taper[0] * clamp01((z - (nose - 0.7)) / 0.7) ** 2 - b.taper[1] * clamp01((tail + 0.5 - z) / 0.5) ** 2;
    }
    // Sidan lutar lite inåt ovanför sidolisten.
    x *= 1 - 0.03 * clamp01((y - crease) / (belt - crease));
    pos.setXY(i, x, y);
  }
  // Utbyggda hjulhus: sidan under en hylla strax under gördellinjen skjuts ut kring hjulen,
  // med korta sluttande övergångar så de blir lådformade.
  if (b.flare) {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (Math.abs(x) < b.halfX - 0.12) continue;
      const out = clamp01((belt - 0.06 - pos.getY(i)) / 0.04);
      const along = Math.max(...wheelZ.map((zw, w) => clamp01((archR[w]! + 0.2 - Math.abs(pos.getZ(i) - zw)) / 0.05)));
      const k = clamp01((Math.abs(x) - (b.halfX - 0.12)) / 0.12);
      pos.setX(i, x + Math.sign(x) * b.flare * out * along * k);
    }
  }
  // Hjulhus: lyft plåten ytterst över hjulen upp till en båge, så hela hjulet syns.
  // Bara |x| > 0.5 lyfts, så kvarvarande plåt innanför bildar hjulhusets innervägg.
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) < 0.5) continue;
    wheelZ.forEach((zw, w) => {
      const r = archR[w]!;
      const dz = pos.getZ(i) - zw;
      if (Math.abs(dz) >= r) return;
      pos.setY(i, Math.max(pos.getY(i), archY + Math.sqrt(r * r - dz * dz)));
    });
  }
  // Färgerna räknas från formen före bucklorna. Efter lyftet ligger hjulhusets tak precis
  // på bågen, så kanten mot sidan blir en ren cirkel.
  g.setAttribute('rest', pos.clone());
  g.computeVertexNormals();
  // Färgen räknas per pixel från vilopositionen, så lyktornas kanter blir skarpa
  // (hörnfärger tonas ut över en hel ruta) och följer med när plåten bucklas.
  const p = attribute('rest', 'vec3');
  const ax = abs(p.x);
  const band = (lo: number, hi: number) => p.y.greaterThan(lo).and(p.y.lessThan(hi));
  const front = p.z.greaterThan(nose - 0.04);
  const rear = p.z.lessThan(tail + 0.04);
  const side = ax.greaterThan(b.halfX - 0.05);
  const top = p.y.greaterThan(belt - 0.1);
  const { lampY, lampX, tailY } = b;

  // Fram: grill med kromram och lodräta lameller, höga rektangulära strålkastare som fyller
  // fronten från huvkanten ner till stötfångaren, blinkers i lyktans nedre ytterhörn.
  const grilleBox = front.and(ax.lessThan(b.grilleX)).and(band(...lampY));
  const grilleFrame = grilleBox.and(ax.greaterThan(b.grilleX - 0.025).or(p.y.lessThan(lampY[0] + 0.02)).or(p.y.greaterThan(lampY[1] - 0.02)));
  const crate = fract(p.x.mul(40)).lessThan(0.35);
  const lampUnit = front.and(ax.greaterThan(lampX[0])).and(ax.lessThan(lampX[1])).and(band(...lampY));
  const lampRim = front.and(ax.greaterThan(lampX[0] - 0.015)).and(ax.lessThan(lampX[1] + 0.015)).and(band(lampY[0] - 0.015, lampY[1] + 0.015));
  // Med blinkers i stötfångaren har strålkastarna inga (bandet 9–9 är tomt).
  const indicator = (b.bumperBlinkers ? band(9, 9) : band(lampY[0], lampY[0] + 0.09)).and(
    lampUnit.and(ax.greaterThan(lampX[0] + 0.6 * (lampX[1] - lampX[0]))).or(side.and(p.z.greaterThan(nose - 0.08))),
  );
  let lamp = lampUnit.and(indicator.not());
  let lampFrame = lampRim;
  if (b.roundLamps) {
    // Runda lyktor med kromring i en svart panel som går från grillen ut till hörnet.
    const dist = ([x, r]: [number, number]) => ax.sub(x).mul(ax.sub(x)).add(p.y.sub((lampY[0] + lampY[1]) / 2).pow(2)).sqrt().div(r);
    const near = (lim: number) => b.roundLamps!.map((l) => dist(l).lessThan(lim)).reduce((a, c) => a.or(c));
    lamp = front.and(near(0.82));
    lampFrame = front.and(near(1)).or(lampUnit);
  }
  // Ventilspringor i huven, ute vid kanterna så startnumret får plats emellan.
  const vents = b.hoodVents
    ? top.and(p.z.greaterThan(nose - 0.8)).and(p.z.lessThan(nose - 0.5)).and(ax.greaterThan(0.46)).and(ax.lessThan(0.66)).and(fract(p.z.mul(28)).lessThan(0.45))
    : null;
  const scoop = b.hoodScoop ? top.and(p.z.greaterThan(screen[0] + 0.12)).and(p.z.lessThan(screen[0] + 0.4)).and(ax.lessThan(0.24)) : null;

  // Bak: höga lyktor som går runt hörnen, röd med blinkersband överst och backljus inåt.
  const tailZone = band(...tailY).and(rear.and(ax.greaterThan(b.tailX)).or(side.and(p.z.lessThan(tail + 0.14))));
  const tailAmber = tailZone.and(p.y.greaterThan(tailY[1] - 0.055));
  const tailReverse = tailZone.and(rear).and(ax.lessThan(b.tailX + 0.1));
  const plate = rear.and(ax.lessThan(0.26)).and(band(tailY[0] + 0.03, tailY[1] - 0.05));

  // Sidor: mörk skyddslist med kromkant, dörrspringor, mörka hjulhus och grå trösklar.
  const stripZ = side.and(p.z.lessThan(nose - 0.12)).and(p.z.greaterThan(tail + 0.16));
  const strip = stripZ.and(band(crease - 0.016, crease + 0.008));
  const stripChrome = stripZ.and(band(crease + 0.008, crease + 0.018));
  const seamAt = (z: number) => abs(p.z.sub(z)).lessThan(0.008);
  const seam = side.and(p.y.greaterThan(bottom + 0.09)).and([screen[0], ...b.doorSeams].map(seamAt).reduce((a, c) => a.or(c)));
  const archDist = (w: number) => p.z.sub(wheelZ[w]!).mul(p.z.sub(wheelZ[w]!)).add(p.y.sub(archY).mul(p.y.sub(archY))).sqrt().sub(archR[w]!);
  const archs = ax.greaterThan(b.halfX - 0.4).and(archDist(0).lessThan(0.004).or(archDist(1).lessThan(0.004)));
  // Smal skuggad kant runt hjulhusen på sidan.
  const archLip = side.and(archDist(0).lessThan(0.03).or(archDist(1).lessThan(0.03)));
  // Skarvar runt motorhuven och bakluckan.
  const lidSeam = top.and(
    ax
      .lessThan(b.halfX - 0.07)
      .and(seamAt(screen[0]).or(seamAt(backlight[0])))
      .or(ax.sub(b.halfX - 0.05).abs().lessThan(0.006).and(p.z.greaterThan(screen[0]))),
  );

  const shaded = select(seam.or(lidSeam), color(paint.clone().multiplyScalar(0.72)), select(archLip, color(paint.clone().multiplyScalar(0.86)), color(paint)));
  const vented = vents ? select(vents, color(BLACK), shaded) : shaded;
  const painted = scoop ? select(scoop, select(fract(p.x.mul(30)).lessThan(0.3), color(DARK), color(BLACK)), vented) : vented;
  const trimmed = bodyDecals(select(stripChrome, color(CHROME), select(strip, color(DARK), painted)), p, side, b, decals, paint);
  const body = select(archs, color(BLACK), select(p.y.lessThan(bottom + 0.17), color(SILL), trimmed));
  const tailColor = select(tailReverse, color(REVERSE), select(tailAmber, color(AMBER), color(TAIL)));
  const mat = new THREE.MeshToonNodeMaterial();
  mat.colorNode = select(
    grilleBox,
    b.lampBand ? color(BLACK) : select(grilleFrame, color(CHROME), select(crate, color(DARK), color(BLACK))),
    select(
      lamp,
      color(LAMP),
      select(
        indicator,
        color(AMBER),
        select(lampFrame, b.roundLamps ? select(lampUnit.and(lamp.not()), color(BLACK), color(CHROME)) : color(b.lampBand ? BLACK : CHROME), select(tailZone, tailColor, select(plate, color(PLATE), body))),
      ),
    ),
  );
  // Lyktorna lyser lite själva, så de inte blir mörka i skugga, och starkt när strålkastarna är på.
  // Blinkers och backljus används inte och lyser därför aldrig.
  mat.emissiveNode = select(
    lamp,
    color(LAMP).mul(select(p.x.greaterThan(0), lampGlow[0], lampGlow[1])),
    select(tailZone.and(tailAmber.or(tailReverse).not()), color(TAIL).mul(tailGlow), vec3(0)),
  );
  return new DeformablePart(g, mat);
}

/** Kupé med lutande vindruta och bakruta, svarta fönsterlister och lodräta mittstolpar. */
function buildCabin(b: BodyShape, paint: THREE.Color, decals: THREE.Texture): DeformablePart {
  const { screen, backlight, belt } = b;
  const H = b.roof - belt + 0.01;
  const L = screen[0] - backlight[0];
  const hx = b.cabinHalfX;
  const g = roundedBox(2 * hx, H, L, [12, 6, 24], 0.05);
  // Rutor räknas i lådans koordinater före formningen, se buildBody.
  g.setAttribute('rest', (g.getAttribute('position') as THREE.BufferAttribute).clone());
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const baseMid = (screen[0] + backlight[0]) / 2;
  const topMid = (screen[1] + backlight[1]) / 2;
  const topHalf = (screen[1] - backlight[1]) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = pos.getZ(i) / (L / 2); // -1 bak, 1 fram
    const t = y / H + 0.5; // 0 nere, 1 uppe
    // Stolparna går rakt från rutornas fot till taket.
    const z = (1 - t) * (baseMid + (u * L) / 2) + t * (topMid + u * topHalf);
    // Sidorutorna lutar inåt, taket välvs svagt.
    const crown = 0.03 * (x / hx) ** 2 * t ** 3;
    // Nedersta raden sänks ner i karossen, så stolparna möter gördellinjen utan hack.
    const sink = 0.06 * (1 - t) ** 3;
    pos.setXYZ(i, x * (1 - 0.17 * t), belt - 0.01 + t * H - crown - sink, z);
  }
  g.computeVertexNormals();
  const p = attribute('rest', 'vec3');
  const t = p.y.div(H).add(0.5);
  const u = p.z.div(L / 2);
  const tIn = (lo: number, hi: number) => t.greaterThan(lo).and(t.lessThan(hi));
  const ax = abs(p.x);
  const side = ax.greaterThan(hx - 0.04);
  const ends = abs(u).greaterThan(0.96);
  // Bilens z, så B-stolpen och stolpen vid kvartsrutan blir lodräta och inte lutar med A/C.
  const z = t.oneMinus().mul(u.mul(L / 2).add(baseMid)).add(t.mul(u.mul(topHalf).add(topMid)));
  const zIn = (lo: number, hi: number) => z.greaterThan(lo).and(z.lessThan(hi));
  // Sidorutor åtskilda av svarta stolpar. Den främsta följer A-stolpen, den bakersta C-stolpen.
  const pane = ([lo, hi]: Range) =>
    hi === Infinity ? z.greaterThan(lo).and(u.lessThan(0.93)) : lo === -Infinity ? z.lessThan(hi).and(u.greaterThan(-0.8)) : zIn(lo, hi);
  const sideGlass = side.and(tIn(0.13, 0.91)).and(b.sideGlass.map(pane).reduce((a, c) => a.or(c)));
  // A-stolparna och vindrutans ram är mörka hela vägen ut; C-stolpen är lackad.
  const sideTrim = side.and(tIn(0.08, 0.95)).and(u.greaterThan(-0.84));
  const endGlass = ends.and(ax.lessThan(hx - 0.12)).and(tIn(0.1, 0.9));
  const endTrim = ends.and(tIn(0.05, 0.95)).and(u.greaterThan(0).or(ax.lessThan(hx - 0.08)));
  const glass = sideGlass.or(endGlass);
  const aPillar = u.greaterThan(0.9).and(ax.greaterThan(hx - 0.12)).and(tIn(0.05, 0.95));
  const trim = sideTrim.or(endTrim).or(aPillar);
  const mat = new THREE.MeshToonNodeMaterial();
  // Taket: plana ovansidan, med x och z som efter formningen.
  const roof = t.greaterThan(0.97).and(abs(u).lessThan(0.95));
  const painted = roofDecals(color(paint), p.x.mul(0.83), u.mul(topHalf).add(topMid), roof, b, decals, paint);
  mat.colorNode = select(glass, color(GLASS), select(trim, color(BLACK), painted));
  return new DeformablePart(g, mat);
}

/** Stor svart stötfångare med kromlist överst, som går runt hörnen. */
interface BumperStyle {
  /** Lack; utan den blir stötfångaren svart med kromlist. */
  paint?: THREE.Color;
  /** Höjd och hörnradie. */
  H?: number;
  r?: number;
  /** Svart luftintag med lameller på framsidan, och blinkers i hörnen. */
  intake?: boolean;
  blinkers?: boolean;
}

function buildBumper(halfX: number, z: number, y: number, depth: number, { paint, H = 0.2, r = 0.05, intake = true, blinkers = false }: BumperStyle = {}): DeformablePart {
  const g = roundedBox(2 * halfX + 0.08, H, depth, [8, 3, 6], r, [0, y, z]);
  g.computeVertexNormals();
  const mat = new THREE.MeshToonNodeMaterial();
  // Höjd räknad från stötfångarens överkant, så detaljerna sitter rätt oavsett höjd.
  const h = positionGeometry.y.sub(y + H / 2);
  const x = abs(positionGeometry.x);
  const face = positionGeometry.z.sub(z).mul(Math.sign(z)).greaterThan(depth / 2 - 0.03);
  // Lackad stötfångare: svart underkant, svarta luftintag med lameller och blinkers ute i hörnen.
  const vent = face.and(x.lessThan(halfX - 0.2)).and(h.lessThan(-0.06)).and(h.greaterThan(0.03 - H));
  const slat = fract(h.mul(45)).lessThan(0.3);
  const blinker = face.and(h.greaterThan(-0.055)).and(h.lessThan(-0.015)).and(x.greaterThan(halfX - 0.32)).and(x.lessThan(halfX - 0.08));
  const vented = intake ? select(vent, select(slat, color(DARK), color(BLACK)), color(paint ?? BLACK)) : color(paint ?? BLACK);
  mat.colorNode = paint
    ? select(h.lessThan(0.025 - H), color(BLACK), blinkers ? select(blinker, color(AMBER), vented) : vented)
    : select(h.greaterThan(-0.065).and(h.lessThan(-0.045)), color(CHROME), color(BLACK));
  return new DeformablePart(g, mat);
}

/** En detalj som lossnar när karossen under den buckats in, och då faller till marken. */
interface Detail {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  dent: number;
  /** Stänkskydd: hänger under karossen, så träffar ovanför räknas och de lossnar lättare. */
  flap: boolean;
  loose: boolean;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

/** Bucklans djup (m) vid en detalj innan den lossnar. */
const DETACH_DENT = 0.12;

/** Små odeformerbara detaljer: speglar, främre nummerplåt, stänkskydd, dörrhandtag. */
/**
 * Klass 2-bilarnas extraljusramp: fyra runda lampor på en svart balk framför grillen.
 * Lyser med strålkastarna och ramlar av, en och en, vid krockar framifrån.
 */
function addLampPod(g: THREE.Group, b: BodyShape, lampGlow: LampGlow) {
  const black = new THREE.MeshToonMaterial({ color: BLACK });
  const y = (b.lampY[0] + b.lampY[1]) / 2;
  const z = b.nose + 0.16;
  const xs = b.podX ?? [0.52, 0.18, -0.18, -0.52];
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * xs[0]! + 0.16, 0.04, 0.04), black);
  bar.position.set(0, y - 0.1, z - 0.02);
  g.add(bar);
  const housing = new THREE.CylinderGeometry(0.095, 0.08, 0.1, 20).rotateX(Math.PI / 2);
  const lens = new THREE.CylinderGeometry(0.078, 0.078, 0.01, 20).rotateX(Math.PI / 2).translate(0, 0, 0.051);
  for (const x of xs) {
    const glass = new THREE.MeshToonNodeMaterial();
    glass.colorNode = color(LAMP);
    glass.emissiveNode = color(LAMP).mul(lampGlow[x > 0 ? 0 : 1]);
    const lamp = new THREE.Mesh(housing, black);
    lamp.add(new THREE.Mesh(lens, glass));
    lamp.position.set(x, y, z);
    lamp.castShadow = true;
    g.add(lamp);
  }
}

function buildDetails(b: BodyShape, wheelZ: Range, paint: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const black = new THREE.MeshToonMaterial({ color: BLACK });
  const add = (w: number, h: number, l: number, x: number, y: number, z: number, m: THREE.Material, name = '') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(0.5, 0.11, 0.02, 0, b.bumperY[0], b.nose + 0.11, new THREE.MeshToonMaterial({ color: PLATE }));
  if (b.spoiler === 'roof') {
    // Takspoiler över bakrutans överkant, lutad bakåt, på två fästen.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(2 * b.cabinHalfX * 0.8, 0.025, 0.2), new THREE.MeshToonMaterial({ color: paint }));
    lip.position.set(0, b.roof + 0.035, b.backlight[1] - 0.1);
    lip.rotation.x = -0.25;
    lip.castShadow = true;
    g.add(lip);
    for (const s of [1, -1]) add(0.03, 0.04, 0.1, s * 0.45, b.roof + 0.01, b.backlight[1] - 0.06, black);
  } else if (b.spoiler === 'trunk') {
    // Vinge över bakluckans bakkant, på två fästen, nästan hela bilens bredd.
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2 * b.halfX - 0.16, 0.03, 0.18), new THREE.MeshToonMaterial({ color: paint }));
    // Bakluckans kant ligger beltRise över gördellinjen; vingen står strax ovanför den.
    const deck = b.belt + (b.beltRise ?? 0);
    wing.position.set(0, deck + 0.07, b.tail + 0.16);
    wing.rotation.x = -0.1;
    wing.castShadow = true;
    g.add(wing);
    for (const s of [1, -1]) add(0.04, 0.1, 0.08, s * (b.halfX - 0.22), deck + 0.02, b.tail + 0.18, new THREE.MeshToonMaterial({ color: paint }));
  }
  if (b.roofVent) {
    // Luftintag till kupén framtill på taket, med svart öppning framåt.
    add(0.32, 0.05, 0.22, 0, b.roof + 0.02, b.screen[1] - 0.2, new THREE.MeshToonMaterial({ color: paint }));
    add(0.26, 0.03, 0.01, 0, b.roof + 0.025, b.screen[1] - 0.088, black);
  }
  const mirrorZ = b.screen[0] - 0.12;
  for (const s of [1, -1]) {
    // Spegeln sitter på dörren i sidorutans främre hörn.
    add(0.08, 0.05, 0.08, s * (b.cabinHalfX + 0.03), b.belt + 0.05, mirrorZ + 0.01, black); // spegelfot
    add(0.15, 0.12, 0.08, s * (b.cabinHalfX + 0.14), b.belt + 0.1, mirrorZ, b.paintedMirrors ? new THREE.MeshToonMaterial({ color: paint }) : black); // spegel
    add(0.2, 0.16, 0.015, s * (b.halfX - 0.13), b.bottom - 0.08, wheelZ[0] - 0.46, black, 'flap'); // stänkskydd fram
    add(0.2, 0.16, 0.015, s * (b.halfX - 0.13), b.bottom - 0.08, wheelZ[1] - 0.46, black, 'flap'); // stänkskydd bak
    for (const z of b.doorHandles) add(0.02, 0.03, 0.14, s * (b.halfX + 0.005), b.belt - 0.09, z, black);
  }
  return g;
}

/** Ett ihåligt däck runt en modellerad fälg (innerradie 0,205 m), så de insänkta ekrarna syns. */
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

function buildWheel(radius: number, rally = false): THREE.Group {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.22, 28).rotateZ(Math.PI / 2),
    new THREE.MeshToonMaterial({ color: 0x242424 }),
  );
  // Släta navkapslar med en ring av korta slitsar, som visar rotationen.
  const cap = (r: number, w: number, c: number) =>
    new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28).rotateZ(Math.PI / 2), new THREE.MeshToonMaterial({ color: c }));
  g.add(tyre, cap(radius * (rally ? 0.72 : 0.7), 0.232, rally ? 0xf2f2ee : 0xd6d6d6), cap(radius * 0.2, 0.24, 0xb4b4b4));
  // Rallyfälgen: tät ring av smala hål nära kanten, så den liknar en ekrad fälg.
  const slotMat = new THREE.MeshToonMaterial({ color: rally ? 0x2a2a2a : 0x6a6a6a });
  const [count, at, len] = rally ? [20, 0.52, 0.32] : [10, 0.47, 0.2];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.236, radius * len, rally ? 0.018 : 0.03), slotMat);
    s.position.set(0, Math.cos(a) * radius * at, Math.sin(a) * radius * at);
    s.rotation.x = -a;
    g.add(s);
  }
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/** Lyktglasets självlysning [vänster, höger]; lokalt x > 0 är vänster. */
type FloatUniform = THREE.UniformNode<'float', number>;
type LampGlow = [FloatUniform, FloatUniform];

export class CarMesh {
  readonly group = new THREE.Group();
  private lampGlow: LampGlow = [uniform(0.5), uniform(0.5)];
  /** Baklyktornas röda sken: alltid tänt, starkare med strålkastarna och mycket starkare vid inbromsning. */
  private tailGlow: FloatUniform = uniform(0.9);
  /** Baklyktornas röda sken på marken bakom bilen, ett per lykta; riktat bakåt så det inte färgar karossen. */
  private tailLights = [0, 1].map(() => new THREE.SpotLight(0xff1a0a, 0, 10, 1.2, 0.8, 2));
  /** Smal kägla bakifrån mot stötfångaren under varje lykta, så ytan mellan lyktorna förblir mörk. */
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
    // Främre stötfångaren går bak till hjulhuset, den bakre en bit runt hörnen.
    const front = b.nose + 0.1 - (wheelZ[0] + b.archR[0] + 0.04);
    const decals = decalTexture(b, wheelZ, c, startNumber(car.params.name), model.sponsors?.() ?? []);
    const data = MODELS[model.body];
    const built = data && buildModel(data, b, c, this.lampGlow, this.tailGlow, decals, tierOf(car.params.name) === 2);
    this.parts = built ? built.panels : [
      buildBody(b, wheelZ, c, this.lampGlow, this.tailGlow, decals),
      buildCabin(b, c, decals),
      // En avsmalnande nos får en smalare stötfångare med rundare hörn, så den följer formen.
      buildBumper((b.halfX + (b.flare ?? 0)) * (1 - 0.5 * (b.taper?.[0] ?? 0)), b.nose + 0.1 - front / 2, b.bumperY[0], front, {
        paint: b.paintedBumpers ? c : undefined,
        H: b.bumperH,
        r: b.taper ? 0.12 : 0.05,
        blinkers: b.bumperBlinkers,
      }),
      buildBumper((b.halfX + (b.flare ?? 0)) * (1 - 0.5 * (b.taper?.[1] ?? 0)), b.tail - 0.09 + b.rearBumperDepth / 2, b.bumperY[1], b.rearBumperDepth, {
        paint: b.paintedBumpers ? c : undefined,
        H: b.bumperH,
        r: b.taper ? 0.12 : 0.05,
        intake: !b.frontIntakeOnly,
      }),
    ];
    this.parts.forEach((p) => this.group.add(p.mesh));
    this.detailGroup = built ? built.details : buildDetails(b, wheelZ, c);
    if (!built && tierOf(car.params.name) === 2) addLampPod(this.detailGroup, b, this.lampGlow);
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
    // Strax bakom bakpartiet, så karossen ligger bakom ljuskäglan.
    // Ett par ljus per baklykta, mitt för lyktan ute vid hörnet.
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
      const w = built?.wheel
        ? modelWheel(built.wheel, car.params.wheels[i]!.mount[0] > 0)
        : built?.rim
          ? buildModelWheel(car.params.wheelRadius, built.rim)
          : buildWheel(car.params.wheelRadius, b.rallyRims);
      this.wheels.push(w);
    }
  }

  addTo(scene: THREE.Object3D) {
    scene.add(this.group);
    this.wheels.forEach((w) => scene.add(w));
  }

  /** `fall` = false när skadan återskapas (dentFrom): lösa detaljer saknas då bara, de ramlar inte. */
  applyDamage(events: DamageEvent[], fall = true) {
    if (events.length === 0) return;
    for (const e of events) {
      const amount = Math.min(0.32, e.impulse * 0.00009);
      const radius = e.kind === 'ground' ? 0.5 : 0.75;
      for (const part of this.parts) part.dent(e.local, e.normal, amount, radius);
      for (const d of this.details) {
        if (d.loose) continue;
        // Stänkskyddet sitter i karossens underkant: mät bara i sidled och längsled.
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

  /** Lyktglaset: svagt sken på dagen, starkt med strålkastarna på, släckt när lyktan är trasig. Baklyktorna lyser alltid. */
  setLamps(on: boolean, lamps: number[], braking: boolean) {
    lamps.forEach((l, i) => (this.lampGlow[i]!.value = l >= LAMP_BROKEN ? 0 : on ? 2.4 * (1 - 0.6 * l) : 0.5));
    // Glaset lyser klart med strålkastarna på; vid inbromsning ännu starkare.
    this.tailGlow.value = braking ? 4 : on ? 2.5 : 0.9;
    // Skenet på stötfångaren, marken, rök och damm syns bara vid inbromsning i mörker (strålkastarna på).
    const tail = on && braking ? 2 : 0;
    this.tailLights.forEach((l) => (l.intensity = tail));
    this.bumperLights.forEach((l) => (l.intensity = tail * 0.8));
  }

  /**
   * Bucklor som motsvarar skadesiffrorna, när de riktiga träffarna inte finns kvar
   * (t.ex. efter omladdningen mellan etapperna). Samma impuls som gav siffran i Car.registerDamage.
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

  /** Krymper bucklorna mot k; anropas varje bildruta under en lagning. */
  heal(k: number) {
    for (const p of this.parts) p.scale(k);
  }

  /** Lös detalj: faller, studsar lite mot marken och glider till stillastående. */
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
