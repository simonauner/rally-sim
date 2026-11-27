/**
 * Dekaler: startnummer på framdörrarna och huven, och en sponsor per monterad del.
 * Allt ritas på en canvas i bilens koordinater och läses i karossens shader från plåtens
 * viloposition, så dekalerna följer med när plåten bucklas.
 */
import * as THREE from 'three/webgpu';
import { abs, color, float, mix, select, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import type { Sponsor } from '../physics/params';
import type { BodyShape } from './carMesh';

type Range = readonly [number, number];

/** Pixlar per meter, kant runt varje fält, canvasens storlek. */
const S = 400;
const M = 16;
const W = 2048;
const H = 1280;
/** Vänster sida överst, höger sida under, huven sedd framifrån längst ner. */
const ROW = 320;
const HOOD = 672;
const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

/** Startnumret följer bilmodellen, så samma bil alltid bär samma nummer. */
export const startNumber = (name: string) => ([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 98) + 2;

const cache = new Map<string, THREE.CanvasTexture>();

/** Canvasen för en bil. Cachas, så menyns bilar som körs varv efter varv inte bygger nya texturer. */
function decalTexture(b: BodyShape, wheelZ: Range, paint: THREE.Color, number: number, sponsors: Sponsor[]): THREE.CanvasTexture {
  const key = JSON.stringify([b.nose, b.tail, wheelZ, paint.getHex(), number, sponsors]);
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

  const { nose, tail, belt, bottom, screen, archY, archR } = b;
  type Rect = { z: number; y: number; w: number; h: number };
  /** Ritar på båda sidorna, så texten läses från vänster till höger på var sida. */
  const onSides = (draw: (cx: number, cy: number) => void, z: number, y: number) => {
    draw(M + (nose - z) * S, M + (belt - y) * S);
    draw(M + (z - tail) * S, ROW + M + (belt - y) * S);
  };

  const box = (cx: number, cy: number, w: number, h: number, fill: string, r = 0.02) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(cx - (w * S) / 2, cy - (h * S) / 2, w * S, h * S, r * S);
    ctx.fill();
  };
  /** Text centrerad i (cx, cy), så stor som får plats i w × h meter. */
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

  // Startnummer på framdörren.
  const panel: Rect = { z: (screen[0] + b.doorSeams[0]!) / 2, y: belt - 0.04 - 0.17, w: 0.52, h: 0.34 };
  onSides((cx, cy) => plate(cx, cy, panel.w, panel.h), panel.z, panel.y);
  // Och på huven, läsbart framifrån som i menyerna.
  plate(W / 2, HOOD + ((nose - screen[0]) / 2 + 0.05) * S, 0.62, 0.36);

  // Sponsorerna staplas i rader i fält runt nummerplåten och ovanför hjulhusen, viktigast först.
  const ROW_H = 0.075;
  const GAP = 0.022;
  const rearArch = wheelZ[1] + archR[1] + 0.04;
  const areas = [
    // Framskärmen ovanför hjulhuset.
    { z0: screen[0] + 0.06, z1: nose - 0.16, y0: archY + archR[0] + 0.04, y1: belt - 0.03 },
    // Mellan bakre hjulhuset och nummerplåten.
    { z0: rearArch, z1: panel.z - panel.w / 2 - 0.05, y0: bottom + 0.2, y1: belt - 0.03 },
    // Bakskärmen ovanför hjulhuset.
    { z0: tail + 0.22, z1: rearArch, y0: archY + archR[1] + 0.04, y1: belt - 0.03 },
    // Under nummerplåten.
    { z0: panel.z - panel.w / 2, z1: panel.z + panel.w / 2, y0: bottom + 0.2, y1: panel.y - panel.h / 2 - 0.02 },
  ];
  const slots: Rect[] = [];
  for (const a of areas) {
    if (a.z1 - a.z0 < 0.25) continue;
    for (let y = a.y1 - ROW_H / 2; y - ROW_H / 2 >= a.y0; y -= ROW_H + GAP) slots.push({ z: (a.z0 + a.z1) / 2, y, w: a.z1 - a.z0, h: ROW_H });
  }
  // shortcut: fler sponsorer än platser (14 delar på en sedan) ritas inte; krymp raderna om det syns.
  sponsors.slice(0, slots.length).forEach((sp, i) => {
    const s = slots[i]!;
    onSides((cx, cy) => {
      if (!sp.bg) return void text(cx, cy, sp.name, s.w, s.h, sp.fg);
      // Mät först med genomskinlig text, så bakgrunden blir lika bred som namnet.
      const w = Math.min(s.w, text(cx, cy, sp.name, s.w - 0.04, s.h * 0.78, 'rgba(0,0,0,0)') + 0.05);
      box(cx, cy, w, s.h, sp.bg, 0.01);
      text(cx, cy, sp.name, s.w - 0.04, s.h * 0.78, sp.fg);
    }, s.z, s.y);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}

/**
 * Lägger dekalerna över `under` på sidorna och huven. `p` är plåtens viloposition, `side` och
 * `top` karossens masker för sidorna och ovansidan.
 */
export function withDecals(
  under: THREE.Node<'color'>,
  p: THREE.Node<'vec3'>,
  side: THREE.Node<'bool'>,
  top: THREE.Node<'bool'>,
  b: BodyShape,
  wheelZ: Range,
  paint: THREE.Color,
  number: number,
  sponsors: Sponsor[],
) {
  const tex = decalTexture(b, wheelZ, paint, number, sponsors);
  const left = p.x.greaterThan(0);
  const sideUv = vec2(
    select(left, p.z.negate().add(b.nose), p.z.sub(b.tail)).mul(S).add(M).div(W),
    select(left, float(0), float(ROW)).add(M).add(p.y.negate().add(b.belt).mul(S)).div(H),
  );
  const hoodUv = vec2(p.x.mul(S).add(W / 2).div(W), p.z.sub(b.screen[0]).mul(S).add(HOOD).div(H));
  const hood = top.and(abs(p.x).lessThan(b.halfX - 0.05)).and(p.z.greaterThan(b.screen[0]));
  const t = texture(tex, select(side, sideUv, hoodUv));
  // Där canvasen har lackens färg syns det som ligger under (lister, springor).
  const a = smoothstep(0.01, 0.06, t.rgb.sub(vec3(paint.r, paint.g, paint.b)).length()).mul(select(side.or(hood), float(1), float(0)));
  return color(mix(under, t.rgb, a));
}
