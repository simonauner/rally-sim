/**
 * The career in the browser. The account (account/sync.ts) syncs it; the latest change wins.
 * A career that was never changed has timestamp 0, so a new device never overwrites the account's.
 */

import { isCareerState, type CareerState } from '../account/protocol';
import { currentCarName, migrateCareer, newCareer } from './career';
import { isProgress, type ChampionshipProgress } from './championship';

const KEY = 'rally.career';

interface Stored {
  career: CareerState;
  /** When it was last changed here (ms), or 0 for a new career. */
  updatedAt: number;
}

export function loadCareer(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (s && isCareerState(s.career) && Number.isInteger(s.updatedAt)) return { ...s, career: migrateCareer(s.career) };
  } catch {
    // Broken data: start over.
  }
  return { career: newCareer(), updatedAt: 0 };
}

/** Saves a career changed on this device, or (with updatedAt) one that came from the account. */
export function saveCareer(career: CareerState, updatedAt = Date.now()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ career, updatedAt }));
  } catch {
    // Private mode or full storage: the change only lasts this session.
  }
}

const CHAMPIONSHIP_KEY = 'rally.championship';

/**
 * The championship in progress. Only in this browser, since it lives for minutes, not days.
 * shortcut: not synced; switching device mid-championship starts it over.
 */
export function loadChampionship(): ChampionshipProgress | null {
  try {
    const p: unknown = JSON.parse(localStorage.getItem(CHAMPIONSHIP_KEY) ?? 'null');
    return isProgress(p) ? { ...p, car: currentCarName(p.car) } : null;
  } catch {
    return null;
  }
}

export function saveChampionship(p: ChampionshipProgress | null) {
  try {
    if (p) localStorage.setItem(CHAMPIONSHIP_KEY, JSON.stringify(p));
    else localStorage.removeItem(CHAMPIONSHIP_KEY);
  } catch {
    // Private mode: the championship cannot be continued after a reload.
  }
}
