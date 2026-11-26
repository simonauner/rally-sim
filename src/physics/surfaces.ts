/** Underlag och däcktyper. All grip är ren data, så den lätt kan trimmas. */

export type SurfaceId = 'asphalt' | 'gravel' | 'mud' | 'snow' | 'snowbank';
export type TyreType = 'tarmac' | 'gravel' | 'snow';

export interface SurfaceParams {
  id: SurfaceId;
  name: string;
  /** Slip ratio där däcket ger mest grepp. */
  peakSlipRatio: number;
  /** tan(slipvinkel) där däcket ger mest sidgrepp. */
  peakTanSlipAngle: number;
  /** Formfaktor i kurvan. Högre = mer fall efter toppen (löst underlag). */
  curveC: number;
  /** Rullmotstånd som andel av hjullasten. */
  rolling: number;
  /** Djup lös snö: motstånd mot farten i markplanet, per N hjullast och m/s. Bromsar även en låst bil. */
  sink?: number;
}

export const SURFACES: Record<SurfaceId, SurfaceParams> = {
  asphalt: { id: 'asphalt', name: 'Asfalt', peakSlipRatio: 0.11, peakTanSlipAngle: 0.15, curveC: 1.35, rolling: 0.012 },
  gravel: { id: 'gravel', name: 'Grus', peakSlipRatio: 0.18, peakTanSlipAngle: 0.22, curveC: 1.45, rolling: 0.035 },
  mud: { id: 'mud', name: 'Lera', peakSlipRatio: 0.22, peakTanSlipAngle: 0.28, curveC: 1.5, rolling: 0.07 },
  snow: { id: 'snow', name: 'Snö', peakSlipRatio: 0.15, peakTanSlipAngle: 0.2, curveC: 1.4, rolling: 0.03 },
  // Lös snö i vallarna längs vinterväg: hjulen gräver ner sig och bromsar bilen.
  snowbank: { id: 'snowbank', name: 'Snövall', peakSlipRatio: 0.25, peakTanSlipAngle: 0.3, curveC: 1.6, rolling: 0.35, sink: 0.04 },
};

/** Friktionskoefficient per däcktyp och underlag (toppvärde vid nominell last). */
export const TYRE_GRIP: Record<TyreType, Record<SurfaceId, number>> = {
  tarmac: { asphalt: 1.1, gravel: 0.58, mud: 0.38, snow: 0.18, snowbank: 0.15 },
  gravel: { asphalt: 0.95, gravel: 0.85, mud: 0.6, snow: 0.32, snowbank: 0.25 },
  snow: { asphalt: 0.8, gravel: 0.72, mud: 0.52, snow: 0.55, snowbank: 0.4 },
};

export const TYRE_NAMES: Record<TyreType, string> = {
  tarmac: 'Asfaltsdäck',
  gravel: 'Grusdäck',
  snow: 'Vinterdäck',
};
