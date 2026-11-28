import * as THREE from 'three/webgpu';
import type { CarParams } from '../physics/params';

/** Genomskinlig förenklad kaross för ghosten: syns men skymmer inte vägen. */
export function buildGhostMesh(p: CarParams): THREE.Group {
  const { halfX, halfZ, bottomY, centerZ = 0 } = p.body;
  const mat = new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.35, depthWrite: false });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(halfX * 2, 0.55, halfZ * 2), mat);
  lower.position.set(0, bottomY + 0.275, centerZ);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(halfX * 1.6, 0.5, halfZ * 0.95), mat);
  cabin.position.set(0, bottomY + 0.55 + 0.25, centerZ - 0.2);
  const g = new THREE.Group();
  g.add(lower, cabin);
  g.visible = false;
  return g;
}
