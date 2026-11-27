/**
 * Dekaler: startnummer på framdörrarna, huven och taket, och en sponsor per monterad del.
 * Allt ritas på en canvas i bilens koordinater och läses i karossens shader från plåtens
 * viloposition, så dekalerna följer med när plåten bucklas.
 */
import * as THREE from 'three/webgpu';
import { color, float, mix, select, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import type { Sponsor } from '../physics/params';
import type { BodyShape } from './bodies/shape';

type Range = readonly [number, number];

/** Pixlar per meter, kant runt varje fält, canvasens storlek. */
const S = 400;
const M = 16;
const W = 2048;
const H = 1408;
/**
 * Vänster sida överst, höger sida under. Längst ner ovanifrån: bagageluckan och taket läsbara
 * bakifrån (som från jaktkameran) och huven mitt emellan läsbar framifrån (som i menyerna).
 */
const ROW = 320;
const TOPS = 672;
const TRUNK_X = 344;
const HOOD_X = W / 2;
const ROOF_X = 1704;
const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

/** Startnumret följer bilmodellen, så samma bil alltid bär samma nummer. */
export const startNumber = (name: string) => ([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 98) + 2;

const cache = new Map<string, THREE.CanvasTexture>();

/** Canvasen för en bil. Cachas, så menyns bilar som körs varv efter varv inte bygger nya texturer. */
export function decalTexture(b: BodyShape, wheelZ: Range, paint: THREE.Color, number: number, sponsors: Sponsor[]): THREE.CanvasTexture {
  const key = JSON.stringify([b, wheelZ, paint.getHex(), number, sponsors]);
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // Lackfärg överallt: shadern ser dekalen där canvasen skiljer sig från lacken, så kanterna
  // inte får mörka ränder från genomskinliga pixlar när texturen skalas ner.
  ctx.fillStyle = `#${paint.getHexString(THREE.SRGBColorSpace)}`;
  ctx.fillRect(0, 0, W, H);

  const { nose, tail, belt, bottom, screen, backlight, archY, archR } = b;

  const box = (cx: number, cy: number, w: number, h: number, fill: string, r = 0.02) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(cx - (w * S) / 2, cy - (h * S) / 2, w * S, h * S, r * S);
    ctx.fill();
  };
  /** Text centrerad i (cx, cy), så stor som får plats i w × h meter. Returnerar bredden. */
  const text = (cx: number, cy: number, s: string, w: number, h: number, fill: string, italic = true) => {
    let size = h * S;
    ctx.font = `${italic ? 'italic ' : ''}900 ${size}px ${FONT}`;
    const width = ctx.measureText(s).width;
    if (width > w * S) size *= (w * S) / width;
    ctx.font = `${italic ? 'italic ' : ''}900 ${size}px ${FONT}`;
    ctx.fillStyle = fill;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, cx, cy + size * 0.05);
    return Math.min(width, w * S) / S;
  };
  /** Nummerplåt: vit med blått band överst och svart nummer. */
  const plate = (cx: number, cy: number, w: number, h: number) => {
    box(cx, cy, w, h, '#f4f4f0');
    const band = h * 0.24;
    ctx.fillStyle = '#1d4f91';
    ctx.beginPath();
    ctx.roundRect(cx - (w * S) / 2, cy - (h * S) / 2, w * S, band * S, [0.02 * S, 0.02 * S, 0, 0]);
    ctx.fill();
    text(cx, cy - ((h - band) * S) / 2, 'RALLY', w * 0.8, band * 0.75, '#f4f4f0');
    text(cx, cy + (band * S) / 2, String(number), w * 0.85, (h - band) * 0.85, '#141414', false);
  };

  /** Ett fält: canvasens mitt (x) och överkant (y) för varje ställe det ritas, och storleken i meter. */
  type Area = { at: [number, number][]; w: number; h: number; rowH: number };
  const sideArea = (z0: number, z1: number, y0: number, y1: number): Area => {
    const z = (z0 + z1) / 2;
    const top = M + (belt - y1) * S;
    return { at: [[M + (nose - z) * S, top], [M + (z - tail) * S, ROW + top]], w: z1 - z0, h: y1 - y0, rowH: 0.075 };
  };
  // Ovansidorna i z: huven har bortre kanten mot vindrutan, bagageluckan och taket mot fronten.
  const hoodArea = (z0: number, z1: number): Area => ({ at: [[HOOD_X, TOPS + (z0 - screen[0]) * S]], w: 2 * (b.halfX - 0.14), h: z1 - z0, rowH: 0.1 });
  const trunkArea = (z0: number, z1: number): Area => ({ at: [[TRUNK_X, TOPS + (backlight[0] - z1) * S]], w: 2 * (b.halfX - 0.14), h: z1 - z0, rowH: 0.1 });
  const roofHalf = b.cabinHalfX * 0.83 - 0.09;
  const roofArea = (z0: number, z1: number): Area => ({ at: [[ROOF_X, TOPS + (screen[1] - z1) * S]], w: 2 * roofHalf, h: z1 - z0, rowH: 0.12 });
  const center = (a: Area, draw: (cx: number, cy: number) => void) => a.at.forEach(([cx, top]) => draw(cx, top + (a.h * S) / 2));

  // Startnummer på framdörrarna, huven och taket.
  const door = { z: (screen[0] + b.doorSeams[0]!) / 2, y0: belt - 0.38, y1: belt - 0.04, w: 0.52 };
  center(sideArea(door.z - door.w / 2, door.z + door.w / 2, door.y0, door.y1), (cx, cy) => plate(cx, cy, door.w, door.y1 - door.y0));
  // Med ett upphöjt luftintag på huven hamnar numret mellan vindrutan och intaget.
  const scoop = b.hoodScoopZ;
  const hoodPlate = scoop ? (screen[0] + scoop[0]) / 2 : screen[0] + (nose - screen[0]) / 2 + 0.05;
  center(hoodArea(hoodPlate - 0.18, hoodPlate + 0.18), (cx, cy) => plate(cx, cy, 0.62, 0.36));
  const roofZ: Range = [(backlight[1] + screen[1]) / 2 - 0.42 * (screen[1] - backlight[1]), (backlight[1] + screen[1]) / 2 + 0.42 * (screen[1] - backlight[1])];
  const roofPlate = Math.min(0.62, 2 * roofHalf);
  center(roofArea(roofZ[0], roofZ[0] + 0.42), (cx, cy) => plate(cx, cy, roofPlate, 0.42));

  // Sponsorerna staplas i rader i fälten runt nummerplåtarna; fälten i ordning efter hur väl de syns.
  const GAP = 0.022;
  const rearArch = wheelZ[1] + archR[1] + 0.04;
  const areas = [
    sideArea(screen[0] + 0.06, nose - 0.16, archY + archR[0] + 0.04, belt - 0.03), // framskärmen
    hoodArea(screen[0] + 0.08, hoodPlate - 0.21), // huven bakom plåten
    sideArea(rearArch, door.z - door.w / 2 - 0.05, bottom + 0.2, belt - 0.03), // mellan bakre hjulhuset och dörrens nummer
    trunkArea(tail + 0.12, backlight[0] - 0.06), // bagageluckan
    roofArea(roofZ[0] + 0.48, roofZ[1]), // taket framför numret
    hoodArea(scoop ? scoop[1] + 0.03 : hoodPlate + 0.21, nose - 0.14), // huven framför plåten (och intaget)
    sideArea(tail + 0.22, rearArch, archY + archR[1] + 0.04, belt - 0.03), // bakskärmen
    sideArea(door.z - door.w / 2, door.z + door.w / 2, bottom + 0.2, door.y0 - 0.02), // under dörrens nummer
  ];
  type Slot = { at: [number, number][]; w: number; h: number };
  const rows = areas.map((a): Slot[] => {
    const n = a.w < 0.25 ? 0 : Math.floor((a.h + GAP) / (a.rowH + GAP));
    const first = (a.h - n * a.rowH - (n - 1) * GAP) / 2 + a.rowH / 2;
    return Array.from({ length: n }, (_, i) => ({ at: a.at.map(([cx, top]) => [cx, top + (first + i * (a.rowH + GAP)) * S]), w: a.w, h: a.rowH }));
  });
  // En rad i taget från varje fält, så få sponsorer sprids över hela bilen.
  const slots: Slot[] = [];
  for (let i = 0; slots.length < sponsors.length && rows.some((r) => r.length > i); i++) rows.forEach((r) => r[i] && slots.push(r[i]));
  // shortcut: fler sponsorer än platser ritas inte; krymp raderna om det händer.
  sponsors.slice(0, slots.length).forEach((sp, i) => {
    const s = slots[i]!;
    for (const [cx, cy] of s.at) {
      if (!sp.bg) {
        text(cx, cy, sp.name, s.w, s.h, sp.fg);
        continue;
      }
      // Mät först med genomskinlig text, så bakgrunden blir lika bred som namnet.
      const w = Math.min(s.w, text(cx, cy, sp.name, s.w - 0.04, s.h * 0.78, 'rgba(0,0,0,0)') + 0.05);
      box(cx, cy, w, s.h, sp.bg, 0.01);
      text(cx, cy, sp.name, s.w - 0.04, s.h * 0.78, sp.fg);
    }
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

/** Där canvasen har lackens färg syns det som ligger under (lister, springor). */
function over(under: THREE.Node<'color'>, tex: THREE.Texture, uv: THREE.Node<'vec2'>, mask: THREE.Node<'bool'>, paint: THREE.Color) {
  const t = texture(tex, uv);
  const a = smoothstep(0.01, 0.06, t.rgb.sub(vec3(paint.r, paint.g, paint.b)).length()).mul(select(mask, float(1), float(0)));
  return color(mix(under, t.rgb, a));
}

/** Karossens dekaler: sidorna, huven och bagageluckan. `p` är plåtens viloposition, `side` sidornas mask. */
export function bodyDecals(under: THREE.Node<'color'>, p: THREE.Node<'vec3'>, side: THREE.Node<'bool'>, b: BodyShape, tex: THREE.Texture, paint: THREE.Color) {
  const left = p.x.greaterThan(0);
  const sideUv = vec2(
    select(left, p.z.negate().add(b.nose), p.z.sub(b.tail)).mul(S).add(M).div(W),
    select(left, float(0), float(ROW)).add(M).add(p.y.negate().add(b.belt).mul(S)).div(H),
  );
  const front = p.z.greaterThan(b.screen[0]);
  const hoodUv = vec2(p.x.mul(S).add(HOOD_X).div(W), p.z.sub(b.screen[0]).mul(S).add(TOPS).div(H));
  const trunkUv = vec2(p.x.mul(-S).add(TRUNK_X).div(W), p.z.negate().add(b.backlight[0]).mul(S).add(TOPS).div(H));
  // Fronten och bakpartiet hamnar i kanten av huvens och bagageluckans fält, där canvasen är lack.
  const lid = p.y.greaterThan(b.belt - 0.2).and(front.or(p.z.lessThan(b.backlight[0])));
  return over(under, tex, select(side, sideUv, select(front, hoodUv, trunkUv)), side.or(lid), paint);
}

/** Takets dekaler, från takets x och z i bilens koordinater. */
export function roofDecals(under: THREE.Node<'color'>, x: THREE.Node<'float'>, z: THREE.Node<'float'>, roof: THREE.Node<'bool'>, b: BodyShape, tex: THREE.Texture, paint: THREE.Color) {
  const uv = vec2(x.mul(-S).add(ROOF_X).div(W), z.negate().add(b.screen[1]).mul(S).add(TOPS).div(H));
  return over(under, tex, uv, roof, paint);
}
