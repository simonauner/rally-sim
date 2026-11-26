/**
 * Karriären i webbläsaren. Kontot (account/sync.ts) synkar den; senaste ändringen vinner.
 * En karriär som aldrig ändrats har tidsstämpel 0, så en ny enhet aldrig skriver över kontots.
 */

import { isCareerState, type CareerState } from '../account/protocol';
import { newCareer } from './career';

const KEY = 'rally.career';

interface Stored {
  career: CareerState;
  /** När den senast ändrades här (ms), eller 0 för en ny karriär. */
  updatedAt: number;
}

export function loadCareer(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (s && isCareerState(s.career) && Number.isInteger(s.updatedAt)) return s;
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
