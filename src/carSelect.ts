import * as THREE from 'three/webgpu';
import { toonOutlinePass } from 'three/tsl';
import { showMenu } from './menu';
import { Car } from './physics/car';
import type { CarModel, CarParams } from './physics/params';
import { carSpecs, FlatWorld, type CarSpecs } from './physics/specs';
import { TYRE_NAMES } from './physics/surfaces';
import { CarMesh } from './render/carMesh';

const num = (x: number, digits = 0) => x.toLocaleString('sv-SE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const DRIVE = (p: CarParams) =>
  p.frontShare === 0 ? 'Bakhjulsdrift' : p.frontShare === 1 ? 'Framhjulsdrift' : 'Fyrhjulsdrift';

function specsHtml(m: CarModel, p: CarParams, s: CarSpecs): string {
  const hp = s.powerKw * 1.36;
  const rows: [string, string][] = [
    ['Motoreffekt', `${num(hp)} hk (${num(s.powerKw)} kW) vid ${num(s.powerRpm)} rpm`],
    ['Vridmoment', `${num(s.torqueNm)} Nm vid ${num(s.torqueRpm)} rpm`],
    ['Vikt', `${num(p.mass)} kg · ${num(p.mass / hp, 1)} kg/hk`],
    ['Viktfördelning', `${num(s.frontWeight * 100)}/${num(100 - s.frontWeight * 100)} fram/bak`],
    ['Drivning', `${DRIVE(p)}, ${p.gearbox.ratios.length} växlar`],
    ['Däck', `${TYRE_NAMES[p.tyre]}, Ø ${num(p.wheelRadius * 200)} cm`],
    ['0–100 km/h', Number.isNaN(s.zeroTo100) ? 'når inte 100' : `${num(s.zeroTo100, 1)} s på grus`],
    ['Toppfart', `${num(s.topSpeedKmh)} km/h`],
  ];
  return `<div>${m.blurb}</div><table class="specs">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
    <div class="hint">Dra för att snurra bilen.</div>`;
}

/**
 * Bilväljaren: bilen står på ett vridbord bakom menyn och snurrar sakta, och går att
 * vrida med musen. Returnerar vald bil, eller null om spelaren backar.
 */
export async function pickCar(renderer: THREE.WebGPURenderer, cars: CarModel[]): Promise<CarModel | null> {
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
  const specs = new Map<CarModel, string>();
  let shown: CarModel | null = null;
  const show = (m: CarModel) => {
    if (m === shown) return;
    shown = m;
    const p = m.make();
    // Låt bilen sätta sig på fjädringen så hjulen hamnar rätt.
    const car = new Car(p, new FlatWorld('asphalt'));
    for (let i = 0; i < 480; i++) car.step(1 / 240, { throttle: 0, brake: 1, steer: 0, handbrake: 1 });
    holder.clear();
    const mesh = new CarMesh(car, m.paint);
    mesh.addTo(holder);
    mesh.update();
    center = car.pos.clone();
    turntable.position.set(center.x, -0.05, center.z);
    sun.position.set(center.x + 5, center.y + 10, center.z + 6);
    sun.target.position.copy(center);
    if (!specs.has(m)) specs.set(m, specsHtml(m, p, carSpecs(p)));
    const body = document.querySelector('#menu .body');
    if (body) body.innerHTML = specs.get(m)!;
  };
  show(cars[0]!);

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

  const BACK = -1;
  const pick = await showMenu<number>({
    title: 'Välj bil',
    side: true,
    body: specs.get(cars[0]!)!,
    items: [...cars.map((m, i) => ({ label: m.make().name, value: i })), { label: 'Tillbaka', value: BACK }],
    cancel: BACK,
    onSelect: (i) => i !== BACK && show(cars[i]!),
  });

  renderer.setAnimationLoop(null);
  removeEventListener('resize', resize);
  menu.removeEventListener('pointerdown', down);
  menu.removeEventListener('pointermove', move);
  menu.removeEventListener('pointerup', up);
  pipeline.dispose();
  return pick === BACK ? null : cars[pick]!;
}
