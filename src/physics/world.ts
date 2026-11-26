import { Vector3 } from 'three';
import type { SurfaceId } from './surfaces';

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Testbanan: en lekplats längs +Z med olika underlag och hinder.
 *  z   0..40   grus, accelerationssträcka
 *  z  40..100  asfaltsremsa, lera till höger och snö till vänster
 *  z 110..150  tvättbräda
 *  z 170..180  hopp
 *  z 220       betongpelare
 *  z 260       betongvägg (krocktest)
 */
export class World {
  readonly boxes: Box[] = [
    { minX: -40, maxX: 40, minY: -2, maxY: 3.5, minZ: 260, maxZ: 262 },
    { minX: -7.5, maxX: -6, minY: -2, maxY: 2, minZ: 220, maxZ: 221.5 },
    { minX: 6, maxX: 7.5, minY: -2, maxY: 2, minZ: 220, maxZ: 221.5 },
  ];

  heightAt(x: number, z: number): number {
    // Mjuka kullar, men platt i början så accelerationstester blir rena.
    const w = Math.max(smooth(105, 150, z), smooth(40, 90, Math.abs(x)));
    let h = w * (0.28 * Math.sin(x * 0.013 + 1) * Math.cos(z * 0.011) + 0.14 * Math.sin(z * 0.031 + x * 0.017));

    // Tvättbräda
    const inX = 1 - smooth(10, 14, Math.abs(x));
    const inZ = smooth(110, 114, z) * (1 - smooth(146, 150, z));
    h += 0.05 * Math.sin(((z - 110) / 1.6) * Math.PI * 2) * inX * inZ;

    // Hopp: ramp upp, tvärt ned
    if (z >= 170 && z <= 181) {
      const across = 1 - smooth(4, 6, Math.abs(x));
      const up = z <= 178 ? ((z - 170) / 8) * 0.9 : 0.9 * (1 - (z - 178) / 3);
      h += up * across;
    }
    return h;
  }

  normalAt(x: number, z: number, out: Vector3): Vector3 {
    const e = 0.25;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }

  surfaceAt(x: number, z: number): SurfaceId {
    if (z >= 40 && z <= 100) {
      if (Math.hypot(x - 24, z - 70) < 11) return 'mud';
      if (Math.hypot(x + 24, z - 70) < 11) return 'snow';
      if (Math.abs(x) < 8) return 'asphalt';
    }
    return 'gravel';
  }
}
