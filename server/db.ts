import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface QueryResult {
  rows: any[];
}

export interface Db {
  query(sql: string, params?: any[]): Promise<QueryResult>;
}

/**
 * Local dev (default): PGlite, embedded single-process Postgres, zero
 * external setup. Only one process may hold its data directory open at a
 * time — never run the dev server and a script (seed, score-backlog)
 * against it simultaneously.
 *
 * Deployed (DATABASE_URL set — Vercel's Neon integration injects this):
 * real Postgres over `pg`. PGlite cannot run on Vercel at all — serverless
 * functions are stateless with no persistent local disk across
 * invocations, so an embedded file-backed database has nowhere durable to
 * live. This mirrors the same PGlite/SQLite-can't-run-on-Vercel pattern
 * from other projects; Neon is the same fix applied here.
 */
async function createDb(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    return {
      query: async (sql, params) => {
        const result = await pool.query(sql, params);
        return { rows: result.rows };
      }
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = path.join(__dirname, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const pglite = new PGlite(path.join(dataDir, "canopy-watch"));
  return {
    query: async (sql, params) => {
      const result = await pglite.query(sql, params);
      return { rows: result.rows as any[] };
    }
  };
}

export const dbPromise: Promise<Db> = createDb();

// One statement per array entry deliberately — PGlite's parameterized
// query() (unlike its exec()) runs a single statement at a time, and this
// keeps the exact same migrate() working against real Postgres too.
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reference_code TEXT NOT NULL UNIQUE,

    photo_url TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    location_source TEXT NOT NULL,

    description_original TEXT,
    description_language TEXT,
    description_translated TEXT,
    translation_is_ai BOOLEAN NOT NULL DEFAULT false,

    questionnaire_location_answer TEXT,
    questionnaire_danger_answer TEXT,

    land_status TEXT NOT NULL,
    land_status_source TEXT NOT NULL,

    proposed_tier TEXT,
    reason TEXT,
    confidence DOUBLE PRECISION,
    missing_detail TEXT,

    utility_proximity_m DOUBLE PRECISION,
    utility_feature_type TEXT,

    wind_context TEXT,
    eab_flag BOOLEAN NOT NULL DEFAULT false,

    historical_pattern_note TEXT,

    confirmation_count INTEGER NOT NULL DEFAULT 0,
    last_confirmed_at TIMESTAMPTZ,

    review_state TEXT NOT NULL DEFAULT 'awaiting_review',
    final_tier TEXT,
    override_reason TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,

    status TEXT NOT NULL DEFAULT 'new',
    pre_flagged_urgent BOOLEAN NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    before TEXT,
    after TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS confirmations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    session_token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (report_id, session_token)
  )`,
  `CREATE INDEX IF NOT EXISTS reports_review_state_idx ON reports (review_state)`,
  `CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status)`
];

let migrated = false;

/** Idempotent (CREATE ... IF NOT EXISTS) — safe to call on every cold start. */
export async function migrate() {
  if (migrated) return;
  const db = await dbPromise;
  for (const statement of SCHEMA_STATEMENTS) {
    await db.query(statement);
  }
  migrated = true;
}

export function generateReferenceCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `CW-${code}`;
}
