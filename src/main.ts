import * as THREE from 'three/webgpu';
import { toonOutlinePass } from 'three/tsl';
import { Sound } from './audio';
import { createGui } from './gui';
import { Hud } from './hud';
import { Controls } from './input';
import { Car } from './physics/car';
import { kvarn240 } from './physics/params';
import { FINISH_MARGIN, START_S, Stage, STAGE_SKOGSBERG } from './physics/stage';
import { GhostRecorder, sampleGhost } from './physics/ghost';
import { StageTimer } from './physics/timing';
import { loadRecord, saveRecord, type StageRecord } from './records';
import { World } from './physics/world';
import { CarMesh } from './render/carMesh';
import { DebugVectors } from './render/debug';
import { buildGhostMesh } from './render/ghostMesh';
import { buildStage } from './render/stage';
import { buildTerrain } from './render/terrain';

const DT = 1 / 240;
const CAMERAS = ['bakifrån', 'förarvy', 'uppifrån', 'sidovy (skador)'];

async function main() {
  // ?webgl är bara till för felsökning i miljöer utan riktig WebGPU.
  const query = new URLSearchParams(location.search);
  const forceWebGL = query.has('webgl');
  if (!forceWebGL && !('gpu' in navigator)) {
    document.getElementById('unsupported')!.style.display = 'flex';
    return;
  }

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
  try {
    await renderer.init();
  } catch (e) {
    console.error(e);
    document.getElementById('unsupported')!.style.display = 'flex';
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe3ee);
  scene.fog = new THREE.Fog(0xcfe3ee, 120, 520);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1500);
  // Cel-shading: toon-material plus mörka konturer runt allt med toon-material.
  const pipeline = new THREE.RenderPipeline(renderer, toonOutlinePass(scene, camera, new THREE.Color(0x1c1c24), 0.003));

  scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x8a7a5a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -30;
  sc.right = 30;
  sc.top = 30;
  sc.bottom = -30;
  sc.near = 1;
  sc.far = 160;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // ?testbana laddar den gamla lekplatsen med hinder och underlagsprov.
  const stage = query.has('testbana') ? null : new Stage(STAGE_SKOGSBERG);
  const world = stage ?? new World();
  scene.add(stage ? buildStage(stage) : buildTerrain(world));

  const car = new Car(kvarn240(), world);
  const carMesh = new CarMesh(car);
  carMesh.addTo(scene);
  const debug = new DebugVectors();
  scene.add(debug.lines);

  const controls = new Controls();
  const hud = new Hud();
  const sound = new Sound();

  type Spawn = { x: number; z: number; heading: number; speed: number };
  const spawns: Record<string, Spawn> = stage
    ? {
        start: { ...stage.poseAt(START_S - 8), speed: 0 },
        asphalt: { ...stage.poseAt(stage.surfaces.indexOf('asphalt') + 5), speed: 15 },
        mud: { ...stage.poseAt(stage.surfaces.indexOf('mud') + 5), speed: 15 },
      }
    : {
        gravel: { x: 0, z: 0, heading: 0, speed: 0 },
        asphalt: { x: 0, z: 42, heading: 0, speed: 0 },
        mud: { x: 24, z: 56, heading: 0, speed: 0 },
        snow: { x: -24, z: 56, heading: 0, speed: 0 },
        washboard: { x: 0, z: 92, heading: 0, speed: 18 },
        jump: { x: 0, z: 150, heading: 0, speed: 22 },
        crash: { x: 0, z: 235, heading: 0, speed: 20 },
      };
  const places: [string, string][] = stage
    ? [
        ['Etappstart', 'start'],
        ['Asfaltsdelen (15 m/s)', 'asphalt'],
        ['Leriga skogen (15 m/s)', 'mud'],
      ]
    : [
        ['Grus: start', 'gravel'],
        ['Asfalt', 'asphalt'],
        ['Lera', 'mud'],
        ['Snö', 'snow'],
        ['Tvättbräda (18 m/s)', 'washboard'],
        ['Hopp (22 m/s)', 'jump'],
        ['Krocktest (20 m/s)', 'crash'],
      ];
  let spawn = Object.values(spawns)[0]!;
  const timer = stage ? new StageTimer(START_S, stage.length - FINISH_MARGIN) : null;
  let best: StageRecord | null = stage ? loadRecord(stage.def.name) : null;
  /** Bästa tiden före det senaste åket, för att visa skillnaden i mål. */
  let previousBest: StageRecord | null = null;
  let resultSaved = false;
  const recorder = new GhostRecorder();
  const ghostMesh = buildGhostMesh(car.params);
  scene.add(ghostMesh);
  let showGhost = true;
  /** false = kameran hoppar direkt till bilen nästa bildruta i stället för att glida dit. */
  let camInit = false;
  const place = (s: Spawn, keepDamage: boolean) => {
    camInit = false;
    spawn = s;
    car.reset(s.x, s.z, s.heading, s.speed, keepDamage);
    timer?.reset();
    recorder.reset();
    resultSaved = false;
  };
  // På etappen ställer R tillbaka bilen på vägen där den är, och klockan fortsätter.
  const recover = () => {
    if (!stage) return place(spawn, true);
    const p = stage.poseAt(stage.project(car.pos.x, car.pos.z).s);
    car.reset(p.x, p.z, p.heading, 0, true);
    camInit = false;
  };
  const repair = () => {
    for (const k of Object.keys(car.damage) as (keyof typeof car.damage)[]) car.damage[k] = 0;
    car.wheels.forEach((w) => (w.damage = 0));
    car.drivetrain.powerFactor = 1;
    carMesh.repair();
  };
  place(spawn, false);
  createGui(car, places, {
    teleport: (name) => place(spawns[name]!, true),
    repair,
    toggleDebug: (on) => (debug.lines.visible = on),
  });

  let camMode = 0;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpV = new THREE.Vector3();

  const updateCamera = (dt: number) => {
    const fwd = tmpDir.set(0, 0, 1).applyQuaternion(car.quat);
    fwd.y = 0;
    fwd.normalize();
    if (camMode === 0) {
      // Blanda bilens riktning med färdriktningen så sladdar syns tydligt.
      if (car.speed > 6) {
        tmpV.copy(car.vel);
        tmpV.y = 0;
        tmpV.normalize();
        fwd.lerp(tmpV, 0.45).normalize();
      }
      const wantPos = new THREE.Vector3().copy(car.pos).addScaledVector(fwd, -7.2);
      wantPos.y = car.pos.y + 2.6;
      const wantLook = new THREE.Vector3().copy(car.pos).addScaledVector(fwd, 5);
      wantLook.y = car.pos.y + 0.5;
      if (!camInit) {
        camPos.copy(wantPos);
        camLook.copy(wantLook);
        camInit = true;
      }
      const k = 1 - Math.exp(-dt * 5);
      camPos.lerp(wantPos, k);
      camLook.lerp(wantLook, 1 - Math.exp(-dt * 9));
      camera.position.copy(camPos);
      camera.up.set(0, 1, 0);
      camera.lookAt(camLook);
      camera.fov = 60;
    } else if (camMode === 1) {
      const p = new THREE.Vector3(0, 0.62, 0.35).applyQuaternion(car.quat).add(car.pos);
      camera.position.copy(p);
      const look = new THREE.Vector3(0, 0.55, 12).applyQuaternion(car.quat).add(car.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
      camera.fov = 75;
    } else if (camMode === 3) {
      const p = new THREE.Vector3(5.0, 1.5, 0.8).applyQuaternion(car.quat).add(car.pos);
      camera.position.copy(p);
      camera.up.set(0, 1, 0);
      const look = new THREE.Vector3(0, 0.1, 1.0).applyQuaternion(car.quat).add(car.pos);
      camera.lookAt(look);
      camera.fov = 55;
    } else {
      camera.position.set(car.pos.x, car.pos.y + 32, car.pos.z - 0.01);
      camera.up.copy(fwd);
      camera.lookAt(car.pos);
      camera.fov = 50;
    }
    camera.updateProjectionMatrix();
  };

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  let acc = 0;
  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    const frameDt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (controls.wasPressed('KeyR')) recover();
    if (controls.wasPressed('KeyT') && stage) {
      repair();
      place(spawns.start!, true);
    }
    if (controls.wasPressed('KeyC')) camMode = (camMode + 1) % CAMERAS.length;
    if (controls.wasPressed('F3')) debug.lines.visible = !debug.lines.visible;
    if (controls.wasPressed('KeyH')) hud.toggleHelp();
    if (controls.wasPressed('KeyN')) sound.toggleMute();
    if (controls.wasPressed('KeyG')) showGhost = !showGhost;
    if (controls.wasPressed('KeyM')) car.drivetrain.autoShift = !car.drivetrain.autoShift;
    const dtn = car.drivetrain;
    if (!dtn.autoShift) {
      if (controls.wasPressed('KeyE')) {
        if (dtn.gear < 1) dtn.gear += 1;
        else dtn.shiftUp();
      }
      if (controls.wasPressed('KeyQ')) {
        if (dtn.gear <= 1) dtn.gear = Math.max(-1, dtn.gear - 1);
        else dtn.shiftDown();
      }
    }

    const input = controls.sample(frameDt);
    acc += frameDt;
    while (acc >= DT) {
      car.step(DT, input);
      if (stage && timer) {
        timer.update(stage.project(car.pos.x, car.pos.z).s, DT);
        if (timer.state === 'running') recorder.record(timer.time, car.pos, car.quat);
      }
      acc -= DT;
    }
    if (stage && timer?.state === 'finished' && !resultSaved) {
      resultSaved = true;
      previousBest = best;
      if (!best || timer.time < best.time) {
        best = { time: timer.time, splits: [...timer.splits], ghost: recorder.data() };
        saveRecord(stage.def.name, best);
      }
    }
    controls.endFrame();

    if (car.damageEvents.length) {
      carMesh.applyDamage(car.damageEvents);
      sound.impact(car.damageEvents);
      car.damageEvents.length = 0;
    }
    // Hamnar bilen i ett omöjligt läge (ner genom världen) startar vi om.
    if (!Number.isFinite(car.pos.y) || car.pos.y < -20) place(spawn, true);

    sound.update(car, input.throttle);
    carMesh.update();
    // Ghosten väntar vid startlinjen före start och försvinner när du gått i mål.
    ghostMesh.visible =
      showGhost &&
      !!timer &&
      !!best?.ghost &&
      timer.state !== 'finished' &&
      sampleGhost(best.ghost, timer.state === 'running' ? timer.time : 0, ghostMesh.position, ghostMesh.quaternion);
    debug.update(car);
    updateCamera(frameDt);
    sun.position.set(car.pos.x + 40, car.pos.y + 70, car.pos.z - 30);
    sun.target.position.copy(car.pos);
    hud.update(car, input, CAMERAS[camMode]!);
    if (timer) hud.updateTimer(timer, best, previousBest);
    pipeline.render();
    (window as unknown as { __afterRender?: () => void }).__afterRender?.();
  });
}

main();
