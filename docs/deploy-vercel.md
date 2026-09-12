# Deploying to Vercel (free tier)

This covers the whole consolidated app (`frontend/` + `server/src/` + `api/`) — not
`land-check/`, which is a separate Python/FastAPI tool kept out of this deploy on purpose (see
the README's "What's in this repo" section).

## Why this needed code changes at all

Local dev uses [PGlite](https://pglite.dev) (embedded Postgres) and local-disk photo storage —
both zero-setup, both **incompatible with Vercel**. Vercel functions are stateless: each
invocation can run in a different container with no persistent local disk across requests, so
an embedded file-backed database or a locally-saved upload has nowhere durable to live (the
same reason SQLite can't run on Vercel either). `server/src/db.ts` and `server/src/app.ts` now
switch based on environment:

| | Local dev (no env vars set) | Vercel (env vars set) |
|---|---|---|
| Database | PGlite, embedded | Postgres via `DATABASE_URL` (Neon) |
| Photo storage | `server/uploads/`, local disk | Vercel Blob via `BLOB_READ_WRITE_TOKEN` |
| Geo-data cache | `server/data/cache/` | `/tmp` (Vercel's only writable path) |

Nothing about the routes, the scoring pipeline, or the frontend changed. `server/src/index.ts`
is now just a thin local-dev entrypoint (`app.listen(...)`); the actual Express app lives in
`server/src/app.ts` so `api/index.ts` (Vercel's serverless function convention) can import and
export it directly without starting a listener.

## Why `vercel.json` has a custom install/build command

There's no root-level `package.json` in this repo on purpose — `frontend/` and `server/` are
two independent npm projects, kept clean and separate for local dev (`make dev-frontend`,
`make dev-server`). Vercel's zero-config install step only looks at the project root, so
`vercel.json` tells it explicitly to install both:

```json
"installCommand": "npm install --prefix frontend && npm install --prefix server"
```

`api/index.ts` imports `../server/src/app.js`, which in turn imports `express`, `pg`,
`@vercel/blob`, etc. — Node resolves those against `server/node_modules` (walking up from the
importing file), which is why `server`'s deps need to be installed too, not just `frontend`'s.

## One-time setup

1. **Log in to Vercel CLI** (interactive, run it yourself):
   ```bash
   npx vercel login
   ```

2. **Link the project** (run from the repo root — `canopy-watch/`):
   ```bash
   npx vercel link
   ```

3. **Add a Postgres database** — in the Vercel dashboard, open the project → **Storage** tab →
   **Create Database** → **Neon** (or **Postgres**, which is Neon under the hood) → connect it
   to this project. This automatically sets `DATABASE_URL` in the project's environment
   variables — nothing to copy by hand.

4. **Add Blob storage** — same **Storage** tab → **Create Database** → **Blob** → connect it to
   this project. This automatically sets `BLOB_READ_WRITE_TOKEN`.

5. **Set the remaining environment variable:**
   ```bash
   npx vercel env add ANTHROPIC_API_KEY
   ```

6. **Deploy:**
   ```bash
   npx vercel --prod
   ```

7. **Schema migration runs itself** — it's the same idempotent `CREATE TABLE`/`ALTER TABLE ...
   IF NOT EXISTS` schema as local dev, and `server/src/app.ts` already calls `migrate()` on cold
   start, so the first real request to the deployed app creates the tables automatically.

8. **Seed or backfill (optional)** — `npm run seed` and `npm run score-backlog` (run from
   `server/`) both talk to whatever `DATABASE_URL`/API keys are in `server/.env`. To seed the
   *deployed* database, temporarily set `DATABASE_URL` in `server/.env` to the same Neon
   connection string Vercel is using (copy it from the dashboard), then run `npm run seed`
   locally — it writes straight to the production database.

## Verifying it worked

- Visit the deployed URL — the resident app (Report / Map / Check status / Land check) should
  load.
- Visit `<url>/console` — confirm the officer queue loads (empty is fine if nothing's been
  seeded/submitted yet). There's no login gate on this console currently — see the README's
  "Stubbed / not built" section.
- Submit one real report with a photo from a phone — confirm it appears in the officer queue and
  the photo renders (proves Blob storage is wired correctly).

## If the build fails on the `api/index.ts` function

This is the one part of this setup I couldn't fully test without a live Vercel account — the
custom install command for a package.json-less root is a documented, supported pattern, but if
the function build can't resolve `express`/`pg`/etc.:

- Confirm `installCommand` actually ran (check the build logs) and that it ran *before* the
  function bundling step.
- As a fallback, add a minimal root `package.json` (just `{"type": "module"}` plus the same
  `dependencies` as `server/package.json`) so Vercel's default install step covers the function
  without a custom command — more duplication, but zero ambiguity.

## Known limitations of the deployed version

- **Rate limiting resets per cold start** — the per-IP submission cap is in-memory and isn't
  shared across serverless instances. Not a correctness issue, just a softer cap in practice
  than the same code running as one long-lived process.
- **First request after an idle period is slower** — a cold Vercel function plus a suspended
  Neon compute (Neon's free tier suspends after inactivity) adds a second or two of latency to
  the very first request. Everything after that is fast until the next idle period.
- **No officer login** — carried over from the current `main`, not something this deploy work
  added or removed.
