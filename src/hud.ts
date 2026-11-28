import { LAMP_BROKEN, type Car, type Input } from './physics/car';
import type { CarParams, GaugeStyle } from './physics/params';
import { SURFACES, TYRE_NAMES } from './physics/surfaces';
import type { PaceNote } from './physics/pacenotes';
import type { StageTimer } from './physics/timing';
import type { StageRecord } from './account/protocol';

const WHEEL_NAMES = ['VF', 'HF', 'VB', 'HB'];

/** The keys, one per row in the menu's Kontroller. */
const CONTROLS: [string, string][] = [
  ['W', 'gas'],
  ['S', 'broms, bakåt vid stopp'],
  ['A/D', 'styr'],
  ['Mellanslag', 'handbroms'],
  ['R', 'tillbaka på vägen'],
  ['T', 'starta om'],
  ['C', 'kamera'],
  ['M', 'manuell låda'],
  ['E/Q', 'växla upp/ner'],
  ['N', 'ljud av/på'],
  ['G', 'ghost av/på'],
  ['H', 'visa/dölj hjälpen'],
  ['F1', 'felsökning'],
  ['F3', 'kraftvektorer'],
  ['Esc', 'meny'],
];
export const CONTROLS_TABLE = `<table class="specs">${CONTROLS.map(([k, a]) => `<tr><th>${k}</th><td>${a}</td></tr>`).join('')}</table>`;
/** The same keys in the help box, in sequence so the box stays short. */
const CONTROLS_HTML = CONTROLS.map(([k, a]) => `<b>${k}</b> ${a}`).join(' · ');

/** The headlights' condition in words, for the damage panel and the service. */
export function lampStatus(lamps: number[]): string {
  const broken = lamps.map((l) => l >= LAMP_BROKEN);
  if (broken[0] && broken[1]) return 'båda trasiga';
  if (broken[0]) return 'vänster trasig';
  if (broken[1]) return 'höger trasig';
  return lamps.some((l) => l > 0.05) ? 'skadade' : 'hela';
}

export class Hud {
  private hud = document.getElementById('hud')!;
  private help = document.getElementById('help')!;
  private damage = document.getElementById('damage')!;
  private timer = document.getElementById('timer')!;
  private notes = document.getElementById('notes')!;
  private gg = document.getElementById('gg') as HTMLCanvasElement;
  private ctx = this.gg.getContext('2d')!;
  private gauges = document.getElementById('gauges') as HTMLCanvasElement;
  private gctx = this.gauges.getContext('2d')!;
  /** The dials are drawn once per car, only the needles every frame. */
  private faces: { params: CarParams; canvas: HTMLCanvasElement } | null = null;
  /** Where the gear lever's knob is drawn right now; slides towards the selected gear. */
  private lever: { x: number; y: number } | null = null;
  private trail: [number, number][] = [];
  private frame = 0;

  constructor() {
    this.help.innerHTML = CONTROLS_HTML;
  }

  toggleHelp() {
    this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
  }

  /** Hides the speedometer, rev counter and stopwatch, e.g. on the finish screen. */
  showGauges(on: boolean) {
    this.gauges.style.visibility = on ? '' : 'hidden';
    this.timer.style.visibility = on ? '' : 'hidden';
  }

  update(car: Car, input: Input, cameraName: string) {
    this.frame++;
    const dtn = car.drivetrain;
    const kmh = Math.abs(car.forwardSpeed) * 3.6;

    if (this.frame % 3 === 0) {
      const rows = car.wheels
        .map((w, i) => {
          const surf = SURFACES[w.surface].name;
          const air = w.contact ? '' : ' (luft)';
          return `<tr><th>${WHEEL_NAMES[i]}</th><td>${w.fz.toFixed(0)} N</td><td>${(w.kappa * 100).toFixed(0)} %</td><td>${((Math.atan(w.tanAlpha) * 180) / Math.PI).toFixed(1)}°</td><td>${(w.usage * 100).toFixed(0)} %</td><td>${surf}${air}</td></tr>`;
        })
        .join('');
      const flags = [
        `ABS ${car.assists.abs ? (car.absActive ? '<b>●</b>' : 'på') : 'av'}`,
        `TC ${car.assists.tc ? (car.tcActive ? '<b>●</b>' : 'på') : 'av'}`,
        dtn.autoShift ? 'auto' : 'manuell',
        TYRE_NAMES[car.params.tyre],
      ].join(' · ');
      this.hud.innerHTML = `
        <div>${kmh.toFixed(0)} km/h · ${dtn.rpm.toFixed(0)} rpm ${dtn.limiterCut ? '⚠' : ''}</div>
        <div>gas ${(input.throttle * 100).toFixed(0)} % · broms ${(input.brake * 100).toFixed(0)} % · ratt ${(car.steerAngle * 57.3).toFixed(0)}° · ${flags}</div>
        <div>kamera: ${cameraName}</div>
        <table id="wheels"><tr><th></th><td>last</td><td>slip</td><td>vinkel</td><td>grepp</td><td>underlag</td></tr>${rows}</table>`;
      const d = car.damage;
      const pct = (v: number) => (v * 100).toFixed(0);
      this.damage.innerHTML = `<b>Skador</b><br/>fram ${pct(d.front)} % · bak ${pct(d.rear)} %<br/>vänster ${pct(d.left)} % · höger ${pct(d.right)} %<br/>tak ${pct(d.roof)} % · effekt ${(dtn.powerFactor * 100).toFixed(0)} %<br/>lyktor: ${lampStatus(car.lamps)}`;
    }

    this.drawGG(car);
    this.drawGauges(car.params, dtn.rpm, kmh, dtn.gear, dtn.boost);
  }

  private drawGauges(params: CarParams, rpm: number, kmh: number, gearNo: number, boost: number) {
    const g = params.gauges;
    const s = g.style ?? DEFAULT_STYLE;
    const turbo = params.engine.turbo;
    // The gauges stack vertically: rev counter, speedometer, gear lever. The column is 300 px wide;
    // the boost gauge sits to the right of the rev counter.
    const w = 300;
    const r = w * 0.47;
    const tacho = { x: w / 2, y: w / 2, r, min: 0, max: g.rpmMax, a0: s.tachoArc[0], a1: s.tachoArc[1] };
    const speedo = { x: w / 2, y: w * 1.5, r, min: g.speedMin, max: g.speedMax, a0: s.speedoArc[0], a1: s.speedoArc[1] };
    // The scale in tenths of a bar, so the steps are integers.
    const gauge = { x: w + 90, y: w / 2, r: w * 0.28, min: 0, max: 25, a0: 135, a1: 405 };
    const shift = shiftPattern(params.gearbox.ratios.length, w / 2, w * 2.45, w * 0.36);
    if (this.faces?.params !== params) {
      const canvas = document.createElement('canvas');
      canvas.width = this.gauges.width;
      canvas.height = this.gauges.height;
      const c = canvas.getContext('2d')!;
      drawFace(c, s, tacho, 500, 1000, (v) => String(v / s.rpmUnit), g.rpmRed, `1/min x${s.rpmUnit}`);
      // Long scales get a number every 40 km/h, otherwise the numbers are too small to read.
      drawFace(c, s, speedo, 10, g.speedMax - g.speedMin > 240 ? 40 : 20, String, null, 'km/h');
      drawKnob(c, s, shift, null);
      if (turbo) drawFace(c, s, gauge, 1, 5, (v) => String(v / 10).replace('.', ','), null, 'bar');
      this.faces = { params, canvas };
    }
    const ctx = this.gctx;
    ctx.clearRect(0, 0, this.gauges.width, this.gauges.height);
    ctx.drawImage(this.faces.canvas, 0, 0);
    drawNeedle(ctx, s, tacho, rpm);
    drawNeedle(ctx, s, speedo, kmh);
    if (turbo) drawNeedle(ctx, s, gauge, boost * turbo.bar * 10);

    // The lever's knob slides to the selected gear and the gear's number lights up.
    const at = shift.slot(gearNo);
    this.lever ??= { ...at };
    this.lever.x += (at.x - this.lever.x) * 0.35;
    this.lever.y += (at.y - this.lever.y) * 0.35;
    drawKnob(ctx, s, shift, gearNo);
    ctx.fillStyle = s.needle;
    ctx.beginPath();
    ctx.arc(this.lever.x, this.lever.y, shift.R * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Clock, splits and result. best is the current record. field is the drivers who started before you
   * in the championship, with their times on the stage.
   */
  updateTimer(timer: StageTimer, best: StageRecord | null, field: RoadTime[] = []) {
    const splits = timer.splits.map((t, i) => `M${i + 1} ${formatTime(t)}${formatDelta(t, best?.splits[i])}`).join(' · ');
    let html: string;
    if (timer.state === 'ready') {
      html = `Kör över startlinjen${best ? `<br/>Bästa ${formatTime(best.time)}` : ''}${fieldHtml(timer, best, field)}`;
    } else if (timer.state === 'running') {
      html = `<div class="clock">${formatTime(timer.time)}</div>${splits}${fieldHtml(timer, best, field)}`;
    } else {
      // The result with comparisons is shown on the finish screen.
      html = `<div class="clock">Mål ${formatTime(timer.time)}</div>${fieldHtml(timer, best, field)}`;
    }
    if (this.timer.innerHTML !== html) this.timer.innerHTML = html;
  }

  /** Read-out notes ahead of the car, nearest first. */
  updateNotes(notes: PaceNote[], missingVoice: boolean) {
    const icon = (n: PaceNote) => (n.kind === 'corner' ? (n.dir! > 0 ? '↰' : '↱') : n.kind === 'crest' ? '⌒' : n.kind === 'finish' ? '⚑' : '▦');
    const html = notes
      .slice(0, 3)
      .map((n, i) => `<div class="${i === 0 ? 'now' : ''} ${n.grade ? `g${n.grade}` : ''}"><span class="icon">${icon(n)}</span> ${n.label}</div>`)
      .join('') + (missingVoice ? '<div class="hint">Ingen svensk eller engelsk röst i webbläsaren, noterna visas bara här</div>' : '');
    if (this.notes.innerHTML !== html) this.notes.innerHTML = html;
  }

  private drawGG(car: Car) {
    const ctx = this.ctx;
    const w = this.gg.width;
    const c = w / 2;
    const scale = c / 1.6;
    this.trail.push([car.gLat, car.gLong]);
    if (this.trail.length > 90) this.trail.shift();
    ctx.clearRect(0, 0, w, w);
    ctx.strokeStyle = '#0006';
    ctx.lineWidth = 1;
    for (const g of [0.5, 1, 1.5]) {
      ctx.beginPath();
      ctx.arc(c, c, g * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, c);
    ctx.lineTo(w, c);
    ctx.moveTo(c, 0);
    ctx.lineTo(c, w);
    ctx.stroke();
    ctx.fillStyle = '#c62828';
    this.trail.forEach(([lat, lon], i) => {
      ctx.globalAlpha = (i + 1) / this.trail.length;
      ctx.beginPath();
      ctx.arc(c - lat * scale, c - lon * scale, i === this.trail.length - 1 ? 6 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000a';
    ctx.font = '20px ui-monospace, monospace';
    ctx.fillText('g', 8, 22);
  }
}

/** A round gauge: centre, radius, scale and angles in degrees (0 = right, clockwise). */
interface Dial {
  x: number;
  y: number;
  r: number;
  min: number;
  max: number;
  a0: number;
  a1: number;
}

/** Black dial with white ticks and numbers, as in 80s Swedish cars. */
const DEFAULT_STYLE: GaugeStyle = {
  face: '#111',
  ink: '#eee',
  needle: '#ff5a1f',
  red: '#f28a2e',
  tachoArc: [150, 390],
  speedoArc: [125, 415],
  rpmUnit: 1000,
};

function dialAngle(d: Dial, v: number) {
  const t = Math.min(1, Math.max(0, (v - d.min) / (d.max - d.min)));
  return ((d.a0 + t * (d.a1 - d.a0)) * Math.PI) / 180;
}

/** Dial with ticks and numbers in the style's colours. */
function drawFace(ctx: CanvasRenderingContext2D, s: GaugeStyle, d: Dial, minor: number, major: number, label: (v: number) => string, red: number | null, caption: string) {
  const { x, y, r } = d;
  ctx.fillStyle = s.face;
  ctx.strokeStyle = '#333';
  ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (red !== null && !s.redInk) {
    ctx.strokeStyle = s.red;
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, dialAngle(d, red), dialAngle(d, d.max));
    ctx.stroke();
  }
  ctx.strokeStyle = ctx.fillStyle = s.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Three-digit numbers and tightly spaced numbers get smaller text so they don't run together.
  const chars = label(d.max).length;
  const gapR = (((d.a1 - d.a0) / ((d.max - d.min) / major)) * Math.PI / 180) * 0.58;
  ctx.font = `${Math.round(r * Math.min(chars > 2 ? 0.14 : 0.2, gapR / (chars * 0.65)))}px Helvetica, Arial, sans-serif`;
  for (let v = d.min; v <= d.max; v += minor) {
    const a = dialAngle(d, v);
    const isMajor = (v - d.min) % major === 0;
    ctx.strokeStyle = ctx.fillStyle = s.redInk && red !== null && v >= red ? s.red : s.ink;
    const r0 = r * (isMajor ? 0.76 : 0.8);
    ctx.lineWidth = r * (isMajor ? 0.035 : 0.022);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
    ctx.stroke();
    if (isMajor) ctx.fillText(label(v), x + Math.cos(a) * r * 0.58, y + Math.sin(a) * r * 0.58);
  }
  // The caption sits in the middle of the gap where the scale doesn't go.
  const gap = ((d.a0 + d.a1 + 360) / 2) * (Math.PI / 180);
  ctx.fillStyle = s.ink;
  ctx.font = `${Math.round(r * 0.1)}px Helvetica, Arial, sans-serif`;
  ctx.fillText(caption, x + Math.cos(gap) * r * 0.62, y + Math.sin(gap) * r * 0.62);
}

/**
 * The shift pattern on the lever knob: R top left, then 1/2, 3/4 and so on,
 * odd gears up and even down, as on the 240's knob.
 */
function shiftPattern(gears: number, cx: number, cy: number, R: number) {
  const gates = 1 + Math.ceil(gears / 2);
  const gateX = (i: number) => cx + (i / (gates - 1) - 0.5) * R * 1.3;
  const up = cy - R * 0.45;
  const down = cy + R * 0.45;
  return {
    cx,
    cy,
    R,
    gears,
    gateX,
    up,
    down,
    /** The lever position for a gear; 0 = neutral in the 3/4 gate (or nearest). */
    slot(gear: number) {
      if (gear < 0) return { x: gateX(0), y: up };
      if (gear === 0) return { x: gateX(Math.min(2, gates - 1)), y: cy };
      return { x: gateX(Math.ceil(gear / 2)), y: gear % 2 ? up : down };
    },
  };
}

/** The knob with the pattern (active null), or just the selected gear's number in the needle's colour. */
function drawKnob(ctx: CanvasRenderingContext2D, s: GaugeStyle, p: ReturnType<typeof shiftPattern>, active: number | null) {
  const { cx, cy, R, up, down, gateX } = p;
  const labels: [string, number, number, number][] = [['R', -1, gateX(0), up - R * 0.2]];
  for (let g = 1; g <= p.gears; g++) labels.push([String(g), g, gateX(Math.ceil(g / 2)), g % 2 ? up - R * 0.2 : down + R * 0.2]);
  ctx.font = `bold ${Math.round(R * 0.3)}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (active === null) {
    ctx.fillStyle = s.face;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = R * 0.05;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = ctx.fillStyle = s.ink;
    ctx.lineWidth = R * 0.07;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(gateX(0), cy);
    ctx.lineTo(gateX(Math.ceil(p.gears / 2)), cy);
    ctx.moveTo(gateX(0), cy);
    ctx.lineTo(gateX(0), up);
    for (let g = 1; g <= p.gears; g++) {
      ctx.moveTo(gateX(Math.ceil(g / 2)), cy);
      ctx.lineTo(gateX(Math.ceil(g / 2)), g % 2 ? up : down);
    }
    ctx.stroke();
    for (const [text, , x, y] of labels) ctx.fillText(text, x, y);
  } else {
    const l = labels.find(([, g]) => g === active);
    if (!l) return;
    ctx.fillStyle = s.needle;
    ctx.fillText(l[0], l[2], l[3]);
  }
}

function drawNeedle(ctx: CanvasRenderingContext2D, s: GaugeStyle, d: Dial, v: number) {
  const a = dialAngle(d, v);
  ctx.strokeStyle = s.needle;
  ctx.lineWidth = d.r * 0.045;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(d.x - Math.cos(a) * d.r * 0.15, d.y - Math.sin(a) * d.r * 0.15);
  ctx.lineTo(d.x + Math.cos(a) * d.r * 0.86, d.y + Math.sin(a) * d.r * 0.86);
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(d.x, d.y, d.r * 0.09, 0, Math.PI * 2);
  ctx.fill();
}

/** Result for the finish screen: time, splits and comparison with the record before the run. */
export function resultHtml(timer: StageTimer, previousBest: StageRecord | null) {
  const splits = timer.splits.map((t, i) => `M${i + 1} ${formatTime(t)}${formatDelta(t, previousBest?.splits[i])}`).join(' · ');
  const record = !previousBest || timer.time < previousBest.time;
  const verdict = record
    ? `<b>Nytt rekord!</b>${previousBest ? ` Förra ${formatTime(previousBest.time)}${formatDelta(timer.time, previousBest.time)}` : ''}`
    : `Bästa ${formatTime(previousBest.time)}${formatDelta(timer.time, previousBest.time)}`;
  return `<div class="result">${formatTime(timer.time)}</div><div>${splits}</div><div>${verdict}</div>`;
}

/** " −0.32" in green or " +0.84" in red; empty without a reference. */
export interface RoadTime {
  name: string;
  time: number;
}

/** The drivers ahead of you on the road at your latest split or at the finish, with your place among them. */
function fieldHtml(timer: StageTimer, best: StageRecord | null, field: RoadTime[]) {
  if (!field.length) return '';
  const done = timer.state === 'finished';
  const k = timer.splits.length - 1;
  if (!done && k < 0) return `<div class="field">${field.length} förare före dig på vägen</div>`;
  // The opponents only have a finish time; the split is taken as the same share of it as in your record.
  const frac = done ? 1 : best?.splits[k] && best.time ? best.splits[k]! / best.time : (k + 1) / (timer.splitAt.length + 1);
  const mine = done ? timer.time : timer.splits[k]!;
  const rows = [...field.map((f) => ({ name: f.name, t: f.time * frac })), { name: 'Du', t: mine }].sort((a, b) => a.t - b.t);
  const rival = rows.find((r) => r.name !== 'Du')!.t;
  const html = rows
    .map((r, i) => (r.name === 'Du' ? `<div class="me">${i + 1}. Du ${formatTime(r.t)}${formatDelta(r.t, rival)}</div>` : `<div>${i + 1}. ${r.name} ${formatTime(r.t)}</div>`))
    .join('');
  return `<div class="field"><div>${done ? 'Mål' : `M${k + 1}`}</div>${html}</div>`;
}

function formatDelta(t: number, ref: number | undefined) {
  if (ref === undefined) return '';
  return ` <span class="${t <= ref ? 'ahead' : 'behind'}">${t <= ref ? '−' : '+'}${Math.abs(t - ref).toFixed(2)}</span>`;
}

/** m:ss.cc */
export function formatTime(t: number) {
  const cs = Math.round(t * 100);
  const m = Math.floor(cs / 6000);
  return `${m}:${((cs % 6000) / 100).toFixed(2).padStart(5, '0')}`;
}
