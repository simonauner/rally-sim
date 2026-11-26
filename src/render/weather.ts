import * as THREE from 'three/webgpu';
import type { Weather } from '../physics/weather';

/** Sikt och ljus per väder, ovanpå tid på dygnet. `grey` = hur mycket himlen gråas ut. */
const LOOK: Record<Weather, { fog: [number, number] | null; grey: number; sun: number; hemi: number }> = {
  clear: { fog: null, grey: 0, sun: 1, hemi: 1 },
  rain: { fog: [25, 200], grey: 0.7, sun: 0.35, hemi: 0.8 },
  fog: { fog: [6, 75], grey: 0.85, sun: 0.4, hemi: 0.9 },
  snowfall: { fog: [20, 150], grey: 0.7, sun: 0.4, hemi: 0.9 },
};

/** Gråar ut himlen och drar in dimman; anropas efter applyLight. */
export function applyWeather(scene: THREE.Scene, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight, weather: Weather) {
  const look = LOOK[weather];
  if (!look.fog) return;
  const sky = (scene.background as THREE.Color).clone();
  // Samma ljushet, mindre färg: en mulen dag blir grå och en mulen natt förblir mörk.
  const l = sky.r * 0.3 + sky.g * 0.59 + sky.b * 0.11;
  sky.lerp(new THREE.Color(l, l, l), look.grey);
  scene.background = sky;
  const fog = scene.fog as THREE.Fog;
  scene.fog = new THREE.Fog(sky, Math.min(fog.near, look.fog[0]), Math.min(fog.far, look.fog[1]));
  sun.intensity *= look.sun;
  hemi.intensity *= look.hemi;
}

const BOX = 36;
const HALF_H = 12;

/** Regn eller snöfall i en låda runt kameran; dropparna som faller ur lådan börjar om överst. */
export class Precipitation {
  readonly mesh: THREE.InstancedMesh;
  private pos: Float32Array;
  private phase: Float32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private p = new THREE.Vector3();

  constructor(private kind: 'rain' | 'snowfall') {
    const rain = kind === 'rain';
    const count = rain ? 2600 : 3200;
    const geo = rain ? new THREE.BoxGeometry(0.015, 0.55, 0.015) : new THREE.IcosahedronGeometry(0.05, 0);
    // Utan toon-material slipper partiklarna konturerna från cel-shadingen.
    const mat = new THREE.MeshBasicMaterial({ color: rain ? 0xaab6c4 : 0xffffff, transparent: rain, opacity: rain ? 0.55 : 1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * BOX;
      this.pos[i * 3 + 1] = (Math.random() - 0.5) * 2 * HALF_H;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.phase[i] = Math.random() * Math.PI * 2;
    }
  }

  update(dt: number, camera: THREE.Vector3, time: number) {
    const rain = this.kind === 'rain';
    const fall = rain ? 11 : 1.3;
    const wrap = (v: number, size: number) => v - size * Math.floor(v / size + 0.5);
    for (let i = 0; i < this.phase.length; i++) {
      const k = i * 3;
      this.pos[k + 1]! -= fall * dt;
      if (!rain) {
        // Flingorna singlar i sidled.
        this.pos[k]! += Math.sin(time * 0.9 + this.phase[i]!) * 0.4 * dt;
        this.pos[k + 2]! += Math.cos(time * 0.7 + this.phase[i]!) * 0.4 * dt;
      }
      // Lådan följer kameran: läget räknas relativt kameran och lindas runt.
      const x = camera.x + wrap(this.pos[k]! - camera.x, BOX);
      const y = camera.y + wrap(this.pos[k + 1]! - camera.y, 2 * HALF_H);
      const z = camera.z + wrap(this.pos[k + 2]! - camera.z, BOX);
      this.pos[k] = x;
      this.pos[k + 1] = y;
      this.pos[k + 2] = z;
      this.mesh.setMatrixAt(i, this.m.compose(this.p.set(x, y, z), this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
