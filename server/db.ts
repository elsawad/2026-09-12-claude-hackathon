import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });

// Embedded, single-process Postgres. No Docker, no external project to
// provision mid-hackathon — the data directory just lives on disk here.
// PGlite corrupts if two processes open the same data dir at once, so only
// the API server (server/index.ts) or a one-off script should hold it open
// at a time; never run `npm run dev:server` and a script against the same
// data dir simultaneously.
export const db = new PGlite(path.join(__dirname, "data", "canopy-watch"));

export async function migrate() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
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
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      before TEXT,
      after TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS confirmations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      session_token TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (report_id, session_token)
    );

    CREATE INDEX IF NOT EXISTS reports_review_state_idx ON reports (review_state);
    CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status);
  `);
}

export function generateReferenceCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `CW-${code}`;
}
