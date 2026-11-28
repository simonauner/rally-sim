/**
 * Account and sync: how the game and the sync server (sync/) talk. Shared by both, so plain
 * TypeScript without DOM only. The model comes from season-o-meter:
 *
 * The account is a secret of 128 random bits created in the browser. The server stores the account
 * under the SHA-256 of the secret, so it never sees the secret itself. Whoever has the secret
 * (or the recovery key, recoveryKey.ts) can read and write the account.
 */

/** 128 random bits, base64url. Account ids have the same shape. */
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

/** The id the server stores the account under. */
export async function accountIdFor(secret: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return toBase64Url(new Uint8Array(hash).slice(0, 16));
}

/** A value and when it was set (ms since 1970). */
export type Stamped = [value: string, updatedAt: number];

export type AccountData = Record<string, Stamped>;

/**
 * POST /v1/sync with `Authorization: Bearer <secret>`: sends the device's data and gets
 * back everything changed on the server since `since`, the cursor from the previous sync.
 */
export type SyncRequest = { since: number; changes: AccountData };
export type SyncResponse = { cursor: number; changes: AccountData };

/** Best run on a stage. The ghost has the same shape as GhostData in physics/ghost.ts. */
export interface StageRecord {
  time: number;
  splits: number[];
  /** Missing in records saved before the ghost existed. */
  ghost?: { hz: number; frames: number[] };
  /** The stage version the record was set on. Missing in records from before stages were versioned. */
  version?: string;
}

/** A 90 s run is about 90 kB; this is enough for roughly half an hour. */
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
 * The key for the best run on a stage. The version epoch is included (major and recordsSince, see
 * StageDef), so records from different stage versions are never compared with each other.
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

/** The career: money and garage. Shared with the server for validation. */
export interface CareerState {
  money: number;
  /** Owned cars (the car's name), their upgrade levels per category and a bought paint colour (0xRRGGBB; missing = factory paint). */
  garage: Record<string, { upgrades: Record<string, number>; paint?: number }>;
  /** The day (YYYY-MM-DD, local time) the daily bonus was last collected. */
  bonusDay?: string;
  /** What the player has done, oldest first: runs, championships and purchases. Missing in careers from before the history. */
  history?: HistoryEntry[];
  /** Won championships (ChampionshipDef.id); unlocks the next championship and Free drive. */
  won?: string[];
  /** The name on the weekly challenge's leaderboard. */
  driver?: string;
  /** The last week whose weekly challenge result has been paid out (weekOf). */
  weeklyPaid?: number;
}

/** One row in the history. `amount` is prize money (positive) or what the purchase cost (negative). */
export interface HistoryEntry {
  kind: 'stage' | 'championship' | 'upgrade' | 'car';
  /** When it happened (ms since 1970). */
  at: number;
  /** The stage, championship, part or car. */
  name: string;
  /** The car that was driven or upgraded. */
  car?: string;
  /** Position in the championship, and out of how many. */
  place?: number;
  of?: number;
  /** The medal on a single stage, or null without a medal. */
  medal?: string | null;
  /** The stage time or the total championship time (s). */
  time?: number;
  amount: number;
}

export const MAX_HISTORY = 200;
const str = (v: unknown, optional = true) => (v === undefined ? optional : typeof v === 'string' && v.length > 0 && v.length <= 40);
const num = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v));

function isHistoryEntry(value: unknown): value is HistoryEntry {
  const e = value as HistoryEntry;
  return (
    typeof e === 'object' &&
    e !== null &&
    ['stage', 'championship', 'upgrade', 'car'].includes(e.kind) &&
    Number.isInteger(e.at) &&
    e.at >= 0 &&
    str(e.name, false) &&
    str(e.car) &&
    (e.medal === null || str(e.medal)) &&
    [e.place, e.of, e.time].every(num) &&
    Number.isInteger(e.amount) &&
    Math.abs(e.amount) <= MAX_MONEY
  );
}

export const CAREER_KEY = 'career';
const MAX_MONEY = 1e9;

export function isCareerState(value: unknown): value is CareerState {
  const c = value as CareerState;
  if (typeof c !== 'object' || c === null) return false;
  if (!(Number.isInteger(c.money) && c.money >= 0 && c.money <= MAX_MONEY)) return false;
  if (c.bonusDay !== undefined && !(typeof c.bonusDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.bonusDay))) return false;
  if (c.history !== undefined && !(Array.isArray(c.history) && c.history.length <= MAX_HISTORY && c.history.every(isHistoryEntry))) return false;
  if (c.won !== undefined && !(Array.isArray(c.won) && c.won.length <= 20 && c.won.every((id) => str(id, false)))) return false;
  if (c.driver !== undefined && !isDriverName(c.driver)) return false;
  if (c.weeklyPaid !== undefined && !(Number.isInteger(c.weeklyPaid) && c.weeklyPaid >= 0)) return false;
  if (typeof c.garage !== 'object' || c.garage === null) return false;
  const cars = Object.entries(c.garage);
  if (cars.length > 50) return false;
  return cars.every(
    ([name, car]) =>
      name.length > 0 &&
      name.length <= 40 &&
      typeof car?.upgrades === 'object' &&
      car.upgrades !== null &&
      Object.entries(car.upgrades).every(([id, level]) => id.length <= 20 && Number.isInteger(level) && level >= 0 && level <= 10) &&
      (car.paint === undefined || (Number.isInteger(car.paint) && car.paint >= 0 && car.paint <= 0xffffff)),
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

/** Parses the career from sanitized data. */
export const careerOf = (stamped: Stamped | undefined) => (stamped ? parseCareer(stamped[0]) : null);

/** Keeps only valid keys and values; the rest is silently dropped. */
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

/** Parses a record from sanitized data. */
export const recordOf = (stamped: Stamped | undefined) => (stamped ? parseRecord(stamped[0]) : null);

/**
 * Should `incoming` replace `existing` under `key`? For records the lowest time wins, regardless of
 * device or arrival order, so a record is never overwritten by a worse run.
 * For the career the latest change wins.
 * shortcut: the career is not merged field by field; if two devices play at the same time, the one
 * that saves last wins. Switch to per-field merging if that becomes a problem.
 */
export function replaces(key: string, incoming: Stamped, existing: Stamped | undefined): boolean {
  if (!existing) return true;
  if (key === CAREER_KEY) return incoming[1] > existing[1];
  const a = recordOf(incoming);
  const b = recordOf(existing);
  if (!a) return false;
  return !b || a.time < b.time;
}

/** Weeks for the weekly challenge, Monday to Monday in UTC, numbered from the Monday 1970-01-05. */
const WEEK_ZERO = Date.UTC(1970, 0, 5);
const WEEK_MS = 7 * 86_400_000;
export const weekOf = (at = Date.now()) => Math.floor((at - WEEK_ZERO) / WEEK_MS);
/** When the week ends (ms since 1970). */
export const weekEnd = (week: number) => WEEK_ZERO + (week + 1) * WEEK_MS;

/** A name on the leaderboard: letters, digits, spaces and . _ -, starting with a letter or digit. Never contains HTML. */
export const isDriverName = (v: unknown): v is string => typeof v === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,15}$/u.test(v);
/** A plausible stage time in seconds. */
export const isRunTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 30 && v < 3600;

export interface WeeklyEntry {
  name: string;
  time: number;
}
/**
 * POST /v1/weekly with `Authorization: Bearer <secret>`: reads the week's leaderboard, and with `time`, `name` and
 * `trace` (traceOf in career/weekly.ts) submits a run in the current week first, after checking it (checkRun).
 * Only the account's best time counts.
 */
export type WeeklyRequest = { week: number; time?: number; name?: string; trace?: number[] };
/** Why the server refused a run; sent as `error` with status 409, 422 or 429. */
export const WEEKLY_ERRORS = ['week-over', 'too-fast', 'bad-trace', 'too-often'] as const;
export type WeeklyError = (typeof WEEKLY_ERRORS)[number];
export type WeeklyResponse = { week: number; top: WeeklyEntry[]; count: number; you: { place: number; time: number } | null };
