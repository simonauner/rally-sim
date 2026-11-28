import type { DiffParams, EngineParams, GearboxParams } from './drivetrain';
import type { TyreType } from './surfaces';

export interface WheelDef {
  /** Mount in the body's local coordinates (x left, y up, z forward, origin at the centre of mass). */
  mount: [number, number, number];
  front: boolean;
  left: boolean;
}

export interface CarParams {
  name: string;
  mass: number;
  /** Moment of inertia about x (pitch), y (yaw) and z (roll). */
  inertia: [number, number, number];
  cgHeight: number;
  wheelRadius: number;
  wheelInertia: number;
  wheelbase: number;
  trackFront: number;
  wheels: WheelDef[];
  /** Collision box of the body (half sizes) and ground clearance. centerZ moves the box along the car (default 0). */
  body: { halfX: number; halfZ: number; bottomY: number; topY: number; centerZ?: number };

  susp: {
    kFront: number;
    kRear: number;
    bump: number;
    rebound: number;
    arbFront: number;
    arbRear: number;
    freeLen: number;
    minLen: number;
    maxLen: number;
    bumpStopK: number;
  };
  brake: { total: number; bias: number; handbrake: number };
  steer: { maxAngle: number; speedRef: number; rate: number; centerRate: number };
  aero: { cdA: number; rho: number };
  diff: DiffParams;
  /** Fraction of the drive torque sent to the front axle (0 = rear-wheel drive). */
  frontShare: number;
  /** Centre diff for four-wheel drive; without it the torque is split fixed by frontShare. */
  centerDiff?: DiffParams;
  engine: EngineParams;
  gearbox: GearboxParams;
  tyre: TyreType;
  /** Global grip multiplier for tuning. */
  gripScale: number;
  /** The scales on the rev counter and speedometer, as on the car's own instrument panel. */
  gauges: { rpmMax: number; rpmRed: number; speedMin: number; speedMax: number; style?: GaugeStyle };
}

/** Colours and scale angles for cars with their own instrument panel; without it the dial is black with white numbers. */
export interface GaugeStyle {
  face: string;
  /** Ticks, numbers and shift pattern. */
  ink: string;
  needle: string;
  red: string;
  /** Start and end angle of the scales in degrees (0 = right, clockwise). */
  tachoArc: [number, number];
  speedoArc: [number, number];
  /** The rev counter's numbers count in hundreds or thousands of rpm. */
  rpmUnit: 100 | 1000;
  /** The red zone as red ticks and numbers instead of an arc. */
  redInk?: boolean;
}

function boxInertia(m: number, l: number, w: number, h: number, k: number): [number, number, number] {
  return [(m / 12) * (h * h + l * l) * k, (m / 12) * (w * w + l * l) * k, (m / 12) * (w * w + h * h) * k];
}

/** A fictional club rally car: a big, heavy, rear-wheel-drive saloon from the 80s. */
export function kvarn240(): CarParams {
  const mass = 1250;
  const R = 0.32;
  const cg = 0.55;
  const wheelbase = 2.64;
  const zF = wheelbase * 0.45;
  const zR = -wheelbase * 0.55;
  const yMount = R - cg + 0.125;
  return {
    name: 'Kvarn 240 GL',
    mass,
    inertia: boxInertia(mass, 4.7, 1.7, 1.4, 0.8),
    cgHeight: cg,
    wheelRadius: R,
    wheelInertia: 1.3,
    wheelbase,
    trackFront: 1.43,
    wheels: [
      { mount: [0.715, yMount, zF], front: true, left: true },
      { mount: [-0.715, yMount, zF], front: true, left: false },
      { mount: [0.72, yMount, zR], front: false, left: true },
      { mount: [-0.72, yMount, zR], front: false, left: false },
    ],
    body: { halfX: 0.85, halfZ: 2.25, bottomY: -0.33, topY: 0.85 },
    susp: {
      kFront: 28000,
      kRear: 26000,
      bump: 2200,
      rebound: 3600,
      arbFront: 14000,
      arbRear: 8000,
      freeLen: 0.25,
      minLen: 0,
      maxLen: 0.25,
      bumpStopK: 300000,
    },
    brake: { total: 4600, bias: 0.65, handbrake: 3500 },
    steer: { maxAngle: 0.52, speedRef: 26, rate: 1.8, centerRate: 3.2 },
    aero: { cdA: 0.8, rho: 1.2 },
    diff: { lock: 0.35, preload: 40 },
    frontShare: 0,
    engine: {
      idleRpm: 900,
      limiterRpm: 6000,
      curveRpm: [900, 1500, 2500, 3500, 4500, 5500, 6200, 6800],
      curveNm: [110, 150, 185, 200, 205, 195, 175, 140],
      engineBrakeNm: 60,
      inertia: 0.22,
      clutchLockRpm: 2200,
      launchRpm: 3600,
    },
    gearbox: {
      ratios: [3.45, 2.1, 1.45, 1.1, 0.9],
      reverse: 3.3,
      final: 4.3,
      efficiency: 0.9,
      upshiftRpm: 5500,
      downshiftRpm: 2500,
      shiftTime: 0.22,
    },
    tyre: 'gravel',
    gripScale: 1,
    // Rev counter 0–7 with an orange zone from 6,250, speedometer 20–200 km/h.
    gauges: { rpmMax: 7000, rpmRed: 6250, speedMin: 20, speedMax: 200 },
  };
}

/** The same body with a turbo engine: sluggish low down, then everything arrives at once. */
export function kvarn240Turbo(): CarParams {
  const p = kvarn240();
  return {
    ...p,
    name: 'Kvarn 240 Turbo',
    mass: 1310,
    inertia: boxInertia(1310, 4.7, 1.7, 1.4, 0.8),
    engine: {
      ...p.engine,
      curveRpm: [900, 1500, 2500, 3000, 3500, 4500, 5500, 6200, 6800],
      curveNm: [100, 125, 160, 230, 275, 285, 255, 215, 160],
      launchRpm: 4200,
      // About 0.7 bar like the road version of the original with an intercooler.
      turbo: { spool: 0.7, offBoost: 0.6, antilag: 0, bar: 0.7 },
    },
    gearbox: { ...p.gearbox, final: 4.1 },
    brake: { ...p.brake, total: 5000 },
  };
}

/**
 * A fictional small front-wheel-drive hatchback from the 80s with a 1.6-litre carburettor engine:
 * cheap, light and nimble. The amateurs' entry car, which understeers into corners and likes to
 * lift the inside rear wheel, but can be rotated with the handbrake or a lift of the throttle.
 */
export function ljung1600(): CarParams {
  const mass = 880;
  const R = 0.29;
  const cg = 0.5;
  const wheelbase = 2.4;
  // Heavy front: the engine sits transversely ahead of the front axle.
  const zF = wheelbase * 0.38;
  const zR = -wheelbase * 0.62;
  const yMount = R - cg + 0.125;
  return {
    name: 'Ljung 1600 S',
    mass,
    inertia: boxInertia(mass, 3.85, 1.65, 1.38, 0.8),
    cgHeight: cg,
    wheelRadius: R,
    wheelInertia: 1.0,
    wheelbase,
    trackFront: 1.4,
    wheels: [
      { mount: [0.7, yMount, zF], front: true, left: true },
      { mount: [-0.7, yMount, zF], front: true, left: false },
      { mount: [0.69, yMount, zR], front: false, left: true },
      { mount: [-0.69, yMount, zR], front: false, left: false },
    ],
    body: { halfX: 0.82, halfZ: 1.9, bottomY: -0.3, topY: 0.86 },
    susp: {
      kFront: 22000,
      kRear: 17000,
      bump: 1700,
      rebound: 2800,
      arbFront: 8000,
      // Stiff rear axle, so the rear helps rotate the car.
      arbRear: 10000,
      freeLen: 0.24,
      minLen: 0,
      maxLen: 0.24,
      bumpStopK: 250000,
    },
    brake: { total: 3400, bias: 0.7, handbrake: 2800 },
    steer: { maxAngle: 0.55, speedRef: 26, rate: 2.0, centerRate: 3.4 },
    aero: { cdA: 0.7, rho: 1.2 },
    diff: { lock: 0.1, preload: 20 },
    frontShare: 1,
    engine: {
      idleRpm: 900,
      limiterRpm: 6600,
      curveRpm: [900, 1500, 2500, 3500, 4500, 5500, 6200, 6900],
      curveNm: [80, 102, 122, 134, 135, 128, 116, 92],
      engineBrakeNm: 45,
      inertia: 0.15,
      clutchLockRpm: 2400,
      launchRpm: 4000,
    },
    gearbox: {
      ratios: [3.45, 1.94, 1.37, 1.03, 0.84],
      reverse: 3.17,
      final: 4.25,
      efficiency: 0.92,
      upshiftRpm: 6100,
      downshiftRpm: 3000,
      shiftTime: 0.18,
    },
    tyre: 'gravel',
    gripScale: 1,
    // The rev counter goes to 8,000, so forged pistons (+500 rpm) fit on the scale.
    gauges: { rpmMax: 8000, rpmRed: 6600, speedMin: 20, speedMax: 200 },
  };
}

/**
 * Class 2: a fictional kit car hatchback with a two-litre 16-valve engine. Light, rev-happy and nervous,
 * with a front limited-slip diff that tugs at the wheel under throttle. Ljung 1600 S in competition trim.
 */
export function ljung2000(): CarParams {
  const mass = 1000;
  const R = 0.3;
  const cg = 0.48;
  // Same body and wheelbase as the Ljung 1600 S; the kit car gets a wider track under the arch extensions.
  const wheelbase = 2.4;
  const zF = wheelbase * 0.39;
  const zR = -wheelbase * 0.61;
  const yMount = R - cg + 0.125;
  return {
    name: 'Ljung 2000 16V',
    mass,
    inertia: boxInertia(mass, 3.95, 1.75, 1.36, 0.8),
    cgHeight: cg,
    wheelRadius: R,
    wheelInertia: 1.05,
    wheelbase,
    trackFront: 1.48,
    wheels: [
      { mount: [0.74, yMount, zF], front: true, left: true },
      { mount: [-0.74, yMount, zF], front: true, left: false },
      { mount: [0.73, yMount, zR], front: false, left: true },
      { mount: [-0.73, yMount, zR], front: false, left: false },
    ],
    body: { halfX: 0.86, halfZ: 1.95, bottomY: -0.3, topY: 0.86 },
    susp: {
      kFront: 30000,
      kRear: 23000,
      bump: 2400,
      rebound: 3900,
      arbFront: 9000,
      arbRear: 14000,
      freeLen: 0.25,
      minLen: 0,
      maxLen: 0.25,
      bumpStopK: 280000,
    },
    brake: { total: 4300, bias: 0.68, handbrake: 3200 },
    steer: { maxAngle: 0.55, speedRef: 26, rate: 2.2, centerRate: 3.6 },
    aero: { cdA: 0.72, rho: 1.2 },
    diff: { lock: 0.45, preload: 60 },
    frontShare: 1,
    engine: {
      idleRpm: 1000,
      limiterRpm: 7800,
      curveRpm: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 7500, 8000],
      curveNm: [110, 140, 170, 195, 215, 225, 215, 200, 170],
      engineBrakeNm: 50,
      inertia: 0.14,
      clutchLockRpm: 2800,
      launchRpm: 5000,
    },
    gearbox: {
      ratios: [3.0, 2.1, 1.6, 1.3, 1.08, 0.92],
      reverse: 3.2,
      final: 4.6,
      efficiency: 0.92,
      upshiftRpm: 7400,
      downshiftRpm: 4200,
      shiftTime: 0.15,
    },
    tyre: 'gravel',
    gripScale: 1,
    gauges: { rpmMax: 9000, rpmRed: 7800, speedMin: 20, speedMax: 220 },
  };
}

/**
 * Class 2: a fictional light two-door saloon from the late 70s in rally trim, with rear-wheel drive and a
 * high-revving four-cylinder set far back in the engine bay. Short wheelbase and lots of power, so it
 * turns easily; for those who like to slide.
 */
export function strand1800(): CarParams {
  const mass = 1050;
  const R = 0.31;
  const cg = 0.48;
  const wheelbase = 2.4;
  const zF = wheelbase * 0.48;
  const zR = -wheelbase * 0.52;
  const yMount = R - cg + 0.125;
  return {
    name: 'Strand 1800',
    mass,
    // Low yaw inertia: heavy parts near the middle and a short body.
    inertia: boxInertia(mass, 4.1, 1.7, 1.3, 0.72),
    cgHeight: cg,
    wheelRadius: R,
    wheelInertia: 1.15,
    wheelbase,
    trackFront: 1.45,
    wheels: [
      { mount: [0.725, yMount, zF], front: true, left: true },
      { mount: [-0.725, yMount, zF], front: true, left: false },
      { mount: [0.73, yMount, zR], front: false, left: true },
      { mount: [-0.73, yMount, zR], front: false, left: false },
    ],
    // As the Blender model, bumpers included: 1.80 m forward, 2.24 m back, roof 0.875 m above the centre of gravity.
    body: { halfX: 0.84, halfZ: 2.02, centerZ: -0.22, bottomY: -0.28, topY: 0.875 },
    susp: {
      kFront: 29000,
      kRear: 27000,
      bump: 2400,
      rebound: 3800,
      arbFront: 13000,
      arbRear: 8000,
      freeLen: 0.25,
      minLen: 0,
      maxLen: 0.25,
      bumpStopK: 300000,
    },
    brake: { total: 4700, bias: 0.62, handbrake: 3600 },
    steer: { maxAngle: 0.55, speedRef: 26, rate: 2.1, centerRate: 3.5 },
    aero: { cdA: 0.68, rho: 1.2 },
    diff: { lock: 0.55, preload: 70 },
    frontShare: 0,
    engine: {
      idleRpm: 1000,
      limiterRpm: 7600,
      curveRpm: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 7600, 8000],
      curveNm: [120, 155, 185, 210, 230, 240, 232, 215, 180],
      engineBrakeNm: 55,
      inertia: 0.16,
      clutchLockRpm: 2600,
      launchRpm: 4800,
    },
    gearbox: {
      ratios: [3.1, 2.15, 1.6, 1.25, 1.0],
      reverse: 3.3,
      final: 4.4,
      efficiency: 0.91,
      upshiftRpm: 7200,
      downshiftRpm: 4000,
      shiftTime: 0.17,
    },
    tyre: 'gravel',
    gripScale: 1,
    gauges: { rpmMax: 9000, rpmRed: 7600, speedMin: 20, speedMax: 220 },
  };
}

/**
 * Class 2: a fictional four-door saloon from around 1990 with four-wheel drive and a big turbo, a Group A
 * car. Dimensions follow the original: 4.468 × 1.697 × 1.359 m, wheelbase 2.608 m, track 1.468 m.
 * Lots of grip and the most power, but heavy and sluggish low down; forgiving but hard to slide.
 */
export function strandTurbo4x4(): CarParams {
  const p = kvarn240();
  const mass = 1230;
  const wheelbase = 2.608;
  const zF = wheelbase * 0.42;
  const zR = -wheelbase * 0.58;
  const [, y] = p.wheels[0]!.mount;
  return {
    ...p,
    name: 'Strand 2.0 Turbo 4x4',
    mass,
    inertia: boxInertia(mass, 4.468, 1.697, 1.359, 0.8),
    cgHeight: 0.52,
    wheelbase,
    trackFront: 1.468,
    // As the Blender model: nose 1.897 m forward, tail 2.571 m back, roof 0.779 m above the centre of gravity.
    body: { halfX: 0.85, halfZ: 2.234, centerZ: -0.337, bottomY: -0.37, topY: 0.779 },
    wheels: [
      { mount: [0.734, y, zF], front: true, left: true },
      { mount: [-0.734, y, zF], front: true, left: false },
      { mount: [0.734, y, zR], front: false, left: true },
      { mount: [-0.734, y, zR], front: false, left: false },
    ],
    susp: { ...p.susp, kFront: 34000, kRear: 30000, bump: 2700, rebound: 4300, arbFront: 15000, arbRear: 11000 },
    brake: { total: 5600, bias: 0.64, handbrake: 3800 },
    steer: { ...p.steer, rate: 2.0, centerRate: 3.4 },
    diff: { lock: 0.4, preload: 60 },
    // Rear-biased torque split like a Group A car, and a viscous centre diff.
    frontShare: 0.4,
    centerDiff: { lock: 0.5, preload: 100 },
    engine: {
      idleRpm: 950,
      limiterRpm: 6800,
      curveRpm: [950, 1500, 2500, 3000, 3500, 4000, 5000, 6000, 6800, 7200],
      curveNm: [100, 120, 170, 260, 330, 360, 370, 340, 280, 220],
      engineBrakeNm: 65,
      inertia: 0.2,
      clutchLockRpm: 2600,
      launchRpm: 4500,
      // The Group A cars ran around 1.5 bar before the 1995 restrictors.
      turbo: { spool: 0.6, offBoost: 0.6, antilag: 0, bar: 1.5 },
    },
    gearbox: {
      ratios: [3.2, 2.2, 1.65, 1.3, 1.06, 0.88],
      reverse: 3.3,
      final: 4.5,
      efficiency: 0.88,
      upshiftRpm: 6500,
      downshiftRpm: 3600,
      shiftTime: 0.18,
    },
    gauges: { rpmMax: 8000, rpmRed: 6750, speedMin: 20, speedMax: 220 },
  };
}

/** Four wheels at the same mount height; z is measured from the centre of mass. */
const wheelsAt = (y: number, xF: number, xR: number, zF: number, zR: number): WheelDef[] => [
  { mount: [xF, y, zF], front: true, left: true },
  { mount: [-xF, y, zF], front: true, left: false },
  { mount: [xR, y, zR], front: false, left: true },
  { mount: [-xR, y, zR], front: false, left: false },
];

/**
 * Class 2: a fictional rounded Japanese coupé with four-wheel drive and a two-litre turbo, modelled on a
 * Group A car from the early 90s: 299 hp at ~5,700 rpm but 459 Nm already at 4,000, so it pulls
 * hard out of corners but runs out of breath towards the limiter. Long wheelbase and heavy nose: stable at speed
 * but reluctant to turn in; even torque split with a viscous centre diff.
 */
export function hoshi4wd(): CarParams {
  const p = strandTurbo4x4();
  const mass = 1200;
  const R = 0.31;
  const cg = 0.48;
  const wheelbase = 2.525;
  return {
    ...p,
    name: 'Hoshi 2.0 4WD',
    mass,
    // Long body with heavy parts far forward and back: high yaw inertia.
    inertia: boxInertia(mass, 4.41, 1.745, 1.3, 0.86),
    cgHeight: cg,
    wheelRadius: R,
    wheelbase,
    trackFront: 1.51,
    wheels: wheelsAt(R - cg + 0.125, 0.755, 0.755, wheelbase * 0.42, -wheelbase * 0.58),
    body: { halfX: 0.873, halfZ: 2.2, bottomY: -0.3, topY: 0.78 },
    susp: { ...p.susp, kFront: 32000, kRear: 29000, arbFront: 13000, arbRear: 12000 },
    // Even 50/50 split with a viscous centre diff, as in the original.
    frontShare: 0.5,
    centerDiff: { lock: 0.4, preload: 80 },
    steer: { ...p.steer, rate: 1.9, centerRate: 3.3 },
    engine: {
      ...p.engine,
      limiterRpm: 7000,
      curveRpm: [950, 1500, 2500, 3000, 3500, 4000, 5000, 5700, 6500, 7000, 7400],
      curveNm: [120, 150, 260, 360, 430, 459, 410, 365, 290, 230, 180],
      launchRpm: 4500,
    },
    // Six-speed dog box; the ratios are not published, so the Kvarn's are kept. Shift up just after
    // peak power, since torque falls steeply above 5,700 rpm.
    gearbox: { ...p.gearbox, upshiftRpm: 6300, downshiftRpm: 3600, shiftTime: 0.16 },
    gauges: { rpmMax: 8000, rpmRed: 7000, speedMin: 20, speedMax: 220 },
  };
}

/**
 * Class 2: a fictional boxy Italian hatchback with four-wheel drive, a short wheelbase and more torque to the rear.
 * Turns in willingly but is nervous over crests; for those who want to slide on four wheels.
 */
export function volpeTurbo(): CarParams {
  const p = strandTurbo4x4();
  const mass = 1200;
  const R = 0.31;
  const cg = 0.52;
  const wheelbase = 2.48;
  return {
    ...p,
    name: 'Volpe 2.0 Turbo 16V',
    mass,
    inertia: boxInertia(mass, 3.9, 1.77, 1.4, 0.75),
    cgHeight: cg,
    wheelRadius: R,
    wheelbase,
    trackFront: 1.5,
    wheels: wheelsAt(R - cg + 0.125, 0.75, 0.76, wheelbase * 0.43, -wheelbase * 0.57),
    body: { halfX: 0.88, halfZ: 1.95, bottomY: -0.3, topY: 0.92 },
    susp: { ...p.susp, kFront: 34000, kRear: 32000, arbFront: 12000, arbRear: 14000 },
    steer: { ...p.steer, rate: 2.2, centerRate: 3.6 },
    // 47/53 as in the original: epicyclic centre diff with a viscous coupling.
    frontShare: 0.47,
    centerDiff: { lock: 0.45, preload: 90 },
    engine: {
      ...p.engine,
      curveRpm: [950, 1500, 2500, 3000, 3500, 4000, 5000, 6000, 6800, 7200],
      curveNm: [105, 130, 190, 280, 340, 360, 360, 330, 270, 210],
    },
    // Orange scale on black; the rev counter starts at three o'clock, the speedometer at nine o'clock.
    gauges: {
      rpmMax: 9000,
      rpmRed: 7000,
      speedMin: 0,
      speedMax: 240,
      style: { face: '#0b0b0b', ink: '#f7a21b', needle: '#ffc21a', red: '#e3261b', tachoArc: [0, 270], speedoArc: [180, 450], rpmUnit: 100 },
    },
  };
}

/**
 * Class 2: a fictional German coupé from the early 80s with a five-cylinder turbo far forward and
 * four-wheel drive with a nearly locked centre diff. Masses of power after a big turbo lag, but a heavy nose
 * that understeers; brake early and get on the throttle late.
 */
export function brenner5t(): CarParams {
  const p = strandTurbo4x4();
  const mass = 1250;
  const R = 0.31;
  const cg = 0.53;
  const wheelbase = 2.52;
  return {
    ...p,
    name: 'Brenner 5T Coupé',
    mass,
    inertia: boxInertia(mass, 4.4, 1.73, 1.35, 0.85),
    cgHeight: cg,
    wheelRadius: R,
    wheelbase,
    trackFront: 1.46,
    // The engine hangs ahead of the front axle: 58 % of the weight at the front.
    wheels: wheelsAt(R - cg + 0.125, 0.73, 0.74, wheelbase * 0.42, -wheelbase * 0.58),
    // As the Blender model: nose 1.905 m forward, tail 2.415 m back, roof 0.775 m above the centre of gravity.
    body: { halfX: 0.865, halfZ: 2.16, centerZ: -0.255, bottomY: -0.305, topY: 0.775 },
    susp: { ...p.susp, kFront: 36000, kRear: 28000, arbFront: 17000, arbRear: 9000 },
    brake: { ...p.brake, bias: 0.66 },
    steer: { ...p.steer, rate: 1.9, centerRate: 3.3 },
    frontShare: 0.5,
    centerDiff: { lock: 0.8, preload: 150 },
    engine: {
      ...p.engine,
      idleRpm: 900,
      limiterRpm: 7000,
      curveRpm: [900, 1500, 2500, 3500, 4000, 4500, 5500, 6500, 7000, 7400],
      curveNm: [100, 115, 140, 200, 310, 360, 370, 330, 275, 210],
      inertia: 0.22,
      launchRpm: 5000,
      // 1.6 bar like the rally version of the original with 230 kW.
      turbo: { spool: 0.8, offBoost: 0.55, antilag: 0, bar: 1.6 },
    },
    gearbox: { ...p.gearbox, ratios: [3.0, 2.0, 1.5, 1.18, 0.95], final: 4.4, shiftTime: 0.2 },
    gauges: { rpmMax: 8000, rpmRed: 7000, speedMin: 20, speedMax: 240 },
  };
}

/**
 * Class 2: a fictional Japanese two-door coupé with a boxer engine, low centre of mass and soft suspension. Stable
 * and forgiving over bumps, and pulls evenly out of corners. Dimensions, weight and engine follow the original
 * from 1999: 4.35 × 1.69 × 1.405 m, wheelbase 2.52 m, track 1.47/1.46 m, 1,260 kg, 206 kW at
 * 6,500 rpm and 352 Nm at 4,000 rpm, tyres 205/50 R16.
 */
export function soraTurbo(): CarParams {
  const p = strandTurbo4x4();
  const mass = 1260;
  const R = 0.31;
  const cg = 0.47;
  const wheelbase = 2.52;
  return {
    ...p,
    name: 'Sora 2.0 Turbo',
    mass,
    inertia: boxInertia(mass, 4.35, 1.69, 1.405, 0.8),
    cgHeight: cg,
    wheelRadius: R,
    wheelbase,
    trackFront: 1.47,
    wheels: wheelsAt(R - cg + 0.125, 0.735, 0.73, wheelbase * 0.44, -wheelbase * 0.56),
    // Roof as on the rally version in the Blender model: 1.30 m above the ground.
    body: { halfX: 0.845, halfZ: 2.175, bottomY: -0.3, topY: 0.79 },
    susp: { ...p.susp, kFront: 30000, kRear: 27000, bump: 2500, rebound: 4000, arbFront: 13000, arbRear: 11000 },
    frontShare: 0.5,
    centerDiff: { lock: 0.5, preload: 100 },
    engine: {
      ...p.engine,
      curveRpm: [950, 1500, 2500, 3000, 3500, 4000, 5000, 6000, 6800, 7200],
      curveNm: [115, 150, 230, 310, 340, 352, 345, 325, 295, 225],
      // The road version of the original: 1.1 bar from 3,000 rpm.
      turbo: { ...p.engine.turbo!, bar: 1.1 },
    },
    // White dial with black numbers and an orange needle; red zone from 8000 as on the original.
    gauges: {
      rpmMax: 10000,
      rpmRed: 8000,
      speedMin: 0,
      speedMax: 280,
      style: { face: '#f2f2ee', ink: '#151515', needle: '#ff5a1f', red: '#e0201b', tachoArc: [125, 415], speedoArc: [120, 390], rpmUnit: 1000, redInk: true },
    },
  };
}


/** A decal on the body: fictional name, text colour and optional background (CSS colours). */
export interface Sponsor {
  name: string;
  fg: string;
  bg?: string;
}

export interface CarModel {
  make: () => CarParams;
  /** The car's own body in src/render/bodies/ (same name as the file). */
  body: 'kvarn240' | 'kvarn240Turbo' | 'strandTurbo4x4' | 'soraTurbo' | 'ljung1600' | 'ljung2000' | 'strand1800' | 'brenner5t' | 'volpeTurbo' | 'hoshi4wd';
  /** A one-line description of the car in the car picker. */
  blurb: string;
  /** Paint colour. */
  paint: number;
  /** Decals from fitted parts, read when the car is built. Absent outside the career. */
  sponsors?: () => Sponsor[];
}

/** The cars you can pick before a stage. */
export const CARS: CarModel[] = [
  { make: kvarn240, body: 'kvarn240', paint: 0xc4553a, blurb: 'Tung och bakhjulsdriven 80-talssedan. Förlåtande, men vill sladda.' },
  {
    make: kvarn240Turbo,
    body: 'kvarn240Turbo',
    paint: 0x24365c,
    blurb: 'Samma kaross med turbo. Seg under 3 000 rpm, sedan kommer allt på en gång.',
  },
  {
    make: ljung1600,
    body: 'ljung1600',
    paint: 0xd9b22e,
    blurb: 'Liten och lätt framhjulsdriven halvkombi. Billig, kvick och understyr, men vrids runt med handbromsen.',
  },
  // Class 2: unlocked when all class 1 championships are won.
  {
    make: ljung2000,
    body: 'ljung2000',
    paint: 0xf2f2ee,
    blurb: 'Kitcar på Ljungens kaross. Varvglad och nervös, och spärren fram drar i ratten när du gasar.',
  },
  {
    make: strand1800,
    body: 'strand1800',
    paint: 0x2f7d4f,
    blurb: 'Lätt bakhjulsdriven tvådörrars sedan med kort hjulbas. Mycket gas och vrider sig lätt; för den som vill sladda.',
  },
  {
    make: strandTurbo4x4,
    body: 'strandTurbo4x4',
    paint: 0x1a1a1e,
    blurb: 'Fyrhjulsdriven turbosedan i Grupp A-stil. Mest effekt och grepp, men tung och seg under 3 000 rpm.',
  },
  {
    make: hoshi4wd,
    body: 'hoshi4wd',
    paint: 0xf2f2ee,
    blurb: 'Rundad japansk turbocoupé med fyrhjulsdrift. Enormt mellanregister, stabil i fart men trög att vrida in.',
  },
  {
    make: volpeTurbo,
    body: 'volpeTurbo',
    paint: 0xc8141c,
    blurb: 'Kantig italiensk halvkombi med kort hjulbas och mer moment bak. Vrider sig villigt, men nervös på krön.',
  },
  {
    make: brenner5t,
    body: 'brenner5t',
    paint: 0xd8d4c8,
    blurb: 'Femcylindrig turbocoupé med motorn långt fram och låst mittdiff. Stort turbohål och tung nos som understyr.',
  },
  {
    make: soraTurbo,
    body: 'soraTurbo',
    paint: 0x1f4fb4,
    blurb: 'Tvådörrars boxercoupé med hög vinge och låg tyngdpunkt. Mjuk fjädring, stabil över ojämnheter och drar jämnt ur kurvorna.',
  },
];
