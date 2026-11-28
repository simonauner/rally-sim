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

/** A control point on the stage. The surface applies from this point up to the next. */
export interface StagePoint {
  x: number;
  z: number;
  /** Road height. */
  y: number;
  /** Road width in metres. */
  width: number;
  surface: SurfaceId;
}

/**
 * Something along the road from the map data, as a stretch along the stage (m from the start). Areas (field, farm, lake, bog, clear-cut)
 * lie on one side: 1 = left in the driving direction, -1 = right. Points (power line, bridge, crest)
 * have from = to and side 0.
 */
export interface Landmark {
  kind: 'field' | 'farm' | 'lake' | 'bog' | 'clearcut' | 'power' | 'bridge' | 'crest';
  side: -1 | 0 | 1;
  from: number;
  to: number;
}

/** Houses, barns, posts, rails and bales along the stage. They collide; drawn by the renderer. */
export interface Prop {
  kind: 'house' | 'barn' | 'pylon' | 'rail' | 'bale' | 'fence';
  x: number;
  z: number;
  y: number;
  /** Rotation about y (rad). Houses stand at 0 or 90°, so the collision box is axis-aligned. */
  yaw: number;
}

/** House dimensions (half width in x, half depth in z, wall height), before rotation. */
export const HOUSE_SIZE = { house: [4.5, 3, 3.2], barn: [7, 4, 4.5] } as const;

/**
 * A crossing road the stage doesn't use, closed off at the stage. Follows the height of the stage's
 * nearest point, so the terrain around it joins up with the stage's, and ends in the forest.
 */
export interface Spur {
  points: { x: number; z: number }[];
  width: number;
  surface: SurfaceId;
}

export interface StageDef {
  name: string;
  /**
   * The stage version, major.minor.patch. Major: records and ghost are always reset.
   * Minor: reset only if recordsSince is moved forward. Patch: cosmetic only.
   */
  version: string;
  /** Oldest version (within the same major) whose records and ghost still apply. */
  recordsSince: string;
  points: StagePoint[];
  spurs?: Spur[];
  /** Winter stage: snow off the road and in the forest, even where the road is ploughed down to gravel. */
  winter?: boolean;
  /** Time of day; day if not given. Only affects the graphics. */
  light?: Light;
  /** Source of the real map data, shown in the stage preview. */
  credit?: string;
  /** Road after the finish to stop on (m); FINISH_MARGIN if not given. */
  runout?: number;
  landmarks?: Landmark[];
}

export type Light = 'day' | 'dawn' | 'dusk' | 'night';

/**
 * The light at a given time, from the sun's elevation above the horizon: dusk/dawn when the sun is
 * between 6° below and 6° above the horizon.
 * shortcut: the location is guessed (59° N, longitude from the time zone's standard time), replace with a real position if needed.
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

/** Result of projecting a point onto the road's centre line. */
export interface StageHit {
  /** Distance along the stage from the start (m). */
  s: number;
  /** Distance from the centre line (m), always >= 0. */
  d: number;
  /** Road height at the projection. */
  roadY: number;
  width: number;
  surface: SurfaceId;
  /** Side of the stage's centre line: 1 = left in the driving direction, -1 = right. */
  side: number;
}

const SAMPLE_STEP = 1;
/** The start and finish lines sit a little in from the spline's ends; after the finish there are at least 80 m to stop on. */
export const START_S = 20;
const FINISH_MARGIN = 80;
const CELL = 20;
/** Trees per stage, and more on long stages so the forest is equally dense. */
const TREES = 2500;
const TREES_PER_M = 0.9;
/** Beyond this distance from the road the terrain is just filler. */
export const STAGE_CORRIDOR = 45;
/** Height of the snowbanks above the road on winter stages (m). */
export const SNOWBANK_HEIGHT = 0.7;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The rolling hills of the terrain away from the road (m), also used by the scenery beyond the corridor. */
export const terrainHills = (x: number, z: number) => 1.8 * Math.sin(x * 0.021 + 1) * Math.cos(z * 0.017) + 0.9 * Math.sin(z * 0.043 + x * 0.029);

/**
 * Stage along a spline (centripetal Catmull-Rom) through the control points.
 * The road is flat across; beyond it comes a ditch and then hilly terrain.
 */
export class Stage extends World {
  readonly def: StageDef;
  /** Sampled centre line, one point per metre. */
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly ys: Float64Array;
  readonly widths: Float64Array;
  readonly surfaces: SurfaceId[];
  readonly length: number;
  /** The finish line along the stage (m). */
  readonly finish: number;
  readonly spurs: Spur[];
  /** Barriers across the crossing roads, one per road. Local x runs across the road. */
  readonly barriers: { x: number; z: number; y: number; yaw: number; halfWidth: number }[];
  private grid = new Map<number, number[]>();
  private hit: StageHit = { s: 0, d: 0, roadY: 0, width: 0, surface: 'gravel', side: 1 };
  readonly landmarks: Landmark[];
  /** The area per metre and side (index into landmarks, -1 = forest): [left, right]. */
  private area: [Int16Array, Int16Array];
  /** Lake water level, per landmark. */
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
    // The parameter t in getPoint is not proportional to distance, so we sample densely per segment
    // and redistribute into even metre steps.
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
      // As close to the stage as possible without standing on it.
      const clear = this.project(a.x, a.z).width / 2 + 2;
      let t = 0;
      while (t < len && this.project(a.x + dx * t, a.z + dz * t).d < clear) t += 0.5;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      return { x, z, y: this.heightAt(x, z), yaw: Math.atan2(dx, dz), halfWidth: sp.width / 2 + 0.6 };
    });
  }

  /**
   * Average road height around (x, z): every fourth metre of road within about 35 m beyond the nearest,
   * weighted so the nearest count most. `d` is the distance to the nearest point.
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

  /** Forest in the corridor along the roads, at least 7 m from the road edge. */
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

  /** The area (field, farm, lake, bog, clear-cut) at distance s on one side, and how far into it (0–1, soft at the ends). */
  areaAt(s: number, side: number): { lm: Landmark; t: number } | null {
    const k = this.area[side > 0 ? 0 : 1][Math.min(this.xs.length - 1, Math.max(0, Math.round(s)))]!;
    if (k < 0) return null;
    const lm = this.landmarks[k]!;
    const ramp = lm.kind === 'lake' ? 25 : 12;
    return { lm, t: smooth(lm.from, lm.from + ramp, s) * (1 - smooth(lm.to - ramp, lm.to, s)) };
  }

  /** Does forest grow here? `edge` is the distance from the road edge. */
  private wooded(s: number, side: number, edge: number): boolean {
    if (this.areaAt(s, side)) return false;
    for (const lm of this.landmarks) {
      const ds = Math.abs(s - lm.from);
      if (lm.kind === 'power' && ds < 16) return false; // the power line corridor
      if (lm.kind === 'bridge' && ds < 10) return false;
      if (lm.kind === 'crest' && ds < 50 && edge < 18) return false; // room for the spectators
    }
    return true;
  }

  /** Point `off` m to the left (negative = right) of the road at s. */
  private beside(s: number, off: number) {
    const p = this.poseAt(s);
    return { x: p.x + Math.cos(p.heading) * off, z: p.z - Math.sin(p.heading) * off, heading: p.heading };
  }

  /** Houses on the farms, bales and fences on the fields, power line poles and bridge rails. */
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
          // The house stands on its lowest corner so it never floats; the foundation goes into the ground.
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

  /** Position and direction (heading as in Car.reset) at distance s. */
  poseAt(s: number) {
    const i = Math.min(this.xs.length - 2, Math.max(0, Math.round(s / SAMPLE_STEP)));
    const j = Math.min(this.xs.length - 1, i + 2);
    return { x: this.xs[i]!, z: this.zs[i]!, heading: Math.atan2(this.xs[j]! - this.xs[i]!, this.zs[j]! - this.zs[i]!) };
  }

  /**
   * Nearest point on the centre line. The result object is reused between calls.
   * With maxD, points further away than that give d = Infinity (the other fields don't apply then), without
   * searching the whole stage; that makes building the terrain many times faster.
   */
  project(x: number, z: number, maxD = Infinity): StageHit {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = -1;
    let bestD2 = Infinity;
    // Search in growing rings until the hit is guaranteed to be the nearest.
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

    // Refine against the segments on both sides of the nearest sample.
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
   * Like project, but the nearest road of the stage and the crossing roads. For a crossing road
   * d, width and surface apply; s and roadY are still the stage's.
   */
  roadAt(x: number, z: number, maxD = Infinity): StageHit {
    return this.withSpurs(this.project(x, z, maxD), x, z);
  }

  /** Replaces the hit with a crossing road if one is closer than the stage. */
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
    // Beyond the stage's road edge the terrain follows an average of the surrounding road, not just the nearest
    // point: otherwise there is a ridge on the inside of tight corners and hairpins, where the nearest
    // point jumps to another part of the road. The distance is measured to the stage even next to a crossing
    // road, which then follows the same average. The road and the road edge have the road's own height.
    const blend = smooth(stageHw + 2, stageHw + 12, stageD);
    const roadY = blend > 0 ? nearY + (this.nearbyRoadY(x, z, stageD) - nearY) * blend : nearY;
    // Winter roads have ploughed snowbanks where other roads have a ditch.
    const edge = this.def.winter ? SNOWBANK_HEIGHT * smooth(hw + 0.3, hw + 1.4, d) * (1 - smooth(hw + 2.4, hw + 4.5, d)) : -0.35 * smooth(hw + 0.3, hw + 1.5, d) * (1 - smooth(hw + 2.5, hw + 4.5, d));
    const bank = smooth(hw + 2.5, hw + 8, d) * 0.12 * (d - hw - 2.5);
    const hills = smooth(hw + 4, hw + 30, d) * terrainHills(x, z);
    let h = roadY + edge + bank + hills;
    if (area) {
      // Fields, farmyards and bogs are flatter than the forest (clear-cuts keep their hills); the lake bed lies below the water surface out to
      // the horizon, with a long shore so there is no steep edge.
      if (area.lm.kind === 'lake') h -= Math.max(h - (this.lakeLevel.get(area.lm)! - 1.6), 0) * area.t * smooth(stageHw + 3, stageHw + 16, stageD);
      else if (area.lm.kind !== 'clearcut') h -= hills * 0.75 * area.t * smooth(stageHw + 3, stageHw + 12, stageD);
    }
    for (const lm of this.landmarks) {
      if (lm.kind !== 'bridge' || Math.abs(stageS - lm.from) > 10) continue;
      // The stream under the bridge: a channel across, at most 2.2 m deep, with the road as the bridge deck (beyond the snowbank in winter).
      const t = (1 - smooth(4, 10, Math.abs(stageS - lm.from))) * smooth(stageHw + (this.def.winter ? 3 : 1), stageHw + 8, stageD);
      h -= Math.min(Math.max(h - (this.ys[Math.round(lm.from)]! - 2.4), 0), 2.2) * t;
    }
    return h;
  }

  /** The water surface of a lake or stream at (x, z), or null. */
  waterAt(x: number, z: number): number | null {
    const h = this.project(x, z);
    const area = this.areaAt(h.s, h.side);
    if (area?.lm.kind === 'lake' && h.d > h.width / 2 + 8) return this.lakeLevel.get(area.lm)!;
    return null;
  }

  override surfaceAt(x: number, z: number): SurfaceId {
    const { d, width, surface } = this.roadAt(x, z);
    if (d <= width / 2 + 0.3) return surface;
    // Beside a winter road there are banks and then deep snow: the wheels dig in.
    if (this.def.winter) return 'snowbank';
    if (this.landmarks.length && this.waterAt(x, z) !== null) return 'water';
    // The road edge: loose soil, or snow if the road is snowy.
    return surface === 'snow' ? 'snow' : 'mud';
  }
}

/** Extra straight after the real road ends (m): on snow and gravel more than 80 m is needed to stop. */
const RUNOUT_EXTRA = 160;

/** Extends the road straight ahead from the last point, so the finish line stays put but the run-off gets longer. */
function withRunout(road: RealStagePart['road']): RealStagePart['road'] {
  const [x1, z1, y1, w = 6] = road[road.length - 1]!;
  const [x0, z0] = road[road.length - 2]!;
  const d = Math.hypot(x1 - x0, z1 - z0);
  const extra: RealStagePart['road'] = [];
  for (let m = 20; m <= RUNOUT_EXTRA; m += 20) extra.push([x1 + ((x1 - x0) / d) * m, z1 + ((z1 - z0) / d) * m, y1, w]);
  return [...road, ...extra];
}

/** One part of a real stage, from open map data. */
export interface RealStagePart {
  name: string;
  /** The centre line: [x west, z north, y height above the start, width (6 m if absent)], in metres from the start point. */
  road: ([number, number, number] | [number, number, number, number])[];
  /** Crossing forest roads, cut off 80 m from the stage. */
  spurs: { x: number; z: number }[][];
}

/**
 * Stages from a real road in parts, with the source credited: snowy winter road or summer gravel.
 * `light` gives the light per part (day if not given); `version` and `recordsSince` apply to all parts.
 * 1.1.0: landmarks from the map data (fields, farms, lakes, power lines, bridges); records still apply.
 * 1.2.0: bogs and clear-cuts.
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
 * Andersvattnet from Rally Sweden in four parts (see andersvattnet.ts). The last part is run at dusk,
 * like the afternoon loop in the rally. 1.1.0: gradient capped at 12 %, so older records don't apply.
 * 1.2.0: landmarks. 1.3.0: bogs and clear-cuts.
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
 * Bygdsiljum from Rally Sweden in five parts (see bygdsiljum.ts). The last part is run at night.
 * 1.1.0: gradient capped at 12 %, so older records don't apply. 1.2.0: landmarks.
 * 1.3.0: bogs and clear-cuts.
 */
export const [STAGE_ASJON, STAGE_ALTARLIDEN, STAGE_BERGTJARNEN, STAGE_TORPET, STAGE_TROLLBERGET] = realStages(
  'Bygdsiljum i Rally Sweden',
  BYGDSILJUM,
  true,
  [undefined, undefined, undefined, undefined, 'night'],
  '1.3.0',
  '1.1.0',
) as [StageDef, StageDef, StageDef, StageDef, StageDef];

/** Bäck from Rally Sweden in three parts (see back.ts). The last part is run at dusk, like the afternoon loop. */
export const [STAGE_NAS, STAGE_RICKLEAN, STAGE_VALSFABODA] = realStages('Bäck i Rally Sweden', BACK, true, [undefined, undefined, 'dusk']) as [
  StageDef,
  StageDef,
  StageDef,
];

const ROYAL = 'i Royal Rally of Scandinavia';

/** Värmskog in three parts (see real/varmskog.ts). The last part is run at dusk. */
export const [STAGE_GRINSBOL, STAGE_TOLLESRUD, STAGE_ASTERUD] = realStages(`Värmskog ${ROYAL}`, VARMSKOG, false, [undefined, undefined, 'dusk']) as [
  StageDef,
  StageDef,
  StageDef,
];
/** Gårdsjö and Colins in two parts each (see real/gardsjo.ts, real/colins.ts). The first part is run at dawn. */
export const [STAGE_BOTTEN, STAGE_RANNSJON] = realStages(`Gårdsjö ${ROYAL}`, GARDSJO, false, ['dawn']) as [StageDef, StageDef];
export const [STAGE_LARSSATER, STAGE_STOR_JANGEN] = realStages(`Colins ${ROYAL}`, COLINS, false) as [StageDef, StageDef];
/** Royal Forest in four parts (see real/royalForest.ts). */
export const [STAGE_SODRA_HULTEBY, STAGE_AMTEN, STAGE_LINDAS, STAGE_LUNGSUND] = realStages(`Royal Forest ${ROYAL}`, ROYAL_FOREST, false) as [
  StageDef,
  StageDef,
  StageDef,
  StageDef,
];
/** Ängebäckstorp and Ölme in two parts each (see real/angebackstorp.ts, real/olme.ts). The last part is run at dusk. */
export const [STAGE_SUNDSTORP, STAGE_BACKELID] = realStages(`Ängebäckstorp ${ROYAL}`, ANGEBACKSTORP, false) as [StageDef, StageDef];
export const [STAGE_NIKLASDAMM, STAGE_BROBY] = realStages(`Ölme ${ROYAL}`, OLME, false, [undefined, 'dusk']) as [StageDef, StageDef];

/** All stages, in the order the menus show them. */
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

/** Fraction of the stage per surface, measured along straight lines between the control points. */
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

/** The tyre with the best average grip over the stage's surfaces. */
export function bestTyre(def: StageDef): TyreType {
  const shares = Object.entries(surfaceShares(def)) as [SurfaceId, number][];
  const grip = (t: TyreType) => shares.reduce((sum, [surf, share]) => sum + share * TYRE_GRIP[t][surf], 0);
  return (Object.keys(TYRE_GRIP) as TyreType[]).reduce((best, t) => (grip(t) > grip(best) ? t : best));
}
