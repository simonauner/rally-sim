import * as THREE from 'three/webgpu';
import { toonOutlinePass, uniform } from 'three/tsl';
import { Sound } from './audio';
import { driveAlongRoad, turnAt } from './physics/autopilot';
import { Car } from './physics/car';
import { CARS } from './physics/params';
import { type Light, lightAt, START_S, Stage, type StageDef } from './physics/stage';
import { CarMesh, carModelReady, loadCarModel } from './render/carMesh';
import { Dust } from './render/dust';
import { buildStage } from './render/stage';
import { applyLight, Headlights, LIGHTS } from './render/lighting';
import { applyWeather, Precipitation } from './render/weather';
import type { Weather } from './physics/weather';
import { settings } from './settings';

const DT = 1 / 240;
/** Bilen startar så här långt före kurvan och byts ut så här långt efter den (m). */
const RUN_IN = 150;
const RUN_OUT = 220;

// Lucides volume-2 och volume-x (lucide-static 1.81.0, ISC).
const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const VOLUME_ON = icon(
  '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
);
const VOLUME_OFF = icon(
  '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>',
);

export interface MenuScene {
  /** Visar scenen bakom menyerna och kör loopen, i givet ljus och väder eller spelarens klocka och klart väder. */
  play(light?: Light, weather?: Weather): void;
  /** Stoppar loopen; scenen finns kvar till nästa play(). */
  stop(): void;
  dispose(): void;
}

/**
 * Bakgrunden till menyerna: en fast kamera ovanför etappens skarpaste kurva på grus (snö på
 * vinteretapper), där autopiloten kör förbi med en bil i taget, en ny modell varje varv.
 */
export function menuScene(renderer: THREE.WebGPURenderer, def: StageDef): MenuScene {
  const stage = new Stage(def);
  const surface = def.winter ? 'snow' : 'gravel';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 1500);
  const outlinePass = toonOutlinePass(scene, camera, undefined, 0.003);
  const outlineColor = uniform(new THREE.Color(0x1c1c24));
  outlinePass.colorNode = outlineColor;
  const pipeline = new THREE.RenderPipeline(renderer, outlinePass);
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  scene.add(hemi, sun, sun.target, buildStage(stage));
  const headlights = new Headlights();
  scene.add(headlights.group);

  // Skarpaste kurvan på grus/snö (surfaces har en post per meter), och kameran högt upp på utsidan av den så bilen kommer mot kameran.
  let corner = 0;
  for (let s = START_S + RUN_IN; s < stage.length - RUN_OUT; s += 5) {
    const gravel = stage.surfaces.slice(s - 60, s + 60).every((x) => x === surface);
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
  sun.target.position.copy(look);
  // Ljuset följer spelarens klocka om inget annat ges; läses om varje gång menyn visas.
  let precipitation: Precipitation | null = null;
  const setLight = (time = lightAt(new Date()), weather: Weather = 'clear') => {
    const light = LIGHTS[time];
    applyLight(scene, hemi, sun, light);
    // Svagt månljus på natten så att banan syns mellan bilarna; etappens natt förblir becksvart.
    if (time === 'night') {
      hemi.intensity = 0.08;
      sun.intensity = 0.12;
    }
    applyWeather(scene, hemi, sun, weather);
    if (precipitation) {
      scene.remove(precipitation.mesh);
      precipitation.mesh.geometry.dispose();
      (precipitation.mesh.material as THREE.Material).dispose();
    }
    precipitation = weather === 'rain' || weather === 'snowfall' ? new Precipitation(weather) : null;
    if (precipitation) scene.add(precipitation.mesh);
    outlineColor.value.setHex(light.outline);
    sun.position.set(apex.x + light.sunOffset[0], apexY + light.sunOffset[1], apex.z + light.sunOffset[2]);
    headlights.group.visible = light.headlights;
  };
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
    mute.innerHTML = settings.menuCars ? VOLUME_ON : VOLUME_OFF;
    mute.title = mute.ariaLabel = settings.menuCars ? 'Stäng av bilarnas ljud' : 'Sätt på bilarnas ljud';
  };
  mute.onclick = () => {
    settings.menuCars = !settings.menuCars;
    showMute();
  };
  showMute();
  const nextCar = () => {
    const model = CARS[lap % CARS.length]!;
    // Bilen som kör nu fortsätter tills nästa modell är hämtad.
    if (!carModelReady(model)) return void loadCarModel(model).catch(() => {});
    lap++;
    void loadCarModel(CARS[lap % CARS.length]!).catch(() => {});
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
    // Första bilens modell hämtas fortfarande; visa banan tom så länge.
    if (!car) nextCar();
    if (!car) return void pipeline.render();
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
    headlights.update(car);
    dust.update(car, stage, dt);
    precipitation?.update(dt, camera.position, now / 1000);
    // Motorljudet tonar in när bilen närmar sig kameran och följer den från sida till sida.
    toCar.subVectors(car.pos, camera.position);
    const dist = toCar.length();
    sound?.setVolume(settings.menuCars ? Math.min(1, (30 / dist) ** 2) : 0, toCar.dot(right) / dist);
    mute.hidden = !settings.sound;
    sound?.update(car, throttle);
    pipeline.render();
  };

  return {
    play(light, weather) {
      setLight(light, weather);
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
