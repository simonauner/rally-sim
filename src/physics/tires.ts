import type { SurfaceParams } from './surfaces';

/**
 * Förenklad "Pacejka-lite". Längs- och sidslip normaliseras mot sina toppvärden och
 * kombineras till en slipvektor. Kraften följer en magic-formula-lik kurva och
 * fördelas i slipvektorns riktning, vilket ger en friktionsellips utan extra parametrar.
 */

export interface TyreOut {
  fx: number; // kraft på bilen, framåt positiv
  fy: number; // kraft på bilen, vänster positiv
  /** Använd andel av tillgängligt grepp, 0..1+ (för debug). */
  usage: number;
}

const NOMINAL_LOAD = 3000;

export function tyreForce(
  kappa: number,
  tanAlpha: number,
  fz: number,
  surface: SurfaceParams,
  mu: number,
  out: TyreOut,
): TyreOut {
  if (fz <= 0) {
    out.fx = 0;
    out.fy = 0;
    out.usage = 0;
    return out;
  }
  const sx = kappa / surface.peakSlipRatio;
  const sy = tanAlpha / surface.peakTanSlipAngle;
  const s = Math.hypot(sx, sy);
  if (s < 1e-9) {
    out.fx = 0;
    out.fy = 0;
    out.usage = 0;
    return out;
  }
  const C = surface.curveC;
  const B = Math.tan(Math.PI / (2 * C));
  const g = Math.sin(C * Math.atan(B * s));
  // Lastkänslighet: mer last ger något lägre friktionstal.
  const muEff = mu * Math.pow(Math.max(fz, 300) / NOMINAL_LOAD, -0.12);
  const f = muEff * fz * g;
  out.fx = (f * sx) / s;
  out.fy = (-f * sy) / s;
  out.usage = g;
  return out;
}
