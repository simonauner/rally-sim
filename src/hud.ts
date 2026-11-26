import { LAMP_BROKEN, type Car, type Input } from './physics/car';
import type { CarParams } from './physics/params';
import { SURFACES, TYRE_NAMES } from './physics/surfaces';
import type { PaceNote } from './physics/pacenotes';
import type { StageTimer } from './physics/timing';
import type { StageRecord } from './account/protocol';

const WHEEL_NAMES = ['VF', 'HF', 'VB', 'HB'];

/** Tangentlistan, både i hjälprutan och i menyns Kontroller. */
export const CONTROLS_HTML = [
  '<b>W/S</b> gas/broms (S bakåt vid stopp) · <b>A/D</b> styr',
  '<b>Mellanslag</b> handbroms · <b>R</b> tillbaka på vägen · <b>T</b> starta om',
  '<b>C</b> kamera · <b>M</b> manuell låda (<b>E</b>/<b>Q</b>) · <b>F3</b> kraftvektorer',
  '<b>F1</b> felsökning · <b>H</b> visa/dölj hjälpen · <b>N</b> ljud av/på · <b>G</b> ghost av/på · <b>Esc</b> meny',
].join('<br/>');

/** Strålkastarnas skick i ord, för skadepanelen och servicen. */
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
  /** Urtavlorna ritas en gång per bil, bara nålarna varje bildruta. */
  private faces: { params: CarParams; canvas: HTMLCanvasElement } | null = null;
  /** Var växelspakens kula är ritad just nu; glider mot vald växel. */
  private lever: { x: number; y: number } | null = null;
  private trail: [number, number][] = [];
  private frame = 0;

  constructor() {
    this.help.innerHTML = CONTROLS_HTML;
  }

  toggleHelp() {
    this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
  }

  /** Döljer hastighetsmätaren och varvräknaren, t.ex. på målskärmen. */
  showGauges(on: boolean) {
    this.gauges.style.visibility = on ? '' : 'hidden';
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
    this.drawGauges(car.params, dtn.rpm, kmh, dtn.gear);
  }

  private drawGauges(params: CarParams, rpm: number, kmh: number, gearNo: number) {
    const g = params.gauges;
    // Mätarna står under varandra: varvräknare, hastighetsmätare, växelspak.
    const w = this.gauges.width;
    const r = w * 0.47;
    const tacho = { x: w / 2, y: w / 2, r, min: 0, max: g.rpmMax, a0: 150, a1: 390 };
    const speedo = { x: w / 2, y: w * 1.5, r, min: g.speedMin, max: g.speedMax, a0: 125, a1: 415 };
    const shift = shiftPattern(params.gearbox.ratios.length, w / 2, w * 2.45, w * 0.36);
    if (this.faces?.params !== params) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = this.gauges.height;
      const c = canvas.getContext('2d')!;
      drawFace(c, tacho, 500, 1000, (v) => String(v / 1000), g.rpmRed, '1/min x1000');
      drawFace(c, speedo, 10, 20, String, null, 'km/h');
      drawKnob(c, shift, '#eee', null);
      this.faces = { params, canvas };
    }
    const ctx = this.gctx;
    ctx.clearRect(0, 0, w, this.gauges.height);
    ctx.drawImage(this.faces.canvas, 0, 0);
    drawNeedle(ctx, tacho, rpm);
    drawNeedle(ctx, speedo, kmh);

    // Spakens kula glider till vald växel och växelns siffra lyser.
    const at = shift.slot(gearNo);
    this.lever ??= { ...at };
    this.lever.x += (at.x - this.lever.x) * 0.35;
    this.lever.y += (at.y - this.lever.y) * 0.35;
    drawKnob(ctx, shift, null, gearNo);
    ctx.fillStyle = NEEDLE;
    ctx.beginPath();
    ctx.arc(this.lever.x, this.lever.y, shift.R * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Klocka, mellantider och resultat. best är rekordet nu, previousBest rekordet före senaste åket. */
  updateTimer(timer: StageTimer, best: StageRecord | null) {
    const splits = timer.splits.map((t, i) => `M${i + 1} ${formatTime(t)}${formatDelta(t, best?.splits[i])}`).join(' · ');
    let html: string;
    if (timer.state === 'ready') {
      html = `Kör över startlinjen${best ? `<br/>Bästa ${formatTime(best.time)}` : ''}`;
    } else if (timer.state === 'running') {
      html = `<div class="clock">${formatTime(timer.time)}</div>${splits}`;
    } else {
      // Resultatet med jämförelser visas på målskärmen.
      html = `<div class="clock">Mål ${formatTime(timer.time)}</div>`;
    }
    if (this.timer.innerHTML !== html) this.timer.innerHTML = html;
  }

  /** Upplästa noter som ligger framför bilen, närmast först. */
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

/** En rund mätare: centrum, radie, skala och vinklar i grader (0 = höger, medurs). */
interface Dial {
  x: number;
  y: number;
  r: number;
  min: number;
  max: number;
  a0: number;
  a1: number;
}

const NEEDLE = '#ff5a1f';
const RED_ZONE = '#f28a2e';

function dialAngle(d: Dial, v: number) {
  const t = Math.min(1, Math.max(0, (v - d.min) / (d.max - d.min)));
  return ((d.a0 + t * (d.a1 - d.a0)) * Math.PI) / 180;
}

/** Svart urtavla med vita streck och siffror, som i 80-talets svenska bilar. */
function drawFace(ctx: CanvasRenderingContext2D, d: Dial, minor: number, major: number, label: (v: number) => string, red: number | null, caption: string) {
  const { x, y, r } = d;
  ctx.fillStyle = '#111';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (red !== null) {
    ctx.strokeStyle = RED_ZONE;
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, dialAngle(d, red), dialAngle(d, d.max));
    ctx.stroke();
  }
  ctx.strokeStyle = ctx.fillStyle = '#eee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Tresiffriga tal (hastighetsmätaren) får mindre text för att inte flyta ihop.
  ctx.font = `${Math.round(r * (label(d.max).length > 2 ? 0.14 : 0.2))}px Helvetica, Arial, sans-serif`;
  for (let v = d.min; v <= d.max; v += minor) {
    const a = dialAngle(d, v);
    const isMajor = (v - d.min) % major === 0;
    const r0 = r * (isMajor ? 0.76 : 0.8);
    ctx.lineWidth = r * (isMajor ? 0.035 : 0.022);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
    ctx.stroke();
    if (isMajor) ctx.fillText(label(v), x + Math.cos(a) * r * 0.58, y + Math.sin(a) * r * 0.58);
  }
  ctx.font = `${Math.round(r * 0.1)}px Helvetica, Arial, sans-serif`;
  ctx.fillText(caption, x, y + r * 0.62);
}

/**
 * Växelmönstret på spakknoppen: R uppe till vänster, sedan 1/2, 3/4 och så vidare,
 * udda växlar uppe och jämna nere, som på 240:s knopp.
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
    /** Spakens läge för en växel; 0 = friläge i 3/4-gaten (eller närmaste). */
    slot(gear: number) {
      if (gear < 0) return { x: gateX(0), y: up };
      if (gear === 0) return { x: gateX(Math.min(2, gates - 1)), y: cy };
      return { x: gateX(Math.ceil(gear / 2)), y: gear % 2 ? up : down };
    },
  };
}

/** Knoppen med mönstret (color satt), eller bara den valda växelns siffra i orange (active satt). */
function drawKnob(ctx: CanvasRenderingContext2D, p: ReturnType<typeof shiftPattern>, color: string | null, active: number | null) {
  const { cx, cy, R, up, down, gateX } = p;
  const labels: [string, number, number, number][] = [['R', -1, gateX(0), up - R * 0.2]];
  for (let g = 1; g <= p.gears; g++) labels.push([String(g), g, gateX(Math.ceil(g / 2)), g % 2 ? up - R * 0.2 : down + R * 0.2]);
  ctx.font = `bold ${Math.round(R * 0.3)}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (color) {
    ctx.fillStyle = '#111';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = R * 0.05;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = ctx.fillStyle = color;
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
    ctx.fillStyle = NEEDLE;
    ctx.fillText(l[0], l[2], l[3]);
  }
}

function drawNeedle(ctx: CanvasRenderingContext2D, d: Dial, v: number) {
  const a = dialAngle(d, v);
  ctx.strokeStyle = NEEDLE;
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

/** Resultat för målskärmen: tid, mellantider och jämförelse mot rekordet före åket. */
export function resultHtml(timer: StageTimer, previousBest: StageRecord | null) {
  const splits = timer.splits.map((t, i) => `M${i + 1} ${formatTime(t)}${formatDelta(t, previousBest?.splits[i])}`).join(' · ');
  const record = !previousBest || timer.time < previousBest.time;
  const verdict = record
    ? `<b>Nytt rekord!</b>${previousBest ? ` Förra ${formatTime(previousBest.time)}${formatDelta(timer.time, previousBest.time)}` : ''}`
    : `Bästa ${formatTime(previousBest.time)}${formatDelta(timer.time, previousBest.time)}`;
  return `<div class="result">${formatTime(timer.time)}</div><div>${splits}</div><div>${verdict}</div>`;
}

/** " −0.32" i grönt eller " +0.84" i rött; tomt utan referens. */
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
