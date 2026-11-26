import type { Car, Input } from './physics/car';
import { SURFACES, TYRE_NAMES } from './physics/surfaces';

const WHEEL_NAMES = ['VF', 'HF', 'VB', 'HB'];

export class Hud {
  private hud = document.getElementById('hud')!;
  private help = document.getElementById('help')!;
  private damage = document.getElementById('damage')!;
  private gg = document.getElementById('gg') as HTMLCanvasElement;
  private ctx = this.gg.getContext('2d')!;
  private trail: [number, number][] = [];
  private frame = 0;

  constructor() {
    this.help.innerHTML = [
      '<b>W/S</b> gas/broms (S bakåt vid stopp) · <b>A/D</b> styr',
      '<b>Mellanslag</b> handbroms · <b>R</b> placera om · <b>C</b> kamera (4 vyer)',
      '<b>M</b> manuell växellåda (<b>E</b>/<b>Q</b>) · <b>F3</b> kraftvektorer',
      '<b>H</b> visa/dölj panelen · <b>N</b> ljud av/på',
    ].join('<br/>');
  }

  toggleHelp() {
    this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
  }

  update(car: Car, input: Input, cameraName: string) {
    this.frame++;
    const dtn = car.drivetrain;
    const kmh = Math.abs(car.forwardSpeed) * 3.6;
    const gear = dtn.gear < 0 ? 'R' : dtn.gear === 0 ? 'N' : String(dtn.gear);
    const rpmFrac = Math.min(1, dtn.rpm / car.params.engine.limiterRpm);

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
        <div><span class="big">${kmh.toFixed(0)}</span> km/h &nbsp; <span class="big">${gear}</span> &nbsp; ${dtn.rpm.toFixed(0)} rpm ${dtn.limiterCut ? '⚠' : ''}</div>
        <div id="bar"><div style="width:${(rpmFrac * 100).toFixed(0)}%;background:${rpmFrac > 0.9 ? '#c62828' : '#2e7d32'}"></div></div>
        <div>gas ${(input.throttle * 100).toFixed(0)} % · broms ${(input.brake * 100).toFixed(0)} % · ratt ${(car.steerAngle * 57.3).toFixed(0)}° · ${flags}</div>
        <div>kamera: ${cameraName}</div>
        <table id="wheels"><tr><th></th><td>last</td><td>slip</td><td>vinkel</td><td>grepp</td><td>underlag</td></tr>${rows}</table>`;
      const d = car.damage;
      const pct = (v: number) => (v * 100).toFixed(0);
      this.damage.innerHTML = `<b>Skador</b><br/>fram ${pct(d.front)} % · bak ${pct(d.rear)} %<br/>vänster ${pct(d.left)} % · höger ${pct(d.right)} %<br/>tak ${pct(d.roof)} % · effekt ${(dtn.powerFactor * 100).toFixed(0)} %`;
    }

    this.drawGG(car);
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
