import * as THREE from 'three/webgpu';
import type { Car } from '../physics/car';

/** Kraftvektorer i 3D: röd = däckkraft, blå = hjullast, grön = färdriktning. */
export class DebugVectors {
  readonly lines: THREE.LineSegments;
  private pos = new Float32Array(9 * 2 * 3);
  private attr: THREE.BufferAttribute;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    geo.setAttribute('position', this.attr);
    const colors = new Float32Array(9 * 2 * 3);
    const set = (seg: number, r: number, g: number, b: number) => {
      colors.set([r, g, b, r, g, b], seg * 6);
    };
    for (let i = 0; i < 4; i++) {
      set(i, 0.9, 0.1, 0.1);
      set(4 + i, 0.1, 0.3, 0.95);
    }
    set(8, 0.1, 0.7, 0.2);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
  }

  update(car: Car) {
    const p = this.pos;
    car.wheels.forEach((w, i) => {
      const c = w.contactW;
      p.set([c.x, c.y + 0.02, c.z, c.x + w.tyreForceW.x * 0.0005, c.y + 0.02 + w.tyreForceW.y * 0.0005, c.z + w.tyreForceW.z * 0.0005], i * 6);
      p.set([c.x, c.y + 0.02, c.z, c.x, c.y + 0.02 + w.fz * 0.0002, c.z], (4 + i) * 6);
    });
    const c = car.pos;
    p.set([c.x, c.y, c.z, c.x + car.vel.x * 0.25, c.y + car.vel.y * 0.25, c.z + car.vel.z * 0.25], 8 * 6);
    this.attr.needsUpdate = true;
  }
}
