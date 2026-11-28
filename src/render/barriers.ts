import * as THREE from 'three/webgpu';
import type { Barriers } from '../physics/barriers';

const COLORS = { post: 0x2b2b2b, red: 0xd32f2f, white: 0xf5f5f5 };

/** The barrier parts, which follow the physics in physics/barriers.ts. */
export function buildBarriers(barriers: Barriers) {
  const group = new THREE.Group();
  const mats = Object.fromEntries(Object.entries(COLORS).map(([k, color]) => [k, new THREE.MeshToonMaterial({ color })]));
  const meshes = barriers.parts.map((p) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.size.x, p.size.y, p.size.z), mats[p.color]);
    m.castShadow = true;
    group.add(m);
    return m;
  });
  const update = () =>
    barriers.parts.forEach((p, i) => {
      meshes[i]!.position.copy(p.pos);
      meshes[i]!.quaternion.copy(p.quat);
    });
  update();
  return { group, update };
}
