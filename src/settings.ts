/** Spelarens inställningar, sparade i webbläsaren, och menyn för dem. */

import { showMenu } from './menu';

const VOICE_KEY = 'rally.codriver';

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

export const settings = {
  /** Om kartläsaren läser upp noterna; de visas på skärmen ändå. */
  get voice() {
    return voice;
  },
  set voice(on: boolean) {
    voice = on;
    write(VOICE_KEY, on ? 'on' : 'off');
  },
};

/** Inställningsmenyn, från både huvud- och pausmenyn. */
export async function showSettings(solid: boolean) {
  for (;;) {
    const c = await showMenu<'voice' | 'back'>({
      title: 'Inställningar',
      solid,
      items: [
        { label: 'Kartläsarens röst', detail: settings.voice ? 'på' : 'av', note: 'Noterna visas på skärmen ändå.', value: 'voice' },
        { label: '← Tillbaka', value: 'back' },
      ],
      cancel: 'back',
    });
    if (c === 'back') return;
    settings.voice = !settings.voice;
  }
}
