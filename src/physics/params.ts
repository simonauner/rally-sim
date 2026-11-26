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

export interface CarModel {
  make: () => CarParams;
  /** En rad om bilen i bilväljaren. */
  blurb: string;
  /** Lackfärg. */
  paint: number;
}

/** Bilarna man kan välja före en etapp. */
export const CARS: CarModel[] = [
  { make: kvarn240, paint: 0xc4553a, blurb: 'Tung och bakhjulsdriven 80-talssedan. Förlåtande, men vill sladda.' },
  {
    make: kvarn240Turbo,
    paint: 0x24365c,
    blurb: 'Samma kaross med turbo. Seg under 3 000 rpm, sedan kommer allt på en gång.',
  },
];
