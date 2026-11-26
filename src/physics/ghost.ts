import type { Quaternion, Vector3 } from 'three';

/** Inspelat åk: position och rotation med fast takt, räknat i etapptid från startlinjen. */
export interface GhostData {
  hz: number;
  /** x, y, z, qx, qy, qz, qw per bild. */
  frames: number[];
}

const STRIDE = 7;
const round = (v: number, d: number) => Math.round(v * d) / d;

export class GhostRecorder {
  private frames: number[] = [];
  private next = 0;

  constructor(readonly hz = 20) {}

  reset() {
    this.frames = [];
    this.next = 0;
  }

  /** Anropas varje fysiksteg medan klockan går; sparar en bild per 1/hz sekund. */
  record(t: number, pos: Vector3, quat: Quaternion) {
    while (t >= this.next) {
      // Avrundning håller sparfilen liten: mm i position, 1e-4 i kvaternion.
      this.frames.push(round(pos.x, 1e3), round(pos.y, 1e3), round(pos.z, 1e3));
      this.frames.push(round(quat.x, 1e4), round(quat.y, 1e4), round(quat.z, 1e4), round(quat.w, 1e4));
      this.next = this.frames.length / STRIDE / this.hz;
    }
  }

  data(): GhostData {
    return { hz: this.hz, frames: [...this.frames] };
  }
}

/** Ghostens läge vid etapptiden t. Returnerar false när åket är slut. */
export function sampleGhost(g: GhostData, t: number, pos: Vector3, quat: Quaternion): boolean {
  const n = g.frames.length / STRIDE;
  const f = Math.max(0, t) * g.hz;
  const i = Math.floor(f);
  if (i >= n - 1) return false;
  const u = f - i;
  const a = i * STRIDE;
  const b = a + STRIDE;
  const F = g.frames;
  pos.set(F[a]! + (F[b]! - F[a]!) * u, F[a + 1]! + (F[b + 1]! - F[a + 1]!) * u, F[a + 2]! + (F[b + 2]! - F[a + 2]!) * u);
  quat.set(F[a + 3]!, F[a + 4]!, F[a + 5]!, F[a + 6]!);
  const qx = F[b + 3]!;
  const qy = F[b + 4]!;
  const qz = F[b + 5]!;
  const qw = F[b + 6]!;
  // Interpolera linjärt och normalisera; vid 20 Hz är skillnaden mot slerp osynlig.
  const sign = quat.x * qx + quat.y * qy + quat.z * qz + quat.w * qw < 0 ? -1 : 1;
  quat.set(
    quat.x + (sign * qx - quat.x) * u,
    quat.y + (sign * qy - quat.y) * u,
    quat.z + (sign * qz - quat.z) * u,
    quat.w + (sign * qw - quat.w) * u,
  ).normalize();
  return true;
}
