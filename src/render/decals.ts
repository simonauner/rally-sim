/**
 * Decals: start numbers on the front doors, hood and roof, and one sponsor per fitted part.
 * Everything is drawn on a canvas in car coordinates and read in the body shader from the panels'
 * rest position, so the decals follow along when the panels dent.
 */
import * as THREE from 'three/webgpu';
import { color, float, mix, select, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import type { Livery, Sponsor } from '../physics/params';
import type { BodyShape } from './bodies/shape';

type Range = readonly [number, number];

/** Pixels per metre, margin around each field, canvas size. */
const S = 400;
const M = 16;
const W = 2048;
const H = 1408;
/**
 * Left side at the top, right side below. At the bottom, seen from above: the boot lid and roof readable
 * from behind (as from the chase camera) and the hood in between readable from the front (as in the menus).
 */
const ROW = 320;
const TOPS = 672;
const TRUNK_X = 344;
const HOOD_X = W / 2;
const ROOF_X = 1704;
const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

/** The start number follows the car model, so the same car always carries the same number. */
export const startNumber = (name: string) => ([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 98) + 2;

const cache = new Map<string, THREE.CanvasTexture>();

/** The canvas for one car. Cached, so the menu's cars driving lap after lap don't build new textures. */
export function decalTexture(b: BodyShape, wheelZ: Range, paint: THREE.Color, number: number, sponsors: Sponsor[], livery?: Livery): THREE.CanvasTexture {
  if (livery) sponsors = [livery.sponsor, ...sponsors];
  const key = JSON.stringify([b, wheelZ, paint.getHex(), number, sponsors, livery]);
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // Paint colour everywhere: the shader sees the decal where the canvas differs from the paint, so the edges
  // don't get dark fringes from transparent pixels when the texture is scaled down.
  ctx.fillStyle = `#${paint.getHexString(THREE.SRGBColorSpace)}`;
  ctx.fillRect(0, 0, W, H);

  const { nose, tail, belt, bottom, screen, backlight, archY, archR } = b;

  const box = (cx: number, cy: number, w: number, h: number, fill: string, r = 0.02) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(cx - (w * S) / 2, cy - (h * S) / 2, w * S, h * S, r * S);
    ctx.fill();
  };
  /** Text centred at (cx, cy), as large as fits in w × h metres. Returns the width. */
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
  /** Number plate: white with a blue band at the top and a black number. */
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

  if (livery) {
    // Bands on each side row, from nose to tail; the left side has the nose at the canvas' left edge, the right side at the far end.
    const len = (nose - tail) * S;
    for (const row of [0, ROW]) {
      // Canvas x at a fraction of the length from the nose; the ends reach past the bumpers.
      const x = (f: number) => {
        const d = f * len + (f <= 0 ? -M : f >= 1 ? M : 0);
        return row ? M + len - d : M + d;
      };
      const y = (f: number) => row + M + f * (belt - bottom) * S;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, row, W, ROW);
      ctx.clip();
      for (const { color, top, bottom: low, from = 0, to = 1, rise = 0, flare = 0, bend = 0 } of livery.bands) {
        const [x0, x1, xm] = [x(from), x(to), x((from + to) / 2)];
        const [t1, b1] = [top - rise - flare, low - rise];
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x0, y(top));
        ctx.quadraticCurveTo(xm, y((top + t1) / 2 + 2 * bend), x1, y(t1));
        ctx.lineTo(x1, y(b1));
        ctx.quadraticCurveTo(xm, y((low + b1) / 2 + 2 * bend), x0, y(low));
        ctx.fill();
      }
      ctx.restore();
    }
    // Stripes over the top fields; the boot lid and roof are drawn mirrored (read from behind).
    for (const st of livery.stripes ?? [])
      for (const [cx, dir] of [[HOOD_X, 1], [TRUNK_X, -1], [ROOF_X, -1]] as const) {
        ctx.fillStyle = st.color;
        ctx.fillRect(cx + (dir * st.x - st.w / 2) * S, TOPS, st.w * S, H - TOPS);
      }
  }

  /** A field: the canvas centre (x) and top edge (y) for each place it is drawn, and its size in metres. */
  type Area = { at: [number, number][]; w: number; h: number; rowH: number };
  const sideArea = (z0: number, z1: number, y0: number, y1: number): Area => {
    const z = (z0 + z1) / 2;
    const top = M + (belt - y1) * S;
    return { at: [[M + (nose - z) * S, top], [M + (z - tail) * S, ROW + top]], w: z1 - z0, h: y1 - y0, rowH: 0.075 };
  };
  // The top surfaces in z: the hood has its far edge towards the windscreen, the boot lid and roof towards the front.
  const hoodArea = (z0: number, z1: number): Area => ({ at: [[HOOD_X, TOPS + (z0 - screen[0]) * S]], w: 2 * (b.halfX - 0.14), h: z1 - z0, rowH: 0.1 });
  const trunkArea = (z0: number, z1: number): Area => ({ at: [[TRUNK_X, TOPS + (backlight[0] - z1) * S]], w: 2 * (b.halfX - 0.14), h: z1 - z0, rowH: 0.1 });
  const roofHalf = b.cabinHalfX * 0.83 - 0.09;
  const roofArea = (z0: number, z1: number): Area => ({ at: [[ROOF_X, TOPS + (screen[1] - z1) * S]], w: 2 * roofHalf, h: z1 - z0, rowH: 0.12 });
  const center = (a: Area, draw: (cx: number, cy: number) => void) => a.at.forEach(([cx, top]) => draw(cx, top + (a.h * S) / 2));

  // Start numbers on the front doors, hood and roof.
  const door = { z: (screen[0] + b.doorSeams[0]!) / 2, y0: belt - 0.38, y1: belt - 0.04, w: 0.52 };
  center(sideArea(door.z - door.w / 2, door.z + door.w / 2, door.y0, door.y1), (cx, cy) => plate(cx, cy, door.w, door.y1 - door.y0));
  // With a raised air intake on the hood, the number goes between the windscreen and the intake.
  const scoop = b.hoodScoopZ;
  const hoodPlate = scoop ? (screen[0] + scoop[0]) / 2 : screen[0] + (nose - screen[0]) / 2 + 0.05;
  center(hoodArea(hoodPlate - 0.18, hoodPlate + 0.18), (cx, cy) => plate(cx, cy, 0.62, 0.36));
  const roofZ: Range = [(backlight[1] + screen[1]) / 2 - 0.42 * (screen[1] - backlight[1]), (backlight[1] + screen[1]) / 2 + 0.42 * (screen[1] - backlight[1])];
  const roofPlate = Math.min(0.62, 2 * roofHalf);
  center(roofArea(roofZ[0], roofZ[0] + 0.42), (cx, cy) => plate(cx, cy, roofPlate, 0.42));

  // Sponsors are stacked in rows in the fields around the number plates; fields ordered by how visible they are.
  const GAP = 0.022;
  const rearArch = wheelZ[1] + archR[1] + 0.04;
  const areas = [
    sideArea(screen[0] + 0.06, nose - 0.16, archY + archR[0] + 0.04, belt - 0.03), // front fender
    hoodArea(screen[0] + 0.08, hoodPlate - 0.21), // hood behind the plate
    sideArea(rearArch, door.z - door.w / 2 - 0.05, bottom + 0.2, belt - 0.03), // between the rear wheel arch and the door number
    trunkArea(tail + 0.12, backlight[0] - 0.06), // boot lid
    roofArea(roofZ[0] + 0.48, roofZ[1]), // roof in front of the number
    hoodArea(scoop ? scoop[1] + 0.03 : hoodPlate + 0.21, nose - 0.14), // hood in front of the plate (and the intake)
    sideArea(tail + 0.22, rearArch, archY + archR[1] + 0.04, belt - 0.03), // rear fender
    sideArea(door.z - door.w / 2, door.z + door.w / 2, bottom + 0.2, door.y0 - 0.02), // below the door number
  ];
  type Slot = { at: [number, number][]; w: number; h: number };
  const rows = areas.map((a): Slot[] => {
    const n = a.w < 0.25 ? 0 : Math.floor((a.h + GAP) / (a.rowH + GAP));
    const first = (a.h - n * a.rowH - (n - 1) * GAP) / 2 + a.rowH / 2;
    return Array.from({ length: n }, (_, i) => ({ at: a.at.map(([cx, top]) => [cx, top + (first + i * (a.rowH + GAP)) * S]), w: a.w, h: a.rowH }));
  });
  // One row at a time from each field, so a few sponsors are spread over the whole car.
  const slots: Slot[] = [];
  for (let i = 0; slots.length < sponsors.length && rows.some((r) => r.length > i); i++) rows.forEach((r) => r[i] && slots.push(r[i]));
  // shortcut: sponsors beyond the available slots aren't drawn; shrink the rows if that happens.
  sponsors.slice(0, slots.length).forEach((sp, i) => {
    const s = slots[i]!;
    for (const [cx, cy] of s.at) {
      if (!sp.bg) {
        text(cx, cy, sp.name, s.w, s.h, sp.fg);
        continue;
      }
      // Measure first with transparent text, so the background is as wide as the name.
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

/** Where the canvas has the paint colour, what lies underneath shows through (mouldings, seams). */
function over(under: THREE.Node<'color'>, tex: THREE.Texture, uv: THREE.Node<'vec2'>, mask: THREE.Node<'bool'>, paint: THREE.Color) {
  const t = texture(tex, uv);
  const a = smoothstep(0.01, 0.06, t.rgb.sub(vec3(paint.r, paint.g, paint.b)).length()).mul(select(mask, float(1), float(0)));
  return color(mix(under, t.rgb, a));
}

/** Body decals: the sides, hood and boot lid. `p` is the panels' rest position, `side` the sides' mask. */
export function bodyDecals(under: THREE.Node<'color'>, p: THREE.Node<'vec3'>, side: THREE.Node<'bool'>, b: BodyShape, tex: THREE.Texture, paint: THREE.Color) {
  const left = p.x.greaterThan(0);
  const sideUv = vec2(
    select(left, p.z.negate().add(b.nose), p.z.sub(b.tail)).mul(S).add(M).div(W),
    select(left, float(0), float(ROW)).add(M).add(p.y.negate().add(b.belt).mul(S)).div(H),
  );
  const front = p.z.greaterThan(b.screen[0]);
  const hoodUv = vec2(p.x.mul(S).add(HOOD_X).div(W), p.z.sub(b.screen[0]).mul(S).add(TOPS).div(H));
  const trunkUv = vec2(p.x.mul(-S).add(TRUNK_X).div(W), p.z.negate().add(b.backlight[0]).mul(S).add(TOPS).div(H));
  // The front and rear end land at the edge of the hood and boot lid fields, where the canvas is paint.
  const lid = p.y.greaterThan(b.belt - 0.2).and(front.or(p.z.lessThan(b.backlight[0])));
  return over(under, tex, select(side, sideUv, select(front, hoodUv, trunkUv)), side.or(lid), paint);
}

/** Roof decals, from the roof's x and z in car coordinates. */
export function roofDecals(under: THREE.Node<'color'>, x: THREE.Node<'float'>, z: THREE.Node<'float'>, roof: THREE.Node<'bool'>, b: BodyShape, tex: THREE.Texture, paint: THREE.Color) {
  const uv = vec2(x.mul(-S).add(ROOF_X).div(W), z.negate().add(b.screen[1]).mul(S).add(TOPS).div(H));
  return over(under, tex, uv, roof, paint);
}
