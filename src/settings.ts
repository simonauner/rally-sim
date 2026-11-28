/** The player's settings, saved in the browser, and their menu. */

import { showMenu } from './menu';
import { DIFFICULTY_PACE, type Difficulty } from './career/championship';

const VOICE_KEY = 'rally.codriver';
const SOUND_KEY = 'rally.sound';
const MENU_SOUND_KEY = 'rally.menusound';
const MENU_CARS_KEY = 'rally.menucars';
const DIFFICULTY_KEY = 'rally.difficulty';
const STEER_ASSIST_KEY = 'rally.steerassist';
const TC_KEY = 'rally.tc';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: only applies to this session.
  }
}

let voice = read(VOICE_KEY) !== 'off';
let sound = read(SOUND_KEY);
let menuSound = read(MENU_SOUND_KEY) !== 'off';
let menuCars = read(MENU_CARS_KEY) !== 'off';
let tc = read(TC_KEY) === 'on';
const savedDifficulty = read(DIFFICULTY_KEY);
let difficulty: Difficulty = savedDifficulty && savedDifficulty in DIFFICULTY_PACE ? (savedDifficulty as Difficulty) : 'easy';

const STEER_ASSISTS = [0, 0.5, 1];
const STEER_ASSIST_LABEL = ['av', 'halv', 'full'];
const savedSteerAssist = Number(read(STEER_ASSIST_KEY) ?? 0.5);
let steerAssist = STEER_ASSISTS.includes(savedSteerAssist) ? savedSteerAssist : 0.5;

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'lätt', medium: 'medel', hard: 'svår' };

export const settings = {
  /** Whether the co-driver reads the notes aloud; they are shown on screen anyway. */
  get voice() {
    return voice;
  },
  set voice(on: boolean) {
    voice = on;
    write(VOICE_KEY, on ? 'on' : 'off');
  },
  /** All sound; N toggles it while driving. */
  get sound() {
    // Off until the player has said yes on the welcome screen.
    return sound === 'on';
  },
  set sound(on: boolean) {
    sound = on ? 'on' : 'off';
    write(SOUND_KEY, sound);
  },
  /** Click when moving and choosing in the menus; only heard with sound on. */
  get menuSound() {
    return menuSound;
  },
  set menuSound(on: boolean) {
    menuSound = on;
    write(MENU_SOUND_KEY, on ? 'on' : 'off');
  },
  /** Engine sound from the cars behind the main menu; the speaker at the top left toggles it. */
  get menuCars() {
    return menuCars;
  },
  set menuCars(on: boolean) {
    menuCars = on;
    write(MENU_CARS_KEY, on ? 'on' : 'off');
  },
  /** Opponents' pace in new championships. */
  get difficulty() {
    return difficulty;
  },
  set difficulty(d: Difficulty) {
    difficulty = d;
    write(DIFFICULTY_KEY, d);
  },
  /** How much the car countersteers by itself in a slide: 0 off, 1 full. */
  get steerAssist() {
    return steerAssist;
  },
  set steerAssist(v: number) {
    steerAssist = v;
    write(STEER_ASSIST_KEY, String(v));
  },
  /** Traction control: cuts the throttle when the driven wheels start spinning. */
  get tc() {
    return tc;
  },
  set tc(on: boolean) {
    tc = on;
    write(TC_KEY, on ? 'on' : 'off');
  },
  /** Nobody has answered the welcome questions yet. */
  get firstVisit() {
    return sound === null;
  },
};

/** The welcome screen the first time the game starts. */
export async function showWelcome() {
  settings.sound = await showMenu({
    title: 'Välkommen!',
    solid: true,
    body: 'Hej och välkommen till rally direkt i webbläsaren! Först en fråga: vill du ha ljud på? Det går att ändra under Inställningar, eller med N när du kör.',
    items: [
      { label: 'Ja, ljud på', value: true },
      { label: 'Nej, inget ljud', value: false },
    ],
  });
  if (settings.sound) {
    settings.menuSound = await showMenu({
      title: 'Välkommen!',
      solid: true,
      body: 'Vill du ha ljudeffekter i menyerna?',
      items: [
        { label: 'Ja, menyljud på', value: true },
        { label: 'Nej, bara i spelet', value: false },
      ],
    });
  }
  let c: 'steerAssist' | 'done' | undefined;
  for (;;) {
    c = await showMenu<'steerAssist' | 'done'>({
      title: 'Hur mycket hjälpmedel vill du ha?',
      solid: true,
      body: 'Förvalt är halv motstyrning, full är enklast. Välj raden för att ändra den. Det går att ändra under Inställningar senare.',
      items: [
        { label: 'Motstyrning', detail: steerAssistLabel(), note: 'Bilen styr själv emot i sladd.', value: 'steerAssist' },
        { label: 'Klart', value: 'done' },
      ],
      cancel: 'done',
      initial: c,
    });
    if (c === 'done') return;
    cycleSteerAssist();
  }
}

function steerAssistLabel() {
  const i = STEER_ASSISTS.indexOf(settings.steerAssist);
  return STEER_ASSIST_LABEL[i] + (i === STEER_ASSISTS.length - 1 ? ' (enklast)' : '');
}

function cycleSteerAssist() {
  settings.steerAssist = STEER_ASSISTS[(STEER_ASSISTS.indexOf(settings.steerAssist) + 1) % STEER_ASSISTS.length]!;
}

/** The settings menu, from both the main and pause menus. */
export async function showSettings(solid: boolean) {
  let c: 'sound' | 'menuSound' | 'voice' | 'difficulty' | 'steerAssist' | 'tc' | 'back' | undefined;
  for (;;) {
    c = await showMenu<'sound' | 'menuSound' | 'voice' | 'difficulty' | 'steerAssist' | 'tc' | 'back'>({
      title: 'Inställningar',
      solid,
      items: [
        { label: 'Ljud', detail: settings.sound ? 'på' : 'av', value: 'sound' },
        { label: 'Menyljud', detail: settings.menuSound ? 'på' : 'av', value: 'menuSound' },
        { label: 'Kartläsarens röst', detail: settings.voice ? 'på' : 'av', note: 'Noterna visas på skärmen ändå.', value: 'voice' },
        { label: 'Motståndare', detail: DIFFICULTY_LABEL[settings.difficulty], note: 'Gäller mästerskap som startas efter ändringen.', value: 'difficulty' },
        { label: 'Motstyrning', detail: steerAssistLabel(), note: 'Bilen styr själv emot i sladd.', value: 'steerAssist' },
        { label: 'Antispinn', detail: settings.tc ? 'på (enklast)' : 'av', note: 'Drar ner gasen när drivhjulen spinner.', value: 'tc' },
        { label: '← Tillbaka', value: 'back' },
      ],
      cancel: 'back',
      // The highlight stays on the row you just changed.
      initial: c,
    });
    if (c === 'back') return;
    if (c === 'difficulty') settings.difficulty = DIFFICULTIES[(DIFFICULTIES.indexOf(settings.difficulty) + 1) % DIFFICULTIES.length]!;
    else if (c === 'steerAssist') cycleSteerAssist();
    else if (c === 'tc') settings.tc = !settings.tc;
    else if (c === 'sound') settings.sound = !settings.sound;
    else if (c === 'menuSound') settings.menuSound = !settings.menuSound;
    else settings.voice = !settings.voice;
  }
}
