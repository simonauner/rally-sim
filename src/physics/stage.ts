import { CatmullRomCurve3, Vector3 } from 'three';
import type { SurfaceId } from './surfaces';
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
 * En korsande väg som etappen inte kör på, avspärrad vid etappen. Ligger plant på etappens
 * höjd vid första punkten och tar slut i skogen.
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
}

const SAMPLE_STEP = 1;
/** Start- och mållinjen ligger en bit in från splinens ändar; efter mål finns 80 m att stanna på. */
export const START_S = 20;
export const FINISH_MARGIN = 80;
const CELL = 20;
/** Bortom detta avstånd från vägen är terrängen bara utfyllnad. */
export const STAGE_CORRIDOR = 45;

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
  readonly spurs: (Spur & { y: number })[];
  /** Avspärrningar tvärs över de korsande vägarna, en per väg. Lokalt x går tvärs över vägen. */
  readonly barriers: { x: number; z: number; y: number; yaw: number; halfWidth: number }[];
  private grid = new Map<number, number[]>();
  private hit: StageHit = { s: 0, d: 0, roadY: 0, width: 0, surface: 'gravel' };

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

    for (let i = 0; i < xs.length; i++) {
      const key = this.key(Math.floor(xs[i]! / CELL), Math.floor(zs[i]! / CELL));
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(i);
    }
    this.spurs = (def.spurs ?? []).map((sp) => ({ ...sp, y: this.project(sp.points[0]!.x, sp.points[0]!.z).roadY }));
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
    return h;
  }

  /**
   * Som project, men närmaste väg av etappen och de korsande vägarna. För en korsande väg
   * gäller d, roadY, width och surface; s är fortfarande etappens.
   */
  roadAt(x: number, z: number, maxD = Infinity): StageHit {
    const h = this.project(x, z, maxD);
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
          h.roadY = sp.y;
          h.width = sp.width;
          h.surface = sp.surface;
        }
      }
    }
    return h;
  }

  override heightAt(x: number, z: number): number {
    const { d, roadY, width } = this.roadAt(x, z);
    const hw = width / 2;
    const ditch = -0.35 * smooth(hw + 0.3, hw + 1.5, d) * (1 - smooth(hw + 2.5, hw + 4.5, d));
    const bank = smooth(hw + 2.5, hw + 8, d) * 0.12 * (d - hw - 2.5);
    const hills = smooth(hw + 4, hw + 30, d) * (1.8 * Math.sin(x * 0.021 + 1) * Math.cos(z * 0.017) + 0.9 * Math.sin(z * 0.043 + x * 0.029));
    return roadY + ditch + bank + hills;
  }

  override surfaceAt(x: number, z: number): SurfaceId {
    const { d, width, surface } = this.roadAt(x, z);
    if (d <= width / 2 + 0.3) return surface;
    // Vägkanten: lös jord, eller snö om vägen är snöig.
    return surface === 'snow' ? 'snow' : 'mud';
  }
}

/**
 * Första etappen: fiktiv skogsetapp, ca 1,8 km. Underlaget byter bara i korsningar, där etappen
 * leds in på en annan väg och de vägar den lämnar är avspärrade.
 */
export const STAGE_SKOGSBERG: StageDef = {
  name: 'Skogsberg',
  version: '1.0.0',
  recordsSince: '1.0.0',
  points: [
    { x: 0, z: -20, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 0, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 120, y: 1, width: 7, surface: 'gravel' },
    { x: 40, z: 250, y: 3, width: 6.5, surface: 'gravel' },
    { x: 130, z: 320, y: 5, width: 6.5, surface: 'gravel' },
    { x: 240, z: 330, y: 6, width: 6.5, surface: 'gravel' },
    // Korsning: grusvägen fortsätter rakt fram, etappen svänger snävt höger ut på asfaltsvägen
    { x: 284, z: 338, y: 6, width: 6.5, surface: 'gravel' },
    { x: 300, z: 340, y: 5.8, width: 8, surface: 'asphalt' },
    { x: 304, z: 358, y: 5.3, width: 8, surface: 'asphalt' },
    { x: 320, z: 400, y: 4, width: 8, surface: 'asphalt' },
    { x: 330, z: 520, y: 2, width: 8, surface: 'asphalt' },
    // Korsning: asfaltsvägen fortsätter, etappen viker av vänster på en grusväg
    { x: 262, z: 598, y: 1, width: 7, surface: 'gravel' },
    { x: 285, z: 680, y: 3, width: 6.5, surface: 'gravel' },
    // Korsning: grusvägen fortsätter, etappen svänger vänster in på en lerig skogsväg
    { x: 340, z: 820, y: 7, width: 6, surface: 'mud' },
    { x: 460, z: 830, y: 9, width: 6, surface: 'mud' },
    // Skogsvägen mynnar i en grusväg som kommer söderifrån
    { x: 520, z: 850, y: 9, width: 6.5, surface: 'gravel' },
    // Krön och snäv vänster
    { x: 542, z: 872, y: 9, width: 6.5, surface: 'gravel' },
    { x: 546, z: 900, y: 8, width: 6.5, surface: 'gravel' },
    { x: 530, z: 1030, y: 5, width: 6.5, surface: 'gravel' },
    { x: 440, z: 1110, y: 4, width: 7, surface: 'gravel' },
    { x: 420, z: 1240, y: 3, width: 7, surface: 'gravel' },
    { x: 420, z: 1280, y: 3, width: 7, surface: 'gravel' },
    // Utrullning efter mål, så bilen hinner stanna på vägen.
    { x: 420, z: 1340, y: 3, width: 7, surface: 'gravel' },
  ],
  spurs: [
    // Grusvägen rakt fram och asfaltsvägen söderut från första korsningen
    { points: [{ x: 308, z: 341 }, { x: 350, z: 346 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: 300, z: 340 }, { x: 281, z: 283 }], width: 8, surface: 'asphalt' },
    { points: [{ x: 262, z: 598 }, { x: 229, z: 636 }], width: 8, surface: 'asphalt' },
    { points: [{ x: 340, z: 820 }, { x: 358, z: 866 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: 520, z: 850 }, { x: 520, z: 800 }], width: 6.5, surface: 'gravel' },
  ],
};
