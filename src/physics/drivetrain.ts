/** Motor, koppling, växellåda och differential. */

export interface EngineParams {
  idleRpm: number;
  limiterRpm: number;
  /** Rpm och moment (Nm), linjärt interpolerad. */
  curveRpm: number[];
  curveNm: number[];
  /** Motorbroms vid släppt gas (Nm vid begränsarvarvet). */
  engineBrakeNm: number;
  /** Roterande tröghet motor + svänghjul (kg m²). */
  inertia: number;
  /** Rpm där kopplingen har tagit helt. */
  clutchLockRpm: number;
  /** Rpm vid gaspådrag från stillastående. */
  launchRpm: number;
  /** Turbo: kurvan är momentet med fullt laddtryck, som byggs upp med fördröjning. Saknas för sugmotorer. */
  turbo?: TurboParams;
}

export interface TurboParams {
  /** Tidskonstant (s) för laddtrycket att byggas upp efter gaspådrag. */
  spool: number;
  /** Andel av kurvans moment utan laddtryck (0..1). */
  offBoost: number;
  /** Laddtryck som antilag håller kvar utan gas (0..1); 0 utan antilag. */
  antilag: number;
  /** Fullt laddtryck i bar, för mätaren; påverkar inte momentet. */
  bar: number;
}

export interface GearboxParams {
  /** Utväxling per växel 1..n. */
  ratios: number[];
  reverse: number;
  final: number;
  efficiency: number;
  upshiftRpm: number;
  downshiftRpm: number;
  shiftTime: number;
}

export function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]!) return ys[0]!;
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]!) {
      const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
      return ys[i - 1]! + t * (ys[i]! - ys[i - 1]!);
    }
  }
  return ys[ys.length - 1]!;
}

export class Drivetrain {
  gear = 1; // -1 back, 0 neutral, 1..n
  rpm = 1000;
  autoShift = true;
  shiftTimer = 0;
  /** Gasen efter hjälpmedel, för HUD. */
  limiterCut = false;
  /** Moment vid drivaxeln (Nm), för HUD/debug. */
  shaftTorque = 0;
  /** Ratio inklusive slututväxling med tecken. */
  ratio = 0;
  /** Kopplingsgrad 0..1. */
  engage = 0;
  /** Skadefaktor för effekt (1 = hel). */
  powerFactor = 1;
  /** Laddtryck 0..1, för turbomotorer. */
  boost = 0;

  constructor(
    public engine: EngineParams,
    public gearbox: GearboxParams,
  ) {}

  totalRatio(gear: number): number {
    if (gear === 0) return 0;
    if (gear < 0) return -this.gearbox.reverse * this.gearbox.final;
    return this.gearbox.ratios[gear - 1]! * this.gearbox.final;
  }

  reset() {
    this.gear = 1;
    this.rpm = this.engine.idleRpm;
    this.shiftTimer = 0;
    this.boost = 0;
  }

  shiftUp() {
    if (this.gear < this.gearbox.ratios.length && this.shiftTimer <= 0) {
      this.gear = this.gear <= 0 ? 1 : this.gear + 1;
      this.shiftTimer = this.gearbox.shiftTime;
    }
  }

  shiftDown() {
    if (this.gear > 1 && this.shiftTimer <= 0) {
      this.gear -= 1;
      this.shiftTimer = this.gearbox.shiftTime * 0.6;
    }
  }

  /**
   * Räknar ut moment vid drivaxeln.
   * @param throttle gaspedalen 0..1 (efter hjälpmedel)
   * @param shaftOmega drivaxelns vinkelhastighet (rad/s), medel av drivhjulen
   */
  update(dt: number, throttle: number, shaftOmega: number): number {
    const { engine, gearbox } = this;

    this.ratio = this.totalRatio(this.gear);
    const shaftRpmIn = Math.abs(shaftOmega * this.ratio) * (60 / (2 * Math.PI));

    if (this.shiftTimer > 0) this.shiftTimer -= dt;

    if (this.autoShift && this.gear >= 1 && this.shiftTimer <= 0) {
      if (this.rpm > gearbox.upshiftRpm && throttle > 0.1 && this.gear < gearbox.ratios.length) this.shiftUp();
      // Nedväxling även när kopplingen slirar och håller motorvarvet uppe men hjulen nästan står,
      // t.ex. efter hjulspinn i en brant snöbacke; annars fastnar bilen på en hög växel.
      else if (Math.min(this.rpm, shaftRpmIn) < gearbox.downshiftRpm && this.gear > 1) this.shiftDown();
    }
    this.ratio = this.totalRatio(this.gear);

    // Motorvarv: följer axeln, eller kopplingsslirning vid start.
    const launch = engine.idleRpm + (engine.launchRpm - engine.idleRpm) * throttle;
    const target = this.gear === 0 ? engine.idleRpm + throttle * 3500 : Math.max(shaftRpmIn, launch, engine.idleRpm);
    const follow = this.gear !== 0 && shaftRpmIn >= launch ? 1 : Math.min(1, dt * 18);
    this.rpm += (target - this.rpm) * follow;
    this.rpm = Math.min(this.rpm, engine.limiterRpm * 1.02);

    // Kopplingen tar med fart. Vid start slirar den och för över ett begränsat moment.
    const speedEngage = clamp01((shaftRpmIn - engine.idleRpm * 0.7) / (engine.clutchLockRpm - engine.idleRpm * 0.7));
    const slipEngage = 0.75 * Math.min(1, throttle * 4);
    this.engage = this.gear === 0 ? 0 : speedEngage + (1 - speedEngage) * slipEngage;
    if (this.shiftTimer > 0) this.engage *= 0.1;

    this.limiterCut = this.rpm >= engine.limiterRpm;
    const thr = this.limiterCut ? 0 : throttle;
    let full = interp(engine.curveRpm, engine.curveNm, this.rpm) * this.powerFactor;
    const turbo = engine.turbo;
    if (turbo) {
      // Trycket byggs upp långsamt och släpps snabbt när gasen lyfts, om inte antilag håller det.
      const want = Math.max(thr, turbo.antilag);
      this.boost += (want - this.boost) * Math.min(1, dt / (want > this.boost ? turbo.spool : 0.15));
      full *= turbo.offBoost + (1 - turbo.offBoost) * this.boost;
    }
    const drive = full * thr;
    const engineBrake = -engine.engineBrakeNm * (this.rpm / engine.limiterRpm) * (1 - throttle);
    const tEng = drive + engineBrake;

    const torque = tEng * this.engage * this.ratio * gearbox.efficiency;
    this.shaftTorque = torque;
    return torque;
  }
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface DiffParams {
  /** 0 = öppet, 1 = låst. */
  lock: number;
  /** Förspänning (Nm). */
  preload: number;
}

/**
 * Fördelar moment på två utgångar: hjulen på en axel, eller (som mittdiff) fram- och bakaxeln.
 * `share` är grundandelen till den första. Returnerar [första, andra].
 */
export function splitDiff(torque: number, wA: number, wB: number, d: DiffParams, share = 0.5): [number, number] {
  const a = torque * share;
  const b = torque - a;
  const dw = wA - wB;
  const ramp = Math.min(1, Math.abs(dw) / 3);
  const bias = (d.lock * Math.min(Math.abs(a), Math.abs(b)) + d.preload) * ramp * Math.sign(dw);
  // Snabbare utgång får mindre moment, långsammare mer.
  return [a - bias, b + bias];
}
