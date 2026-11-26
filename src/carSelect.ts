import * as THREE from 'three/webgpu';
import { toonOutlinePass } from 'three/tsl';
import type { CarDamage } from './career/championship';
import { showMenu } from './menu';
import { Car } from './physics/car';
import type { CarModel, CarParams } from './physics/params';
import { carSpecs, FlatWorld, type CarSpecs } from './physics/specs';
import { TYRE_NAMES } from './physics/surfaces';
import { CarMesh } from './render/carMesh';

const num = (x: number, digits = 0) => x.toLocaleString('sv-SE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const DRIVE = (p: CarParams) =>
  p.frontShare === 0 ? 'Bakhjulsdrift' : p.frontShare === 1 ? 'Framhjulsdrift' : 'Fyrhjulsdrift';

interface Row {
  k: string;
  /** Lång text när bilen visas ensam, kort när den jämförs. */
  full: string;
  short: string;
  /** Jämförbart tal och om högre är bättre; utan v färgas raden inte. */
  v?: number;
  more?: boolean;
}

function specRows(p: CarParams, s: CarSpecs): Row[] {
  const hp = s.powerKw * 1.36;
  const z = s.zeroTo100;
  return [
    { k: 'Motoreffekt', full: `${num(hp)} hk (${num(s.powerKw)} kW) vid ${num(s.powerRpm)} rpm`, short: `${num(hp)} hk`, v: hp, more: true },
    { k: 'Vridmoment', full: `${num(s.torqueNm)} Nm vid ${num(s.torqueRpm)} rpm`, short: `${num(s.torqueNm)} Nm`, v: s.torqueNm, more: true },
    { k: 'Vikt', full: `${num(p.mass)} kg · ${num(p.mass / hp, 1)} kg/hk`, short: `${num(p.mass)} kg`, v: p.mass, more: false },
    { k: 'Viktfördelning', full: `${num(s.frontWeight * 100)}/${num(100 - s.frontWeight * 100)} fram/bak`, short: `${num(s.frontWeight * 100)}/${num(100 - s.frontWeight * 100)}` },
    { k: 'Drivning', full: `${DRIVE(p)}, ${p.gearbox.ratios.length} växlar`, short: DRIVE(p) },
    { k: 'Däck', full: `${TYRE_NAMES[p.tyre]}, Ø ${num(p.wheelRadius * 200)} cm`, short: TYRE_NAMES[p.tyre] },
    { k: '0–100 km/h', full: Number.isNaN(z) ? 'når inte 100' : `${num(z, 1)} s på grus`, short: Number.isNaN(z) ? '–' : `${num(z, 1)} s`, v: Number.isNaN(z) ? undefined : z, more: false },
    { k: 'Toppfart', full: `${num(s.topSpeedKmh)} km/h`, short: `${num(s.topSpeedKmh)} km/h`, v: s.topSpeedKmh, more: true },
  ];
}

/** Grönt om bilen är bättre än den jämförda, rött om sämre; små skillnader räknas inte. */
function verdict(a: Row, b: Row): string {
  if (a.v === undefined || b.v === undefined || Math.abs(a.v - b.v) <= Math.abs(b.v) * 0.005) return '';
  return a.v > b.v === a.more ? 'ahead' : 'behind';
}

export interface PickOptions {
  title?: string;
  /** Läses om varje gång menyn visas, t.ex. kassan som ändras efter ett köp. */
  subtitle?: () => string;
  /**
   * Ersätter Kör: run öppnar en undermeny medan bilen står kvar på vridbordet, och sedan
   * visas bilväljaren igen med bilen byggd på nytt (t.ex. med nya uppgraderingar).
   * Returnerar run true stängs väljaren och bilen returneras.
   */
  action?: { label: string; run: (m: CarModel) => Promise<boolean | void> };
  /** Liten text bredvid bilnamnet, t.ex. priset. */
  detail?: (m: CarModel) => string;
  /** Bilar att jämföra med (t.ex. de man äger); värdena visas i en kolumn bredvid. */
  compare?: CarModel[];
}

export interface Showroom {
  /** Ställer bilen på vridbordet, med bucklor och snedställda hjul om den är skadad. */
  show(m: CarModel, damage?: CarDamage | null): void;
  /** Lagar bilen på vridbordet: hjulen rätas och bucklorna slätas ut. */
  repair(): void;
  close(): void;
}

/** Vridbordet bakom menyn: bilen snurrar sakta och går att vrida med musen. */
export function showroom(renderer: THREE.WebGPURenderer): Showroom {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe3ee);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const pipeline = new THREE.RenderPipeline(renderer, toonOutlinePass(scene, camera, new THREE.Color(0x1c1c24), 0.003));
  scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x8a7a5a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun, sun.target);
  const turntable = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.1, 64), new THREE.MeshToonMaterial({ color: 0x8f9396 }));
  turntable.receiveShadow = true;
  scene.add(turntable);
  const holder = new THREE.Group();
  scene.add(holder);

  // Kameran står till vänster om panelen, som ligger till höger.
  const resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    camera.aspect = w / h;
    camera.setViewOffset(w, h, w > 900 ? w * 0.19 : 0, 0, w, h);
  };
  resize();
  addEventListener('resize', resize);

  let center = new THREE.Vector3();
  let car: Car | null = null;
  let mesh: CarMesh | null = null;
  /** Sekunder kvar av en pågående lagning. */
  let healing = 0;
  // Låt bilen sätta sig på fjädringen så hjulen hamnar rätt.
  const settle = (c: Car) => {
    for (let i = 0; i < 480; i++) c.step(1 / 240, { throttle: 0, brake: 1, steer: 0, handbrake: 1 });
  };
  const show = (m: CarModel, damage?: CarDamage | null) => {
    car = new Car(m.make(), new FlatWorld('asphalt'));
    if (damage) {
      Object.assign(car.damage, damage.body);
      car.wheels.forEach((w, i) => (w.damage = damage.wheels[i] ?? 0));
    }
    settle(car);
    holder.clear();
    mesh = new CarMesh(car, m);
    mesh.addTo(holder);
    if (damage) mesh.dentFrom(damage.body);
    mesh.update();
    healing = 0;
    center = car.pos.clone();
    turntable.position.set(center.x, -0.05, center.z);
    sun.position.set(center.x + 5, center.y + 10, center.z + 6);
    sun.target.position.copy(center);
  };
  const repair = () => {
    if (!car || !mesh) return;
    car.wheels.forEach((w) => (w.damage = 0));
    settle(car);
    mesh.update();
    healing = 0.9;
  };

  // Vridbordet: snurrar av sig själv och följer musen när man drar.
  let yaw = 0.7;
  let pitch = 0.18;
  let dragging = false;
  let idle = 0;
  const menu = document.getElementById('menu')!;
  const down = (e: PointerEvent) => {
    if (e.target !== menu) return;
    dragging = true;
    menu.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    yaw -= e.movementX * 0.008;
    pitch = Math.min(0.9, Math.max(0.02, pitch + e.movementY * 0.004));
    idle = 0;
  };
  const up = () => (dragging = false);
  menu.addEventListener('pointerdown', down);
  menu.addEventListener('pointermove', move);
  menu.addEventListener('pointerup', up);

  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    idle += dt;
    if (healing > 0 && mesh) {
      healing -= dt;
      if (healing > 0) mesh.heal(Math.exp(-dt * 5));
      else mesh.repair();
    }
    // Börja snurra igen en stund efter att man släppt.
    if (!dragging && idle > 2) yaw += dt * 0.35;
    const d = 14;
    camera.position.set(
      center.x + Math.sin(yaw) * Math.cos(pitch) * d,
      center.y + Math.sin(pitch) * d,
      center.z + Math.cos(yaw) * Math.cos(pitch) * d,
    );
    camera.lookAt(center.x, center.y - 0.1, center.z);
    pipeline.render();
  });

  return {
    show,
    repair,
    close() {
      renderer.setAnimationLoop(null);
      removeEventListener('resize', resize);
      menu.removeEventListener('pointerdown', down);
      menu.removeEventListener('pointermove', move);
      menu.removeEventListener('pointerup', up);
      pipeline.dispose();
    },
  };
}

/**
 * Bilväljaren: bilen står på vridbordet bakom menyn. Returnerar vald bil, eller null om
 * spelaren backar.
 */
export async function pickCar(renderer: THREE.WebGPURenderer, cars: CarModel[], opts: PickOptions = {}): Promise<CarModel | null> {
  const room = showroom(renderer);
  const cmp = opts.compare ?? [];
  let current = 0;
  let compared = 0;
  // Bilnamnet med pilar; inga <button> eftersom showMenu gör alla knappar i menyn till menyval.
  const navHtml = (m: CarModel) => {
    const extra = [cars.length > 1 ? `${cars.indexOf(m) + 1}/${cars.length}` : '', opts.detail?.(m) ?? ''].filter(Boolean).join(' · ');
    const name = `<b>${m.make().name}</b>${extra ? `<small>${extra}</small>` : ''}`;
    return `<div class="car-nav">${cars.length > 1 ? `<span data-step="-1">‹</span>${name}<span data-step="1">›</span>` : name}</div>`;
  };
  // carSpecs kör en accelerationssimulering, så värdena sparas per bil.
  const data = new Map<CarModel, { name: string; rows: Row[] }>();
  const rowsOf = (m: CarModel) => {
    if (!data.has(m)) {
      const p = m.make();
      data.set(m, { name: p.name, rows: specRows(p, carSpecs(p)) });
    }
    return data.get(m)!;
  };
  const bodyHtml = (m: CarModel) => {
    const a = rowsOf(m).rows;
    const other = cmp[compared];
    const hints = [cars.length > 1 ? '← → byter bil.' : '', cmp.length > 1 ? 'Q E byter jämförelse.' : '', 'Dra för att snurra bilen.'];
    let table: string;
    let compareRow = '';
    if (other) {
      const b = rowsOf(other);
      const name = `<b>${b.name}</b>`;
      compareRow = `<div class="compare">Jämför med ${cmp.length > 1 ? `<span data-cmp="-1">‹</span>${name}<span data-cmp="1">›</span>` : name}</div>`;
      table = a.map((r, i) => `<tr><th>${r.k}</th><td class="${verdict(r, b.rows[i]!)}">${r.short}</td><td>${b.rows[i]!.short}</td></tr>`).join('');
    } else {
      table = a.map((r) => `<tr><th>${r.k}</th><td>${r.full}</td></tr>`).join('');
    }
    return `${navHtml(m)}${compareRow}<div>${m.blurb}</div><table class="specs">${table}</table><div class="hint">${hints.filter(Boolean).join(' ')}</div>`;
  };
  /** Skriver om panelens text med en mjuk övergång till den nya höjden. */
  const render = () => {
    const body = document.querySelector('#menu .body');
    const panel = body?.closest<HTMLElement>('.panel');
    if (!body || !panel) return;
    // Mäts mitt i en pågående animation om man bläddrar snabbt.
    const from = panel.offsetHeight;
    panel.getAnimations().forEach((a) => a.cancel());
    body.innerHTML = bodyHtml(cars[current]!);
    const to = panel.offsetHeight;
    if (from !== to) panel.animate({ height: [`${from}px`, `${to}px`] }, { duration: 200, easing: 'ease-out' });
  };
  let shown: CarModel | null = null;
  const show = (m: CarModel) => {
    if (m === shown) return;
    shown = m;
    room.show(m);
    render();
  };
  show(cars[0]!);

  const menu = document.getElementById('menu')!;
  let browsing = true; // av medan en undermeny visas
  const step = (d: number) => {
    current = (current + d + cars.length) % cars.length;
    show(cars[current]!);
  };
  const stepCompare = (d: number) => {
    if (cmp.length < 2) return;
    compared = (compared + d + cmp.length) % cmp.length;
    render();
  };
  const click = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-step], [data-cmp]');
    if (el?.dataset.step) step(Number(el.dataset.step));
    if (el?.dataset.cmp) stepCompare(Number(el.dataset.cmp));
  };
  // Registreras före showMenu så att den hinner före menyns lyssnare, som stoppar tangenttrycket.
  const key = (e: KeyboardEvent) => {
    if (!browsing) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') step(-1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') step(1);
    else if (e.code === 'KeyQ') stepCompare(-1);
    else if (e.code === 'KeyE') stepCompare(1);
  };
  menu.addEventListener('click', click);
  addEventListener('keydown', key, true);

  let pick: 'pick' | 'back';
  for (;;) {
    pick = await showMenu<'pick' | 'back'>({
      title: opts.title ?? 'Välj bil',
      subtitle: opts.subtitle?.(),
      side: true,
      body: bodyHtml(cars[current]!),
      items: [
        { label: opts.action?.label ?? 'Kör', value: 'pick' },
        { label: '← Tillbaka', value: 'back' },
      ],
      cancel: 'back',
    });
    if (pick === 'back' || !opts.action) break;
    // Bilen man har bläddrat fram, inte den som visades när menyn öppnades.
    const m = cars[current]!;
    browsing = false;
    const close = await opts.action.run(m);
    browsing = true;
    if (close) break;
    data.clear();
    shown = null;
    show(m);
  }

  room.close();
  menu.removeEventListener('click', click);
  removeEventListener('keydown', key, true);
  return pick === 'back' ? null : cars[current]!;
}
