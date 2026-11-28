/** Engine, clutch, gearbox and differential. */

export interface EngineParams {
  idleRpm: number;
  limiterRpm: number;
  /** Rpm and torque (Nm), linearly interpolated. */
  curveRpm: number[];
  curveNm: number[];
  /** Engine braking off throttle (Nm at the limiter rpm). */
  engineBrakeNm: number;
  /** Rotational inertia of engine + flywheel (kg m²). */
  inertia: number;
  /** Rpm at which the clutch is fully engaged. */
  clutchLockRpm: number;
  /** Rpm when applying throttle from a standstill. */
  launchRpm: number;
  /** Turbo: the curve is the torque at full boost, which builds up with a delay. Absent for naturally aspirated engines. */
  turbo?: TurboParams;
}

export interface TurboParams {
  /** Time constant (s) for boost to build after applying throttle. */
  spool: number;
  /** Fraction of the curve's torque without boost (0..1). */
  offBoost: number;
  /** Boost that anti-lag keeps off throttle (0..1); 0 without anti-lag. */
  antilag: number;
  /** Full boost in bar, for the gauge; does not affect torque. */
  bar: number;
}

export interface GearboxParams {
  /** Ratio per gear 1..n. */
  ratios: number[];
  reverse: number;
  final: number;
  efficiency: number;
  upshiftRpm: number;
  downshiftRpm: number;
  shiftTime: number;
}

/** How far below the upshift rpm a kickdown must land, so the gearbox doesn't hunt between gears. */
const KICKDOWN_MARGIN_RPM = 700;

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
  gear = 1; // -1 reverse, 0 neutral, 1..n
  rpm = 1000;
  autoShift = true;
  shiftTimer = 0;
  /** Throttle after assists, for the HUD. */
  limiterCut = false;
  /** Torque at the drive shaft (Nm), for HUD/debugging. */
  shaftTorque = 0;
  /** Signed ratio including the final drive. */
  ratio = 0;
  /** Clutch engagement 0..1. */
  engage = 0;
  /** Damage factor for power (1 = intact). */
  powerFactor = 1;
  /** Boost 0..1, for turbo engines. */
  boost = 0;
  /** Kickdown requires the driver to have lifted since the last upshift, otherwise the gearbox hunts when wheelspin stops. */
  kickdownArmed = false;

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
    this.kickdownArmed = false;
  }

  shiftUp() {
    if (this.gear < this.gearbox.ratios.length && this.shiftTimer <= 0) {
      this.gear = this.gear <= 0 ? 1 : this.gear + 1;
      this.shiftTimer = this.gearbox.shiftTime;
      this.kickdownArmed = false;
    }
  }

  shiftDown() {
    if (this.gear > 1 && this.shiftTimer <= 0) {
      this.gear -= 1;
      this.shiftTimer = this.gearbox.shiftTime * 0.6;
    }
  }

  /**
   * Computes the torque at the drive shaft.
   * @param throttle throttle pedal 0..1 (after assists)
   * @param shaftOmega angular velocity of the drive shaft (rad/s), average of the driven wheels
   * @param pedal the driver's throttle pedal 0..1 before assists, for kickdown
   * @param declutch clutch disengaged (handbrake on a rear-wheel-drive car), the gear stays in
   */
  update(dt: number, throttle: number, shaftOmega: number, pedal: number, declutch = false): number {
    const { engine, gearbox } = this;

    this.ratio = this.totalRatio(this.gear);
    const shaftRpmIn = Math.abs(shaftOmega * this.ratio) * (60 / (2 * Math.PI));

    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (pedal < 0.5) this.kickdownArmed = true;

    if (this.autoShift && !declutch && this.gear >= 1 && this.shiftTimer <= 0) {
      if (this.rpm > gearbox.upshiftRpm && throttle > 0.1 && this.gear < gearbox.ratios.length) this.shiftUp();
      // Downshift even when the clutch slips and holds the revs up while the wheels have nearly stopped,
      // e.g. after wheelspin on a steep snowy hill; otherwise the car gets stuck in a high gear.
      else if (Math.min(this.rpm, shaftRpmIn) < gearbox.downshiftRpm && this.gear > 1) this.shiftDown();
      // Kickdown: when the driver floors the throttle the gearbox shifts down if the rpm in the gear below lands well
      // under the upshift rpm, so it doesn't immediately shift up again.
      else if (
        this.kickdownArmed &&
        pedal > 0.8 &&
        this.gear > 1 &&
        (Math.max(this.rpm, shaftRpmIn) * gearbox.ratios[this.gear - 2]!) / gearbox.ratios[this.gear - 1]! < gearbox.upshiftRpm - KICKDOWN_MARGIN_RPM
      )
        this.shiftDown();
    }
    this.ratio = this.totalRatio(this.gear);

    // Engine rpm: follows the shaft, or clutch slip at launch.
    const launch = engine.idleRpm + (engine.launchRpm - engine.idleRpm) * throttle;
    const free = this.gear === 0 || declutch;
    const target = free ? engine.idleRpm + throttle * 3500 : Math.max(shaftRpmIn, launch, engine.idleRpm);
    const follow = !free && shaftRpmIn >= launch ? 1 : Math.min(1, dt * 18);
    this.rpm += (target - this.rpm) * follow;
    this.rpm = Math.min(this.rpm, engine.limiterRpm * 1.02);

    // The clutch engages with speed. At launch it slips and transfers a limited torque.
    const speedEngage = clamp01((shaftRpmIn - engine.idleRpm * 0.7) / (engine.clutchLockRpm - engine.idleRpm * 0.7));
    const slipEngage = 0.75 * Math.min(1, throttle * 4);
    this.engage = free ? 0 : speedEngage + (1 - speedEngage) * slipEngage;
    if (this.shiftTimer > 0) this.engage *= 0.1;

    this.limiterCut = this.rpm >= engine.limiterRpm;
    const thr = this.limiterCut ? 0 : throttle;
    let full = interp(engine.curveRpm, engine.curveNm, this.rpm) * this.powerFactor;
    const turbo = engine.turbo;
    if (turbo) {
      // Boost builds slowly and drops quickly when lifting off, unless anti-lag holds it.
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
  /** 0 = open, 1 = locked. */
  lock: number;
  /** Preload (Nm). */
  preload: number;
}

/**
 * Splits torque between two outputs: the wheels on an axle, or (as a centre diff) the front and rear axles.
 * `share` is the base share to the first. Returns [first, second].
 */
export function splitDiff(torque: number, wA: number, wB: number, d: DiffParams, share = 0.5): [number, number] {
  const a = torque * share;
  const b = torque - a;
  const dw = wA - wB;
  const ramp = Math.min(1, Math.abs(dw) / 3);
  const bias = (d.lock * Math.min(Math.abs(a), Math.abs(b)) + d.preload) * ramp * Math.sign(dw);
  // The faster output gets less torque, the slower more.
  return [a - bias, b + bias];
}
