# Canopy Watch

**HRM receives ~2,000 tree-related service requests every six months. About 290 are waiting at
any given time, and none of them gets looked at by a human for 2-3 days.** Canopy Watch doesn't
replace the arborist who makes the real call — it removes the lead time before they even see the
request. A resident reports a hazardous tree from their phone in under 30 seconds; the backend
verifies it against real HRM and provincial open data, pre-triages it against HRM's own published
service standards, and hands a city officer a one-glance summary they can accept or override in
seconds, with every decision — model and human — logged immutably.

Built at the Claude Community Impact Lab, Halifax, Sep 12 2026. Full spec: [`canopy-watch-prd_1.md`](canopy-watch-prd_1.md) and [`canopy-watch-build-plan.md`](canopy-watch-build-plan.md).

## Two implementations currently in this repo

Two tracks were built in parallel and haven't been consolidated yet — both are kept so nothing
gets lost before the team picks (or merges) one. **Pick whichever matches what you're demoing.**

| | This track (repo root) | The other track |
|---|---|---|
| Frontend | `src/` — Vite+React+TS, `npm run dev`, **http://localhost:5190** | `frontend/` — Vite+React+TS, `make dev-frontend`, http://localhost:5173 |
| Backend | `server/*.ts` — Express+TS, same `npm run dev`, API on `API_PORT` (default **8787**) | `server/src/index.ts` — Express+TS, `make dev-server`, http://localhost:3001 |
| Land/geometry check | `server/geometry.ts` (Turf.js against live HRM/NS ArcGIS+Socrata layers, see `docs/data-sources.md`) | `land-check/` — Python/FastAPI, `make dev-land`, http://localhost:8765, against `hrm_owned_land.geojson` / `Census_2021_Dissemination_Areas...geojson` |
| Data store | [PGlite](https://pglite.dev) (embedded Postgres, see below) | (see `frontend/README.md` / `server/Makefile`) |
| Run everything | `npm install && npm run dev` (below) | `make install && make dev-server && make dev-land && make dev-frontend` (see `frontend/README.md`) |

Nothing under `frontend/`, `land-check/`, or `server/src/` was touched to produce this README —
that track's own `frontend/README.md` has its details. The rest of this file documents the
root-level track only.

## Human in the loop, always

Every report gets a proposed tier from Claude and nothing more. No report auto-closes, no report
auto-dispatches. An officer accepts, overrides (reason required), escalates, or resolves — and
that action is the only thing that ever changes a report's real status. The `awaiting_review`
count is the headline number on the officer console for exactly that reason.

## Architecture (root-level track)

- **Resident app** — Vite + React + TypeScript, mobile-first, installable PWA (`/`).
- **Officer console** — same app, `/officer` route, passphrase-gated demo access.
- **Backend** — Express API (`server/`), the only thing that talks to Claude, HRM/NS open data,
  and the database.
- **Database** — [PGlite](https://pglite.dev) (embedded, single-process Postgres) instead of a
  hosted Supabase project. Chosen deliberately for a hackathon clock: zero external
  provisioning, zero Docker, real Postgres SQL underneath. **Only one process may hold the data
  directory open at a time** — never run the dev server and a script (`seed`, `score-backlog`)
  against it simultaneously.
- **Claude** — `@anthropic-ai/sdk`, tool-forced structured output for both triage scoring
  (`server/scoring.ts`) and translation (`server/translate.ts`).

See [`docs/data-sources.md`](docs/data-sources.md) for the real, verified REST endpoints and
field names behind every open-data layer — the landing pages describe intent, not field names,
and we hit the actual services directly rather than guessing.

## Setup (root-level track)

```bash
npm install
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY
npm run seed        # writes 5 sample reports so the UI has something to show immediately
npm run dev         # starts the Express API (8787) + Vite client (5190) together
```

Open http://localhost:5190 for the resident app, http://localhost:5190/officer for the officer
console (passphrase defaults to `canopy` — set `OFFICER_PASSPHRASE` in `.env` to change it).

To (re)generate the precomputed, real-data demo fallback:

```bash
npm run score-backlog        # scores 20 most recent real HRM tree service requests
```

This writes `data/scored-backlog.json`, committed to the repo — real Halifax data, really
scored by Claude, so the demo has a safety net if live calls fail and evidence the model works
on real inputs rather than three cherry-picked examples.

## What's real vs. stubbed vs. a known limitation

**Real:** NS Topographic Utilities, HRM Parks, Street Centrelines, HRM municipal boundary (all
live open data, cached locally), Cityworks Service Requests + Work Orders (live, current through
Sept 2026 — see the correction in `docs/data-sources.md`), live Open-Meteo wind, live Claude
scoring + translation, the full human-in-the-loop review/audit flow.

**Stubbed for the demo:** officer authentication (shared passphrase, not real HRM SSO),
Cityworks write-back (nothing is dispatched to HRM's real system).

**Known limitations, stated rather than hidden:**
- Parcel ownership is a paid, restricted provincial licence (~$8,786+tax) — we use a free
  geometric proxy (HRM Park polygon / street-centreline buffer) plus asking the resident
  directly, per PRD §5.2.
- Even though the Cityworks data turned out to be current (not frozen at Dec 2024 as the PRD
  first assumed — see `docs/data-sources.md`), it's still a periodic open-data extract, not
  HRM's live internal queue — an integration requirement, not a hidden gap.
- No ground truth on which trees actually failed, so no accuracy claim is made — only that the
  model reproduces HRM's own stated priority split on real historical inputs
  (`data/scored-backlog.json`).
- The emerald ash borer regulated-area flag is simplified to "inside HRM ⇒ flagged" rather than
  CFIA's precise 2018 boundary (documented in `server/eab.ts`).

## Decisions made and written down

- Street right-of-way buffer: 10m. Utility-emergency buffer: 30m, erring wide on purpose — a
  false positive costs an officer ten seconds to downgrade, a false negative could miss a real
  downed line. Full rationale in `docs/data-sources.md`.
- Land status resolution (`server/geometry.ts: resolveLandStatus`): geometry and questionnaire
  are reconciled, not one blindly overriding the other — only explicit agreement that land is
  private triggers diversion out of the work queue.
