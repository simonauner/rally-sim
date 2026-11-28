import { Quaternion, Vector3 } from 'three';
import type { Car } from './car';
import type { World } from './world';

export interface DamageEvent {
  /** Träffpunkt i kroppens lokala koordinater. */
  local: Vector3;
  /** Riktningen kroppen trycks undan, lokalt. */
  normal: Vector3;
  /** Impuls (Ns). */
  impulse: number;
  kind: 'object' | 'ground';
}

interface Contact {
  r: Vector3;
  rLocal: Vector3;
  n: Vector3;
  depth: number;
  lambda: number;
  tangent: Vector3;
  vTarget: number;
  denomN: number;
  mu: number;
  kind: 'object' | 'ground';
}

const tmpV = new Vector3();
const tmpW = new Vector3();
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpQ = new Quaternion();
const tmpL = new Vector3();

function invMassTerm(car: Car, r: Vector3, n: Vector3): number {
  // 1/m + n · ((I^-1 (r × n)) × r)
  tmpA.crossVectors(r, n);
  car.invInertiaWorld(tmpA, tmpB);
  tmpC.crossVectors(tmpB, r);
  return 1 / car.params.mass + n.dot(tmpC);
}

/** Sekventiell-impuls-lösare mot marken (underrede, tak) och statiska boxar. */
export function collide(car: Car, world: World, dt: number) {
  const contacts: Contact[] = [];
  const pw = new Vector3();
  const n = new Vector3();

  for (const lp of car.collisionPoints) {
    pw.copy(lp).applyQuaternion(car.quat).add(car.pos);

    const h = world.heightAt(pw.x, pw.z);
    if (pw.y < h) {
      world.normalAt(pw.x, pw.z, n);
      pushContact(car, contacts, lp, pw, n, h - pw.y, 0.6, 'ground');
    }

    for (const b of world.boxes) {
      if (pw.x < b.minX || pw.x > b.maxX || pw.y < b.minY || pw.y > b.maxY || pw.z < b.minZ || pw.z > b.maxZ) continue;
      // Minsta penetrationen avgör ytnormalen.
      const d = [pw.x - b.minX, b.maxX - pw.x, pw.y - b.minY, b.maxY - pw.y, pw.z - b.minZ, b.maxZ - pw.z];
      let k = 0;
      for (let i = 1; i < 6; i++) if (d[i]! < d[k]!) k = i;
      n.set(0, 0, 0);
      if (k === 0) n.x = -1;
      else if (k === 1) n.x = 1;
      else if (k === 2) n.y = -1;
      else if (k === 3) n.y = 1;
      else if (k === 4) n.z = -1;
      else n.z = 1;
      pushContact(car, contacts, lp, pw, n, d[k]!, 0.4, 'object');
    }
  }
  collideTrunks(car, world, contacts);
  if (contacts.length === 0) return;

  for (const c of contacts) {
    c.denomN = invMassTerm(car, c.r, c.n);
    const vn = car.pointVelocity(c.r, tmpV).dot(c.n);
    const closing = -vn;
    const bounce = closing > 1.5 ? 0.15 * (closing - 1.5) : 0;
    const bias = Math.min(2, Math.max(0, (0.12 * (c.depth - 0.005)) / dt));
    c.vTarget = bounce + bias;
  }

  const fric = new Map<Contact, Vector3>();
  for (let iter = 0; iter < 8; iter++) {
    for (const c of contacts) {
      const vp = car.pointVelocity(c.r, tmpV);
      const vn = vp.dot(c.n);
      const dl = (c.vTarget - vn) / c.denomN;
      const next = Math.max(0, c.lambda + dl);
      const d = next - c.lambda;
      c.lambda = next;
      if (d !== 0) car.applyImpulse(tmpW.copy(c.n).multiplyScalar(d), c.r);

      // Friktion
      const vt = car.pointVelocity(c.r, tmpV);
      vt.addScaledVector(c.n, -vt.dot(c.n));
      const len = vt.length();
      if (len > 1e-5 && c.lambda > 0) {
        tmpW.copy(vt).multiplyScalar(-1 / len);
        const dn = invMassTerm(car, c.r, tmpW);
        let acc = fric.get(c);
        if (!acc) {
          acc = new Vector3();
          fric.set(c, acc);
        }
        const want = tmpB.copy(acc).addScaledVector(tmpW, len / dn);
        const cap = c.mu * c.lambda;
        if (want.length() > cap) want.setLength(cap);
        const delta = want.clone().sub(acc);
        acc.copy(want);
        car.applyImpulse(delta, c.r);
      }
    }
  }

  // Tryck ut kroppen ur djupa penetrationer.
  let deepest: Contact | null = null;
  for (const c of contacts) if (!deepest || c.depth > deepest.depth) deepest = c;
  if (deepest && deepest.depth > 0.04) car.pos.addScaledVector(deepest.n, (deepest.depth - 0.02) * 0.6);

  for (const c of contacts) {
    if (c.lambda < 250) continue;
    const localN = c.n.clone().applyQuaternion(car.quatInv.copy(car.quat).invert());
    car.damageEvents.push({ local: c.rLocal.clone(), normal: localN, impulse: c.lambda, kind: c.kind });
    car.registerDamage(c.rLocal, c.lambda, c.kind);
  }
}

/**
 * Trädstammar mot karossen sedd uppifrån som en rektangel. Stammarna är smalare än avståndet
 * mellan kollisionspunkterna, så punkterna räcker inte.
 */
function collideTrunks(car: Car, world: World, contacts: Contact[]) {
  const b = car.params.body;
  const cz = b.centerZ ?? 0;
  const reach = Math.hypot(b.halfX, b.halfZ + Math.abs(cz)) + 1;
  const inv = tmpQ.copy(car.quat).invert();
  for (const t of world.trunks) {
    if (Math.abs(t.x - car.pos.x) > reach || Math.abs(t.z - car.pos.z) > reach) continue;
    // Stammens mitt i bilens ram (lutningen ignoreras; stammen är lodrät och hög).
    // Relative to the box centre, which may sit offset along the car.
    const c = tmpL.set(t.x - car.pos.x, 0, t.z - car.pos.z).applyQuaternion(inv);
    c.z -= cz;
    const px = Math.min(b.halfX, Math.max(-b.halfX, c.x));
    const pz = Math.min(b.halfZ, Math.max(-b.halfZ, c.z));
    const dx = px - c.x;
    const dz = pz - c.z;
    const dist = Math.hypot(dx, dz);
    let depth: number;
    const n = new Vector3();
    const lp = new Vector3(px, (b.bottomY + b.topY) / 2, pz);
    if (dist > 1e-6) {
      if (dist >= t.r) continue;
      depth = t.r - dist;
      n.set(dx / dist, 0, dz / dist);
    } else if (b.halfX - Math.abs(c.x) < b.halfZ - Math.abs(c.z)) {
      // Stammens mitt är inne i karossen: ut genom närmaste sida.
      const sx = Math.sign(c.x) || 1;
      depth = b.halfX - Math.abs(c.x) + t.r;
      n.set(-sx, 0, 0);
      lp.x = sx * b.halfX;
    } else {
      const sz = Math.sign(c.z) || 1;
      depth = b.halfZ - Math.abs(c.z) + t.r;
      n.set(0, 0, -sz);
      lp.z = sz * b.halfZ;
    }
    lp.z += cz;
    n.applyQuaternion(car.quat);
    n.y = 0;
    n.normalize();
    const pw = lp.clone().applyQuaternion(car.quat).add(car.pos);
    pushContact(car, contacts, lp, pw, n, depth, 0.4, 'object');
  }
}

function pushContact(car: Car, out: Contact[], lp: Vector3, pw: Vector3, n: Vector3, depth: number, mu: number, kind: 'object' | 'ground') {
  out.push({
    r: pw.clone().sub(car.pos),
    rLocal: lp.clone(),
    n: n.clone(),
    depth,
    lambda: 0,
    tangent: new Vector3(),
    vTarget: 0,
    denomN: 1,
    mu,
    kind,
  });
}
