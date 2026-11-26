/**
 * Konto och synk: hur spelet och synkservern (sync/) pratar. Delas av båda, så bara ren
 * TypeScript utan DOM. Modellen kommer från season-o-meter:
 *
 * Kontot är en hemlighet på 128 slumpbitar som skapas i webbläsaren. Servern lagrar kontot
 * under SHA-256 av hemligheten, så den ser aldrig själva hemligheten. Den som har hemligheten
 * (eller återställningsnyckeln, recoveryKey.ts) kan läsa och skriva kontot.
 */

/** 128 slumpbitar, base64url. Konto-id har samma form. */
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export const isSecret = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);

export function toBase64Url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export const newSecret = () => toBase64Url(crypto.getRandomValues(new Uint8Array(16)));

/** Id:t servern lagrar kontot under. */
export async function accountIdFor(secret: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return toBase64Url(new Uint8Array(hash).slice(0, 16));
}

/** Ett värde och när det sattes (ms sedan 1970). */
export type Stamped = [value: string, updatedAt: number];

export type AccountData = Record<string, Stamped>;

/**
 * POST /v1/sync med `Authorization: Bearer <hemlighet>`: skickar enhetens data och får
 * tillbaka allt som ändrats på servern sedan `since`, markören från förra synken.
 */
export type SyncRequest = { since: number; changes: AccountData };
export type SyncResponse = { cursor: number; changes: AccountData };

/** Bästa åket på en bana. Ghosten har samma form som GhostData i physics/ghost.ts. */
export interface StageRecord {
  time: number;
  splits: number[];
  /** Saknas i rekord sparade innan ghosten fanns. */
  ghost?: { hz: number; frames: number[] };
  /** Banversionen rekordet sattes på. Saknas i rekord från innan banor versionerades. */
  version?: string;
}

/** Ett åk på 90 s är cirka 90 kB; det här räcker till ungefär en halvtimme. */
export const MAX_VALUE_LENGTH = 2_000_000;
const MAX_SPLITS = 20;

export function isStageRecord(value: unknown): value is StageRecord {
  const r = value as StageRecord;
  if (typeof r !== 'object' || r === null) return false;
  if (!(Number.isFinite(r.time) && r.time > 0 && r.time < 3600)) return false;
  if (!Array.isArray(r.splits) || r.splits.length > MAX_SPLITS || !r.splits.every(Number.isFinite)) return false;
  if (r.version !== undefined && !(typeof r.version === 'string' && /^\d+\.\d+\.\d+$/.test(r.version))) return false;
  if (r.ghost === undefined) return true;
  const g = r.ghost;
  return typeof g === 'object' && g !== null && Number.isFinite(g.hz) && g.hz > 0 && g.hz <= 240 && Array.isArray(g.frames) && g.frames.length % 7 === 0 && g.frames.every(Number.isFinite);
}

/**
 * Nyckeln för bästa åket på en bana. Versionsepoken ingår (major och recordsSince, se
 * StageDef), så rekord från olika banversioner aldrig jämförs med varandra.
 */
export const recordKey = (stage: { name: string; version: string; recordsSince: string }) =>
  `best:${stage.name}:${stage.version.split('.')[0]}:${stage.recordsSince}`;

const RECORD_KEY = /^best:[\p{L}\p{N} _-]{1,40}:\d{1,4}:\d{1,4}\.\d{1,4}\.\d{1,4}$/u;

function parseRecord(value: string): StageRecord | null {
  if (value.length > MAX_VALUE_LENGTH) return null;
  try {
    const r: unknown = JSON.parse(value);
    return isStageRecord(r) ? r : null;
  } catch {
    return null;
  }
}

/** Behåller bara giltiga nycklar och värden; resten kastas tyst. */
export function sanitize(input: unknown): AccountData {
  const out: AccountData = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
  for (const [key, stamped] of Object.entries(input)) {
    if (!Array.isArray(stamped) || stamped.length !== 2) continue;
    const [value, updatedAt] = stamped as unknown[];
    if (typeof value !== 'string' || !Number.isInteger(updatedAt) || (updatedAt as number) < 0) continue;
    if (!RECORD_KEY.test(key) || !parseRecord(value)) continue;
    out[key] = [value, updatedAt as number];
  }
  return out;
}

/** Parsar ett rekord ur sanerad data. */
export const recordOf = (stamped: Stamped | undefined) => (stamped ? parseRecord(stamped[0]) : null);

/**
 * Ska `incoming` ersätta `existing`? För rekord vinner lägsta tiden, oavsett vilken enhet
 * eller i vilken ordning de kommer, så ett rekord aldrig skrivs över av ett sämre åk.
 */
export function replaces(incoming: Stamped, existing: Stamped | undefined): boolean {
  if (!existing) return true;
  const a = recordOf(incoming);
  const b = recordOf(existing);
  if (!a) return false;
  return !b || a.time < b.time;
}
