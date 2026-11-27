/** Spelarens inställningar, sparade i webbläsaren, och menyn för dem. */

import { showMenu } from './menu';
import { DIFFICULTY_PACE, type Difficulty } from './career/championship';

const VOICE_KEY = 'rally.codriver';
const SOUND_KEY = 'rally.sound';
const MENU_SOUND_KEY = 'rally.menusound';
const MENU_CARS_KEY = 'rally.menucars';
const DIFFICULTY_KEY = 'rally.difficulty';

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
    // Privat läge: gäller bara den här sessionen.
  }
}

let voice = read(VOICE_KEY) !== 'off';
let sound = read(SOUND_KEY);
let menuSound = read(MENU_SOUND_KEY) !== 'off';
let menuCars = read(MENU_CARS_KEY) !== 'off';
const savedDifficulty = read(DIFFICULTY_KEY);
let difficulty: Difficulty = savedDifficulty && savedDifficulty in DIFFICULTY_PACE ? (savedDifficulty as Difficulty) : 'easy';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'lätt', medium: 'medel', hard: 'svår' };

export const settings = {
  /** Om kartläsaren läser upp noterna; de visas på skärmen ändå. */
  get voice() {
    return voice;
  },
  set voice(on: boolean) {
    voice = on;
    write(VOICE_KEY, on ? 'on' : 'off');
  },
  /** Allt ljud; N växlar det under körning. */
  get sound() {
    // Av tills spelaren har tackat ja på välkomstskärmen.
    return sound === 'on';
  },
  set sound(on: boolean) {
    sound = on ? 'on' : 'off';
    write(SOUND_KEY, sound);
  },
  /** Klick när man flyttar och väljer i menyerna; hörs bara med ljudet på. */
  get menuSound() {
    return menuSound;
  },
  set menuSound(on: boolean) {
    menuSound = on;
    write(MENU_SOUND_KEY, on ? 'on' : 'off');
  },
  /** Motorljudet från bilarna bakom huvudmenyn; högtalaren uppe till vänster växlar det. */
  get menuCars() {
    return menuCars;
  },
  set menuCars(on: boolean) {
    menuCars = on;
    write(MENU_CARS_KEY, on ? 'on' : 'off');
  },
  /** Motståndarnas fart i nya mästerskap. */
  get difficulty() {
    return difficulty;
  },
  set difficulty(d: Difficulty) {
    difficulty = d;
    write(DIFFICULTY_KEY, d);
  },
  /** Ingen har svarat på välkomstfrågorna än. */
  get firstVisit() {
    return sound === null;
  },
};

/** Välkomstskärmen första gången spelet startas. */
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
  if (!settings.sound) return;
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

/** Inställningsmenyn, från både huvud- och pausmenyn. */
export async function showSettings(solid: boolean) {
  for (;;) {
    const c = await showMenu<'sound' | 'menuSound' | 'voice' | 'difficulty' | 'back'>({
      title: 'Inställningar',
      solid,
      items: [
        { label: 'Ljud', detail: settings.sound ? 'på' : 'av', value: 'sound' },
        { label: 'Menyljud', detail: settings.menuSound ? 'på' : 'av', value: 'menuSound' },
        { label: 'Kartläsarens röst', detail: settings.voice ? 'på' : 'av', note: 'Noterna visas på skärmen ändå.', value: 'voice' },
        { label: 'Motståndare', detail: DIFFICULTY_LABEL[settings.difficulty], note: 'Gäller mästerskap som startas efter ändringen.', value: 'difficulty' },
        { label: '← Tillbaka', value: 'back' },
      ],
      cancel: 'back',
    });
    if (c === 'back') return;
    if (c === 'difficulty') settings.difficulty = DIFFICULTIES[(DIFFICULTIES.indexOf(settings.difficulty) + 1) % DIFFICULTIES.length]!;
    else if (c === 'sound') settings.sound = !settings.sound;
    else if (c === 'menuSound') settings.menuSound = !settings.menuSound;
    else settings.voice = !settings.voice;
  }
}
