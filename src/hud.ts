import type { Car, Input } from './physics/car';
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
    const gear = dtn.gear < 0 ? 'R' : dtn.gear === 0 ? 'N' : String(dtn.gear);

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
      this.damage.innerHTML = `<b>Skador</b><br/>fram ${pct(d.front)} % · bak ${pct(d.rear)} %<br/>vänster ${pct(d.left)} % · höger ${pct(d.right)} %<br/>tak ${pct(d.roof)} % · effekt ${(dtn.powerFactor * 100).toFixed(0)} %`;
    }

    this.drawGG(car);
    this.drawGauges(car.params, dtn.rpm, kmh, gear);
  }

  private drawGauges(params: CarParams, rpm: number, kmh: number, gear: string) {
    const g = params.gauges;
    const h = this.gauges.height;
    const r = h * 0.47;
    const tacho = { x: h / 2, y: h / 2, r, min: 0, max: g.rpmMax, a0: 150, a1: 390 };
    const speedo = { x: h * 1.5, y: h / 2, r, min: g.speedMin, max: g.speedMax, a0: 125, a1: 415 };
    if (this.faces?.params !== params) {
      const canvas = document.createElement('canvas');
      canvas.width = this.gauges.width;
      canvas.height = h;
      const c = canvas.getContext('2d')!;
      drawFace(c, tacho, 500, 1000, (v) => String(v / 1000), g.rpmRed, '1/min x1000');
      drawFace(c, speedo, 10, 20, String, null, 'km/h');
      this.faces = { params, canvas };
    }
    const ctx = this.gctx;
    ctx.clearRect(0, 0, this.gauges.width, h);
    ctx.drawImage(this.faces.canvas, 0, 0);
    drawNeedle(ctx, tacho, rpm);
    // Växeln i ett litet fönster där den riktiga mätaren har trippmätaren.
    ctx.fillStyle = '#eee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(r * 0.22)}px Helvetica, Arial, sans-serif`;
    ctx.fillText(gear, speedo.x, speedo.y + r * 0.4);
    drawNeedle(ctx, speedo, kmh);
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
      .map((n, i) => `<div class="${i === 0 ? 'now' : ''}"><span class="icon">${icon(n)}</span> ${n.label}</div>`)
      .join('') + (missingVoice ? '<div class="hint">Ingen svensk röst i webbläsaren, noterna visas bara här</div>' : '');
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
