/**
 * Synkserver för rally-sim. En Durable Object per konto håller kontots data i SQLite och slår
 * ihop ändringar från enheter enligt `replaces` i src/account/protocol.ts: för rekord vinner
 * lägsta tiden. Kontot lagras under SHA-256 av hemligheten, så servern ser aldrig hemligheten.
 * Upplägget kommer från season-o-meter (sync/ där).
 */

import { DurableObject } from 'cloudflare:workers';
import { accountIdFor, isSecret, replaces, sanitize, type AccountData, type Stamped, type SyncResponse } from '../../src/account/protocol';

/** Långt fler banor än spelet har, men hindrar ett konto från att växa utan gräns. */
const MAX_ENTRIES = 1000;
/** Några rekord med ghost får plats; ett åk på 90 s är cirka 90 kB. */
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

  /** Slår ihop enhetens data och returnerar det som ändrats sedan `since`. */
  sync(since: number, changes: AccountData): SyncResponse {
    return this.ctx.storage.transactionSync(() => {
      // Tabellen skapas först vid första synken, så en läsning av ett okänt konto lagrar inget.
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS entries (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          -- Ökas vid varje skrivning, så enheter kan fråga efter det som är nytt.
          seq INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS entries_seq ON entries (seq);
      `);
      const seq = this.lastSeq() + 1;
      for (const [key, incoming] of Object.entries(changes)) {
        const [row] = this.sql.exec<Row>('SELECT key, value, updated_at FROM entries WHERE key = ?', key).toArray();
        const existing: Stamped | undefined = row ? [row.value, row.updated_at] : undefined;
        if (!replaces(incoming, existing)) continue;
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
      // Ett kast rullar tillbaka transaktionen.
      if (count > MAX_ENTRIES) throw new HttpError(413, 'Too many entries');
      return {
        cursor: this.lastSeq(),
        changes: toData(this.sql.exec<Row>('SELECT key, value, updated_at FROM entries WHERE seq > ?', since)),
      };
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
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      return Response.json(await handle(request, env), { headers: { ...cors, 'Cache-Control': 'no-store' } });
    } catch (error) {
      // Fel som kastas i en Durable Object tappar sin klass på vägen.
      const status = error instanceof HttpError ? error.status : /Too many entries/.test(String(error)) ? 413 : 500;
      if (status === 500) console.error(error);
      return Response.json({ error: status === 500 ? 'Server error' : (error as Error).message }, { status, headers: cors });
    }
  },
} satisfies ExportedHandler<Env>;
