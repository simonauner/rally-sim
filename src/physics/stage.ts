import { CatmullRomCurve3, Vector3 } from 'three';
import { TYRE_GRIP, type SurfaceId, type TyreType } from './surfaces';
import { ANDERSVATTNET } from './real/andersvattnet';
import { BACK } from './real/back';
import { BYGDSILJUM } from './real/bygdsiljum';
import { ANGEBACKSTORP } from './real/angebackstorp';
import { COLINS } from './real/colins';
import { GARDSJO } from './real/gardsjo';
import { OLME } from './real/olme';
import { ROYAL_FOREST } from './real/royalForest';
import { VARMSKOG } from './real/varmskog';
import { LANDMARKS } from './real/landmarks';
import { rng } from './rng';
import { World } from './world';

/** En stödpunkt på etappen. Underlaget gäller från punkten fram till nästa. */
export interface StagePoint {
  x: number;
  z: number;
  /** Vägens höjd. */
  y: number;
  /** Vägbredd i meter. */
  width: number;
  surface: SurfaceId;
}

/**
 * Något längs vägen ur kartdatan, som sträcka längs etappen (m från start). Ytor (åker, gård, sjö, myr, kalhygge)
 * ligger på en sida: 1 = vänster i färdriktningen, -1 = höger. Punkter (kraftledning, bro, krön)
 * har from = to och side 0.
 */
export interface Landmark {
  kind: 'field' | 'farm' | 'lake' | 'bog' | 'clearcut' | 'power' | 'bridge' | 'crest';
  side: -1 | 0 | 1;
  from: number;
  to: number;
}

/** Hus, ladugårdar, stolpar, räcken och balar längs etappen. Kolliderar; ritas av renderaren. */
export interface Prop {
  kind: 'house' | 'barn' | 'pylon' | 'rail' | 'bale' | 'fence';
  x: number;
  z: number;
  y: number;
  /** Rotation runt y (rad). Hus står i 0 eller 90°, så kollisionslådan är axelparallell. */
  yaw: number;
}

/** Husens mått (halva bredden i x, halva djupet i z, vägghöjd), före rotation. */
export const HOUSE_SIZE = { house: [4.5, 3, 3.2], barn: [7, 4, 4.5] } as const;

/**
 * En korsande väg som etappen inte kör på, avspärrad vid etappen. Följer höjden från etappens
 * närmaste punkt, så terrängen runt den hänger ihop med etappens, och tar slut i skogen.
 */
export interface Spur {
  points: { x: number; z: number }[];
  width: number;
  surface: SurfaceId;
}

export interface StageDef {
  name: string;
  /**
   * Banans version, major.minor.patch. Major: rekord och ghost nollställs alltid.
   * Minor: nollställs bara om recordsSince flyttas fram. Patch: bara kosmetiskt.
   */
  version: string;
  /** Äldsta versionen (inom samma major) vars rekord och ghost fortfarande gäller. */
  recordsSince: string;
  points: StagePoint[];
  spurs?: Spur[];
  /** Vinteretapp: snö utanför vägen och i skogen, även där vägen är plogad till grus. */
  winter?: boolean;
  /** Tid på dygnet; dag om inget anges. Påverkar bara grafiken. */
  light?: Light;
  /** Källa för verklig kartdata, visas i etappens förhandsvisning. */
  credit?: string;
  /** Väg efter mål att stanna på (m); FINISH_MARGIN om inget anges. */
  runout?: number;
  landmarks?: Landmark[];
}

export type Light = 'day' | 'dawn' | 'dusk' | 'night';

/**
 * Ljuset vid en viss tidpunkt, från solens höjd över horisonten: skymning/gryning när solen är
 * mellan 6° under och 6° över horisonten.
 * shortcut: platsen gissas (59° N, längdgrad från tidszonens normaltid), byt mot riktig position om det behövs.
 */
export function lightAt(date: Date): Light {
  const rad = Math.PI / 180;
  const lat = 59 * rad;
  const jan = new Date(date.getFullYear(), 0, 1);
  const jul = new Date(date.getFullYear(), 6, 1);
  const lon = -Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset()) / 4;
  const day = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000;
  const decl = -23.44 * rad * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const solarHour = ((day % 1) * 24 + lon / 15 + 24) % 24;
  const hourAngle = 15 * rad * (solarHour - 12);
  const elevation = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)) / rad;
  if (elevation > 6) return 'day';
  if (elevation < -6) return 'night';
  return solarHour < 12 ? 'dawn' : 'dusk';
}

/** Resultat av att projicera en punkt på vägens mittlinje. */
export interface StageHit {
  /** Sträcka längs etappen från start (m). */
  s: number;
  /** Avstånd från mittlinjen (m), alltid >= 0. */
  d: number;
  /** Vägens höjd vid projektionen. */
  roadY: number;
  width: number;
  surface: SurfaceId;
  /** Sida om etappens mittlinje: 1 = vänster i färdriktningen, -1 = höger. */
  side: number;
}

const SAMPLE_STEP = 1;
/** Start- och mållinjen ligger en bit in från splinens ändar; efter mål finns minst 80 m att stanna på. */
export const START_S = 20;
const FINISH_MARGIN = 80;
const CELL = 20;
/** Träd per etapp, och fler på långa etapper så skogen blir lika tät. */
const TREES = 2500;
const TREES_PER_M = 0.9;
/** Bortom detta avstånd från vägen är terrängen bara utfyllnad. */
export const STAGE_CORRIDOR = 45;
/** Snövallarnas höjd över vägen på vinteretapper (m). */
export const SNOWBANK_HEIGHT = 0.7;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Etapp längs en spline (centripetal Catmull-Rom) genom stödpunkterna.
 * Vägen är plan i sidled; utanför den kommer ett dike och sedan kuperad terräng.
 */
export class Stage extends World {
  readonly def: StageDef;
  /** Samplad mittlinje, en punkt per meter. */
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly ys: Float64Array;
  readonly widths: Float64Array;
  readonly surfaces: SurfaceId[];
  readonly length: number;
  /** Mållinjen längs etappen (m). */
  readonly finish: number;
  readonly spurs: Spur[];
  /** Avspärrningar tvärs över de korsande vägarna, en per väg. Lokalt x går tvärs över vägen. */
  readonly barriers: { x: number; z: number; y: number; yaw: number; halfWidth: number }[];
  private grid = new Map<number, number[]>();
  private hit: StageHit = { s: 0, d: 0, roadY: 0, width: 0, surface: 'gravel', side: 1 };
  readonly landmarks: Landmark[];
  /** Ytan per meter och sida (index i landmarks, -1 = skog): [vänster, höger]. */
  private area: [Int16Array, Int16Array];
  /** Sjöarnas vattennivå, per landmärke. */
  readonly lakeLevel = new Map<Landmark, number>();
  readonly props: Prop[] = [];

  constructor(def: StageDef) {
    super();
    this.boxes.length = 0;
    this.def = def;
    const pts = def.points;
    const curve = new CatmullRomCurve3(
      pts.map((p) => new Vector3(p.x, p.y, p.z)),
      false,
      'centripetal',
    );
    // Parametern t i getPoint är inte proportionell mot sträckan, så vi samplar tätt per segment
    // och fördelar om till jämna metersteg.
    const dense: { x: number; y: number; z: number; seg: number; f: number }[] = [];
    const segs = pts.length - 1;
    const v = new Vector3();
    for (let i = 0; i < segs; i++) {
      for (let k = 0; k < 64; k++) {
        const f = k / 64;
        curve.getPoint((i + f) / segs, v);
        dense.push({ x: v.x, y: v.y, z: v.z, seg: i, f });
      }
    }
    const lastP = pts[segs]!;
    dense.push({ x: lastP.x, y: lastP.y, z: lastP.z, seg: segs - 1, f: 1 });

    const xs: number[] = [];
    const zs: number[] = [];
    const ys: number[] = [];
    const widths: number[] = [];
    const surfaces: SurfaceId[] = [];
    let acc = 0;
    let next = 0;
    for (let i = 0; i < dense.length - 1; i++) {
      const a = dense[i]!;
      const b = dense[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      while (next <= acc + len) {
        const u = len > 0 ? (next - acc) / len : 0;
        const p0 = pts[a.seg]!;
        const p1 = pts[a.seg + 1]!;
        const f = a.f + (b.seg === a.seg ? b.f - a.f : 1 - a.f) * u;
        xs.push(a.x + (b.x - a.x) * u);
        zs.push(a.z + (b.z - a.z) * u);
        ys.push(a.y + (b.y - a.y) * u);
        widths.push(p0.width + (p1.width - p0.width) * f);
        surfaces.push(p0.surface);
        next += SAMPLE_STEP;
      }
      acc += len;
    }
    this.xs = Float64Array.from(xs);
    this.zs = Float64Array.from(zs);
    this.ys = Float64Array.from(ys);
    this.widths = Float64Array.from(widths);
    this.surfaces = surfaces;
    this.length = (xs.length - 1) * SAMPLE_STEP;
    this.finish = this.length - (def.runout ?? FINISH_MARGIN);

    for (let i = 0; i < xs.length; i++) {
      const key = this.key(Math.floor(xs[i]! / CELL), Math.floor(zs[i]! / CELL));
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(i);
    }
    this.spurs = def.spurs ?? [];
    this.landmarks = def.landmarks ?? [];
    this.area = [new Int16Array(xs.length).fill(-1), new Int16Array(xs.length).fill(-1)];
    this.landmarks.forEach((lm, k) => {
      if (lm.side === 0) return;
      const a = this.area[lm.side > 0 ? 0 : 1];
      for (let i = Math.max(0, Math.round(lm.from)); i <= Math.min(xs.length - 1, Math.round(lm.to)); i++) a[i] = k;
      if (lm.kind === 'lake') {
        let y = Infinity;
        for (let i = Math.max(0, Math.round(lm.from)); i <= Math.min(xs.length - 1, Math.round(lm.to)); i++) y = Math.min(y, ys[i]!);
        this.lakeLevel.set(lm, y - 1.2);
      }
    });
    this.placeTrees();
    this.placeProps();
    this.barriers = this.spurs.map((sp) => {
      const [a, b] = sp.points as [{ x: number; z: number }, { x: number; z: number }];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dx = (b.x - a.x) / len;
      const dz = (b.z - a.z) / len;
      // Så nära etappen som möjligt utan att stå på den.
      const clear = this.project(a.x, a.z).width / 2 + 2;
      let t = 0;
      while (t < len && this.project(a.x + dx * t, a.z + dz * t).d < clear) t += 0.5;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      return { x, z, y: this.heightAt(x, z), yaw: Math.atan2(dx, dz), halfWidth: sp.width / 2 + 0.6 };
    });
  }

  /**
   * Vägens höjd i snitt runt (x, z): var fjärde meter av vägen inom ca 35 m bortom den närmaste,
   * viktad så att de närmaste väger mest. `d` är avståndet till närmaste punkten.
   */
  private nearbyRoadY(x: number, z: number, d: number): number {
    const sigma = 12;
    const reach = d + 3 * sigma;
    const r = Math.ceil(reach / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let sum = 0;
    let weight = 0;
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cz - r; j <= cz + r; j++) {
        for (const k of this.grid.get(this.key(i, j)) ?? []) {
          if (k % 4) continue;
          const dk = Math.hypot(this.xs[k]! - x, this.zs[k]! - z);
          if (dk > reach) continue;
          const w = Math.exp(-(((dk - d) / sigma) ** 2) / 2);
          sum += w * this.ys[k]!;
          weight += w;
        }
      }
    }
    return weight > 0 ? sum / weight : this.hit.roadY;
  }

  /** Skog i korridoren längs vägarna, minst 7 m från vägkanten. */
  private placeTrees() {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < this.xs.length; i++) {
      minX = Math.min(minX, this.xs[i]!);
      maxX = Math.max(maxX, this.xs[i]!);
      minZ = Math.min(minZ, this.zs[i]!);
      maxZ = Math.max(maxZ, this.zs[i]!);
    }
    const r = rng(99);
    const count = Math.max(TREES, Math.round(this.length * TREES_PER_M));
    for (let tries = 0; tries < count * 20 && this.trunks.length < count; tries++) {
      const x = minX - STAGE_CORRIDOR + r() * (maxX - minX + 2 * STAGE_CORRIDOR);
      const z = minZ - STAGE_CORRIDOR + r() * (maxZ - minZ + 2 * STAGE_CORRIDOR);
      const { d, width, s, side } = this.roadAt(x, z, STAGE_CORRIDOR);
      if (d < width / 2 + 7 || d > STAGE_CORRIDOR - 2 || !this.wooded(s, side, d - width / 2)) continue;
      const scale = 0.7 + r() * 0.9;
      this.trunks.push({ x, z, y: this.heightAt(x, z), r: 0.33 * scale, scale });
    }
  }

  /** Ytan (åker, gård, sjö, myr, kalhygge) vid sträckan s på en sida, och hur långt in i den (0–1, mjukt i ändarna). */
  areaAt(s: number, side: number): { lm: Landmark; t: number } | null {
    const k = this.area[side > 0 ? 0 : 1][Math.min(this.xs.length - 1, Math.max(0, Math.round(s)))]!;
    if (k < 0) return null;
    const lm = this.landmarks[k]!;
    const ramp = lm.kind === 'lake' ? 25 : 12;
    return { lm, t: smooth(lm.from, lm.from + ramp, s) * (1 - smooth(lm.to - ramp, lm.to, s)) };
  }

  /** Växer det skog här? `edge` är avståndet från vägkanten. */
  private wooded(s: number, side: number, edge: number): boolean {
    if (this.areaAt(s, side)) return false;
    for (const lm of this.landmarks) {
      const ds = Math.abs(s - lm.from);
      if (lm.kind === 'power' && ds < 16) return false; // ledningsgatan
      if (lm.kind === 'bridge' && ds < 10) return false;
      if (lm.kind === 'crest' && ds < 50 && edge < 18) return false; // plats för publiken
    }
    return true;
  }

  /** Punkt `off` m till vänster (negativt = höger) om vägen vid s. */
  private beside(s: number, off: number) {
    const p = this.poseAt(s);
    return { x: p.x + Math.cos(p.heading) * off, z: p.z - Math.sin(p.heading) * off, heading: p.heading };
  }

  /** Hus på gårdarna, balar och gärdsgård på åkrarna, kraftledningsstolpar och broräcken. */
  private placeProps() {
    const r = rng(61);
    const hidden = (x: number, z: number, rad: number) => this.trunks.push({ x, z, y: this.heightAt(x, z), r: rad, scale: 0, hidden: true });
    const free = (x: number, z: number, clear: number) => {
      const h = this.roadAt(x, z);
      return h.d > h.width / 2 + clear;
    };
    for (const lm of this.landmarks) {
      const hw = (s: number) => this.widths[Math.min(this.xs.length - 1, Math.max(0, Math.round(s)))]! / 2;
      if (lm.kind === 'farm') {
        const n = Math.max(1, Math.floor((lm.to - lm.from) / 45));
        for (let i = 0; i < n; i++) {
          const s = lm.from + ((i + 0.3 + r() * 0.4) * (lm.to - lm.from)) / n;
          const kind = r() < 0.35 ? 'barn' : 'house';
          const [hx, hz, wall] = HOUSE_SIZE[kind];
          const p = this.beside(s, lm.side * (hw(s) + 13 + r() * 12));
          const yaw = r() < 0.5 ? 0 : Math.PI / 2;
          const ax = yaw ? hz : hx;
          const az = yaw ? hx : hz;
          if (!free(p.x, p.z, Math.hypot(ax, az) + 3)) continue;
          // Huset står på den lägsta hörnpunkten, så det aldrig svävar; grunden går ner i marken.
          let y = Infinity;
          for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) y = Math.min(y, this.heightAt(p.x + cx * ax, p.z + cz * az));
          this.props.push({ kind, x: p.x, z: p.z, y, yaw });
          this.boxes.push({ minX: p.x - ax, maxX: p.x + ax, minY: y - 1, maxY: y + wall + 2.5, minZ: p.z - az, maxZ: p.z + az });
        }
      } else if (lm.kind === 'field') {
        for (let s = lm.from + 4; s < lm.to - 4; s += 2.5) {
          const p = this.beside(s, lm.side * (hw(s) + 6));
          if (!free(p.x, p.z, 5)) continue;
          this.props.push({ kind: 'fence', x: p.x, z: p.z, y: this.heightAt(p.x, p.z), yaw: p.heading });
          hidden(p.x, p.z, 0.12);
        }
        for (let s = lm.from + 15; s < lm.to - 15; s += 30) {
          if (r() < 0.45) continue;
          const n = 1 + Math.floor(r() * 3);
          const off = lm.side * (hw(s) + 11 + r() * 22);
          for (let k = 0; k < n; k++) {
            const p = this.beside(s + k * 1.7, off + (r() - 0.5) * 1.5);
            if (!free(p.x, p.z, 9)) continue;
            this.props.push({ kind: 'bale', x: p.x, z: p.z, y: this.heightAt(p.x, p.z), yaw: r() * Math.PI });
            hidden(p.x, p.z, 0.75);
          }
        }
      } else if (lm.kind === 'power') {
        for (const side of [-1, 1]) {
          const p = this.beside(lm.from, side * (hw(lm.from) + 17));
          if (!free(p.x, p.z, 10)) continue;
          this.props.push({ kind: 'pylon', x: p.x, z: p.z, y: this.heightAt(p.x, p.z), yaw: p.heading });
          hidden(p.x, p.z, 1.3);
        }
      } else if (lm.kind === 'bridge') {
        for (const side of [-1, 1]) {
          for (let s = lm.from - 7; s <= lm.from + 7; s += 1.4) {
            const p = this.beside(s, side * (hw(s) + 0.45));
            this.props.push({ kind: 'rail', x: p.x, z: p.z, y: this.heightAt(p.x, p.z), yaw: p.heading });
            hidden(p.x, p.z, 0.15);
          }
        }
      }
    }
  }

  private key(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /** Position och riktning (heading enligt Car.reset) vid sträckan s. */
  poseAt(s: number) {
    const i = Math.min(this.xs.length - 2, Math.max(0, Math.round(s / SAMPLE_STEP)));
    const j = Math.min(this.xs.length - 1, i + 2);
    return { x: this.xs[i]!, z: this.zs[i]!, heading: Math.atan2(this.xs[j]! - this.xs[i]!, this.zs[j]! - this.zs[i]!) };
  }

  /**
   * Närmaste punkt på mittlinjen. Resultatobjektet återanvänds mellan anrop.
   * Med maxD ger punkter längre bort än så d = Infinity (övriga fält gäller då inte), utan att
   * söka igenom hela etappen; det gör terrängbygget många gånger snabbare.
   */
  project(x: number, z: number, maxD = Infinity): StageHit {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = -1;
    let bestD2 = Infinity;
    // Sök i växande ringar tills träffen garanterat är närmast.
    for (let r = 1; r < 64; r++) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cz - r; j <= cz + r; j++) {
          if (r > 1 && Math.abs(i - cx) < r && Math.abs(j - cz) < r) continue;
          const list = this.grid.get(this.key(i, j));
          if (!list) continue;
          for (const k of list) {
            const dx = this.xs[k]! - x;
            const dz = this.zs[k]! - z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = k;
            }
          }
        }
      }
      if (best >= 0 && Math.sqrt(bestD2) <= r * CELL) break;
      if (r * CELL >= maxD) {
        this.hit.d = Infinity;
        return this.hit;
      }
    }
    if (best < 0) best = 0;

    // Förfina mot segmenten på båda sidor om närmaste sampel.
    const h = this.hit;
    h.d = Math.sqrt(bestD2);
    h.s = best * SAMPLE_STEP;
    h.roadY = this.ys[best]!;
    let seg = best;
    let u = 0;
    for (const a of [best - 1, best]) {
      const b = a + 1;
      if (a < 0 || b >= this.xs.length) continue;
      const ex = this.xs[b]! - this.xs[a]!;
      const ez = this.zs[b]! - this.zs[a]!;
      const t = Math.min(1, Math.max(0, ((x - this.xs[a]!) * ex + (z - this.zs[a]!) * ez) / (ex * ex + ez * ez)));
      const d = Math.hypot(this.xs[a]! + ex * t - x, this.zs[a]! + ez * t - z);
      if (d <= h.d) {
        h.d = d;
        seg = a;
        u = t;
      }
    }
    const b = Math.min(seg + 1, this.xs.length - 1);
    h.s = (seg + u) * SAMPLE_STEP;
    h.roadY = this.ys[seg]! + (this.ys[b]! - this.ys[seg]!) * u;
    h.width = this.widths[seg]! + (this.widths[b]! - this.widths[seg]!) * u;
    h.surface = this.surfaces[seg]!;
    const ex = this.xs[b]! - this.xs[seg]!;
    const ez = this.zs[b]! - this.zs[seg]!;
    h.side = (x - this.xs[seg]!) * ez - (z - this.zs[seg]!) * ex >= 0 ? 1 : -1;
    return h;
  }

  /**
   * Som project, men närmaste väg av etappen och de korsande vägarna. För en korsande väg
   * gäller d, width och surface; s och roadY är fortfarande etappens.
   */
  roadAt(x: number, z: number, maxD = Infinity): StageHit {
    return this.withSpurs(this.project(x, z, maxD), x, z);
  }

  /** Byter träffen mot en korsande väg om någon ligger närmare än etappen. */
  private withSpurs(h: StageHit, x: number, z: number): StageHit {
    for (const sp of this.spurs) {
      const p = sp.points;
      for (let i = 0; i + 1 < p.length; i++) {
        const ax = p[i]!.x;
        const az = p[i]!.z;
        const ex = p[i + 1]!.x - ax;
        const ez = p[i + 1]!.z - az;
        const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
        const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
        if (d < h.d) {
          h.d = d;
          h.width = sp.width;
          h.surface = sp.surface;
        }
      }
    }
    return h;
  }

  override heightAt(x: number, z: number): number {
    const stage = this.project(x, z);
    const stageD = stage.d;
    const stageS = stage.s;
    const area = this.landmarks.length ? this.areaAt(stage.s, stage.side) : null;
    const stageHw = stage.width / 2;
    const nearY = stage.roadY;
    const { d, width } = this.withSpurs(stage, x, z);
    const hw = width / 2;
    // Utanför etappens vägkant följer terrängen ett medel av vägen runt omkring, inte bara närmaste
    // punkten: annars blir det en kant på insidan av snäva kurvor och hårnålar, där närmaste
    // punkt hoppar till en annan del av vägen. Avståndet räknas till etappen även intill en korsande
    // väg, som då följer samma medel. Vägen och vägkanten har vägens egen höjd.
    const blend = smooth(stageHw + 2, stageHw + 12, stageD);
    const roadY = blend > 0 ? nearY + (this.nearbyRoadY(x, z, stageD) - nearY) * blend : nearY;
    // Vinterväg har plogade snövallar där andra vägar har dike.
    const edge = this.def.winter ? SNOWBANK_HEIGHT * smooth(hw + 0.3, hw + 1.4, d) * (1 - smooth(hw + 2.4, hw + 4.5, d)) : -0.35 * smooth(hw + 0.3, hw + 1.5, d) * (1 - smooth(hw + 2.5, hw + 4.5, d));
    const bank = smooth(hw + 2.5, hw + 8, d) * 0.12 * (d - hw - 2.5);
    const hills = smooth(hw + 4, hw + 30, d) * (1.8 * Math.sin(x * 0.021 + 1) * Math.cos(z * 0.017) + 0.9 * Math.sin(z * 0.043 + x * 0.029));
    let h = roadY + edge + bank + hills;
    if (area) {
      // Åkrar, gårdstomter och myrar är flackare än skogen (kalhygget behåller sina kullar); sjöns botten ligger under vattenytan ut till
      // horisonten, med en lång strand så att det inte blir någon brant kant.
      if (area.lm.kind === 'lake') h -= Math.max(h - (this.lakeLevel.get(area.lm)! - 1.6), 0) * area.t * smooth(stageHw + 3, stageHw + 16, stageD);
      else if (area.lm.kind !== 'clearcut') h -= hills * 0.75 * area.t * smooth(stageHw + 3, stageHw + 12, stageD);
    }
    for (const lm of this.landmarks) {
      if (lm.kind !== 'bridge' || Math.abs(stageS - lm.from) > 10) continue;
      // Ån under bron: en fåra tvärs över, högst 2,2 m djup, med vägen som brobana (bortom snövallen på vintern).
      const t = (1 - smooth(4, 10, Math.abs(stageS - lm.from))) * smooth(stageHw + (this.def.winter ? 3 : 1), stageHw + 8, stageD);
      h -= Math.min(Math.max(h - (this.ys[Math.round(lm.from)]! - 2.4), 0), 2.2) * t;
    }
    return h;
  }

  /** Vattenytan i en sjö eller å vid (x, z), eller null. */
  waterAt(x: number, z: number): number | null {
    const h = this.project(x, z);
    const area = this.areaAt(h.s, h.side);
    if (area?.lm.kind === 'lake' && h.d > h.width / 2 + 8) return this.lakeLevel.get(area.lm)!;
    return null;
  }

  override surfaceAt(x: number, z: number): SurfaceId {
    const { d, width, surface } = this.roadAt(x, z);
    if (d <= width / 2 + 0.3) return surface;
    // Utanför vinterväg är det vallar och sedan djup snö: hjulen gräver ner sig.
    if (this.def.winter) return 'snowbank';
    if (this.landmarks.length && this.waterAt(x, z) !== null) return 'water';
    // Vägkanten: lös jord, eller snö om vägen är snöig.
    return surface === 'snow' ? 'snow' : 'mud';
  }
}

/** Extra raksträcka efter den verkliga vägens slut (m): på snö och grus behövs mer än 80 m för att stanna. */
const RUNOUT_EXTRA = 160;

/** Förlänger vägen rakt fram från sista punkten, så mållinjen ligger kvar men utrullningen blir längre. */
function withRunout(road: RealStagePart['road']): RealStagePart['road'] {
  const [x1, z1, y1, w = 6] = road[road.length - 1]!;
  const [x0, z0] = road[road.length - 2]!;
  const d = Math.hypot(x1 - x0, z1 - z0);
  const extra: RealStagePart['road'] = [];
  for (let m = 20; m <= RUNOUT_EXTRA; m += 20) extra.push([x1 + ((x1 - x0) / d) * m, z1 + ((z1 - z0) / d) * m, y1, w]);
  return [...road, ...extra];
}

/** En del av en verklig sträcka, från öppen kartdata. */
export interface RealStagePart {
  name: string;
  /** Mittlinjen: [x väster, z norr, y höjd över starten, bredd (6 m om den saknas)], i meter från startpunkten. */
  road: ([number, number, number] | [number, number, number, number])[];
  /** Korsande skogsvägar, kapade 80 m från etappen. */
  spurs: { x: number; z: number }[][];
}

/**
 * Etapper från en verklig sträcka i delar, med källan angiven: snöig vinterväg eller sommargrus.
 * `light` ger ljuset per del (dag om inget anges); `version` och `recordsSince` gäller alla delar.
 * 1.1.0: landmärken ur kartdatan (åkrar, gårdar, sjöar, kraftledningar, broar); rekorden gäller.
 * 1.2.0: myrar och kalhyggen.
 */
function realStages(
  source: string,
  parts: RealStagePart[],
  winter: boolean,
  light: (Light | undefined)[] = [],
  version = '1.2.0',
  recordsSince = '1.0.0',
): StageDef[] {
  const surface = winter ? ('snow' as const) : ('gravel' as const);
  return parts.map((part, i) => ({
    name: part.name,
    version,
    recordsSince,
    ...(winter ? { winter } : {}),
    ...(light[i] ? { light: light[i] } : {}),
    credit: `${source}, del ${i + 1} av ${parts.length} · kartdata © OpenStreetMap contributors (ODbL) · höjd EU-DEM, Copernicus`,
    points: withRunout(part.road).map(([x, z, y, width = 6]) => ({ x, z, y, width, surface })),
    spurs: part.spurs.map((points) => ({ points, width: 5, surface })),
    runout: FINISH_MARGIN + RUNOUT_EXTRA,
    ...(LANDMARKS[part.name] ? { landmarks: LANDMARKS[part.name] } : {}),
  }));
}

/**
 * Andersvattnet ur Rally Sweden i fyra delar (se andersvattnet.ts). Sista delen körs i skymning,
 * som eftermiddagens omgång i rallyt. 1.1.0: lutningen begränsad till 12 %, så äldre rekord gäller inte.
 * 1.2.0: landmärken. 1.3.0: myrar och kalhyggen.
 */
export const [STAGE_STORBERGET, STAGE_HOSJOALVEN, STAGE_ROJMYRBERGET, STAGE_FLARKAN] = realStages(
  'Andersvattnet i Rally Sweden',
  ANDERSVATTNET,
  true,
  [undefined, undefined, undefined, 'dusk'],
  '1.3.0',
  '1.1.0',
) as [StageDef, StageDef, StageDef, StageDef];

/**
 * Bygdsiljum ur Rally Sweden i fem delar (se bygdsiljum.ts). Sista delen körs på natten.
 * 1.1.0: lutningen begränsad till 12 %, så äldre rekord gäller inte. 1.2.0: landmärken.
 * 1.3.0: myrar och kalhyggen.
 */
export const [STAGE_ASJON, STAGE_ALTARLIDEN, STAGE_BERGTJARNEN, STAGE_TORPET, STAGE_TROLLBERGET] = realStages(
  'Bygdsiljum i Rally Sweden',
  BYGDSILJUM,
  true,
  [undefined, undefined, undefined, undefined, 'night'],
  '1.3.0',
  '1.1.0',
) as [StageDef, StageDef, StageDef, StageDef, StageDef];

/** Bäck ur Rally Sweden i tre delar (se back.ts). Sista delen körs i skymning, som eftermiddagens omgång. */
export const [STAGE_NAS, STAGE_RICKLEAN, STAGE_VALSFABODA] = realStages('Bäck i Rally Sweden', BACK, true, [undefined, undefined, 'dusk']) as [
  StageDef,
  StageDef,
  StageDef,
];

const ROYAL = 'i Royal Rally of Scandinavia';

/** Värmskog i tre delar (se real/varmskog.ts). Sista delen körs i skymning. */
export const [STAGE_GRINSBOL, STAGE_TOLLESRUD, STAGE_ASTERUD] = realStages(`Värmskog ${ROYAL}`, VARMSKOG, false, [undefined, undefined, 'dusk']) as [
  StageDef,
  StageDef,
  StageDef,
];
/** Gårdsjö och Colins i två delar vardera (se real/gardsjo.ts, real/colins.ts). Första delen körs i gryning. */
export const [STAGE_BOTTEN, STAGE_RANNSJON] = realStages(`Gårdsjö ${ROYAL}`, GARDSJO, false, ['dawn']) as [StageDef, StageDef];
export const [STAGE_LARSSATER, STAGE_STOR_JANGEN] = realStages(`Colins ${ROYAL}`, COLINS, false) as [StageDef, StageDef];
/** Royal Forest i fyra delar (se real/royalForest.ts). */
export const [STAGE_SODRA_HULTEBY, STAGE_AMTEN, STAGE_LINDAS, STAGE_LUNGSUND] = realStages(`Royal Forest ${ROYAL}`, ROYAL_FOREST, false) as [
  StageDef,
  StageDef,
  StageDef,
  StageDef,
];
/** Ängebäckstorp och Ölme i två delar vardera (se real/angebackstorp.ts, real/olme.ts). Sista delen körs i skymning. */
export const [STAGE_SUNDSTORP, STAGE_BACKELID] = realStages(`Ängebäckstorp ${ROYAL}`, ANGEBACKSTORP, false) as [StageDef, StageDef];
export const [STAGE_NIKLASDAMM, STAGE_BROBY] = realStages(`Ölme ${ROYAL}`, OLME, false, [undefined, 'dusk']) as [StageDef, StageDef];

/** Alla etapper, i den ordning menyerna visar dem. */
export const STAGES: StageDef[] = [
  STAGE_GRINSBOL,
  STAGE_TOLLESRUD,
  STAGE_ASTERUD,
  STAGE_BOTTEN,
  STAGE_RANNSJON,
  STAGE_LARSSATER,
  STAGE_STOR_JANGEN,
  STAGE_ASJON,
  STAGE_ALTARLIDEN,
  STAGE_BERGTJARNEN,
  STAGE_TORPET,
  STAGE_TROLLBERGET,
  STAGE_NAS,
  STAGE_RICKLEAN,
  STAGE_VALSFABODA,
  STAGE_STORBERGET,
  STAGE_HOSJOALVEN,
  STAGE_ROJMYRBERGET,
  STAGE_FLARKAN,
  STAGE_SODRA_HULTEBY,
  STAGE_AMTEN,
  STAGE_LINDAS,
  STAGE_LUNGSUND,
  STAGE_SUNDSTORP,
  STAGE_BACKELID,
  STAGE_NIKLASDAMM,
  STAGE_BROBY,
];

/** Andel av etappen per underlag, mätt längs raka linjer mellan stödpunkterna. */
export function surfaceShares(def: StageDef): Partial<Record<SurfaceId, number>> {
  const len: Partial<Record<SurfaceId, number>> = {};
  let total = 0;
  for (let i = 0; i + 1 < def.points.length; i++) {
    const a = def.points[i]!;
    const b = def.points[i + 1]!;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    len[a.surface] = (len[a.surface] ?? 0) + d;
    total += d;
  }
  for (const k of Object.keys(len) as SurfaceId[]) len[k]! /= total;
  return len;
}

/** Däcket med bäst grepp i snitt över etappens underlag. */
export function bestTyre(def: StageDef): TyreType {
  const shares = Object.entries(surfaceShares(def)) as [SurfaceId, number][];
  const grip = (t: TyreType) => shares.reduce((sum, [surf, share]) => sum + share * TYRE_GRIP[t][surf], 0);
  return (Object.keys(TYRE_GRIP) as TyreType[]).reduce((best, t) => (grip(t) > grip(best) ? t : best));
}
