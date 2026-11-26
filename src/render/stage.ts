import * as THREE from 'three/webgpu';
import { FINISH_MARGIN, STAGE_CORRIDOR, START_S, type Stage } from '../physics/stage';
import { COLORS, rng } from './terrain';

const VERGE = 0x6f5a3e;
const FOREST = 0x6f7d4c;
const STEP = 0.75;

/**
 * Terräng för en etapp: ett rutnät över etappens omfång där bara hörn nära vägen behålls.
 * shortcut: vägar som kommer närmare sig själva än 2 × STAGE_CORRIDOR ger överlappande nät;
 * byt till ett band längs splinen om etapperna börjar få hårnålar.
 */
export function buildStage(stage: Stage): THREE.Group {
  const group = new THREE.Group();
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  for (let i = 0; i < stage.xs.length; i++) {
    minX = Math.min(minX, stage.xs[i]!);
    maxX = Math.max(maxX, stage.xs[i]!);
    minZ = Math.min(minZ, stage.zs[i]!);
    maxZ = Math.max(maxZ, stage.zs[i]!);
    minY = Math.min(minY, stage.ys[i]!);
  }
  const x0 = minX - STAGE_CORRIDOR;
  const z0 = minZ - STAGE_CORRIDOR;
  const nx = Math.ceil((maxX + STAGE_CORRIDOR - x0) / STEP);
  const nz = Math.ceil((maxZ + STAGE_CORRIDOR - z0) / STEP);

  const index = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
  const positions: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color();
  const road = new THREE.Color();
  const side = new THREE.Color();
  const rand = rng(11);
  let count = 0;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * STEP;
      const z = z0 + j * STEP;
      const { d, width, surface } = stage.roadAt(x, z, STAGE_CORRIDOR);
      if (d > STAGE_CORRIDOR) continue;
      const hw = width / 2;
      road.setHex(COLORS[surface]!);
      side.setHex(surface === 'snow' ? COLORS.snow! : VERGE).lerp(c.setHex(FOREST), smooth(hw + 2, hw + 6, d));
      c.copy(road).lerp(side, smooth(hw - 0.2, hw + 0.4, d)).multiplyScalar(0.93 + rand() * 0.14);
      positions.push(x, stage.heightAt(x, z), z);
      colors.push(c.r, c.g, c.b);
      index[j * (nx + 1) + i] = count++;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = index[j * (nx + 1) + i]!;
      const b = index[j * (nx + 1) + i + 1]!;
      const d = index[(j + 1) * (nx + 1) + i]!;
      const e = index[(j + 1) * (nx + 1) + i + 1]!;
      if (a >= 0 && b >= 0 && d >= 0 && e >= 0) idx.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true }));
  ground.receiveShadow = true;
  group.add(ground);

  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
    new THREE.MeshToonMaterial({ color: FOREST }),
  );
  outer.position.set((minX + maxX) / 2, minY - 3, (minZ + maxZ) / 2);
  outer.receiveShadow = true;
  group.add(outer);

  // Kantpinnar var 25:e meter
  const sideOf = (s: number) => {
    const p = stage.poseAt(s);
    // Vänster om färdriktningen: heading 0 = +Z, vänster = +X.
    return { ...p, lx: Math.cos(p.heading), lz: -Math.sin(p.heading) };
  };
  const mat = new THREE.Matrix4();
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6);
  const nPoles = Math.floor(stage.length / 25) * 2;
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshToonMaterial({ color: 0xffffff }), nPoles);
  let pi = 0;
  for (let s = 0; s < stage.length && pi < nPoles - 1; s += 25) {
    const p = sideOf(s);
    const hw = stage.project(p.x, p.z).width / 2 + 1.2;
    for (const k of [-1, 1]) {
      const x = p.x + p.lx * hw * k;
      const z = p.z + p.lz * hw * k;
      if (stage.roadAt(x, z).d < 4) continue; // inte mitt i en korsande väg
      poles.setMatrixAt(pi++, mat.makeTranslation(x, stage.heightAt(x, z) + 0.55, z));
    }
  }
  poles.count = pi;
  poles.castShadow = true;
  group.add(poles);

  // Start- och målportal (bara grafik, ingen kollision)
  const postMat = new THREE.MeshToonMaterial({ color: 0x2b2b2b });
  const bannerMats = [0x2e7d32, 0xc62828].map((color) => new THREE.MeshToonMaterial({ color }));
  const lineMat = new THREE.MeshToonMaterial({ color: 0xf5f5f5 });
  [START_S, stage.length - FINISH_MARGIN].forEach((s, n) => {
    const p = sideOf(s);
    const hw = stage.project(p.x, p.z).width / 2 + 0.8;
    const y = stage.heightAt(p.x, p.z);
    const gate = new THREE.Group();
    for (const k of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5, 0.25), postMat);
      post.position.set(hw * k, 2.5, 0);
      gate.add(post);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.25, 0.9, 0.15), bannerMats[n]);
    banner.position.y = 4.6;
    gate.add(banner);
    const line = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 - 1.4, 0.02, 0.4), lineMat);
    line.position.y = 0.01;
    gate.add(line);
    gate.position.set(p.x, y, p.z);
    gate.rotation.y = p.heading;
    gate.traverse((o) => (o.castShadow = true));
    group.add(gate);
  });

  // Avspärrning tvärs över varje korsande väg: stolpar med rödvitt band (bara grafik)
  const tapeMats = [0xd32f2f, 0xf5f5f5].map((color) => new THREE.MeshToonMaterial({ color }));
  for (const sp of stage.spurs) {
    const [a, b] = sp.points as [{ x: number; z: number }, { x: number; z: number }];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    // Så nära etappen som möjligt utan att stå på den.
    let t = 0;
    while (t < len && stage.project(a.x + dx * t, a.z + dz * t).d < stage.project(a.x, a.z).width / 2 + 2) t += 0.5;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    const barrier = new THREE.Group();
    const hw = sp.width / 2 + 0.6;
    for (const k of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), postMat);
      post.position.set(hw * k, 0.55, 0);
      barrier.add(post);
    }
    const n = Math.round(hw * 2);
    for (let i = 0; i < n; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry((hw * 2) / n, 0.12, 0.02), tapeMats[i % 2]);
      seg.position.set(-hw + ((i + 0.5) * hw * 2) / n, 0.95, 0);
      barrier.add(seg);
    }
    barrier.position.set(x, stage.heightAt(x, z), z);
    barrier.rotation.y = Math.atan2(dx, dz);
    barrier.traverse((o) => (o.castShadow = true));
    group.add(barrier);
  }

  // Skog längs vägen
  const r = rng(99);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8);
  const crownGeo = new THREE.ConeGeometry(1.6, 4.5, 9);
  const N = 2500;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshToonMaterial({ color: 0x6b4a32 }), N);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshToonMaterial({ color: 0x4f7a4a }), N);
  const scale = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  let ti = 0;
  for (let tries = 0; tries < N * 20 && ti < N; tries++) {
    const x = minX - STAGE_CORRIDOR + r() * (maxX - minX + 2 * STAGE_CORRIDOR);
    const z = minZ - STAGE_CORRIDOR + r() * (maxZ - minZ + 2 * STAGE_CORRIDOR);
    const { d, width } = stage.roadAt(x, z, STAGE_CORRIDOR);
    if (d < width / 2 + 7 || d > STAGE_CORRIDOR - 2) continue;
    const k = 0.7 + r() * 0.9;
    scale.set(k, k, k);
    const y = stage.heightAt(x, z);
    pos.set(x, y + 1.1 * k, z);
    trunks.setMatrixAt(ti, mat.compose(pos, q, scale));
    pos.set(x, y + (2.2 + 2.0) * k, z);
    crowns.setMatrixAt(ti, mat.compose(pos, q, scale));
    ti++;
  }
  trunks.count = ti;
  crowns.count = ti;
  trunks.castShadow = true;
  crowns.castShadow = true;
  group.add(trunks, crowns);
  return group;
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
