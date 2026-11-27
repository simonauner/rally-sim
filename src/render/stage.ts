import * as THREE from 'three/webgpu';
import { STAGE_CORRIDOR, START_S, type Stage } from '../physics/stage';
import { rng } from '../physics/rng';
import { COLORS } from './terrain';
import { buildLandmarks } from './landmarks';

const VERGE = 0x6f5a3e;
const FOREST = 0x6f7d4c;
/** Åker i sensommar, klippt gräs på gårdstomter, myrens starr och kalhyggets ris. */
const AREA: Record<string, number> = { field: 0xaaa65c, farm: 0x86a04e, bog: 0xa09a64, clearcut: 0x8b7a52 };
/** Snötäckt skogsmark på vinteretapper. */
const WINTER_FOREST = 0xf2f5f7;
const BANK_SHADE = 0xaab9cd;
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
  const forest = stage.def.winter ? WINTER_FOREST : FOREST;
  let count = 0;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * STEP;
      const z = z0 + j * STEP;
      const { d, width, surface, s, side: lr } = stage.roadAt(x, z, STAGE_CORRIDOR);
      if (d > STAGE_CORRIDOR) continue;
      const hw = width / 2;
      const area = stage.def.winter ? null : stage.areaAt(s, lr);
      road.setHex(COLORS[surface]!);
      side.setHex(stage.def.winter ? COLORS.snowbank! : surface === 'snow' ? COLORS.snow! : VERGE).lerp(c.setHex(forest), smooth(hw + 2, hw + 6, d));
      if (area && area.lm.kind !== 'lake') side.lerp(c.setHex(AREA[area.lm.kind]!), area.t * smooth(hw + 3, hw + 7, d));
      c.copy(road).lerp(side, smooth(hw - 0.2, hw + 0.4, d)).multiplyScalar(0.93 + rand() * 0.14);
      // Snövallens insida mot vägen ligger i blå skugga, som i lågt vintersolljus.
      if (stage.def.winter) c.lerp(side.setHex(BANK_SHADE), 0.9 * smooth(hw + 0.1, hw + 0.7, d) * (1 - smooth(hw + 1.3, hw + 1.9, d)));
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

  group.add(buildTracks(stage));

  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
    new THREE.MeshToonMaterial({ color: forest }),
  );
  outer.position.set((minX + maxX) / 2, minY - 3, (minZ + maxZ) / 2);
  outer.receiveShadow = true;
  group.add(outer);

  group.add(buildWater(stage));
  group.add(buildLandmarks(stage));

  // Kantpinnar var 25:e meter
  const sideOf = (s: number) => {
    const p = stage.poseAt(s);
    // Vänster om färdriktningen: heading 0 = +Z, vänster = +X.
    return { ...p, lx: Math.cos(p.heading), lz: -Math.sin(p.heading) };
  };
  const mat = new THREE.Matrix4();
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6);
  const nPoles = Math.floor(stage.length / 25) * 2;
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshToonMaterial({ color: stage.def.winter ? 0xd8432f : 0xffffff }), nPoles);
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
  [START_S, stage.finish].forEach((s, n) => {
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

  // Skog längs vägen (placerad i fysiken, där stammarna kolliderar)
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8);
  const trees = stage.trunks.filter((t) => !t.hidden);
  const N = trees.length;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshToonMaterial({ color: 0x6b4a32 }), N);
  // Kronan som kon(er) runt stammen: y = konens mitt, i trädets skala. Vintergranar har tre
  // våningar med snö ovanpå varje, så grönt syns i kanterna och undertill.
  const tiers = stage.def.winter
    ? [
        { r: 1.7, h: 2.6, y: 3.2 },
        { r: 1.25, h: 2.2, y: 4.4 },
        { r: 0.8, h: 1.8, y: 5.6 },
      ]
    : [{ r: 1.6, h: 4.5, y: 4.2 }];
  const green = new THREE.MeshToonMaterial({ color: 0x4f7a4a });
  const snowMat = new THREE.MeshToonMaterial({ color: 0xeef2f5 });
  const layers: { mesh: THREE.InstancedMesh; y: number }[] = [];
  for (const t of tiers) {
    layers.push({ mesh: new THREE.InstancedMesh(new THREE.ConeGeometry(t.r, t.h, 9), green, N), y: t.y });
    if (stage.def.winter) {
      // Snöhättan har samma lutning som grenverket och spetsen lite ovanför det.
      const k = 0.8;
      layers.push({ mesh: new THREE.InstancedMesh(new THREE.ConeGeometry(t.r * k * 1.05, t.h * k, 9), snowMat, N), y: t.y + t.h / 2 + 0.06 - (t.h * k) / 2 });
    }
  }
  const scale = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tr = rng(47);
  trees.forEach((t, i) => {
    scale.setScalar(t.scale);
    q.setFromAxisAngle(up, tr() * Math.PI * 2);
    pos.set(t.x, t.y + 1.1 * t.scale, t.z);
    trunks.setMatrixAt(i, mat.compose(pos, q, scale));
    for (const l of layers) {
      pos.set(t.x, t.y + l.y * t.scale, t.z);
      l.mesh.setMatrixAt(i, mat.compose(pos, q, scale));
    }
  });
  trunks.castShadow = true;
  group.add(trunks);
  for (const l of layers) {
    l.mesh.castShadow = true;
    group.add(l.mesh);
  }

  // Buskar, tuvor och stenar nära vägkanten som susar förbi (bara grafik, ingen kollision).
  const snowy = stage.surfaces.includes('snow');
  const kinds = [
    { geo: new THREE.IcosahedronGeometry(0.7, 0), color: snowy ? 0x8a9a86 : 0x5c7a3e, every: 3, near: 1.0, far: 6.5, size: [0.6, 1.4] },
    { geo: new THREE.ConeGeometry(0.25, 0.6, 5), color: snowy ? 0xb8b6a0 : 0x8f9a4c, every: 1.6, near: 0.5, far: 3.5, size: [0.6, 1.3] },
    { geo: new THREE.DodecahedronGeometry(0.35, 0), color: 0x8a857c, every: 7, near: 0.6, far: 4, size: [0.4, 1.2] },
  ];
  const r = rng(23);
  for (const k of kinds) {
    const n = Math.floor(stage.length / k.every) * 2;
    const inst = new THREE.InstancedMesh(k.geo, new THREE.MeshToonMaterial({ color: k.color }), n);
    let ki = 0;
    for (let s = 0; s < stage.length && ki < n - 1; s += k.every) {
      const p = sideOf(s + r() * k.every);
      if (stage.project(p.x, p.z).surface === 'water') continue; // inga buskar i bäcken
      const hw = stage.project(p.x, p.z).width / 2;
      for (const side of [-1, 1]) {
        const off = (hw + k.near + r() * (k.far - k.near)) * side;
        const x = p.x + p.lx * off;
        const z = p.z + p.lz * off;
        if (stage.roadAt(x, z).d < hw + k.near - 0.1) continue; // inte på en korsande väg
        scale.set(1, 0.6 + r() * 0.5, 1).multiplyScalar(k.size[0]! + r() * (k.size[1]! - k.size[0]!));
        q.setFromAxisAngle(pos.set(0, 1, 0), r() * Math.PI * 2);
        pos.set(x, stage.heightAt(x, z) + 0.1 * scale.y, z);
        inst.setMatrixAt(ki++, mat.compose(pos, q, scale));
      }
    }
    inst.count = ki;
    inst.castShadow = k.every > 2;
    group.add(inst);
  }
  return group;
}

/**
 * Vattenytan i varje vadställe: en rektangel tvärs över vägen, en bit över stenbotten, så hjulen
 * försvinner ner i vattnet. Bäckfåran utanför vägen är samma sänka i terrängen.
 */
function buildWater(stage: Stage): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: 0x4f8fa8, transparent: true, opacity: 0.78 });
  for (let i = 0; i < stage.surfaces.length; i++) {
    if (stage.surfaces[i] !== 'water' || stage.surfaces[i - 1] === 'water') continue;
    let j = i;
    let y = Infinity;
    while (stage.surfaces[j + 1] === 'water') y = Math.min(y, stage.ys[j++]!);
    const mid = stage.poseAt((i + j) / 2);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(18, j - i + 12).rotateX(-Math.PI / 2), mat);
    plane.position.set(mid.x, Math.min(y, stage.ys[j]!) + 0.3, mid.z);
    plane.rotation.y = mid.heading;
    plane.receiveShadow = true;
    group.add(plane);
    i = j;
  }
  return group;
}

/** Hjulspårens färg per underlag: packad snö blir beigegrå, grus och lera mörkare där stenarna sopats undan. */
const TRACK: Record<string, (c: THREE.Color) => THREE.Color> = {
  snow: (c) => c.setHex(0xd3cbbb),
  gravel: (c) => c.setHex(COLORS.gravel!).multiplyScalar(0.82),
  mud: (c) => c.setHex(COLORS.mud!).multiplyScalar(0.78),
  asphalt: (c) => c.setHex(COLORS.asphalt!).multiplyScalar(0.88),
  water: (c) => c.setHex(COLORS.water!).multiplyScalar(0.85),
};

/** Två hjulspår längs etappens mitt, som vandrar lite i sidled och varierar i bredd och ton. */
function buildTracks(stage: Stage): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const r = rng(31);
  const STEP_S = 1.5;
  let rows = 0;
  for (let s = 0; s <= stage.length; s += STEP_S) {
    const i = Math.min(stage.xs.length - 1, Math.round(s));
    const p = stage.poseAt(s);
    const lx = Math.cos(p.heading);
    const lz = -Math.sin(p.heading);
    const y = stage.ys[i]! + 0.02;
    const drift = 0.25 * Math.sin(s * 0.013 + 1.3) + 0.08 * Math.sin(s * 0.051);
    const half = 0.17 + 0.04 * Math.sin(s * 0.09);
    TRACK[stage.surfaces[i]!]!(c).multiplyScalar(0.95 + r() * 0.1);
    for (const side of [-1, 1]) {
      const mid = drift + side * (0.74 + 0.04 * Math.sin(s * 0.07 + side));
      for (const o of [mid - half, mid + half]) {
        positions.push(p.x + lx * o, y, p.z + lz * o);
        colors.push(c.r, c.g, c.b);
      }
    }
    if (rows > 0) {
      const a = (rows - 1) * 4;
      const b = rows * 4;
      for (const k of [0, 2]) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
    }
    rows++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.receiveShadow = true;
  return mesh;
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
