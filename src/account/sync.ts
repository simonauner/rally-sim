/**
 * The account in the browser: created automatically on the first visit, it syncs best times and ghosts
 * with the sync server (sync/) when VITE_SYNC_URL is set. Without a server the account still exists locally,
 * so the recovery key can be saved from the start. The design comes from season-o-meter.
 */

import { STAGES } from '../physics/stage';
import { loadRecord, saveRecord } from '../records';
import { loadCareer, saveCareer } from '../career/store';
import { CAREER_KEY, careerOf, isSecret, newSecret, recordKey, recordOf, replaces, sanitize, type AccountData, type SyncRequest, type SyncResponse } from './protocol';

/** The sync server's address. Without it nothing is synced. */
const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? '';
export const syncAvailable = SYNC_URL !== '';

const STATE_KEY = 'rally.account';
/** Fetch other devices' changes this often while the game is visible. */
const PULL_INTERVAL_MS = 60_000;

interface AccountState {
  secret: string;
  /** Where the previous sync ended on the server. */
  cursor: number;
  /** When this device last changed something, and which change the last successful sync sent. */
  changedAt: number;
  pushedAt: number;
  /** When the last successful sync finished, by this device's clock. */
  syncedAt?: number;
}

export type SyncPhase = 'idle' | 'syncing' | 'failed';
let phase: SyncPhase = 'idle';

function readState(): AccountState | null {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as AccountState | null;
    return isSecret(s?.secret) ? s : null;
  } catch {
    return null;
  }
}

function writeState(state: AccountState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or full storage: the account only lasts this session.
  }
}

/** The account for this browser; created the first time. Local records are included in the first sync. */
export function account(): AccountState {
  const existing = readState();
  if (existing) return existing;
  const fresh: AccountState = { secret: newSecret(), cursor: 0, changedAt: Date.now(), pushedAt: 0 };
  writeState(fresh);
  return readState() ?? fresh;
}

export const syncStatus = () => ({ phase, syncedAt: readState()?.syncedAt ?? null });

/** What the device has: the best time per stage (under the key for the stage's version epoch) and the career. */
function localData(): AccountData {
  const data: AccountData = {};
  const { career, updatedAt } = loadCareer();
  if (updatedAt > 0) data[CAREER_KEY] = [JSON.stringify(career), updatedAt];
  for (const stage of STAGES) {
    const r = loadRecord(stage);
    if (r) data[recordKey(stage)] = [JSON.stringify(r), Date.now()];
  }
  return data;
}

/** Takes in records from the server that beat the local ones, and the career if it is newer. */
function importData(changes: AccountData) {
  const incomingCareer = changes[CAREER_KEY];
  const career = careerOf(incomingCareer);
  if (incomingCareer && career && incomingCareer[1] > loadCareer().updatedAt) saveCareer(career, incomingCareer[1]);
  for (const stage of STAGES) {
    const incoming = changes[recordKey(stage)];
    const local = loadRecord(stage);
    const record = recordOf(incoming);
    const key = recordKey(stage);
    if (incoming && record && replaces(key, incoming, local ? [JSON.stringify(local), 0] : undefined)) saveRecord(stage, record);
  }
}

let running: Promise<void> | null = null;
let runAgain = false;

/** Sends the device's records (if anything changed) and fetches other devices'. */
export function syncNow(): Promise<void> {
  if (running) {
    runAgain = true;
    return running;
  }
  running = run().finally(() => {
    running = null;
    if (runAgain) {
      runAgain = false;
      void syncNow();
    }
  });
  return running;
}

async function run() {
  const state = account();
  if (!syncAvailable) return;
  phase = 'syncing';
  try {
    const request: SyncRequest = {
      since: state.cursor,
      // Everything, not just what changed, so nothing can be missed; the server keeps only better times.
      changes: state.changedAt > state.pushedAt ? localData() : {},
    };
    const res = await fetch(`${SYNC_URL}/v1/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const response = (await res.json()) as SyncResponse;
    // The account may have been switched (restore) in the meantime.
    const latest = readState();
    if (latest?.secret !== state.secret) return;
    importData(sanitize(response.changes));
    writeState({ ...latest, cursor: response.cursor, pushedAt: state.changedAt, syncedAt: Date.now() });
    phase = 'idle';
  } catch {
    phase = 'failed';
  }
}

/** Called when a new record or the career has been saved locally. */
export function localChanged() {
  writeState({ ...account(), changedAt: Date.now() });
  void syncNow();
}

/**
 * Switches to the account with this secret. Local records are merged with the account's, while
 * the account's career replaces this device's.
 */
export function restore(secret: string) {
  saveCareer(loadCareer().career, 0);
  writeState({ secret, cursor: 0, changedAt: Date.now(), pushedAt: 0 });
  return syncNow();
}

/** Keeps the device synced while the game is open. */
export function startSync() {
  account();
  if (!syncAvailable) return;
  const syncIfVisible = () => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  document.addEventListener('visibilitychange', syncIfVisible);
  addEventListener('online', syncIfVisible);
  setInterval(syncIfVisible, PULL_INTERVAL_MS);
  void syncNow();
}
