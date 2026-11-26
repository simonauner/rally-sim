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

/** Karriären: pengar och garage. Delas med servern för validering. */
export interface CareerState {
  money: number;
  /** Ägda bilar (bilens namn) och deras uppgraderingsnivåer per kategori. */
  garage: Record<string, { upgrades: Record<string, number> }>;
  /** Dagen (YYYY-MM-DD, lokal tid) då dagsbonusen senast hämtades. */
  bonusDay?: string;
}

export const CAREER_KEY = 'career';
const MAX_MONEY = 1e9;

export function isCareerState(value: unknown): value is CareerState {
  const c = value as CareerState;
  if (typeof c !== 'object' || c === null) return false;
  if (!(Number.isInteger(c.money) && c.money >= 0 && c.money <= MAX_MONEY)) return false;
  if (c.bonusDay !== undefined && !(typeof c.bonusDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.bonusDay))) return false;
  if (typeof c.garage !== 'object' || c.garage === null) return false;
  const cars = Object.entries(c.garage);
  if (cars.length > 50) return false;
  return cars.every(
    ([name, car]) =>
      name.length > 0 &&
      name.length <= 40 &&
      typeof car?.upgrades === 'object' &&
      car.upgrades !== null &&
      Object.entries(car.upgrades).every(([id, level]) => id.length <= 20 && Number.isInteger(level) && level >= 0 && level <= 10),
  );
}

function parseCareer(value: string): CareerState | null {
  if (value.length > 100_000) return null;
  try {
    const c: unknown = JSON.parse(value);
    return isCareerState(c) ? c : null;
  } catch {
    return null;
  }
}

/** Parsar karriären ur sanerad data. */
export const careerOf = (stamped: Stamped | undefined) => (stamped ? parseCareer(stamped[0]) : null);

/** Behåller bara giltiga nycklar och värden; resten kastas tyst. */
export function sanitize(input: unknown): AccountData {
  const out: AccountData = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
  for (const [key, stamped] of Object.entries(input)) {
    if (!Array.isArray(stamped) || stamped.length !== 2) continue;
    const [value, updatedAt] = stamped as unknown[];
    if (typeof value !== 'string' || !Number.isInteger(updatedAt) || (updatedAt as number) < 0) continue;
    const valid = key === CAREER_KEY ? !!parseCareer(value) : RECORD_KEY.test(key) && !!parseRecord(value);
    if (!valid) continue;
    out[key] = [value, updatedAt as number];
  }
  return out;
}

/** Parsar ett rekord ur sanerad data. */
export const recordOf = (stamped: Stamped | undefined) => (stamped ? parseRecord(stamped[0]) : null);

/**
 * Ska `incoming` ersätta `existing` under `key`? För rekord vinner lägsta tiden, oavsett vilken
 * enhet eller i vilken ordning de kommer, så ett rekord aldrig skrivs över av ett sämre åk.
 * För karriären vinner senaste ändringen.
 * shortcut: karriären slås inte ihop fält för fält; spelar två enheter samtidigt vinner den som
 * sparar sist. Byt till sammanslagning per fält om det blir ett problem.
 */
export function replaces(key: string, incoming: Stamped, existing: Stamped | undefined): boolean {
  if (!existing) return true;
  if (key === CAREER_KEY) return incoming[1] > existing[1];
  const a = recordOf(incoming);
  const b = recordOf(existing);
  if (!a) return false;
  return !b || a.time < b.time;
}
