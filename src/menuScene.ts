import * as THREE from 'three/webgpu';
import { toonOutlinePass } from 'three/tsl';
import { Sound } from './audio';
import { driveAlongRoad, turnAt } from './physics/autopilot';
import { Car } from './physics/car';
import { CARS } from './physics/params';
import { START_S, Stage, STAGE_MYRKULLA } from './physics/stage';
import { CarMesh } from './render/carMesh';
import { Dust } from './render/dust';
import { buildStage } from './render/stage';
import { applyLight, LIGHTS } from './render/lighting';
import { settings } from './settings';

const DT = 1 / 240;
/** Bilen startar så här långt före kurvan och byts ut så här långt efter den (m). */
const RUN_IN = 150;
const RUN_OUT = 220;

export interface MenuScene {
  /** Visar scenen bakom menyerna och kör loopen. */
  play(): void;
  /** Stoppar loopen; scenen finns kvar till nästa play(). */
  stop(): void;
  dispose(): void;
}

/**
 * Bakgrunden till huvudmenyn: en fast kamera ovanför Myrkullas skarpaste gruskurva, där
 * autopiloten kör förbi med en bil i taget, en ny modell varje varv.
 */
export function menuScene(renderer: THREE.WebGPURenderer): MenuScene {
  const stage = new Stage(STAGE_MYRKULLA);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 1500);
  const pipeline = new THREE.RenderPipeline(renderer, toonOutlinePass(scene, camera, new THREE.Color(0x1c1c24), 0.003));
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  scene.add(hemi, sun, sun.target, buildStage(stage));
  const light = LIGHTS.day;
  applyLight(scene, hemi, sun, light);

  // Skarpaste kurvan på grus (surfaces har en post per meter), och kameran högt upp på utsidan av den så bilen kommer mot kameran.
  let corner = 0;
  for (let s = START_S + RUN_IN; s < stage.length - RUN_OUT; s += 5) {
    const gravel = stage.surfaces.slice(s - 60, s + 60).every((x) => x === 'gravel');
    if (gravel && Math.abs(turnAt(stage, s)) > Math.abs(turnAt(stage, corner))) corner = s;
  }
  const apex = stage.poseAt(corner);
  const a = stage.poseAt(corner - 30);
  const b = stage.poseAt(corner + 30);
  const out = new THREE.Vector2(apex.x - (a.x + b.x) / 2, apex.z - (a.z + b.z) / 2).normalize();
  const apexY = stage.heightAt(apex.x, apex.z);
  const look = new THREE.Vector3(apex.x, apexY + 1, apex.z);
  camera.position.set(apex.x + out.x * 42, 0, apex.z + out.y * 42);
  camera.position.y = Math.max(apexY, stage.heightAt(camera.position.x, camera.position.z)) + 22;
  sun.position.set(apex.x + light.sunOffset[0], apexY + light.sunOffset[1], apex.z + light.sunOffset[2]);
  sun.target.position.copy(look);
  camera.lookAt(look);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const toCar = new THREE.Vector3();

  const holder = new THREE.Group();
  const dust = new Dust();
  scene.add(holder, dust.mesh);
  let car: Car;
  let mesh: CarMesh;
  let lap = 0;
  let lapTime = 0;
  let throttle = 0;
  let sound: Sound | null = null;
  // Högtalaren stänger av bara bilarna; döljs när allt ljud redan är av.
  const mute = document.createElement('button');
  mute.id = 'menu-cars-mute';
  const showMute = () => {
    mute.textContent = settings.menuCars ? '🔊' : '🔇';
    mute.title = mute.ariaLabel = settings.menuCars ? 'Stäng av bilarnas ljud' : 'Sätt på bilarnas ljud';
  };
  mute.onclick = () => {
    settings.menuCars = !settings.menuCars;
    showMute();
  };
  showMute();
  const nextCar = () => {
    const model = CARS[lap++ % CARS.length]!;
    car = new Car(model.make(), stage);
    const p = stage.poseAt(corner - RUN_IN);
    car.reset(p.x, p.z, p.heading, 20);
    holder.clear();
    mesh = new CarMesh(car, model);
    mesh.addTo(holder);
    lapTime = 0;
  };
  nextCar();

  // Kurvan hamnar till vänster om huvudmenyn, som ligger till höger (som i bilväljaren).
  const resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.setViewOffset(w, h, w > 900 ? w * 0.19 : 0, 0, w, h);
  };
  let acc = 0;
  let last = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    for (acc += dt; acc >= DT; acc -= DT) {
      const input = driveAlongRoad(stage, car);
      throttle = input.throttle;
      car.step(DT, input);
    }
    lapTime += dt;
    // Ny bil när den här kört ut ur bild, eller fastnat någonstans.
    if (stage.project(car.pos.x, car.pos.z).s > corner + RUN_OUT || lapTime > 40) nextCar();
    car.damageEvents.length = 0;
    mesh.update();
    dust.update(car, stage, dt);
    // Motorljudet tonar in när bilen närmar sig kameran och följer den från sida till sida.
    toCar.subVectors(car.pos, camera.position);
    const dist = toCar.length();
    sound?.setVolume(settings.menuCars ? Math.min(1, (30 / dist) ** 2) : 0, toCar.dot(right) / dist);
    mute.hidden = !settings.sound;
    sound?.update(car, throttle);
    pipeline.render();
  };

  return {
    play() {
      resize();
      addEventListener('resize', resize);
      document.body.classList.add('menu-scene');
      last = performance.now();
      sound = new Sound();
      document.body.append(mute);
      renderer.setAnimationLoop(frame);
    },
    stop() {
      renderer.setAnimationLoop(null);
      sound?.close();
      sound = null;
      mute.remove();
      removeEventListener('resize', resize);
      document.body.classList.remove('menu-scene');
    },
    dispose() {
      this.stop();
      pipeline.dispose();
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
      });
    },
  };
}
