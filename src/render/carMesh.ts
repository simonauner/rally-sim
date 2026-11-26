import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { abs, attribute, color, fract, positionGeometry, select, vec3 } from 'three/tsl';
import type { Car, DamageState } from '../physics/car';
import type { DamageEvent } from '../physics/collision';
import type { CarModel } from '../physics/params';

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

type Range = readonly [number, number];

/** Karossens form i bilens koordinater (fram = +z, origo i tyngdpunkten). */
interface BodyShape {
  halfX: number;
  bottom: number;
  /** Plåtens framkant och bakkant. */
  nose: number;
  tail: number;
  /** Gördellinjen, rak från huv till baklucka. */
  belt: number;
  roof: number;
  /** Sidolistens höjd. */
  crease: number;
  /** Vindrutans och bakrutans fot och topp (z). */
  screen: Range;
  backlight: Range;
  /** Hur mycket huven sluttar ner mot fronten och bakluckan mot bakkanten. */
  hoodDrop: number;
  trunkDrop: number;
  cabinHalfX: number;
  /** Hjulhusens centrum (y) och radie fram och bak. */
  archY: number;
  archR: Range;
  /** Dörrspringor bakom vindrutans fot (z). */
  doorSeams: number[];
  /** Sidorutor (z från, till). ±Infinity följer A- respektive C-stolpen. */
  sideGlass: Range[];
  doorHandles: number[];
  lampY: Range;
  grilleX: number;
  lampX: Range;
  tailY: Range;
  /** Baklyktornas innerkant. */
  tailX: number;
  bumperY: Range;
  rearBumperDepth: number;
}

const SHAPES: Record<CarModel['body'], BodyShape> = {
  // Kantig 80-talssedan: lång flat huv och baklucka, stora fyrkantiga lyktor.
  sedan: {
    halfX: 0.85,
    bottom: -0.31,
    nose: 1.96,
    tail: -2.53,
    belt: 0.4,
    roof: 0.83,
    crease: 0.19,
    screen: [0.546, 0.123],
    backlight: [-1.67, -1.318],
    hoodDrop: 0.08,
    trunkDrop: 0.05,
    cabinHalfX: 0.74,
    archY: -0.24,
    archR: [0.39, 0.38], // bakre hjulhuset sluter tätare om hjulet
    doorSeams: [-0.4, -1.22],
    sideGlass: [
      [-0.37, Infinity],
      [-1.06, -0.45],
      [-Infinity, -1.11],
    ],
    doorHandles: [-0.27, -1.1],
    lampY: [0.03, 0.255],
    grilleX: 0.39,
    lampX: [0.43, 0.79],
    tailY: [0.04, 0.24],
    tailX: 0.46,
    bumperY: [-0.1, -0.055],
    rearBumperDepth: 0.46,
  },
  // Liten tredörrars halvkombi: kort sluttande huv, lång dörr, nästan lodrät baklucka.
  hatch: {
    halfX: 0.825,
    bottom: -0.3,
    nose: 1.65,
    tail: -2.07,
    belt: 0.36,
    roof: 0.86,
    crease: 0.12,
    screen: [0.62, 0.06],
    backlight: [-2.0, -1.64],
    hoodDrop: 0.11,
    trunkDrop: 0,
    cabinHalfX: 0.71,
    archY: -0.22,
    archR: [0.36, 0.355],
    doorSeams: [-0.66],
    sideGlass: [
      [-0.6, Infinity],
      [-Infinity, -0.7],
    ],
    doorHandles: [-0.52],
    lampY: [0.0, 0.17],
    grilleX: 0.33,
    lampX: [0.37, 0.77],
    tailY: [0.0, 0.2],
    tailX: 0.38,
    bumperY: [-0.13, -0.12],
    rearBumperDepth: 0.3,
  },
};

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
function buildBody(b: BodyShape, wheelZ: Range, paint: THREE.Color): DeformablePart {
  const { bottom, nose, tail, belt, crease, screen, backlight, archY, archR } = b;
  const g = roundedBox(2 * b.halfX, belt - bottom, nose - tail, [14, 14, Math.round((nose - tail) * 21)], 0.05, [
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
    y -= (hood + trunk) * clamp01((y - (belt - 0.3)) / 0.3);
    // Sidan lutar lite inåt ovanför sidolisten.
    x *= 1 - 0.03 * clamp01((y - crease) / (belt - crease));
    pos.setXY(i, x, y);
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
  const indicator = band(lampY[0], lampY[0] + 0.09).and(
    lampUnit.and(ax.greaterThan(lampX[0] + 0.6 * (lampX[1] - lampX[0]))).or(side.and(p.z.greaterThan(nose - 0.08))),
  );
  const lamp = lampUnit.and(indicator.not());

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

  const painted = select(seam.or(lidSeam), color(paint.clone().multiplyScalar(0.72)), select(archLip, color(paint.clone().multiplyScalar(0.86)), color(paint)));
  const trimmed = select(stripChrome, color(CHROME), select(strip, color(DARK), painted));
  const body = select(archs, color(BLACK), select(p.y.lessThan(bottom + 0.17), color(SILL), trimmed));
  const tailColor = select(tailReverse, color(REVERSE), select(tailAmber, color(AMBER), color(TAIL)));
  const mat = new THREE.MeshToonNodeMaterial();
  mat.colorNode = select(
    grilleBox,
    select(grilleFrame, color(CHROME), select(crate, color(DARK), color(BLACK))),
    select(
      lamp,
      color(LAMP),
      select(
        indicator,
        color(AMBER),
        select(lampRim, color(CHROME), select(tailZone, tailColor, select(plate, color(PLATE), body))),
      ),
    ),
  );
  // Lyktorna lyser lite själva, så de inte blir mörka i skugga.
  mat.emissiveNode = select(
    lamp,
    color(LAMP).mul(0.5),
    select(indicator, color(AMBER).mul(0.3), select(tailZone, tailColor.mul(0.6), vec3(0))),
  );
  return new DeformablePart(g, mat);
}

/** Kupé med lutande vindruta och bakruta, svarta fönsterlister och lodräta mittstolpar. */
function buildCabin(b: BodyShape, paint: THREE.Color): DeformablePart {
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
  mat.colorNode = select(glass, color(GLASS), select(trim, color(BLACK), color(paint)));
  return new DeformablePart(g, mat);
}

/** Stor svart stötfångare med kromlist överst, som går runt hörnen. */
function buildBumper(halfX: number, z: number, y: number, depth: number): DeformablePart {
  const g = roundedBox(2 * halfX + 0.08, 0.2, depth, [8, 3, 6], 0.05, [0, y, z]);
  g.computeVertexNormals();
  const mat = new THREE.MeshToonNodeMaterial();
  const h = positionGeometry.y.sub(y);
  mat.colorNode = select(h.greaterThan(0.035).and(h.lessThan(0.055)), color(CHROME), color(BLACK));
  return new DeformablePart(g, mat);
}

/** Små odeformerbara detaljer: speglar, främre nummerplåt, stänkskydd, dörrhandtag. */
function buildDetails(b: BodyShape, wheelZ: Range): THREE.Group {
  const g = new THREE.Group();
  const black = new THREE.MeshToonMaterial({ color: BLACK });
  const add = (w: number, h: number, l: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(0.5, 0.11, 0.02, 0, b.bumperY[0], b.nose + 0.11, new THREE.MeshToonMaterial({ color: PLATE }));
  const mirrorZ = b.screen[0] - 0.12;
  for (const s of [1, -1]) {
    // Spegeln sitter på dörren i sidorutans främre hörn.
    add(0.08, 0.05, 0.08, s * (b.cabinHalfX + 0.03), b.belt + 0.05, mirrorZ + 0.01, black); // spegelfot
    add(0.15, 0.12, 0.08, s * (b.cabinHalfX + 0.14), b.belt + 0.1, mirrorZ, black); // spegel
    add(0.2, 0.16, 0.015, s * (b.halfX - 0.13), b.bottom - 0.08, wheelZ[0] - 0.46, black); // stänkskydd fram
    add(0.2, 0.16, 0.015, s * (b.halfX - 0.13), b.bottom - 0.08, wheelZ[1] - 0.46, black); // stänkskydd bak
    for (const z of b.doorHandles) add(0.02, 0.03, 0.14, s * (b.halfX + 0.005), b.belt - 0.09, z, black);
  }
  return g;
}

function buildWheel(radius: number): THREE.Group {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.22, 28).rotateZ(Math.PI / 2),
    new THREE.MeshToonMaterial({ color: 0x242424 }),
  );
  // Släta navkapslar med en ring av korta slitsar, som visar rotationen.
  const cap = (r: number, w: number, c: number) =>
    new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28).rotateZ(Math.PI / 2), new THREE.MeshToonMaterial({ color: c }));
  g.add(tyre, cap(radius * 0.7, 0.232, 0xd6d6d6), cap(radius * 0.2, 0.24, 0xb4b4b4));
  const slotMat = new THREE.MeshToonMaterial({ color: 0x6a6a6a });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.236, radius * 0.2, 0.03), slotMat);
    s.position.set(0, Math.cos(a) * radius * 0.47, Math.sin(a) * radius * 0.47);
    s.rotation.x = -a;
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
  private hits: Record<keyof DamageState, Hit[]>;
  private qSteer = new THREE.Quaternion();
  private qSpin = new THREE.Quaternion();
  private yAxis = new THREE.Vector3(0, 1, 0);
  private xAxis = new THREE.Vector3(1, 0, 0);

  constructor(
    private car: Car,
    model: CarModel,
  ) {
    const c = new THREE.Color(model.paint);
    const b = SHAPES[model.body];
    this.hits = zoneHits(b);
    const wheels = car.params.wheels;
    const wheelZ: Range = [wheels.find((w) => w.front)!.mount[2], wheels.find((w) => !w.front)!.mount[2]];
    // Främre stötfångaren går bak till hjulhuset, den bakre en bit runt hörnen.
    const front = b.nose + 0.1 - (wheelZ[0] + b.archR[0] + 0.04);
    this.parts = [
      buildBody(b, wheelZ, c),
      buildCabin(b, c),
      buildBumper(b.halfX, b.nose + 0.1 - front / 2, b.bumperY[0], front),
      buildBumper(b.halfX, b.tail - 0.09 + b.rearBumperDepth / 2, b.bumperY[1], b.rearBumperDepth),
    ];
    this.parts.forEach((p) => this.group.add(p.mesh));
    this.group.add(buildDetails(b, wheelZ));
    for (let i = 0; i < 4; i++) {
      const w = buildWheel(car.params.wheelRadius);
      this.wheels.push(w);
    }
  }

  addTo(scene: THREE.Object3D) {
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
    this.applyDamage(events);
  }

  /** Krymper bucklorna mot k; anropas varje bildruta under en lagning. */
  heal(k: number) {
    for (const p of this.parts) p.scale(k);
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
