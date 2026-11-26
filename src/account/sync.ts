/**
 * Kontot i webbläsaren: skapas automatiskt vid första besöket och synkar bästa tider och ghosts
 * med synkservern (sync/) när VITE_SYNC_URL är satt. Utan server finns kontot ändå lokalt,
 * så återställningsnyckeln går att spara från start. Upplägget kommer från season-o-meter.
 */

import { STAGE_SKOGSBERG, type StageDef } from '../physics/stage';
import { loadRecord, saveRecord } from '../records';
import { isSecret, newSecret, recordKey, recordOf, replaces, sanitize, type AccountData, type SyncRequest, type SyncResponse } from './protocol';

/** Synkserverns adress. Utan den synkas inget. */
const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? '';
export const syncAvailable = SYNC_URL !== '';

/** Banorna vars rekord synkas. */
const STAGES: StageDef[] = [STAGE_SKOGSBERG];

const STATE_KEY = 'rally.account';
/** Hämta andra enheters ändringar så här ofta medan spelet syns. */
const PULL_INTERVAL_MS = 60_000;

interface AccountState {
  secret: string;
  /** Var förra synken slutade på servern. */
  cursor: number;
  /** När den här enheten senast ändrade något, och vilken ändring senaste lyckade synk skickade. */
  changedAt: number;
  pushedAt: number;
  /** När senaste lyckade synk blev klar, enligt den här enhetens klocka. */
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
    // Privat läge eller full lagring: kontot gäller bara den här sessionen.
  }
}

/** Kontot för den här webbläsaren; skapas första gången. Lokala rekord följer med vid första synken. */
export function account(): AccountState {
  const existing = readState();
  if (existing) return existing;
  const fresh: AccountState = { secret: newSecret(), cursor: 0, changedAt: Date.now(), pushedAt: 0 };
  writeState(fresh);
  return readState() ?? fresh;
}

export const syncStatus = () => ({ phase, syncedAt: readState()?.syncedAt ?? null });

/** Det enheten har: bästa tiden per bana, under nyckeln för banans versionsepok. */
function localData(): AccountData {
  const data: AccountData = {};
  for (const stage of STAGES) {
    const r = loadRecord(stage);
    if (r) data[recordKey(stage)] = [JSON.stringify(r), Date.now()];
  }
  return data;
}

/** Tar in rekord från servern som är bättre än de lokala. */
function importData(changes: AccountData) {
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

/** Skickar enhetens rekord (om något ändrats) och hämtar andra enheters. */
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
      // Allt, inte bara det som ändrats, så inget kan missas; servern behåller bara bättre tider.
      changes: state.changedAt > state.pushedAt ? localData() : {},
    };
    const res = await fetch(`${SYNC_URL}/v1/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const response = (await res.json()) as SyncResponse;
    // Kontot kan ha bytts (återställning) under tiden.
    const latest = readState();
    if (latest?.secret !== state.secret) return;
    importData(sanitize(response.changes));
    writeState({ ...latest, cursor: response.cursor, pushedAt: state.changedAt, syncedAt: Date.now() });
    phase = 'idle';
  } catch {
    phase = 'failed';
  }
}

/** Anropas när ett nytt rekord har sparats lokalt. */
export function recordChanged() {
  writeState({ ...account(), changedAt: Date.now() });
  void syncNow();
}

/** Byter till kontot med den här hemligheten. Lokala rekord slås ihop med kontots. */
export function restore(secret: string) {
  writeState({ secret, cursor: 0, changedAt: Date.now(), pushedAt: 0 });
  return syncNow();
}

/** Håller enheten synkad medan spelet är öppet. */
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
