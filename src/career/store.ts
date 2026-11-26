/**
 * Karriären i webbläsaren. Kontot (account/sync.ts) synkar den; senaste ändringen vinner.
 * En karriär som aldrig ändrats har tidsstämpel 0, så en ny enhet aldrig skriver över kontots.
 */

import { isCareerState, type CareerState } from '../account/protocol';
import { migrateCareer, newCareer } from './career';
import { isProgress, type ChampionshipProgress } from './championship';

const KEY = 'rally.career';

interface Stored {
  career: CareerState;
  /** När den senast ändrades här (ms), eller 0 för en ny karriär. */
  updatedAt: number;
}

export function loadCareer(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (s && isCareerState(s.career) && Number.isInteger(s.updatedAt)) return { ...s, career: migrateCareer(s.career) };
  } catch {
    // Trasig data: börja om.
  }
  return { career: newCareer(), updatedAt: 0 };
}

/** Sparar en karriär som ändrats på den här enheten, eller (med updatedAt) en som kommit från kontot. */
export function saveCareer(career: CareerState, updatedAt = Date.now()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ career, updatedAt }));
  } catch {
    // Privat läge eller full lagring: ändringen gäller bara den här sessionen.
  }
}

const CHAMPIONSHIP_KEY = 'rally.championship';

/**
 * Pågående mästerskap. Bara i den här webbläsaren, eftersom det lever minuter, inte dagar.
 * shortcut: synkas inte; byter man enhet mitt i ett mästerskap börjar det om.
 */
export function loadChampionship(): ChampionshipProgress | null {
  try {
    const p: unknown = JSON.parse(localStorage.getItem(CHAMPIONSHIP_KEY) ?? 'null');
    return isProgress(p) ? p : null;
  } catch {
    return null;
  }
}

export function saveChampionship(p: ChampionshipProgress | null) {
  try {
    if (p) localStorage.setItem(CHAMPIONSHIP_KEY, JSON.stringify(p));
    else localStorage.removeItem(CHAMPIONSHIP_KEY);
  } catch {
    // Privat läge: mästerskapet går inte att fortsätta efter omladdning.
  }
}
