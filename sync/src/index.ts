/**
 * Sync server for rally-sim. One Durable Object per account holds the account's data in SQLite and merges
 * changes from devices according to `replaces` in src/account/protocol.ts: for records the lowest
 * time wins, for the career the latest change. The account is stored under the SHA-256 of the secret, so the server never sees the secret.
 * The design comes from season-o-meter (sync/ there).
 */

import { DurableObject } from 'cloudflare:workers';
import { accountIdFor, isDriverName, isRunTime, isSecret, replaces, sanitize, weekOf, type AccountData, type Stamped, type SyncResponse, type WeeklyResponse } from '../../src/account/protocol';
import { checkRun, weeklyChallenge } from '../../src/career/weekly';

/** Far more tracks than the game has, but stops an account from growing without bound. */
const MAX_ENTRIES = 1000;
/** Room for a few records with ghosts; a 90 s run is about 90 kB. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Row = { key: string; value: string; updated_at: number };

const toData = (rows: Iterable<Row>): AccountData => Object.fromEntries([...rows].map((r) => [r.key, [r.value, r.updated_at]]));

export class Account extends DurableObject<Env> {
  private get sql() {
    return this.ctx.storage.sql;
  }

  private lastSeq() {
    const [{ last }] = this.sql.exec<{ last: number | null }>('SELECT MAX(seq) AS last FROM entries').toArray();
    return last ?? 0;
  }

  /** Merges the device's data and returns what has changed since `since`. */
  sync(since: number, changes: AccountData): SyncResponse {
    return this.ctx.storage.transactionSync(() => {
      // The table is created only on the first sync, so a read of an unknown account stores nothing.
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS entries (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          -- Incremented on every write, so devices can ask for what is new.
          seq INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS entries_seq ON entries (seq);
      `);
      const seq = this.lastSeq() + 1;
      for (const [key, incoming] of Object.entries(changes)) {
        const [row] = this.sql.exec<Row>('SELECT key, value, updated_at FROM entries WHERE key = ?', key).toArray();
        const existing: Stamped | undefined = row ? [row.value, row.updated_at] : undefined;
        if (!replaces(key, incoming, existing)) continue;
        this.sql.exec(
          `INSERT INTO entries (key, value, updated_at, seq) VALUES (?, ?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, seq = excluded.seq`,
          key,
          incoming[0],
          incoming[1],
          seq,
        );
      }
      const [{ count }] = this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM entries').toArray();
      // A throw rolls back the transaction.
      if (count > MAX_ENTRIES) throw new HttpError(413, 'Too many entries');
      return {
        cursor: this.lastSeq(),
        changes: toData(this.sql.exec<Row>('SELECT key, value, updated_at FROM entries WHERE seq > ?', since)),
      };
    });
  }
}

/** How many leaderboard rows are sent. */
const TOP = 50;
/** The shortest time between two submitted runs from one account; no stage is this short. */
const MIN_SUBMIT_GAP_MS = 20_000;

/** One week's leaderboard for the weekly challenge, one row per account with its best time. Runs are checked before they get here. */
export class Weekly extends DurableObject<Env> {
  /** The leaderboard, after storing `run` if given; 'too-often' if the account submitted a run just before. */
  board(week: number, account: string, run?: { time: number; name: string }): WeeklyResponse | 'too-often' {
    const sql = this.ctx.storage.sql;
    return this.ctx.storage.transactionSync(() => {
      sql.exec('CREATE TABLE IF NOT EXISTS runs (account TEXT PRIMARY KEY, name TEXT NOT NULL, time REAL NOT NULL, submitted_at INTEGER NOT NULL)');
      if (run) {
        const now = Date.now();
        const [last] = sql.exec<{ submitted_at: number }>('SELECT submitted_at FROM runs WHERE account = ?', account).toArray();
        if (last && now - last.submitted_at < MIN_SUBMIT_GAP_MS) return 'too-often';
        sql.exec(
          `INSERT INTO runs (account, name, time, submitted_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (account) DO UPDATE SET name = excluded.name, time = MIN(time, excluded.time), submitted_at = excluded.submitted_at`,
          account,
          run.name,
          run.time,
          now,
        );
      }
      const top = sql.exec<{ name: string; time: number }>('SELECT name, time FROM runs ORDER BY time LIMIT ?', TOP).toArray();
      const [{ count }] = sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM runs').toArray();
      const [mine] = sql.exec<{ time: number }>('SELECT time FROM runs WHERE account = ?', account).toArray();
      const you = mine ? { time: mine.time, place: sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE time < ?', mine.time).one().n + 1 } : null;
      return { week, top, count, you };
    });
  }
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body is not JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'Body is not a JSON object');
  return body as Record<string, unknown>;
}

function secretOf(request: Request) {
  const secret = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!isSecret(secret)) throw new HttpError(401, 'Missing secret');
  return secret;
}

async function handle(request: Request, env: Env): Promise<unknown> {
  const { pathname } = new URL(request.url);
  if (pathname === '/v1/sync' && request.method === 'POST') {
    const secret = secretOf(request);
    const body = await readJson(request);
    const since = typeof body.since === 'number' && Number.isInteger(body.since) && body.since >= 0 ? body.since : 0;
    const id = await accountIdFor(secret);
    return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(id)).sync(since, sanitize(body.changes));
  }
  if (pathname === '/v1/weekly' && request.method === 'POST') {
    const secret = secretOf(request);
    const body = await readJson(request);
    const week = body.week;
    const current = weekOf();
    if (!(typeof week === 'number' && Number.isInteger(week) && week >= 0 && week <= current)) throw new HttpError(400, 'Bad week');
    let run: { time: number; name: string } | undefined;
    if (body.time !== undefined) {
      if (week !== current) throw new HttpError(409, 'week-over');
      if (!isRunTime(body.time) || !isDriverName(body.name)) throw new HttpError(400, 'Bad run');
      const verdict = checkRun(weeklyChallenge(week), body.time, body.trace);
      if (verdict !== 'ok') throw new HttpError(422, verdict);
      run = { time: body.time, name: body.name };
    }
    const id = await accountIdFor(secret);
    const board = await env.WEEKLY.get(env.WEEKLY.idFromName(String(week))).board(week, id, run);
    if (board === 'too-often') throw new HttpError(429, 'too-often');
    return board;
  }
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      return Response.json(await handle(request, env), { headers: { ...cors, 'Cache-Control': 'no-store' } });
    } catch (error) {
      // Errors thrown in a Durable Object lose their class on the way.
      const status = error instanceof HttpError ? error.status : /Too many entries/.test(String(error)) ? 413 : 500;
      if (status === 500) console.error(error);
      return Response.json({ error: status === 500 ? 'Server error' : (error as Error).message }, { status, headers: cors });
    }
  },
} satisfies ExportedHandler<Env>;
