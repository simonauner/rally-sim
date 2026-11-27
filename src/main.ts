import * as THREE from 'three/webgpu';
import { toonOutlinePass, uniform } from 'three/tsl';
import { Sound } from './audio';
import { createGui } from './gui';
import { CONTROLS_TABLE, Hud, resultHtml } from './hud';
import { CoDriver } from './codriver';
import { settings, showSettings, showWelcome } from './settings';
import { Controls } from './input';
import { showLoading, showMenu } from './menu';
import { menuScene, type MenuScene } from './menuScene';
import { account, localChanged, restore, startSync, syncAvailable, syncStatus } from './account/sync';
import { recoveryKey, secretFromKey } from './account/recoveryKey';
import { brakeAlongRoad } from './physics/autopilot';
import { Barriers } from './physics/barriers';
import { Car } from './physics/car';
import { CARS, type CarModel } from './physics/params';
import { START_S, Stage, STAGE_ASJON, STAGE_GRINSBOL, STAGES, type StageDef } from './physics/stage';
import { pickStage, stagePreviewHtml } from './stageMenu';
import { forcedWeather, isTyre, pickTyre } from './tyreMenu';
import type { TyreType } from './physics/surfaces';
import { aheadOnRoad, CHAMPIONSHIPS, championshipUnlocked, legWeather, type CarDamage, type ChampionshipProgress } from './career/championship';
import { GhostRecorder, sampleGhost } from './physics/ghost';
import { generateNotes, NoteCaller } from './physics/pacenotes';
import { StageTimer } from './physics/timing';
import type { StageRecord } from './account/protocol';
import { loadRecord, saveRecord } from './records';
import { World } from './physics/world';
import { CarMesh, loadCarModel } from './render/carMesh';
import { pickCar, type PickOptions, showroom } from './carSelect';
import { formatMoney } from './career/career';
import { awardPrize, careerMenu, championshipLegDone, confirmAbort, resumeChampionship } from './career/menus';
import { loadCareer } from './career/store';
import { DebugVectors } from './render/debug';
import { Dust } from './render/dust';
import { buildBarriers } from './render/barriers';
import { buildGhostMesh } from './render/ghostMesh';
import { buildStage } from './render/stage';
import { buildTerrain } from './render/terrain';
import { applyLight, Headlights, LIGHTS } from './render/lighting';
import { applyWeather, Precipitation } from './render/weather';
import { rollWeather, WEATHER_NAMES, type Weather } from './physics/weather';

const DT = 1 / 240;
const CAMERAS = ['bakifrån nära', 'bakifrån långt', 'motorhuv', 'förarvy', 'uppifrån', 'sidovy (skador)'] as const;
/** Jaktkamerorna: avstånd bakom bilen och höjd över den (m). */
/** tight: kameran följer med bilen innan utjämningen, så den inte släpar efter i fart. */
const CHASE: Record<string, { back: number; up: number; tight?: boolean }> = {
  'bakifrån nära': { back: 4.7, up: 1.6, tight: true },
  'bakifrån långt': { back: 7.0, up: 2.5 },
};
const CAMERA_KEY = 'rally.camera';
/** Sätts vid bygget i vite.config.ts. */
const VERSION = `version ${import.meta.env.VITE_COMMIT} · byggd ${new Date(import.meta.env.VITE_BUILT_AT).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })}`;

function readCamera() {
  try {
    return localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
}

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
  const outlinePass = toonOutlinePass(scene, camera, undefined, 0.003);
  // En uniform, så konturfärgen kan följa etappens ljus (svart på natten).
  const outlineColor = uniform(new THREE.Color(0x1c1c24));
  outlinePass.colorNode = outlineColor;
  const pipeline = new THREE.RenderPipeline(renderer, outlinePass);

  const hemi = new THREE.HemisphereLight(0xe8f3ff, 0x8a7a5a, 1.1);
  scene.add(hemi);
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
  // Skuggtestet flyttas ut längs ytans normal, så täta oregelbundna nät (Blenderbilarna) inte skuggar sig själva i fläckar.
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // Kontot skapas vid första besöket; rekord synkas om en synkserver är inställd.
  startSync();

  const showAccount = async () => {
    for (;;) {
      const key = recoveryKey(account().secret);
      const { phase, syncedAt } = syncStatus();
      const status = !syncAvailable
        ? 'Ingen synkserver är inställd, så kontot finns bara i den här webbläsaren.'
        : phase === 'failed'
          ? 'Senaste synken misslyckades; den försöker igen om en stund.'
          : syncedAt
            ? `Synkat ${new Date(syncedAt).toLocaleTimeString('sv-SE')}.`
            : 'Synkar…';
      const c = await showMenu<'copy' | 'restore' | 'back'>({
        title: 'Konto',
        solid: true,
        body: `Ditt konto skapades automatiskt i den här webbläsaren. Spara återställningsnyckeln: med den får du tillbaka dina rekord på en annan enhet, eller om webbläsarens data rensas.<div class="recovery">${key}</div>${status}`,
        items: [
          { label: 'Kopiera nyckeln', value: 'copy' },
          { label: 'Återställ med nyckel', value: 'restore' },
          { label: '← Tillbaka', value: 'back' },
        ],
        cancel: 'back',
      });
      if (c === 'back') return;
      if (c === 'copy') await navigator.clipboard?.writeText(key).catch(() => {});
      if (c === 'restore') await showRestore();
    }
  };

  const showRestore = async () => {
    let wrong = false;
    for (;;) {
      let typed = '';
      const c = await showMenu<'ok' | 'cancel'>({
        title: 'Återställ konto',
        solid: true,
        body: `Skriv in återställningsnyckeln. Rekorden i den här webbläsaren följer med till det återställda kontot.${
          wrong ? '<div class="behind">Nyckeln stämmer inte. Kontrollera att alla 28 tecken är rätt.</div>' : ''
        }`,
        input: { placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', onDone: (v) => (typed = v) },
        items: [
          { label: 'Återställ', value: 'ok' },
          { label: 'Avbryt', value: 'cancel' },
        ],
        cancel: 'cancel',
      });
      if (c === 'cancel') return;
      const secret = secretFromKey(typed);
      if (!secret) {
        wrong = true;
        continue;
      }
      await restore(secret);
      return;
    }
  };

  const showControls = (solid: boolean) =>
    showMenu({ title: 'Kontroller', body: CONTROLS_TABLE, items: [{ label: '← Tillbaka', value: 0 }], cancel: 0, solid });

  // Världen byggs först när spelaren valt i huvudmenyn. ?testbana hoppar direkt till lekplatsen.
  type MainChoice = 'stage' | 'test' | 'settings' | 'controls' | 'account' | 'career';
  let choice: MainChoice = query.has('testbana') ? 'test' : query.has('karriar') ? 'career' : 'controls';
  /** ?karriar=<kr>: tillbaka från ett mästerskap; kassan räknar upp med prispengarna. */
  let gained = Number(query.get('karriar')) || 0;
  // Ladda man om sidan ska kassan inte räkna upp igen.
  if (query.has('karriar')) history.replaceState(null, '', location.pathname + (forceWebGL ? '?webgl' : ''));
  let model = CARS[0]!;
  let stageDef: StageDef = STAGE_GRINSBOL;
  /** Karriärlopp ger prispengar; fri körning gör det inte. */
  let careerMode = false;
  /** Pågående mästerskap; ?mastarskap=<däck> laddar dess nästa etapp direkt med däcken valda före omladdningen. */
  let champ: ChampionshipProgress | null = null;
  let weather: Weather = 'clear';
  let tyre: TyreType | null = null;
  const resumedTyre = query.get('mastarskap');
  const resumed = isTyre(resumedTyre) ? resumeChampionship() : null;
  if (resumed && isTyre(resumedTyre)) {
    ({ model, stage: stageDef, championship: champ } = resumed);
    // Vädret slumpas per etapp; i mästerskap från dess frö, så en omladdning inte ger nytt väder.
    weather = forcedWeather() ?? legWeather(champ!);
    tyre = resumedTyre;
    choice = 'stage';
  } else if (query.has('mastarskap')) choice = 'career';
  /** Bilen på vridbordet, t.ex. på mästerskapets service. */
  const showCar = (m: CarModel, d: CarDamage) => {
    const room = showroom(renderer);
    room.show(m, d);
    return room;
  };
  /** Bilarna man äger i karriären går att köra fritt; utan bil bara Kvarn 240 GL. */
  const freeCars = () => {
    const owned = Object.keys(loadCareer().career.garage);
    return owned.length ? owned : ['Kvarn 240 GL'];
  };
  const freeDriveDetail = () => {
    const career = loadCareer().career;
    const stages = new Set(CHAMPIONSHIPS.filter((c) => championshipUnlocked(career, c)).flatMap((c) => c.legs)).size;
    const cars = freeCars().length;
    return `${stages} av ${STAGES.length} etapper, ${cars === 1 ? '1 bil' : `${cars} bilar`}`;
  };
  /** Kurvan med bilarna bakom menyerna, en för sommar och en för vinter; byggs första gången de visas. */
  const backdrops = new Map<boolean, MenuScene>();
  const backdropFor = (winter: boolean) => {
    if (!backdrops.has(winter)) backdrops.set(winter, menuScene(renderer, winter ? STAGE_ASJON : STAGE_GRINSBOL));
    return backdrops.get(winter)!;
  };
  /** Scenen som spelas bakom menyn just nu. */
  let shown: MenuScene | null = null;
  const hideScenery = () => {
    shown?.stop();
    shown = null;
  };
  /** Bakgrund i etappens tema (årstid, ljus och väder), eller huvudmenyns kurva i klockans ljus med null. */
  const scenery = (s: StageDef | null, weather?: Weather) => {
    shown?.stop();
    shown = backdropFor(!!s?.winter);
    shown.play(s ? (s.light ?? 'day') : undefined, weather);
  };
  // I karriärens menyer går kurvan i bakgrunden; bilväljaren och vridbordet tar över renderaren medan de visas.
  const careerPick = async (models: CarModel[], opts?: PickOptions) => {
    hideScenery();
    const picked = await pickCar(renderer, models, opts);
    scenery(null);
    return picked;
  };
  const careerShowCar = (m: CarModel, d: CarDamage) => {
    hideScenery();
    const room = showCar(m, d);
    return {
      ...room,
      close() {
        room.close();
        scenery(null);
      },
    };
  };
  while (!resumed) {
    if (choice === 'controls') {
      scenery(null);
      if (settings.firstVisit) await showWelcome();
    }
    while (choice === 'settings' || choice === 'controls' || choice === 'account') {
      choice = await showMenu<MainChoice>({
        title: 'RALLY',
        side: true,
        items: [
          { label: 'Karriär', detail: formatMoney(loadCareer().career.money), value: 'career' },
          { label: 'Fri körning', detail: freeDriveDetail(), value: 'stage' },
          { label: 'Testbana', detail: 'hinder och underlag', value: 'test' },
          { label: 'Inställningar', value: 'settings' },
          { label: 'Kontroller', value: 'controls' },
          { label: 'Konto', value: 'account' },
        ],
        footer: VERSION,
      });
      if (choice === 'settings') await showSettings(true);
      if (choice === 'controls') await showControls(true);
      if (choice === 'account') await showAccount();
    }
    // Fri körning väljer etapp med huvudmenyns kurva bakom sig.
    if (choice !== 'career' && choice !== 'stage') hideScenery();
    if (choice === 'career') {
      const launch = await careerMenu(careerPick, careerShowCar, scenery, gained);
      hideScenery();
      gained = 0;
      if (launch) {
        ({ model, stage: stageDef, championship: champ, weather, tyre } = launch);
        careerMode = !champ;
        choice = 'stage';
        break;
      }
      choice = 'controls';
      continue;
    }
    if (choice === 'stage') {
      const picked = await pickStage('Fri körning');
      hideScenery();
      if (!picked) {
        choice = 'controls';
        continue;
      }
      stageDef = picked;
      weather = forcedWeather() ?? rollWeather(stageDef, Math.random());
    }
    // Bilväljaren före varje start och däcken efter den; Tillbaka går till huvudmenyn respektive bilväljaren.
    let picked: CarModel | null;
    while ((picked = query.has('testbana') ? model : await pickCar(renderer, CARS, { locked: (m) => !freeCars().includes(m.make().name) }))) {
      model = picked;
      if (choice === 'test' || (tyre = await pickTyre(stageDef, weather))) break;
    }
    if (picked) break;
    choice = 'controls';
  }
  backdrops.forEach((b) => b.dispose());
  // Tas bort efter första renderade bildrutan, när terrängen är byggd och shaders kompilerade.
  // Etappkortet står kvar under laddningen, med vad som görs just nu vid snurren.
  const loading = choice === 'test'
    ? showLoading('Laddar: Testbana')
    : showLoading(`Laddar: ${stageDef.name}`, `<div>Väder: ${WEATHER_NAMES[weather]}.</div>${stagePreviewHtml(stageDef)}`);
  let hideLoading: (() => void) | null = loading.hide;
  await loading.status('Bygger vägen…');
  const stage = choice === 'test' ? null : new Stage(stageDef);
  const world = stage ?? new World();
  world.weather = weather;
  await loading.status('Bygger landskapet…');
  scene.add(stage ? buildStage(stage) : buildTerrain(world));
  const light = LIGHTS[stage?.def.light ?? 'day'];
  applyLight(scene, hemi, sun, light);
  applyWeather(scene, hemi, sun, weather);
  const precipitation = weather === 'rain' || weather === 'snowfall' ? new Precipitation(weather) : null;
  if (precipitation) scene.add(precipitation.mesh);
  outlineColor.value.setHex(light.outline);
  const barriers = stage ? new Barriers(stage) : null;
  const barrierMeshes = barriers ? buildBarriers(barriers) : null;
  if (barrierMeshes) scene.add(barrierMeshes.group);

  await loading.status('Hämtar bilen…');
  await loadCarModel(model);
  const car = new Car(model.make(), world);
  if (tyre) car.params.tyre = tyre;
  car.assists.steerAssist = settings.steerAssist;
  car.assists.tc = settings.tc;
  const carMesh = new CarMesh(car, model);
  carMesh.addTo(scene);
  const headlights = light.headlights ? new Headlights() : null;
  if (headlights) scene.add(headlights.group);
  const dust = new Dust();
  scene.add(dust.mesh);
  const debug = new DebugVectors();
  scene.add(debug.lines);
  let showVectors = true; // F3/GUI-valet; syns bara när F1-debugläget är på

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
  const timer = stage ? new StageTimer(START_S, stage.finish) : null;
  let best: StageRecord | null = stage ? loadRecord(stage.def) : null;
  /** Förarna som startar före dig i mästerskapet, och deras tider på etappen. */
  const field = champ ? aheadOnRoad(champ) : [];
  /** Bästa tiden före det senaste åket, för att visa skillnaden i mål. */
  let previousBest: StageRecord | null = null;
  let resultSaved = false;
  /** Skadorna vid målgång; det som händer därefter räknas inte. */
  let damageAtFinish: CarDamage | null = null;
  const caller = stage ? new NoteCaller(generateNotes(stage, START_S, stage.finish)) : null;
  const codriver = new CoDriver();
  const recorder = new GhostRecorder();
  const ghostMesh = buildGhostMesh(car.params);
  scene.add(ghostMesh);
  let showGhost = true;
  /** false = kameran hoppar direkt till bilen nästa bildruta i stället för att glida dit. */
  let camInit = false;
  /** Tid sedan målgång och om målskärmen visas; bilen körs av autopiloten under tiden. */
  let finishedFor = 0;
  let finishShown = false;
  /** Vinkeln runt bilen när kameran cirklar efter målgång; null = vanlig kamera. */
  let orbit: number | null = null;
  const place = (s: Spawn, keepDamage: boolean) => {
    camInit = false;
    finishedFor = 0;
    finishShown = false;
    orbit = null;
    spawn = s;
    car.reset(s.x, s.z, s.heading, s.speed, keepDamage);
    barriers?.reset();
    timer?.reset();
    recorder.reset();
    codriver.stop();
    if (stage) caller?.seek(stage.project(s.x, s.z).s);
    resultSaved = false;
    damageAtFinish = null;
  };
  // På etappen ställer R tillbaka bilen på vägen där den är, och klockan fortsätter.
  const recover = () => {
    if (!stage) return place(spawn, true);
    const p = stage.poseAt(stage.project(car.pos.x, car.pos.z).s);
    car.reset(p.x, p.z, p.heading, 0, true);
    camInit = false;
    codriver.stop();
    caller?.seek(stage.project(p.x, p.z).s);
  };
  const repair = () => {
    for (const k of Object.keys(car.damage) as (keyof typeof car.damage)[]) car.damage[k] = 0;
    car.wheels.forEach((w) => (w.damage = 0));
    car.drivetrain.powerFactor = 1;
    car.lamps = [0, 0];
    carMesh.repair();
  };
  place(spawn, false);
  // Mästerskapets skador följer med från förra etappen; bucklorna ritas från siffrorna.
  const readDamage = (): CarDamage => ({ body: { ...car.damage }, wheels: car.wheels.map((w) => w.damage), powerFactor: car.drivetrain.powerFactor, lamps: [...car.lamps] });
  if (champ?.damage) {
    Object.assign(car.damage, champ.damage.body);
    car.wheels.forEach((w, i) => (w.damage = champ!.damage!.wheels[i] ?? 0));
    car.drivetrain.powerFactor = champ.damage.powerFactor;
    if (champ.damage.lamps) car.lamps = [...champ.damage.lamps];
    carMesh.dentFrom(champ.damage.body);
  }
  createGui(car, places, {
    teleport: (name) => place(spawns[name]!, true),
    repair,
    toggleDebug: (on) => (showVectors = on),
  });

  let camMode = Math.max(0, CAMERAS.indexOf(readCamera() as (typeof CAMERAS)[number]));
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  /** Bilens position förra bildrutan, för det täta kameraläget. */
  const camCar = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  /** Hur långt till höger om bilen målkameran tittar; glider in från 0 så bilden inte hoppar. */
  let lookShift = 0;

  const updateCamera = (dt: number) => {
    const mode = CAMERAS[camMode]!;
    const chase = CHASE[mode];
    const fwd = tmpDir.set(0, 0, 1).applyQuaternion(car.quat);
    fwd.y = 0;
    fwd.normalize();
    if (finishShown) {
      // Börja där kameran är (oavsett kameraläge), glid ut på cirkeln och snurra långsamt.
      if (orbit === null) {
        // Fortsätt från exakt samma bild: blickpunkten längs kamerans nuvarande siktlinje.
        camPos.copy(camera.position);
        camLook.copy(camPos).addScaledVector(camera.getWorldDirection(tmpV), camPos.distanceTo(car.pos));
        orbit = Math.atan2(camPos.x - car.pos.x, camPos.z - car.pos.z);
        lookShift = 0;
      }
      orbit += dt * 0.25;
      const want = tmpV.set(car.pos.x + Math.sin(orbit) * 7.5, car.pos.y + 2.2, car.pos.z + Math.cos(orbit) * 7.5);
      camPos.lerp(want, 1 - Math.exp(-dt * 2));
      camLook.lerp(car.pos, 1 - Math.exp(-dt * 3));
      camera.position.copy(camPos);
      camera.up.set(0, 1, 0);
      // Titta lite till höger om bilen så den hamnar vänster om resultatpanelen.
      lookShift += (2.2 - lookShift) * (1 - Math.exp(-dt * 2));
      const right = tmpDir.subVectors(camLook, camPos).cross(camera.up).normalize();
      camera.lookAt(tmpV.copy(camLook).addScaledVector(right, lookShift));
      camera.fov += (50 - camera.fov) * (1 - Math.exp(-dt * 2));
    } else if (chase) {
      // Blanda bilens riktning med färdriktningen så sladdar syns tydligt.
      if (car.speed > 6) {
        tmpV.copy(car.vel);
        tmpV.y = 0;
        tmpV.normalize();
        fwd.lerp(tmpV, 0.45).normalize();
      }
      // I fart vidgas bilden och kameran skakar lite; den drar sig inte bakåt, för då krymper farten.
      const fast = Math.min(1, car.speed / 40);
      const wantPos = tmpV.copy(car.pos).addScaledVector(fwd, -chase.back);
      // Aldrig under marken bakom bilen, t.ex. i en svacka eller på väg upp mot ett krön.
      wantPos.y = Math.max(car.pos.y + chase.up, world.heightAt(wantPos.x, wantPos.z) + 0.9);
      const lookX = car.pos.x + fwd.x * 5;
      const lookZ = car.pos.z + fwd.z * 5;
      if (!camInit) {
        camPos.copy(wantPos);
        camLook.set(lookX, car.pos.y + 0.5, lookZ);
        camInit = true;
      } else if (chase.tight) {
        const moved = tmpDir.subVectors(car.pos, camCar);
        camPos.add(moved);
        camLook.add(moved);
      }
      camCar.copy(car.pos);
      camPos.lerp(wantPos, 1 - Math.exp(-dt * 5));
      camLook.lerp(tmpV.set(lookX, car.pos.y + 0.5, lookZ), 1 - Math.exp(-dt * 9));
      camera.position.copy(camPos);
      camera.up.set(0, 1, 0);
      const t = performance.now() / 1000;
      const shake = fast * fast * (car.wheels[0]!.surface === 'asphalt' ? 0.012 : 0.03);
      camera.position.y += (Math.sin(t * 37) + Math.sin(t * 23.3)) * shake;
      camera.position.x += Math.sin(t * 29.1) * shake;
      camera.lookAt(camLook);
      camera.fov = 58 + fast * 16;
    } else if (mode === 'motorhuv') {
      camera.position.copy(tmpV.set(0, 0.55, 1.5).applyQuaternion(car.quat).add(car.pos));
      camera.up.set(0, 1, 0).applyQuaternion(car.quat);
      camera.lookAt(tmpV.set(0, 0.5, 12).applyQuaternion(car.quat).add(car.pos));
      camera.fov = 70;
    } else if (mode === 'förarvy') {
      camera.position.copy(tmpV.set(0, 0.62, 0.35).applyQuaternion(car.quat).add(car.pos));
      camera.up.set(0, 1, 0);
      camera.lookAt(tmpV.set(0, 0.55, 12).applyQuaternion(car.quat).add(car.pos));
      camera.fov = 75;
    } else if (mode === 'sidovy (skador)') {
      camera.position.copy(tmpV.set(5.0, 1.5, 0.8).applyQuaternion(car.quat).add(car.pos));
      camera.up.set(0, 1, 0);
      camera.lookAt(tmpV.set(0, 0.1, 1.0).applyQuaternion(car.quat).add(car.pos));
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

  const restart = () => {
    if (!stage) return;
    // Ett bättre rekord kan ha kommit från en annan enhet sedan förra åket.
    best = loadRecord(stage.def);
    repair();
    place(spawns.start!, true);
  };

  // Byte av värld under körning finns inte; huvudmenyn laddar om sidan.
  const goToMainMenu = () => void (location.href = location.pathname + (forceWebGL ? '?webgl' : ''));
  const goToCareer = (prize = 0) => void (location.href = `${location.pathname}?karriar=${prize}${forceWebGL ? '&webgl' : ''}`);
  const goToNextLeg = (t: TyreType) => void (location.href = `${location.pathname}?mastarskap=${t}${forceWebGL ? '&webgl' : ''}`);

  /** Prispengarna från senaste åket, för målskärmen. */
  let prizeHtml = '';
  const showFinish = async () => {
    if (!stage || !timer) return;
    if (champ) {
      const next = await championshipLegDone(champ, timer.time, resultHtml(timer, previousBest), damageAtFinish ?? readDamage(), (d) => showCar(model, d));
      return 'tyre' in next ? goToNextLeg(next.tyre) : goToCareer(next.prize);
    }
    const c = await showMenu<'again' | 'menu'>({
      title: 'Mål',
      side: true,
      body: resultHtml(timer, previousBest) + prizeHtml,
      items: [
        { label: 'Kör igen', value: 'again' },
        { label: 'Huvudmeny', value: 'menu' },
      ],
    });
    if (c === 'menu') return goToMainMenu();
    restart();
  };

  let paused = false;
  const pause = async () => {
    paused = true;
    codriver.stop();
    sound.setPaused(true);
    for (;;) {
      // I mästerskapet finns ingen omstart; att lämna det är att avbryta.
      const c = await showMenu<'resume' | 'restart' | 'settings' | 'controls' | 'menu' | 'abort'>({
        title: 'Paus',
        items: [
          { label: 'Fortsätt', value: 'resume' },
          ...(stage && !champ ? [{ label: 'Starta om etappen', value: 'restart' as const }] : []),
          { label: 'Inställningar', value: 'settings' },
          { label: 'Kontroller', value: 'controls' },
          champ ? { label: 'Avbryt mästerskapet', value: 'abort' as const } : { label: 'Huvudmeny', value: 'menu' as const },
        ],
        cancel: 'resume',
      });
      if (c === 'settings') {
        await showSettings(false);
        car.assists.steerAssist = settings.steerAssist;
        car.assists.tc = settings.tc;
  car.assists.tc = settings.tc;
        continue;
      }
      if (c === 'controls') {
        await showControls(false);
        continue;
      }
      if (c === 'menu') return goToMainMenu();
      if (c === 'abort') {
        if (await confirmAbort()) return goToCareer();
        continue;
      }
      if (c === 'restart') restart();
      break;
    }
    sound.setPaused(false);
    paused = false;
  };

  // Första bildrutan kompilerar shaders, vilket kan ta en stund.
  await loading.status('Förbereder grafiken…');
  let acc = 0;
  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    // rAF:s tidsstämpel kan ligga före performance.now() från när loopen skapades.
    const frameDt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (paused) {
      pipeline.render();
      return;
    }
    // Efter mål styr autopiloten; målskärmen tar över tangenterna när den visas.
    const finished = !!stage && timer?.state === 'finished';
    if (controls.wasPressed('Escape') && !finishShown) void pause();

    if (controls.wasPressed('KeyR') && !finished) recover();
    if (controls.wasPressed('KeyT') && !champ) restart();
    if (controls.wasPressed('KeyC')) {
      camMode = (camMode + 1) % CAMERAS.length;
      camInit = false;
      try {
        localStorage.setItem(CAMERA_KEY, CAMERAS[camMode]!);
      } catch {
        // Privat läge: valet gäller bara den här sessionen.
      }
    }
    if (controls.wasPressed('F1')) document.body.classList.toggle('debug');
    if (controls.wasPressed('F3')) showVectors = !showVectors;
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

    const input = finished ? brakeAlongRoad(stage, car) : controls.sample(frameDt);
    acc += frameDt;
    while (acc >= DT) {
      car.step(DT, input);
      barriers?.update(car, DT);
      if (stage && timer) {
        timer.update(stage.project(car.pos.x, car.pos.z).s, DT);
        if (timer.state === 'running') recorder.record(timer.time, car.pos, car.quat);
      }
      acc -= DT;
    }
    if (stage && timer?.state === 'finished' && !resultSaved) {
      resultSaved = true;
      damageAtFinish = readDamage();
      previousBest = best;
      prizeHtml = careerMode ? awardPrize(stage.def.name, timer.time, car.params.name) : '';
      if (!best || timer.time < best.time) {
        best = { time: timer.time, splits: [...timer.splits], ghost: recorder.data() };
        saveRecord(stage.def, best);
        localChanged();
      }
    }
    if (finished && !finishShown) {
      finishedFor += frameDt;
      if (car.speed < 1 || finishedFor > 2.5) {
        finishShown = true;
        void showFinish();
      }
    }
    controls.endFrame();

    if (car.damageEvents.length) {
      carMesh.applyDamage(car.damageEvents);
      sound.impact(car.damageEvents);
      car.damageEvents.length = 0;
    }
    // Hamnar bilen i ett omöjligt läge (ner genom världen) startar vi om. Mot marken, eftersom verkliga etapper ligger under y = 0.
    if (!Number.isFinite(car.pos.y) || car.pos.y < world.heightAt(car.pos.x, car.pos.z) - 20) place(spawn, true);

    sound.update(car, input.throttle);
    carMesh.update();
    dust.update(car, world, frameDt, carMesh);
    precipitation?.update(frameDt, camera.position, now / 1000);
    barrierMeshes?.update();
    // Ghosten väntar vid startlinjen före start och försvinner när du gått i mål.
    ghostMesh.visible =
      showGhost &&
      !!timer &&
      !!best?.ghost &&
      timer.state !== 'finished' &&
      sampleGhost(best.ghost, timer.state === 'running' ? timer.time : 0, ghostMesh.position, ghostMesh.quaternion);
    debug.lines.visible = showVectors && document.body.classList.contains('debug');
    debug.update(car);
    updateCamera(frameDt);
    sun.position.set(car.pos.x + light.sunOffset[0], car.pos.y + light.sunOffset[1], car.pos.z + light.sunOffset[2]);
    headlights?.update(car);
    carMesh.setLamps(!!headlights, car.lamps, input.brake > 0.05);
    sun.target.position.copy(car.pos);
    hud.update(car, input, CAMERAS[camMode]!);
    hud.showGauges(!finishShown);
    if (timer) hud.updateTimer(timer, best, field);
    if (stage && caller) {
      const s = stage.project(car.pos.x, car.pos.z).s;
      const called = caller.update(s, car.speed);
      if (called.length && !sound.muted) codriver.say(called);
      hud.updateNotes(caller.active(s), settings.voice && codriver.missingVoice);
    }
    pipeline.render();
    hideLoading?.();
    hideLoading = null;
    (window as unknown as { __afterRender?: () => void }).__afterRender?.();
  });
}

main();
