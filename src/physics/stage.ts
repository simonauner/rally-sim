import { CatmullRomCurve3, Vector3 } from 'three';
import { TYRE_GRIP, type SurfaceId, type TyreType } from './surfaces';
import { ANDERSVATTNET } from './real/andersvattnet';
import { BACK } from './real/back';
import { BYGDSILJUM } from './real/bygdsiljum';
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
    this.finish = this.length - (def.runout ?? FINISH_MARGIN);

    for (let i = 0; i < xs.length; i++) {
      const key = this.key(Math.floor(xs[i]! / CELL), Math.floor(zs[i]! / CELL));
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(i);
    }
    this.spurs = def.spurs ?? [];
    this.placeTrees();
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
      const { d, width } = this.roadAt(x, z, STAGE_CORRIDOR);
      if (d < width / 2 + 7 || d > STAGE_CORRIDOR - 2) continue;
      const scale = 0.7 + r() * 0.9;
      this.trunks.push({ x, z, y: this.heightAt(x, z), r: 0.33 * scale, scale });
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
    return roadY + edge + bank + hills;
  }

  override surfaceAt(x: number, z: number): SurfaceId {
    const { d, width, surface } = this.roadAt(x, z);
    if (d <= width / 2 + 0.3) return surface;
    // Utanför vinterväg är det vallar och sedan djup snö: hjulen gräver ner sig.
    if (this.def.winter) return 'snowbank';
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
  version: '1.0.1',
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

/**
 * Andra etappen: fiktiv, ca 2,6 km. Snabbt grus, en lerig väg över myren, en lång stigning med
 * krön, en asfaltsbit och grus in i mål.
 */
export const STAGE_MYRKULLA: StageDef = {
  name: 'Myrkulla',
  version: '1.0.1',
  recordsSince: '1.0.0',
  points: [
    { x: 0, z: -20, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 0, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 100, y: 1, width: 7, surface: 'gravel' },
    { x: -30, z: 200, y: 2, width: 7, surface: 'gravel' },
    { x: -110, z: 260, y: 4, width: 7, surface: 'gravel' },
    { x: -220, z: 280, y: 5, width: 6.5, surface: 'gravel' },
    { x: -300, z: 340, y: 6, width: 6.5, surface: 'gravel' },
    { x: -320, z: 450, y: 8, width: 6.5, surface: 'gravel' },
    // Korsning: grusvägen fortsätter, etappen svänger höger ut på myren
    { x: -330, z: 525, y: 8, width: 6.5, surface: 'gravel' },
    { x: -350, z: 545, y: 7.5, width: 5.5, surface: 'mud' },
    { x: -400, z: 550, y: 6, width: 5.5, surface: 'mud' },
    { x: -520, z: 545, y: 5, width: 5.5, surface: 'mud' },
    { x: -600, z: 570, y: 4, width: 5.5, surface: 'mud' },
    { x: -660, z: 620, y: 4, width: 5.5, surface: 'mud' },
    // Myrvägen mynnar i en grusväg som stiger upp mot kullen
    { x: -690, z: 700, y: 6, width: 6.5, surface: 'gravel' },
    { x: -680, z: 800, y: 12, width: 6.5, surface: 'gravel' },
    { x: -640, z: 880, y: 17, width: 6.5, surface: 'gravel' },
    // Krön på kullen
    { x: -560, z: 940, y: 21, width: 6.5, surface: 'gravel' },
    { x: -470, z: 960, y: 20, width: 6.5, surface: 'gravel' },
    { x: -380, z: 1010, y: 17, width: 6.5, surface: 'gravel' },
    { x: -350, z: 1080, y: 15, width: 6.5, surface: 'gravel' },
    { x: -400, z: 1160, y: 13, width: 7, surface: 'gravel' },
    { x: -420, z: 1280, y: 10, width: 7, surface: 'gravel' },
    // Korsning: etappen svänger höger ut på asfaltsvägen
    { x: -380, z: 1400, y: 7, width: 7, surface: 'gravel' },
    { x: -370, z: 1420, y: 6, width: 8, surface: 'asphalt' },
    { x: -300, z: 1500, y: 5, width: 8, surface: 'asphalt' },
    // Korsning: asfaltsvägen fortsätter, etappen viker av vänster på grus mot mål
    { x: -180, z: 1530, y: 4, width: 8, surface: 'asphalt' },
    { x: -140, z: 1550, y: 4, width: 7, surface: 'gravel' },
    { x: -100, z: 1620, y: 3, width: 7, surface: 'gravel' },
    { x: -90, z: 1720, y: 3, width: 7, surface: 'gravel' },
    { x: -90, z: 1760, y: 3, width: 7, surface: 'gravel' },
    // Utrullning efter mål
    { x: -90, z: 1820, y: 3, width: 7, surface: 'gravel' },
  ],
  spurs: [
    { points: [{ x: -330, z: 525 }, { x: -338, z: 610 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: -690, z: 700 }, { x: -770, z: 705 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: -370, z: 1420 }, { x: -440, z: 1445 }], width: 8, surface: 'asphalt' },
    { points: [{ x: -180, z: 1530 }, { x: -70, z: 1515 }], width: 8, surface: 'asphalt' },
  ],
};

/** Skymningsetapp: fiktiv, ca 1,9 km snabbt tallmogrus med en asfaltsbit på mitten. */
export const STAGE_TALLMON: StageDef = {
  name: 'Tallmon',
  version: '1.0.1',
  recordsSince: '1.0.0',
  light: 'dusk',
  points: [
    { x: 0, z: -20, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 0, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 80, y: 0, width: 7, surface: 'gravel' },
    { x: -40, z: 170, y: 1, width: 7, surface: 'gravel' },
    { x: -20, z: 260, y: 2, width: 7, surface: 'gravel' },
    { x: 60, z: 320, y: 3, width: 6.5, surface: 'gravel' },
    { x: 170, z: 330, y: 4, width: 6.5, surface: 'gravel' },
    { x: 260, z: 380, y: 6, width: 6.5, surface: 'gravel' },
    { x: 290, z: 480, y: 7, width: 6.5, surface: 'gravel' },
    { x: 250, z: 580, y: 8, width: 6.5, surface: 'gravel' },
    { x: 170, z: 640, y: 7, width: 6.5, surface: 'gravel' },
    { x: 110, z: 720, y: 6, width: 7, surface: 'gravel' },
    // Korsning: grusvägen fortsätter, etappen svänger vänster ut på asfaltsvägen
    { x: 120, z: 820, y: 5, width: 8, surface: 'asphalt' },
    { x: 190, z: 890, y: 5, width: 8, surface: 'asphalt' },
    { x: 300, z: 900, y: 4, width: 8, surface: 'asphalt' },
    // Korsning: asfaltsvägen fortsätter, etappen svänger höger in på grus mot mål
    { x: 400, z: 880, y: 4, width: 7, surface: 'gravel' },
    { x: 470, z: 930, y: 4, width: 7, surface: 'gravel' },
    { x: 520, z: 1030, y: 5, width: 7, surface: 'gravel' },
    { x: 500, z: 1140, y: 5, width: 7, surface: 'gravel' },
    { x: 540, z: 1240, y: 4, width: 7, surface: 'gravel' },
    { x: 540, z: 1290, y: 4, width: 7, surface: 'gravel' },
    // Utrullning efter mål
    { x: 540, z: 1350, y: 4, width: 7, surface: 'gravel' },
  ],
  spurs: [
    { points: [{ x: 120, z: 820 }, { x: 108, z: 905 }], width: 7, surface: 'gravel' },
    { points: [{ x: 400, z: 880 }, { x: 485, z: 868 }], width: 8, surface: 'asphalt' },
  ],
};

/** Gryningsetapp: fiktiv, ca 1,9 km över kala ljunghedar med två krön och en lerig sänka. */
export const STAGE_LJUNGHEDEN: StageDef = {
  name: 'Ljungheden',
  version: '1.0.1',
  recordsSince: '1.0.0',
  light: 'dawn',
  points: [
    { x: 0, z: -20, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 0, y: 0, width: 7, surface: 'gravel' },
    { x: 0, z: 90, y: 0, width: 7, surface: 'gravel' },
    { x: 30, z: 190, y: 2, width: 7, surface: 'gravel' },
    { x: 10, z: 290, y: 5, width: 6.5, surface: 'gravel' },
    { x: -60, z: 360, y: 8, width: 6.5, surface: 'gravel' },
    // Krön
    { x: -170, z: 380, y: 10, width: 6.5, surface: 'gravel' },
    { x: -270, z: 350, y: 9, width: 6.5, surface: 'gravel' },
    { x: -360, z: 380, y: 7, width: 6.5, surface: 'gravel' },
    // Korsning: grusvägen fortsätter, etappen svänger höger ner i den leriga sänkan
    { x: -410, z: 470, y: 5, width: 6, surface: 'mud' },
    { x: -400, z: 560, y: 4, width: 6, surface: 'mud' },
    { x: -340, z: 640, y: 4, width: 6, surface: 'mud' },
    // Ut på en grusväg som kommer österifrån och klättrar mot nästa krön
    { x: -330, z: 740, y: 5, width: 6.5, surface: 'gravel' },
    { x: -390, z: 830, y: 8, width: 6.5, surface: 'gravel' },
    { x: -470, z: 880, y: 11, width: 6.5, surface: 'gravel' },
    { x: -560, z: 950, y: 13, width: 6.5, surface: 'gravel' },
    { x: -590, z: 1060, y: 11, width: 7, surface: 'gravel' },
    { x: -560, z: 1160, y: 8, width: 7, surface: 'gravel' },
    { x: -560, z: 1210, y: 8, width: 7, surface: 'gravel' },
    // Utrullning efter mål
    { x: -560, z: 1270, y: 8, width: 7, surface: 'gravel' },
  ],
  spurs: [
    { points: [{ x: -410, z: 470 }, { x: -485, z: 515 }], width: 6.5, surface: 'gravel' },
    { points: [{ x: -330, z: 740 }, { x: -245, z: 760 }], width: 6.5, surface: 'gravel' },
  ],
};

/** Extra raksträcka efter den verkliga vägens slut (m): på snö behövs mer än 80 m för att stanna. */
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
 * Etapper från en verklig sträcka i delar, på snöig vinterväg med källan angiven.
 * `light` ger ljuset per del (dag om inget anges).
 */
function realWinterStages(source: string, parts: RealStagePart[], light: (Light | undefined)[] = []): StageDef[] {
  return parts.map((part, i) => ({
    name: part.name,
    version: '1.0.1',
    recordsSince: '1.0.0',
    winter: true,
    ...(light[i] ? { light: light[i] } : {}),
    credit: `${source}, del ${i + 1} av ${parts.length} · kartdata © OpenStreetMap contributors (ODbL) · höjd EU-DEM, Copernicus`,
    points: withRunout(part.road).map(([x, z, y, width = 6]) => ({ x, z, y, width, surface: 'snow' as const })),
    spurs: part.spurs.map((points) => ({ points, width: 5, surface: 'snow' as const })),
    runout: FINISH_MARGIN + RUNOUT_EXTRA,
  }));
}

/**
 * Andersvattnet ur Rally Sweden i fyra delar (se andersvattnet.ts). Sista delen körs i skymning,
 * som eftermiddagens omgång i rallyt.
 */
export const [STAGE_STORBERGET, STAGE_HOSJOALVEN, STAGE_ROJMYRBERGET, STAGE_FLARKAN] = realWinterStages(
  'Andersvattnet i Rally Sweden',
  ANDERSVATTNET,
  [undefined, undefined, undefined, 'dusk'],
) as [StageDef, StageDef, StageDef, StageDef];

/** Bygdsiljum ur Rally Sweden i fem delar (se bygdsiljum.ts). Sista delen körs på natten. */
export const [STAGE_ASJON, STAGE_ALTARLIDEN, STAGE_BERGTJARNEN, STAGE_TORPET, STAGE_TROLLBERGET] = realWinterStages(
  'Bygdsiljum i Rally Sweden',
  BYGDSILJUM,
  [undefined, undefined, undefined, undefined, 'night'],
) as [StageDef, StageDef, StageDef, StageDef, StageDef];

/** Bäck ur Rally Sweden i tre delar (se back.ts). Sista delen körs i skymning, som eftermiddagens omgång. */
export const [STAGE_NAS, STAGE_RICKLEAN, STAGE_VALSFABODA] = realWinterStages('Bäck i Rally Sweden', BACK, [undefined, undefined, 'dusk']) as [
  StageDef,
  StageDef,
  StageDef,
];

/**
 * Samma väg körd åt andra hållet. Underlaget gäller från en punkt fram till nästa, så varje
 * vänd punkt får underlaget från segmentet som nu ligger framför den. Den gamla utrullningen
 * blir startraka och den gamla startraka blir utrullning efter mål.
 */
export function reversed(def: StageDef, name: string): StageDef {
  const pts = def.points;
  const n = pts.length;
  return {
    ...def,
    name,
    points: pts.map((_, k) => ({ ...pts[n - 1 - k]!, surface: pts[Math.max(0, n - 2 - k)]!.surface })),
  };
}

export const STAGE_SKOGSBERG_BACK = reversed(STAGE_SKOGSBERG, 'Skogsberg baklänges');
export const STAGE_MYRKULLA_BACK = reversed(STAGE_MYRKULLA, 'Myrkulla baklänges');

/** Alla etapper, i den ordning menyerna visar dem. */
export const STAGES: StageDef[] = [
  STAGE_SKOGSBERG,
  STAGE_SKOGSBERG_BACK,
  STAGE_TALLMON,
  STAGE_LJUNGHEDEN,
  STAGE_MYRKULLA,
  STAGE_MYRKULLA_BACK,
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
