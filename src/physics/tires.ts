import type { SurfaceParams } from './surfaces';

/**
 * Simplified "Pacejka-lite". Longitudinal and lateral slip are normalised against their peak values and
 * combined into a slip vector. The force follows a magic-formula-like curve and
 * is applied along the slip vector, which gives a friction ellipse without extra parameters.
 */

export interface TyreOut {
  fx: number; // force on the car, forward positive
  fy: number; // force on the car, left positive
  /** Used fraction of available grip, 0..1+ (for debugging). */
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
  // Load sensitivity: more load gives a slightly lower friction coefficient.
  const muEff = mu * Math.pow(Math.max(fz, 300) / NOMINAL_LOAD, -0.12);
  const f = muEff * fz * g;
  out.fx = (f * sx) / s;
  out.fy = (-f * sy) / s;
  out.usage = g;
  return out;
}
