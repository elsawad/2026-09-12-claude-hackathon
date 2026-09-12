# Canopy Watch

**HRM receives ~2,000 tree-related service requests every six months. About 290 are waiting at
any given time, and none of them gets looked at by a human for 2-3 days.** Canopy Watch doesn't
replace the arborist who makes the real call — it removes the lead time before they even see the
request. A resident reports a hazardous tree from their phone in under 30 seconds; the backend
verifies it against real HRM and provincial open data, pre-triages it against HRM's own published
service standards, and hands a city officer a one-glance summary they can accept or override in
seconds, with every decision — model and human — logged immutably.

Built at the Claude Community Impact Lab, Halifax, Sep 12 2026. Full spec: [`canopy-watch-prd_1.md`](canopy-watch-prd_1.md) and [`canopy-watch-build-plan.md`](canopy-watch-build-plan.md).

## What's in this repo

Two tracks were built in parallel early on and have since been consolidated into one app,
living in `frontend/` + `server/`:

| | Frontend | Backend |
|---|---|---|
| Stack | `frontend/` — Vite + React + TypeScript, `make dev-frontend`, **http://localhost:5173** | `server/src/` — Express + TypeScript, `make dev-server`, **http://localhost:3001** |
| Land/geometry check | `server/src/geometry.ts` (Turf.js against live HRM/NS ArcGIS+Socrata layers, see `docs/data-sources.md`) | |
| Data store | [PGlite](https://pglite.dev) (embedded Postgres, see below) | |

`land-check/` is a separate, standalone tool (Python/FastAPI + Shapely) that plots real Cityworks
work orders against HRM-owned land parcels — it doesn't share data with the resident/officer app
and is deliberately kept as its own process rather than ported into the TS backend.

## Setup

```bash
make install          # frontend, server, and land-check (creates a Python .venv) deps
cp server/.env.example server/.env
# edit server/.env and set ANTHROPIC_API_KEY
cd server && npm run seed && cd ..   # writes demo reports so the UI has something to show immediately
```

Then, in three separate terminals:

```bash
make dev-server      # Express API, http://localhost:3001
make dev-land        # land-check FastAPI, http://localhost:8765
make dev-frontend     # Vite frontend, http://localhost:5173
```

Open **http://localhost:5173** for the resident app (Report / Map / Check status / Land check)
and **http://localhost:5173/console** for the officer console.

**Only one process may hold the PGlite data directory (`server/data/`) open at a time** — never
run `npm run dev` and a one-off script (`seed`, `score-backlog`) against it simultaneously.

To (re)generate the precomputed, real-data demo fallback:

```bash
cd server && npm run score-backlog   # scores the 20 most recent real HRM tree service requests
```

This writes `data/scored-backlog.json` at the repo root, committed to the repo — real Halifax
data, really scored by Claude, so the demo has a safety net if live calls fail and evidence the
model works on real inputs rather than three cherry-picked examples.

## Human in the loop, always

Every report gets a proposed category, priority, and (derived) HRM service-standard tier from
Claude — and nothing more. No report auto-closes, no report auto-dispatches. An officer accepts,
overrides (reason required), escalates, in-progresses, or resolves — and that action is the only
thing that ever changes a report's real status. The `awaiting_review` count is the headline number
on the officer console for exactly that reason.

## Architecture

- **Resident app** — Vite + React + TypeScript (`frontend/src/`, routes `/`, `/report`, `/map`,
  `/lookup`, `/land`). Emergency triage screen first, then photo/EXIF capture, a free
  geolocation→map-pin→typed-address fallback chain, an ownership questionnaire pre-filled from
  geometry, submit → reference code, a block-level live map with "I see this too" confirmation,
  and a reference-code status lookup.
- **Officer console** — same app, `/console` route (`frontend/src/console/Console.tsx`). Queue
  filters (queue/escalated/reviewed/deflected), sort (priority/date/area), a district filter,
  50m-proximity clustering of nearby reports, and per-report accept/override/escalate/
  in-progress/resolve actions, each writing to the audit log.
- **Backend** (`server/src/`) — the only thing that talks to Claude, HRM/NS open data, and the
  database. On submission it runs, in order: geofence → land status → utility proximity →
  nearby-duplicate check → historical pattern lookup → live wind → translation (if needed) →
  Claude scoring → insert + audit log.
- **Database** — [PGlite](https://pglite.dev) (embedded, single-process Postgres) instead of a
  hosted Supabase project. Chosen deliberately for a hackathon clock: zero external
  provisioning, zero Docker, real Postgres SQL underneath.
- **Claude** — `@anthropic-ai/sdk`, tool-forced structured output for triage scoring
  (`server/src/scoring.ts`) and translation (`server/src/translate.ts`).

See [`docs/data-sources.md`](docs/data-sources.md) for the real, verified REST endpoints and
field names behind every open-data layer — the landing pages describe intent, not field names,
and we hit the actual services directly rather than guessing.

## How triage actually works

Claude doesn't pick an HRM tier directly. It picks a **category** (utility / fallen /
hanging_limb / pruning / stump / disease / blockage / other) and a **priority** (high / medium /
low) — the same vocabulary the officer console's queue, sort, and clustering are built around —
and a pure function (`tierFrom` in `server/src/review.ts`) derives the PRD's four tiers
(`utility_emergency` / `imminent_hazard` / `routine` / `insufficient_info`) from that for the
resident-facing confirmation screen, the public map, and SLA labels. Category `other` + priority
`low` is the explicit "I don't have enough to go on" combination — Claude is instructed to use it,
with `missing_detail` filled in, rather than guess. A live utility-proximity hit always overrides
the model's own category/priority, the same way it overrode tier in the PRD's original design.

## What's real vs. stubbed vs. a known limitation

**Real:** NS Topographic Utilities, HRM Parks, Street Centrelines, HRM municipal boundary (all
live open data, cached locally), Cityworks Service Requests + Work Orders (live, current through
Sept 2026 — see the correction in `docs/data-sources.md`), live Open-Meteo wind, live Claude
scoring + translation, the full human-in-the-loop review/audit flow, the Land check tool.

**Stubbed / not built in this consolidation:**
- **Officer console has no login.** The PRD calls for a shared demo passphrase (real HRM SSO is
  named future work); that gate existed in one of the two pre-consolidation tracks but wasn't
  carried over, because the console UI kept here wasn't built with a login screen. `/console` is
  open to anyone who can reach the frontend.
- Cityworks write-back — nothing is dispatched to HRM's real system.

**Known limitations, stated rather than hidden:**
- **District is always "unknown."** No HRM open-data layer in scope (PRD §5.1) gives a district
  number, so it isn't fabricated — the console already renders "unknown" as "Area unknown" and
  the district filter/sort just won't have much to group by until a real districts layer is
  wired in.
- **Block location falls back to raw coordinates** when the geometry check can't resolve a
  street or park name for a point (e.g. genuinely private land away from any street).
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
  CFIA's precise 2018 boundary (documented in `server/src/eab.ts`).

## Decisions made and written down

- Street right-of-way buffer: 10m. Utility-emergency buffer: 30m, erring wide on purpose — a
  false positive costs an officer ten seconds to downgrade, a false negative could miss a real
  downed line. Full rationale in `docs/data-sources.md`.
- Land status resolution (`server/src/geometry.ts: resolveLandStatus`): geometry and
  questionnaire are reconciled, not one blindly overriding the other — only explicit agreement
  that land is private triggers diversion out of the work queue.
- Officer console model is category + priority (clustering, area filter, sort by either), not a
  tier Claude picks directly — the four PRD tiers are a derived label (`tierFrom`) for SLA
  display, not the model's primary output. See "How triage actually works" above.
- Land check (`land-check/`) stays a separate Python/FastAPI service rather than being ported
  into the TS backend — it already works, and re-implementing its Shapely point-in-polygon logic
  in Turf.js would just be re-doing solved work for the sake of one fewer process.
