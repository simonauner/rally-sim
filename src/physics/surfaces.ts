/** Surfaces and tyre types. All grip is plain data so it is easy to tune. */

export type SurfaceId = 'asphalt' | 'gravel' | 'mud' | 'snow' | 'snowbank' | 'water';
export type TyreType = 'tarmac' | 'gravel' | 'snow';

export interface SurfaceParams {
  id: SurfaceId;
  name: string;
  /** Slip ratio at which the tyre gives the most grip. */
  peakSlipRatio: number;
  /** tan(slip angle) at which the tyre gives the most lateral grip. */
  peakTanSlipAngle: number;
  /** Curve shape factor. Higher = more drop-off after the peak (loose surface). */
  curveC: number;
  /** Rolling resistance as a fraction of wheel load. */
  rolling: number;
  /** Deep loose snow: resistance to ground-plane velocity, per N of wheel load and m/s. Also slows a locked car. */
  sink?: number;
}

export const SURFACES: Record<SurfaceId, SurfaceParams> = {
  asphalt: { id: 'asphalt', name: 'Asfalt', peakSlipRatio: 0.11, peakTanSlipAngle: 0.15, curveC: 1.35, rolling: 0.012 },
  gravel: { id: 'gravel', name: 'Grus', peakSlipRatio: 0.18, peakTanSlipAngle: 0.22, curveC: 1.45, rolling: 0.035 },
  mud: { id: 'mud', name: 'Lera', peakSlipRatio: 0.22, peakTanSlipAngle: 0.28, curveC: 1.5, rolling: 0.07 },
  snow: { id: 'snow', name: 'Snö', peakSlipRatio: 0.15, peakTanSlipAngle: 0.2, curveC: 1.4, rolling: 0.03 },
  // Loose snow in the banks along winter roads: the wheels dig in and slow the car.
  snowbank: { id: 'snowbank', name: 'Snövall', peakSlipRatio: 0.25, peakTanSlipAngle: 0.3, curveC: 1.6, rolling: 0.35, sink: 0.04 },
  // Water splash: shallow water over a stone bed. The water slows the car, but less than the snowbanks.
  water: { id: 'water', name: 'Vatten', peakSlipRatio: 0.2, peakTanSlipAngle: 0.25, curveC: 1.5, rolling: 0.12, sink: 0.012 },
};

/** Friction coefficient per tyre type and surface (peak value at nominal load). */
export const TYRE_GRIP: Record<TyreType, Record<SurfaceId, number>> = {
  tarmac: { asphalt: 1.1, gravel: 0.58, mud: 0.38, snow: 0.18, snowbank: 0.15, water: 0.45 },
  gravel: { asphalt: 0.95, gravel: 0.85, mud: 0.6, snow: 0.32, snowbank: 0.25, water: 0.55 },
  snow: { asphalt: 0.8, gravel: 0.72, mud: 0.52, snow: 0.55, snowbank: 0.4, water: 0.5 },
};

export const TYRE_NAMES: Record<TyreType, string> = {
  tarmac: 'Asfaltsdäck',
  gravel: 'Grusdäck',
  snow: 'Vinterdäck',
};
