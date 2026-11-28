import * as THREE from 'three/webgpu';
import { rng } from '../physics/rng';
import { SURFACES } from '../physics/surfaces';
import type { World } from '../physics/world';

export const COLORS: Record<string, number> = {
  gravel: 0xb89f78,
  asphalt: 0x44464c,
  mud: 0x5f4532,
  // Packed road snow is greyer than the loose snow in the banks.
  snow: 0xe3e6e7,
  snowbank: 0xfafcfd,
  // Stone bed in fords, below the water surface.
  water: 0x5d6660,
};

export function buildTerrain(world: World): THREE.Group {
  const group = new THREE.Group();

  // Detailed area where the physics happens
  const x0 = -70;
  const x1 = 70;
  const z0 = -60;
  const z1 = 300;
  const step = 0.6;
  const nx = Math.round((x1 - x0) / step);
  const nz = Math.round((z1 - z0) / step);
  const verts = (nx + 1) * (nz + 1);
  const positions = new Float32Array(verts * 3);
  const colors = new Float32Array(verts * 3);
  const c = new THREE.Color();
  const rand = rng(7);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const k = j * (nx + 1) + i;
      positions.set([x, world.heightAt(x, z), z], k * 3);
      const surf = world.surfaceAt(x, z);
      c.setHex(COLORS[surf]!);
      const n = 0.93 + rand() * 0.14;
      c.multiplyScalar(n);
      colors.set([c.r, c.g, c.b], k * 3);
    }
  }
  const idx = new Uint32Array(nx * nz * 6);
  let q = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const d = a + (nx + 1);
      const e = d + 1;
      idx.set([a, d, b, b, d, e], q);
      q += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true }));
  ground.receiveShadow = true;
  group.add(ground);

  // Large plane outside
  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
    new THREE.MeshToonMaterial({ color: 0xa89a70 }),
  );
  outer.position.y = -0.4;
  outer.receiveShadow = true;
  group.add(outer);

  // Obstacles
  const wallMat = new THREE.MeshToonMaterial({ color: 0xcfcfc8 });
  for (const b of world.boxes) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ),
      wallMat,
    );
    m.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  // Striped warning bands on the wall
  const stripeMat = new THREE.MeshToonMaterial({ color: 0xe0a320 });
  for (let i = -38; i <= 38; i += 4) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.05), stripeMat);
    s.position.set(i, 0.7, 259.95);
    group.add(s);
  }

  // Distance posts every 20 metres give a sense of speed
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8);
  const poleCount = 2 * 17;
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshToonMaterial({ color: 0xffffff }), poleCount);
  const mat = new THREE.Matrix4();
  let pi = 0;
  for (let z = 0; z <= 320; z += 20) {
    for (const x of [-12, 12]) {
      if (pi >= poleCount) break;
      const zz = z + (z === 0 ? 0 : 0);
      mat.makeTranslation(x, world.heightAt(x, zz) + 0.7, zz);
      poles.setMatrixAt(pi++, mat);
    }
  }
  poles.count = pi;
  poles.castShadow = true;
  group.add(poles);

  // Clay trees around the area
  const r = rng(99);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8);
  const crownGeo = new THREE.ConeGeometry(1.6, 4.5, 9);
  const N = 220;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshToonMaterial({ color: 0x6b4a32 }), N);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshToonMaterial({ color: 0x4f7a4a }), N);
  const s = new THREE.Vector3();
  const qq = new THREE.Quaternion();
  const p = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    let x: number;
    let z: number;
    do {
      x = (r() - 0.5) * 260;
      z = -80 + r() * 420;
    } while (Math.abs(x) < 52 && z > -65 && z < 305);
    const k = 0.7 + r() * 0.9;
    s.set(k, k, k);
    const y = world.heightAt(x, z);
    p.set(x, y + 1.1 * k, z);
    trunks.setMatrixAt(i, mat.compose(p, qq, s));
    p.set(x, y + (2.2 + 2.0) * k, z);
    crowns.setMatrixAt(i, mat.compose(p, qq, s));
  }
  trunks.castShadow = true;
  crowns.castShadow = true;
  group.add(trunks, crowns);

  void SURFACES;
  return group;
}
