import type { DiffParams, EngineParams, GearboxParams } from './drivetrain';
import type { TyreType } from './surfaces';

export interface WheelDef {
  /** Fäste i kroppens lokala koordinater (x vänster, y upp, z framåt, origo i tyngdpunkten). */
  mount: [number, number, number];
  front: boolean;
  left: boolean;
}

export interface CarParams {
  name: string;
  mass: number;
  /** Tröghetsmoment kring x (stampning), y (girning) och z (rullning). */
  inertia: [number, number, number];
  cgHeight: number;
  wheelRadius: number;
  wheelInertia: number;
  wheelbase: number;
  trackFront: number;
  wheels: WheelDef[];
  /** Kroppens kollisionsbox (halva mått) och markfrigång. */
  body: { halfX: number; halfZ: number; bottomY: number; topY: number };

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
  /** Andel av drivmomentet som går till framaxeln (0 = bakhjulsdrift). */
  frontShare: number;
  /** Mittdiff för fyrhjulsdrift; utan den delas momentet fast efter frontShare. */
  centerDiff?: DiffParams;
  engine: EngineParams;
  gearbox: GearboxParams;
  tyre: TyreType;
  /** Global grepp-multiplikator för trimning. */
  gripScale: number;
  /** Skalorna på varvräknaren och hastighetsmätaren, som i bilens egen instrumentpanel. */
  gauges: { rpmMax: number; rpmRed: number; speedMin: number; speedMax: number };
}

function boxInertia(m: number, l: number, w: number, h: number, k: number): [number, number, number] {
  return [(m / 12) * (h * h + l * l) * k, (m / 12) * (w * w + l * l) * k, (m / 12) * (w * w + h * h) * k];
}

/** En fiktiv hobbyrallybil: stor, tung och bakhjulsdriven sedan från 80-talet. */
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
    steer: { maxAngle: 0.52, speedRef: 20, rate: 1.8, centerRate: 3.2 },
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
    // Varvräknare 0–7 med orange fält från 6 250, hastighetsmätare 20–200 km/h.
    gauges: { rpmMax: 7000, rpmRed: 6250, speedMin: 20, speedMax: 200 },
  };
}

/** Samma kaross med turbomotor: segt i botten, sedan kommer allt på en gång. */
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
    },
    gearbox: { ...p.gearbox, final: 4.1 },
    brake: { ...p.brake, total: 5000 },
  };
}

/**
 * En fiktiv liten framhjulsdriven halvkombi från 80-talet med 1,6-liters förgasarmotor:
 * billig, lätt och kvick. Amatörernas instegsbil, som understyr in i kurvan och vill
 * lyfta inre bakhjulet, men går att vrida med handbromsen eller lyft av gasen.
 */
export function ljung1600(): CarParams {
  const mass = 880;
  const R = 0.29;
  const cg = 0.5;
  const wheelbase = 2.4;
  // Tung front: motorn sitter tvärs framför framaxeln.
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
      // Styv bakaxel, så bakvagnen hjälper till att vrida bilen.
      arbRear: 10000,
      freeLen: 0.24,
      minLen: 0,
      maxLen: 0.24,
      bumpStopK: 250000,
    },
    brake: { total: 3400, bias: 0.7, handbrake: 2800 },
    steer: { maxAngle: 0.55, speedRef: 20, rate: 2.0, centerRate: 3.4 },
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
    // Varvräknaren går till 8 000, så smidda kolvar (+500 rpm) ryms på skalan.
    gauges: { rpmMax: 8000, rpmRed: 6600, speedMin: 20, speedMax: 200 },
  };
}

/**
 * Klass 2: en fiktiv kitcar-halvkombi med tvåliters 16-ventilsmotor. Lätt, varvglad och nervös,
 * med spärrdiff fram som drar i ratten under gaspådrag. Ljung 1600 S i tävlingsversion.
 */
export function ljung2000(): CarParams {
  const mass = 1000;
  const R = 0.3;
  const cg = 0.48;
  const wheelbase = 2.47;
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
    steer: { maxAngle: 0.55, speedRef: 22, rate: 2.2, centerRate: 3.6 },
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
 * Klass 2: en fiktiv lätt coupé med bakhjulsdrift och tvåliters sugmotor långt bak i motorrummet.
 * Kort hjulbas och mycket gas, så den vrider sig lätt; för den som vill sladda.
 */
export function strandGt(): CarParams {
  const mass = 1050;
  const R = 0.31;
  const cg = 0.48;
  const wheelbase = 2.4;
  const zF = wheelbase * 0.48;
  const zR = -wheelbase * 0.52;
  const yMount = R - cg + 0.125;
  return {
    name: 'Strand 2.0 GT',
    mass,
    // Låg tröghet kring höjdaxeln: tunga delar nära mitten och kort kaross.
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
    body: { halfX: 0.84, halfZ: 2.0, bottomY: -0.29, topY: 0.78 },
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
    steer: { maxAngle: 0.55, speedRef: 22, rate: 2.1, centerRate: 3.5 },
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
 * Klass 2: Kvarnens sedankaross med fyrhjulsdrift och stor turbo, som en Grupp A-bil.
 * Mycket grepp och mest effekt, men tung och seg i botten; förlåtande men svår att sladda.
 */
export function kvarnTurbo4x4(): CarParams {
  const p = kvarn240();
  const mass = 1230;
  const zF = p.wheelbase * 0.42;
  const zR = -p.wheelbase * 0.58;
  const [, y] = p.wheels[0]!.mount;
  return {
    ...p,
    name: 'Kvarn Turbo 4x4',
    mass,
    inertia: boxInertia(mass, 4.7, 1.75, 1.4, 0.8),
    cgHeight: 0.52,
    trackFront: 1.47,
    wheels: [
      { mount: [0.735, y, zF], front: true, left: true },
      { mount: [-0.735, y, zF], front: true, left: false },
      { mount: [0.74, y, zR], front: false, left: true },
      { mount: [-0.74, y, zR], front: false, left: false },
    ],
    susp: { ...p.susp, kFront: 34000, kRear: 30000, bump: 2700, rebound: 4300, arbFront: 15000, arbRear: 11000 },
    brake: { total: 5600, bias: 0.64, handbrake: 3800 },
    steer: { ...p.steer, rate: 2.0, centerRate: 3.4 },
    diff: { lock: 0.4, preload: 60 },
    // Bakvikt i momentet som i en Grupp A-bil, och en viskös mittdiff.
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

/** En dekal på karossen: fiktivt namn, textfärg och eventuell bakgrund (CSS-färger). */
export interface Sponsor {
  name: string;
  fg: string;
  bg?: string;
}

export interface CarModel {
  make: () => CarParams;
  /** Karossform för renderingen. */
  body: 'sedan' | 'hatch' | 'coupe';
  /** En rad om bilen i bilväljaren. */
  blurb: string;
  /** Lackfärg. */
  paint: number;
  /** Dekaler från monterade delar, läses när bilen byggs. Saknas utanför karriären. */
  sponsors?: () => Sponsor[];
}

/** Bilarna man kan välja före en etapp. */
export const CARS: CarModel[] = [
  { make: kvarn240, body: 'sedan', paint: 0xc4553a, blurb: 'Tung och bakhjulsdriven 80-talssedan. Förlåtande, men vill sladda.' },
  {
    make: kvarn240Turbo,
    body: 'sedan',
    paint: 0x24365c,
    blurb: 'Samma kaross med turbo. Seg under 3 000 rpm, sedan kommer allt på en gång.',
  },
  {
    make: ljung1600,
    body: 'hatch',
    paint: 0xd9b22e,
    blurb: 'Liten och lätt framhjulsdriven halvkombi. Billig, kvick och understyr, men vrids runt med handbromsen.',
  },
  // Klass 2: låses upp när alla mästerskap i klass 1 är vunna.
  {
    make: ljung2000,
    body: 'hatch',
    paint: 0xf2f2ee,
    blurb: 'Kitcar på Ljungens kaross. Varvglad och nervös, och spärren fram drar i ratten när du gasar.',
  },
  {
    make: strandGt,
    body: 'coupe',
    paint: 0x2f7d4f,
    blurb: 'Lätt bakhjulsdriven coupé med kort hjulbas. Mycket gas och vrider sig lätt; för den som vill sladda.',
  },
  {
    make: kvarnTurbo4x4,
    body: 'sedan',
    paint: 0x1a1a1e,
    blurb: 'Fyrhjulsdriven turbosedan i Grupp A-stil. Mest effekt och grepp, men tung och seg under 3 000 rpm.',
  },
];
