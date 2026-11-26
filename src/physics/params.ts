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

export interface CarModel {
  make: () => CarParams;
  /** Karossform för renderingen. */
  body: 'sedan' | 'hatch';
  /** En rad om bilen i bilväljaren. */
  blurb: string;
  /** Lackfärg. */
  paint: number;
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
];
