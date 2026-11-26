import type { DamageEvent } from './physics/collision';
import type { Car } from './physics/car';
import type { SurfaceId } from './physics/surfaces';

/** Underlagsljud: filterfrekvens och Q för rullbrus respektive slirljud. */
const SURFACE_SOUND: Record<SurfaceId, { roll: number; slip: number; q: number; level: number }> = {
  asphalt: { roll: 400, slip: 1100, q: 9, level: 0.35 },
  gravel: { roll: 900, slip: 1800, q: 0.8, level: 0.9 },
  mud: { roll: 300, slip: 500, q: 1.2, level: 0.7 },
  snow: { roll: 1500, slip: 2500, q: 0.7, level: 0.5 },
  snowbank: { roll: 700, slip: 1200, q: 0.6, level: 0.9 },
};

/** Syntetiserat ljud med Web Audio: motor, däck/underlag och krockar. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private panner!: StereoPannerNode;
  private engOsc!: OscillatorNode;
  private raspGain!: GainNode;
  private raspDepth!: GainNode;
  private intakeFilter!: BiquadFilterNode;
  private intakeGain!: GainNode;
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private rollGain!: GainNode;
  private rollFilter!: BiquadFilterNode;
  private slipGain!: GainNode;
  private slipFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  muted = false;
  /** Avståndsdämpning, 0–1, t.ex. för bilarna bakom huvudmenyn. */
  private volume = 1;

  // Webbläsare kräver en användargest innan ljud får starta. Capture: menyerna stoppar tangenttrycken.
  private start = () => {
    this.stopListening();
    this.init();
  };

  constructor() {
    addEventListener('keydown', this.start, true);
    addEventListener('pointerdown', this.start);
  }

  private stopListening() {
    removeEventListener('keydown', this.start, true);
    removeEventListener('pointerdown', this.start);
  }

  /** Stänger av ljudet för gott. */
  close() {
    this.stopListening();
    void this.ctx?.close();
    this.ctx = null;
  }

  /** pan: -1 = vänster, 1 = höger. */
  setVolume(v: number, pan = 0) {
    this.volume = v;
    if (this.ctx) this.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.05);
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5 * v, this.ctx.currentTime, 0.05);
  }

  private init() {
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5 * this.volume;
    this.panner = ctx.createStereoPanner();
    this.master.connect(this.panner).connect(ctx.destination);

    // Vitt brus i loop, delat av motorrasp, rull-, slir- och krockljud.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;

    // Motor: stor lågvarvig radfyra med grov, dieselaktig ton.
    // Grundtonen är halva vevaxelvarvet, så övertonen k motsvarar motorordning k/2.
    // En radfyra domineras av ordning 2, 4, 6, 8; halvordningarna ger ojämnheten.
    const real = new Float32Array(41);
    const imag = new Float32Array(41);
    for (let k = 1; k <= 40; k++) imag[k] = (k % 4 === 0 ? 1 : k % 2 === 0 ? 0.25 : 0.12) / Math.pow(k / 4, 0.9);
    this.engOsc = ctx.createOscillator();
    this.engOsc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 3);
    shaper.curve = curve;
    this.engOsc.connect(shaper);

    // Rasp: brus som pulsar i takt med tändningarna.
    const raspBand = ctx.createBiquadFilter();
    raspBand.type = 'bandpass';
    raspBand.frequency.value = 900;
    raspBand.Q.value = 0.7;
    this.raspGain = ctx.createGain();
    this.raspGain.gain.value = 0;
    this.raspDepth = ctx.createGain();
    this.raspDepth.gain.value = 0;
    this.engOsc.connect(this.raspDepth).connect(this.raspGain.gain);
    src.connect(raspBand).connect(this.raspGain).connect(shaper);

    // Avgas: djupt lågpass. Insug: resonant ton som tar över vid höga varv.
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 1.5;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.master);
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 6;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    shaper.connect(this.intakeFilter).connect(this.intakeGain).connect(this.master);
    this.engOsc.start();

    src.loop = true;
    src.start();
    [this.rollFilter, this.rollGain] = this.noiseBranch(src, 'lowpass');
    [this.slipFilter, this.slipGain] = this.noiseBranch(src, 'bandpass');
  }

  private noiseBranch(src: AudioNode, type: BiquadFilterType): [BiquadFilterNode, GainNode] {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    const g = this.ctx!.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    return [f, g];
  }

  /** Pausar allt ljud, t.ex. när pausmenyn är öppen. */
  setPaused(paused: boolean) {
    if (!this.ctx) return;
    void (paused ? this.ctx.suspend() : this.ctx.resume());
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
  }

  /** Anropas en gång per bildruta. */
  update(car: Car, throttle: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const tau = 0.03;
    const dtn = car.drivetrain;

    const half = dtn.rpm / 120;
    const thr = dtn.limiterCut ? 0 : throttle;
    // 0 vid tomgång, 1 vid begränsaren. Motorn trivs inte över ~4500 rpm, så den låter ansträngd där.
    const { idleRpm, limiterRpm } = dtn.engine;
    const rev = Math.min(1, Math.max(0, (dtn.rpm - idleRpm) / (limiterRpm - idleRpm)));
    const strain = Math.max(0, (dtn.rpm - 4500) / (limiterRpm - 4500));
    // Liten slumpvis varvtalsvariation så tonen inte blir helt jämn.
    this.engOsc.frequency.setTargetAtTime(half * (1 + (Math.random() - 0.5) * 0.012), t, tau);
    this.engFilter.frequency.setTargetAtTime(180 + half * (14 + 30 * thr), t, tau);
    this.engGain.gain.setTargetAtTime(0.16 + 0.2 * thr, t, tau);
    const rasp = 0.25 + 0.5 * thr + 0.6 * strain;
    this.raspGain.gain.setTargetAtTime(rasp, t, tau);
    this.raspDepth.gain.setTargetAtTime(rasp, t, tau);
    this.intakeFilter.frequency.setTargetAtTime(350 + 600 * rev, t, tau);
    this.intakeGain.gain.setTargetAtTime(thr * (0.03 + 0.12 * rev + 0.1 * strain), t, tau);

    // Däck: rullbrus efter fart, slirljud efter hur mycket hjulen glider.
    let slip = 0;
    let contacts = 0;
    const count: Partial<Record<SurfaceId, number>> = {};
    for (const w of car.wheels) {
      if (!w.contact) continue;
      contacts++;
      count[w.surface] = (count[w.surface] ?? 0) + 1;
      slip += Math.min(1, Math.abs(w.kappa) * 2 + Math.abs(w.tanAlpha) * 2.5);
    }
    if (contacts === 0) {
      this.rollGain.gain.setTargetAtTime(0, t, 0.08);
      this.slipGain.gain.setTargetAtTime(0, t, 0.08);
      return;
    }
    slip /= contacts;
    const surf = (Object.keys(count) as SurfaceId[]).reduce((a, b) => (count[a]! >= count[b]! ? a : b));
    const s = SURFACE_SOUND[surf];
    const speed = Math.min(1, car.speed / 40);
    const slipAmt = Math.max(0, slip - 0.15) * Math.min(1, car.speed / 3);
    this.rollFilter.frequency.setTargetAtTime(s.roll * (0.6 + speed), t, tau);
    this.rollGain.gain.setTargetAtTime(speed * 0.25 * s.level * (contacts / 4), t, tau);
    this.slipFilter.frequency.setTargetAtTime(s.slip, t, tau);
    this.slipFilter.Q.setTargetAtTime(s.q, t, tau);
    this.slipGain.gain.setTargetAtTime(Math.min(1, slipAmt) * 0.5 * s.level, t, tau);
  }

  /** Smäll vid krock, starkare ju större impuls. */
  impact(events: DamageEvent[]) {
    const ctx = this.ctx;
    if (!ctx) return;
    const impulse = events.reduce((m, e) => Math.max(m, e.impulse), 0);
    const amp = Math.min(1, impulse / 5000);
    if (amp < 0.03) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600 + 2500 * amp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15 + 0.4 * amp);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.6);
  }
}
