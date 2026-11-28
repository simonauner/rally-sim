import * as THREE from 'three/webgpu';
import { toonOutlinePass } from 'three/tsl';
import type { CarDamage } from './career/championship';
import { LOCK_ICON, showMenu } from './menu';
import { Car } from './physics/car';
import type { CarModel, CarParams } from './physics/params';
import { carSpecs, FlatWorld, type CarSpecs } from './physics/specs';
import { TYRE_NAMES } from './physics/surfaces';
import { CarMesh, carModelReady, loadCarModel } from './render/carMesh';

const num = (x: number, digits = 0) => x.toLocaleString('sv-SE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const DRIVE = (p: CarParams) =>
  p.frontShare === 0 ? 'Bakhjulsdrift' : p.frontShare === 1 ? 'Framhjulsdrift' : 'Fyrhjulsdrift';

interface Row {
  k: string;
  full: string;
  /** Comparable number and whether higher is better; without v the row is not coloured. */
  v?: number;
  more?: boolean;
}

function specRows(p: CarParams, s: CarSpecs): Row[] {
  const hp = s.powerKw * 1.36;
  const z = s.zeroTo100;
  // Rally tyres don't change the tyre type but raise grip, so it has to show here.
  const grip = Math.round((p.gripScale - 1) * 100);
  const gripText = grip ? `, ${grip > 0 ? '+' : '−'}${Math.abs(grip)} % grepp` : '';
  return [
    { k: 'Motoreffekt', full: `${num(hp)} hk (${num(s.powerKw)} kW) vid ${num(s.powerRpm)} rpm`, v: hp, more: true },
    { k: 'Vridmoment', full: `${num(s.torqueNm)} Nm vid ${num(s.torqueRpm)} rpm`, v: s.torqueNm, more: true },
    { k: 'Vikt', full: `${num(p.mass)} kg · ${num(p.mass / hp, 1)} kg/hk`, v: p.mass, more: false },
    { k: 'Viktfördelning', full: `${num(s.frontWeight * 100)}/${num(100 - s.frontWeight * 100)} fram/bak` },
    { k: 'Drivning', full: `${DRIVE(p)}, ${p.gearbox.ratios.length} växlar` },
    { k: 'Däck', full: `${TYRE_NAMES[p.tyre]}, Ø ${num(p.wheelRadius * 200)} cm${gripText}` },
    { k: '0–100 km/h', full: Number.isNaN(z) ? 'når inte 100' : `${num(z, 1)} s på grus`, v: Number.isNaN(z) ? undefined : z, more: false },
    { k: 'Toppfart', full: `${num(s.topSpeedKmh)} km/h`, v: s.topSpeedKmh, more: true },
  ];
}

/** Green if the car is better than the compared one, red if worse; small differences don't count. */
function verdict(a: Row, b: Row): string {
  if (a.v === undefined || b.v === undefined || Math.abs(a.v - b.v) <= Math.abs(b.v) * 0.005) return '';
  return a.v > b.v === a.more ? 'ahead' : 'behind';
}

export interface PickOptions {
  title?: string;
  /** Re-read every time the menu is shown, e.g. the cash that changes after a purchase. */
  subtitle?: () => string;
  /**
   * Replaces Kör: run opens a submenu while the car stays on the turntable, and then
   * the car selector is shown again with the car rebuilt (e.g. with new upgrades).
   * If run returns true the selector closes and the car is returned. `preview` shows another model on the turntable meanwhile, e.g. a new paint.
   */
  action?: { label: string; denied?: (m: CarModel) => boolean; confirm?: (m: CarModel) => string; run: (m: CarModel, preview: (m: CarModel) => void) => Promise<boolean | void> };
  /** Small text next to the car name, e.g. the price. */
  detail?: (m: CarModel) => string;
  /** Locked cars can be browsed to but not driven; Kör then becomes a pointer to the career. */
  locked?: (m: CarModel) => boolean;
  /** The button text for a locked car. */
  lockedLabel?: string | ((m: CarModel) => string);
  /** Cars to compare with (e.g. the ones you own); adds a Jämför button that shows them side by side. */
  compare?: CarModel[];
}

export interface Showroom {
  /** Puts the car on the turntable, with dents and bent wheels if it is damaged. */
  show(m: CarModel, damage?: CarDamage | null): void;
  /** Repairs the car on the turntable: the wheels are straightened and/or the dents smoothed out. */
  repair(body: boolean, wheels: boolean): void;
  close(): void;
}

/** The turntable behind the menu: the car spins slowly and can be turned with the mouse. */
export function showroom(renderer: THREE.WebGPURenderer): Showroom {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe3ee);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const pipeline = new THREE.RenderPipeline(renderer, toonOutlinePass(scene, camera, new THREE.Color(0x1c1c24), 0.003));
  scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x8a7a5a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.normalBias = 0.02; // otherwise the Blender cars' dense meshes self-shadow in blotches
  scene.add(sun, sun.target);
  const turntable = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.1, 64), new THREE.MeshToonMaterial({ color: 0x8f9396 }));
  turntable.receiveShadow = true;
  scene.add(turntable);
  const holder = new THREE.Group();
  scene.add(holder);

  // The camera is to the left of the panel, which sits on the right.
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
  /** Seconds left of an ongoing repair. */
  let healing = 0;
  // Let the car settle on its suspension so the wheels end up right. Handbrake only: braking at standstill engages reverse,
  // and a front-wheel-drive car then reverses off the turntable.
  const settle = (c: Car) => {
    for (let i = 0; i < 480; i++) c.step(1 / 240, { throttle: 0, brake: 0, steer: 0, handbrake: 1 });
  };
  let wanted: CarModel | null = null;
  const show = (m: CarModel, damage?: CarDamage | null) => {
    wanted = m;
    // If you browse on during loading, only the last car is shown.
    if (!carModelReady(m)) return void loadCarModel(m).then(() => wanted === m && show(m, damage));
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
  const repair = (body: boolean, wheels: boolean) => {
    if (!car || !mesh) return;
    if (wheels) {
      car.wheels.forEach((w) => (w.damage = 0));
      settle(car);
      mesh.update();
    }
    if (body) healing = 0.9;
  };

  // The turntable: spins on its own and follows the mouse while dragging.
  let yaw = 0.7;
  let pitch = 0.18;
  let dragging = false;
  let idle = 0;
  const menu = document.getElementById('menu')!;
  const down = (e: PointerEvent) => {
    // Anywhere but the panels: the side menu wraps them in a full-width .panels row.
    if ((e.target as Element).closest('.panel, .corner')) return;
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
    // Start spinning again a while after release.
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
 * The car selector: the car stands on the turntable behind the menu. Returns the chosen car, or null if
 * the player backs out.
 */
export async function pickCar(renderer: THREE.WebGPURenderer, cars: CarModel[], opts: PickOptions = {}): Promise<CarModel | null> {
  const room = showroom(renderer);
  const cmp = opts.compare ?? [];
  const locked = (m: CarModel) => opts.locked?.(m) ?? false;
  let current = Math.max(0, cars.findIndex((m) => !locked(m)));
  let compared = 0;
  // The car name with arrows; no <button> since showMenu turns every button in the menu into a menu item.
  const navHtml = (list: CarModel[], m: CarModel, attr: string, detail = '') => {
    const extra = [list.length > 1 ? `${list.indexOf(m) + 1}/${list.length}` : '', detail].filter(Boolean).join(' · ');
    const name = `<b>${m.make().name}${locked(m) ? LOCK_ICON : ''}</b>`;
    return `<div class="car-nav">${list.length > 1 ? `<span ${attr}="-1">‹</span>${name}<span ${attr}="1">›</span>` : name}</div>${extra ? `<div class="car-extra">${extra}</div>` : ''}`;
  };
  // carSpecs runs an acceleration simulation, so the values are cached per car.
  const data = new Map<CarModel, Row[]>();
  const rowsOf = (m: CarModel) => {
    if (!data.has(m)) {
      const p = m.make();
      data.set(m, specRows(p, carSpecs(p)));
    }
    return data.get(m)!;
  };
  /** The car's text and values, coloured against vs if given. */
  const specsHtml = (m: CarModel, vs?: CarModel) =>
    `<div>${m.blurb}</div><table class="specs">${rowsOf(m)
      .map((r, i) => `<tr><th>${r.k}</th><td class="${vs ? verdict(r, rowsOf(vs)[i]!) : ''}">${r.full}</td></tr>`)
      .join('')}</table>`;
  const bodyHtml = (m: CarModel) => {
    const hints = [cars.length > 1 ? '← → byter bil.' : '', 'Dra för att snurra bilen.'];
    return `${navHtml(cars, m, 'data-step', opts.detail?.(m))}${specsHtml(m)}<div class="hint">${hints.filter(Boolean).join(' ')}</div>`;
  };
  // The comparison: the car you're looking at on the left, the chosen comparison car on the right.
  const leftHtml = () => {
    const m = cars[current]!;
    return `${navHtml([m], m, '', opts.detail?.(m))}${specsHtml(m, cmp[compared])}`;
  };
  const asideHtml = () => {
    const o = cmp[compared]!;
    return `<h1>I garaget</h1><div class="subtitle">${cmp.length > 1 ? '← → byter bil.' : '&nbsp;'}</div><div class="body">${navHtml(cmp, o, 'data-cmp')}${specsHtml(o, cars[current])}</div>`;
  };
  /** Rewrites the panel's text with a smooth transition to the new height. */
  const render = () => {
    const body = document.querySelector('#menu .body');
    const panel = body?.closest<HTMLElement>('.panel');
    if (!body || !panel) return;
    // Measured mid-animation if you browse quickly.
    const from = panel.offsetHeight;
    panel.getAnimations().forEach((a) => a.cancel());
    body.innerHTML = bodyHtml(cars[current]!);
    const to = panel.offsetHeight;
    // Hide overflow while it runs: the new content overflows the shorter height and would flash a scrollbar.
    if (from !== to) panel.animate({ height: [`${from}px`, `${to}px`], overflow: ['hidden', 'hidden'] }, { duration: 200, easing: 'ease-out' });
  };
  const pickLabel = (m: CarModel) => (locked(m) ? ((typeof opts.lockedLabel === 'function' ? opts.lockedLabel(m) : opts.lockedLabel) ?? 'Lås upp i Karriär-läget') : (opts.action?.label ?? 'Kör'));
  let shown: CarModel | null = null;
  const show = (m: CarModel) => {
    if (m === shown) return;
    shown = m;
    room.show(m);
    render();
    // The Kör button follows the car you browsed to.
    const btn = document.querySelector('#menu .items button[data-i="0"]');
    btn?.classList.toggle('locked', locked(m));
    if (btn?.firstElementChild) btn.firstElementChild.innerHTML = pickLabel(m) + (locked(m) ? LOCK_ICON : '');
  };
  show(cars[current]!);

  const menu = document.getElementById('menu')!;
  /** What ← → controls; null while a submenu is shown. */
  let view: 'browse' | 'compare' | null = 'browse';
  const step = (d: number) => {
    // While the buy row is flipped for confirmation the car stays still: ← → chooses Ja/Nej.
    if (menu.querySelector('button.flipped')) return;
    current = (current + d + cars.length) % cars.length;
    show(cars[current]!);
  };
  const stepCompare = (d: number) => {
    compared = (compared + d + cmp.length) % cmp.length;
    document.querySelector('#menu .panel .body')!.innerHTML = leftHtml();
    document.querySelector('#menu .aside')!.innerHTML = asideHtml();
  };
  const click = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-step], [data-cmp]');
    if (el?.dataset.step) step(Number(el.dataset.step));
    if (el?.dataset.cmp) stepCompare(Number(el.dataset.cmp));
  };
  // Registered before showMenu so it runs before the menu's listener, which stops the key press.
  const key = (e: KeyboardEvent) => {
    const d = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    if (!d) return;
    if (view === 'browse') step(d);
    else if (view === 'compare' && cmp.length > 1) stepCompare(d);
  };
  menu.addEventListener('click', click);
  addEventListener('keydown', key, true);

  let pick: 'pick' | 'compare' | 'back';
  for (;;) {
    pick = await showMenu<typeof pick>({
      title: opts.title ?? 'Välj bil',
      subtitle: opts.subtitle?.(),
      side: true,
      body: bodyHtml(cars[current]!),
      items: [
        { label: pickLabel(cars[current]!), value: 'pick', locked: locked(cars[current]!), denied: () => locked(cars[current]!) || (opts.action?.denied?.(cars[current]!) ?? false), confirm: opts.action?.confirm && (() => opts.action!.confirm!(cars[current]!)) },
        ...(cmp.length ? [{ label: 'Jämför', value: 'compare' as const }] : []),
        { label: '← Tillbaka', value: 'back' },
      ],
      cancel: 'back',
    });
    if (pick === 'compare') {
      view = 'compare';
      await showMenu({
        title: 'Till salu',
        subtitle: opts.subtitle?.(),
        body: leftHtml(),
        aside: asideHtml(),
        items: [{ label: '← Tillbaka', value: 0 }],
        cancel: 0,
      });
      view = 'browse';
      continue;
    }
    if (pick === 'pick' && locked(cars[current]!)) continue;
    if (pick === 'back' || !opts.action) break;
    // The car you browsed to, not the one shown when the menu opened.
    const m = cars[current]!;
    view = null;
    const close = await opts.action.run(m, (p) => room.show(p));
    view = 'browse';
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
