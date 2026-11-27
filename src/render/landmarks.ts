import * as THREE from 'three/webgpu';
import { HOUSE_SIZE, type Prop, type Stage } from '../physics/stage';
import { rng } from '../physics/rng';

const FALU_RED = 0x8b2b1f;
const WHITE = 0xf2efe6;

/** Prisma med triangulär gavel: bredd 1 i x, höjd 1, längd 1 i z, botten i y = 0. */
function gable(): THREE.BufferGeometry {
  const v = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, 0.5];
  const f = [0, 2, 1, 3, 5, 4, 0, 3, 4, 0, 4, 2, 1, 2, 4, 1, 4, 5, 0, 1, 5, 0, 5, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(f);
  const out = g.toNonIndexed();
  out.computeVertexNormals();
  return out;
}

/** Instanser av en geometri, en per matris. */
function instances(geo: THREE.BufferGeometry, color: number, mats: THREE.Matrix4[], shadow = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshToonMaterial({ color }), Math.max(1, mats.length));
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = mats.length;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

const up = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
/** Matris för en del i propens ram: förskjuten (x, y, z) lokalt, roterad med yaw och ev. extra rotation. */
function part(p: Prop, x: number, y: number, z: number, sx: number, sy: number, sz: number, extra?: THREE.Quaternion) {
  q.setFromAxisAngle(up, p.yaw);
  pos.set(x, y, z).applyQuaternion(q).add(new THREE.Vector3(p.x, p.y, p.z));
  if (extra) q.multiply(extra);
  return new THREE.Matrix4().compose(pos, q, scl.set(sx, sy, sz));
}

/**
 * Landmärkena ur kartdatan: sjöar och åar, röda gårdar med vita knutar, gärdsgårdar och
 * ensilagebalar på åkrarna, myrar med låga tallar, kalhyggen med stubbar, kraftledningar och
 * broräcken, och publik vid krönet.
 */
export function buildLandmarks(stage: Stage): THREE.Group {
  const group = new THREE.Group();
  const winter = !!stage.def.winter;
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // Isen är blågrå, så de frusna sjöarna syns mot snön.
  const waterMat = new THREE.MeshToonMaterial({ color: winter ? 0xa9c2d2 : 0x47809b, side: THREE.DoubleSide });
  const hwAt = (s: number) => stage.widths[Math.min(stage.xs.length - 1, Math.max(0, Math.round(s)))]! / 2;
  const beside = (s: number, off: number) => {
    const p = stage.poseAt(s);
    return { x: p.x + Math.cos(p.heading) * off, z: p.z - Math.sin(p.heading) * off, heading: p.heading };
  };

  // Sjöar: ett band av vatten längs vägen ut till horisonten; terrängen ovanför vattnet skymmer kanten.
  for (const lm of stage.landmarks) {
    if (lm.kind !== 'lake') continue;
    const y = stage.lakeLevel.get(lm)!;
    const v: number[] = [];
    const idx: number[] = [];
    for (let s = lm.from; s <= lm.to + 0.1; s += 4) {
      for (const off of [hwAt(s) + 5, 160]) {
        const p = beside(s, lm.side * off);
        v.push(p.x, y, p.z);
      }
      const n = v.length / 3;
      if (n >= 4) idx.push(n - 4, n - 2, n - 3, n - 3, n - 2, n - 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, waterMat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Åar under broarna: vattnet ligger i fåran tvärs över vägen.
  for (const lm of stage.landmarks) {
    if (lm.kind !== 'bridge') continue;
    const p = stage.poseAt(lm.from);
    const river = new THREE.Mesh(new THREE.PlaneGeometry(120, 11).rotateX(-Math.PI / 2), waterMat);
    river.position.set(p.x, stage.ys[Math.round(lm.from)]! - 1.8, p.z);
    river.rotation.y = p.heading;
    river.receiveShadow = true;
    group.add(river);
  }

  const mats: Record<string, THREE.Matrix4[]> = {};
  const add = (key: string, m: THREE.Matrix4) => (mats[key] ??= []).push(m);

  // Myrar med glesa, låga tallar och kalhyggen med stubbar (bara grafik, ingen kollision).
  const scatter = rng(83);
  for (const lm of stage.landmarks) {
    if (lm.kind !== 'bog' && lm.kind !== 'clearcut') continue;
    const every = lm.kind === 'bog' ? 9 : 2.2;
    for (let s = lm.from; s < lm.to; s += every) {
      const p = beside(s, lm.side * (hwAt(s) + 7 + scatter() * 36));
      const h = stage.roadAt(p.x, p.z);
      if (h.d < h.width / 2 + 6) continue;
      const y = stage.heightAt(p.x, p.z);
      const yaw = scatter() * Math.PI * 2;
      if (lm.kind === 'bog') {
        const k = 0.35 + scatter() * 0.3;
        add('dwarfTrunk', new THREE.Matrix4().compose(pos.set(p.x, y, p.z), q.setFromAxisAngle(up, yaw), scl.set(k, k * 2.5, k)));
        add('dwarfCrown', new THREE.Matrix4().compose(pos.set(p.x, y + k * 2.2, p.z), q, scl.setScalar(k * 1.6)));
      } else {
        const k = 0.8 + scatter() * 0.5;
        add('stump', new THREE.Matrix4().compose(pos.set(p.x, y - 0.05, p.z), q.setFromAxisAngle(up, yaw), scl.set(k, k, k)));
        if (scatter() < 0.12) add('slash', new THREE.Matrix4().compose(pos.set(p.x, y - 0.1, p.z), q, scl.set(2.5 + scatter() * 2, 0.7, 1.2)));
      }
    }
  }
  const tilt = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
  const lying = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const wires: { x: number; z: number; y: number; heading: number }[] = [];
  for (const p of stage.props) {
    if (p.kind === 'house' || p.kind === 'barn') {
      const [hx, hz, wall] = HOUSE_SIZE[p.kind];
      add('wall', part(p, 0, -1, 0, hx * 2, wall + 1, hz * 2));
      // Taknocken längs husets långsida (x), med takfoten lite utanför väggarna.
      add(p.kind === 'barn' ? 'barnRoof' : 'roof', part(p, 0, wall, 0, hz * 2 + 0.6, p.kind === 'barn' ? 3.2 : 2.4, hx * 2 + 0.6, new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2)));
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) add('trim', part(p, cx * (hx - 0.1), -1, cz * (hz - 0.1), 0.3, wall + 1.05, 0.3));
      if (p.kind === 'house') {
        // Vita fönster på långsidorna och en dörr.
        for (const side of [-1, 1]) for (const wx of [-2.6, 0, 2.6]) add('trim', part(p, wx, 1.1, side * (hz + 0.01), 0.9, 1.0, 0.06));
        add('door', part(p, 1.3, 0, -(hz + 0.02), 0.9, 2.0, 0.06));
      } else {
        add('trim', part(p, 0, 0, -(hz + 0.02), 3.2, 3.4, 0.08));
        add('wall', part(p, 0, 0.15, -(hz + 0.05), 2.8, 3.1, 0.08));
      }
    } else if (p.kind === 'fence') {
      // Gärdsgård: lutande slanor mellan par av stör.
      add('fencePost', part(p, 0, 0, 0, 0.09, 1.3, 0.09));
      add('fenceSlat', part(p, 0, 0.55, 0, 0.07, 0.07, 2.9, tilt(-0.5)));
    } else if (p.kind === 'bale') {
      add('bale', part(p, 0, 0.75, 0, 1, 1, 1, lying));
    } else if (p.kind === 'pylon') {
      add('pylon', part(p, 0, 0, 0, 1, 1, 1));
      add('steel', part(p, 0, 15, 0, 0.4, 0.5, 12));
      wires.push({ x: p.x, z: p.z, y: p.y + 14.8, heading: p.yaw });
    } else if (p.kind === 'rail') {
      add('railPost', part(p, 0, 0, 0, 0.14, 0.95, 0.14));
      add('rail', part(p, 0, 0.7, 0, 0.08, 0.28, 1.45));
    }
  }
  const pylonGeo = new THREE.CylinderGeometry(0.25, 1.5, 15.5, 4).rotateY(Math.PI / 4).translate(0, 7.75, 0);
  const prism = gable();
  const bale = new THREE.CylinderGeometry(0.75, 0.75, 1.25, 14);
  const look: Record<string, [THREE.BufferGeometry, number]> = {
    wall: [box, FALU_RED],
    roof: [prism, winter ? 0xf1f4f6 : 0x3b3936],
    barnRoof: [prism, winter ? 0xf1f4f6 : 0x5d6266],
    trim: [box, WHITE],
    door: [box, 0x5a4636],
    fencePost: [box, 0x857a68],
    fenceSlat: [box, 0x9a8f7a],
    bale: [bale, 0xeeeee8],
    pylon: [pylonGeo, 0x8f969c],
    steel: [box, 0x8f969c],
    railPost: [box, 0x4a4a48],
    rail: [box, 0xa9adb0],
    dwarfTrunk: [new THREE.CylinderGeometry(0.15, 0.2, 1, 6).translate(0, 0.5, 0), 0x6b4a32],
    dwarfCrown: [new THREE.ConeGeometry(0.8, 1.8, 7).translate(0, 0.6, 0), winter ? 0x5d7c58 : 0x4f6e48],
    stump: [new THREE.CylinderGeometry(0.28, 0.33, 0.45, 7).translate(0, 0.22, 0), winter ? 0xe9eef1 : 0x9a7c58],
    slash: [new THREE.DodecahedronGeometry(0.6, 0).translate(0, 0.3, 0), winter ? 0xe4eaee : 0x7a6a4a],
  };
  for (const [key, list] of Object.entries(mats)) group.add(instances(look[key]![0], look[key]![1], list, key !== 'fenceSlat'));

  // Ledningarna: tre linor från tvärslån, tvärs över vägen och ut i skogen.
  const wireMat = new THREE.MeshToonMaterial({ color: 0x2f3134 });
  const wireGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 4).rotateX(Math.PI / 2);
  for (const w of wires) {
    const fx = Math.sin(w.heading);
    const fz = Math.cos(w.heading);
    for (const k of [-5, 0, 5]) {
      const mesh = new THREE.Mesh(wireGeo, wireMat);
      mesh.position.set(w.x + fx * k, w.y + (k === 0 ? 0.6 : 0), w.z + fz * k);
      mesh.rotation.y = w.heading + Math.PI / 2;
      mesh.scale.set(1, 1, 260);
      group.add(mesh);
    }
  }

  // Publiken vid krönet: bakom avspärrningsband på båda sidor, mest före krönet där bilarna hoppar.
  const r = rng(73);
  const jackets = [0xc62828, 0x1565c0, 0xf9a825, 0x2e7d32, 0x37474f, 0xef6c00, 0xffffff, 0x6a1b9a];
  for (const lm of stage.landmarks) {
    if (lm.kind !== 'crest') continue;
    const people: THREE.Matrix4[][] = jackets.map(() => []);
    const heads: THREE.Matrix4[] = [];
    const tape: THREE.Matrix4[] = [];
    const flags: THREE.Matrix4[] = [];
    for (const side of [-1, 1]) {
      for (let s = lm.from - 50; s <= lm.from + 20; s += 3) {
        const p = beside(s, side * (hwAt(s) + 4.5));
        const y = stage.heightAt(p.x, p.z);
        tape.push(new THREE.Matrix4().compose(pos.set(p.x, y, p.z), q.setFromAxisAngle(up, p.heading), scl.set(0.06, 1.0, 0.06)));
        tape.push(new THREE.Matrix4().compose(pos.set(p.x, y + 0.9, p.z), q, scl.set(0.04, 0.08, 3)));
      }
      for (let n = 0; n < 45; n++) {
        const s = lm.from - 45 + r() * 60;
        const p = beside(s, side * (hwAt(s) + 6 + r() * 8));
        const y = stage.heightAt(p.x, p.z);
        const h = 0.9 + r() * 0.25;
        q.setFromAxisAngle(up, p.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (r() - 0.5));
        people[Math.floor(r() * jackets.length)]!.push(new THREE.Matrix4().compose(pos.set(p.x, y, p.z), q, scl.set(0.5, h, 0.32)));
        heads.push(new THREE.Matrix4().compose(pos.set(p.x, y + h + 0.17, p.z), q, scl.set(1, 1, 1)));
      }
      for (const ds of [-30, -8, 12]) {
        const p = beside(lm.from + ds, side * (hwAt(lm.from + ds) + 9));
        flags.push(new THREE.Matrix4().compose(pos.set(p.x, stage.heightAt(p.x, p.z), p.z), q.setFromAxisAngle(up, p.heading + Math.PI / 2), scl.set(1, 1, 1)));
      }
    }
    jackets.forEach((c, i) => group.add(instances(box, c, people[i]!)));
    group.add(instances(new THREE.SphereGeometry(0.15, 8, 6), 0xe0b899, heads));
    // Avspärrningsband i rött och vitt.
    group.add(instances(box, 0xd32f2f, tape.filter((_, i) => i % 4 < 2), false));
    group.add(instances(box, WHITE, tape.filter((_, i) => i % 4 >= 2), false));
    group.add(instances(new THREE.BoxGeometry(0.08, 5, 0.08).translate(0, 2.5, 0), 0x3b3b3b, flags));
    group.add(instances(new THREE.BoxGeometry(0.03, 0.9, 1.4).translate(0, 4.4, 0.72), 0x1565c0, flags));
    group.add(instances(new THREE.BoxGeometry(0.035, 0.18, 1.4).translate(0, 4.4, 0.72), 0xf9c80e, flags));
  }
  return group;
}
