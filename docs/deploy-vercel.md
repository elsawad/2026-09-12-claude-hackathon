# Deploying to Vercel (free tier)

This covers the root-level app only (`src/` + `server/` + `api/`), not the `frontend/`/
`land-check/` track. The code is already Vercel-ready — this is the remaining manual setup,
which needs your own Vercel login and can't be done from here.

## Why this needed code changes at all

Local dev uses [PGlite](https://pglite.dev) (embedded Postgres) and local-disk photo storage —
both zero-setup, both **incompatible with Vercel**. Vercel functions are stateless: each
invocation can run in a different container with no persistent local disk across requests, so
an embedded file-backed database or a locally-saved upload has nowhere durable to live (the
same reason SQLite can't run on Vercel either). `server/db.ts` and `server/app.ts` now switch
based on environment:

| | Local dev (no env vars set) | Vercel (env vars set) |
|---|---|---|
| Database | PGlite, embedded | Postgres via `DATABASE_URL` (Neon) |
| Photo storage | `server/uploads/`, local disk | Vercel Blob via `BLOB_READ_WRITE_TOKEN` |
| Geo-data cache | `server/data/cache/` | `/tmp` (Vercel's only writable path) |

Nothing about the routes, the scoring pipeline, or the frontend changed.

## One-time setup

1. **Log in to Vercel CLI** (interactive, run it yourself):
   ```bash
   npx vercel login
   ```

2. **Link the project** (run from the `canopy-watch/` directory):
   ```bash
   npx vercel link
   ```
   When it asks for the project's root directory, confirm `canopy-watch` (or `.` if you're
   already inside it) — **not** the repo root, since `frontend/`/`land-check/` are a separate,
   unrelated app.

3. **Add a Postgres database** — in the Vercel dashboard, open the project → **Storage** tab →
   **Create Database** → **Neon** (or **Postgres**, which is Neon under the hood) → connect it
   to this project. This automatically sets `DATABASE_URL` in the project's environment
   variables — nothing to copy by hand.

4. **Add Blob storage** — same **Storage** tab → **Create Database** → **Blob** → connect it to
   this project. This automatically sets `BLOB_READ_WRITE_TOKEN`.

5. **Set the remaining environment variables** — dashboard → **Settings** → **Environment
   Variables**, or via CLI:
   ```bash
   npx vercel env add ANTHROPIC_API_KEY
   npx vercel env add OFFICER_PASSPHRASE
   ```

6. **Deploy:**
   ```bash
   npx vercel --prod
   ```

7. **Run the schema migration once against the new database** — it's the same idempotent
   `CREATE TABLE IF NOT EXISTS` schema as local dev, and `server/app.ts` already calls
   `migrate()` on cold start, so the first real request to the deployed app creates the tables
   automatically. No separate migration step needed.

8. **Seed or backfill (optional)** — `npm run seed` and `npm run score-backlog` both talk to
   whatever `DATABASE_URL`/API keys are in your local `.env`. To seed the *deployed* database,
   temporarily set `DATABASE_URL` in your local `.env` to the same Neon connection string
   Vercel is using (copy it from the dashboard), then run `npm run seed` locally — it'll write
   straight to the production database.

## Verifying it worked

- Visit the deployed URL — the resident app should load.
- Visit `<url>/officer` — log in with your `OFFICER_PASSPHRASE`, confirm the summary loads (an
  empty queue is fine if you haven't seeded/submitted anything yet).
- Submit one real report with a photo from a phone — confirm it appears in the officer queue and
  the photo renders (proves Blob storage is wired correctly).

## Known limitations of the deployed version

- **Rate limiting resets per cold start** — the per-IP submission cap is in-memory and isn't
  shared across serverless instances. Not a correctness issue, just a softer cap in practice
  than the same code running as one long-lived process.
- **First request after an idle period is slower** — a cold Vercel function plus a suspended
  Neon compute (Neon's free tier suspends after inactivity) adds a second or two of latency to
  the very first request. Everything after that is fast until the next idle period.
