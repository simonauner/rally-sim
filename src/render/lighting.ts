import * as THREE from 'three/webgpu';
import { LAMP_BROKEN, type Car } from '../physics/car';
import type { Light } from '../physics/stage';

interface LightPreset {
  sky: number;
  fog: [near: number, far: number];
  hemi: [sky: number, ground: number, intensity: number];
  sun: [color: number, intensity: number];
  /** Sun position relative to the car; a low sun gives long shadows. */
  sunOffset: [number, number, number];
  headlights: boolean;
  /** Cel-shading outline colour; must be darker than the scene, or it shows as light lines. */
  outline: number;
}

/** Lighting per time of day. Day is what has always been there; the rest are darker with a lower sun. */
export const LIGHTS: Record<Light, LightPreset> = {
  day: { sky: 0xcfe3ee, fog: [120, 520], hemi: [0xe8f3ff, 0x8a7a5a, 1.1], sun: [0xfff1d6, 2.4], sunOffset: [40, 70, -30], headlights: false, outline: 0x1c1c24 },
  dawn: { sky: 0xe8c3a8, fog: [80, 380], hemi: [0xc4c8e4, 0x5a4c58, 0.7], sun: [0xffb47a, 1.7], sunOffset: [70, 16, 40], headlights: true, outline: 0x1c1c24 },
  dusk: { sky: 0x6a6a96, fog: [50, 260], hemi: [0x8088bc, 0x2e2838, 0.4], sun: [0xff8a5c, 0.6], sunOffset: [-70, 10, 30], headlights: true, outline: 0x101018 },
  night: { sky: 0x020306, fog: [20, 140], hemi: [0x34406c, 0x0c0c14, 0.008], sun: [0x9fb3ff, 0.01], sunOffset: [30, 60, 40], headlights: true, outline: 0x000000 },
};

export function applyLight(scene: THREE.Scene, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight, preset: LightPreset) {
  scene.background = new THREE.Color(preset.sky);
  scene.fog = new THREE.Fog(preset.sky, ...preset.fog);
  hemi.color.setHex(preset.hemi[0]);
  hemi.groundColor.setHex(preset.hemi[1]);
  hemi.intensity = preset.hemi[2];
  sun.color.setHex(preset.sun[0]);
  sun.intensity = preset.sun[1];
}

/** Lamp positions in the car's local coordinates (x = left). */
const LAMP_POS = [
  [0.6, 0.0, 2.0],
  [-0.6, 0.0, 2.0],
] as const;

/** Two headlights that follow the car; a damaged lamp shines dimmer and a broken one not at all. */
export class Headlights {
  readonly group = new THREE.Group();
  private spots: THREE.SpotLight[];

  constructor() {
    this.spots = LAMP_POS.map(([x, y, z]) => {
      const s = new THREE.SpotLight(0xfff2d0, 0, 120, 0.4, 0.6, 1);
      s.position.set(x, y, z);
      // Slightly down and a touch outward, so the road edges show in corners.
      s.target.position.set(x * 3, y - 0.8, z + 30);
      this.group.add(s, s.target);
      return s;
    });
  }

  update(car: Car) {
    this.group.position.copy(car.pos);
    this.group.quaternion.copy(car.quat);
    this.spots.forEach((s, i) => {
      const dmg = car.lamps[i]!;
      s.intensity = dmg >= LAMP_BROKEN ? 0 : 12 * (1 - 0.6 * dmg);
    });
  }
}
