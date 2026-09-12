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

First time only:

```bash
make install                        # frontend, server, and land-check (Python .venv) deps
cp server/.env.example server/.env
# edit server/.env and set ANTHROPIC_API_KEY — required for the Claude scoring/translation
# calls. Everything else (map, lookup, land check, console) works without it, but submitting
# a report will fail at the scoring step until it's set.
cd server && npm run seed && cd ..  # writes demo reports so the UI has something to show immediately
```

Then start all three services, each in its own terminal (they're long-running):

```bash
make dev-server      # Express API        — http://localhost:3001
make dev-land        # land-check FastAPI — http://localhost:8765
make dev-frontend    # Vite frontend      — http://localhost:5173
```

`make dev-land`'s first request is slow to respond right after boot — it loads the ~100MB local
GeoJSON/SQLite extracts (owned-land parcels, census areas, work orders) into memory on startup.
Watch its terminal for `Application startup complete` before expecting `http://localhost:8765` to
answer.

Once all three are up, a couple of quick checks confirm the frontend's dual proxy is wired
correctly (see `frontend/vite.config.ts`):

```bash
curl http://localhost:5173/api/health   # -> {"ok":true,...}      (proxied to Express, 3001)
curl http://localhost:5173/api/stats    # -> HRM-land stats JSON  (proxied to FastAPI, 8765)
```

Then open **http://localhost:5173** for the resident app (Report / Map / Check status / Land
check) and **http://localhost:5173/console** for the officer console.

**Only one process may hold the PGlite data directory (`server/data/`) open at a time** — never
run `npm run dev` and a one-off script (`seed`, `score-backlog`) against it simultaneously; stop
the dev server first.

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
  database. On submission (`server/src/pipeline.ts`) it runs, in order: geofence → utility
  proximity / nearby-duplicate check / live wind / EAB flag, gathered in parallel with →
  categorization (HRM-owned-land gate → population + nearby-work-order context → Claude scoring
  → HRM priority rule, see "How triage actually works" below) → translation (if needed) → insert +
  audit log.
- **Database** — [PGlite](https://pglite.dev) (embedded, single-process Postgres) instead of a
  hosted Supabase project. Chosen deliberately for a hackathon clock: zero external
  provisioning, zero Docker, real Postgres SQL underneath.
- **Claude** — `@anthropic-ai/sdk`, tool-forced structured output for triage scoring
  (`server/src/scoring.ts`) and translation (`server/src/translate.ts`).

See [`docs/data-sources.md`](docs/data-sources.md) for the real, verified REST endpoints and
field names behind every open-data layer — the landing pages describe intent, not field names,
and we hit the actual services directly rather than guessing.

## How triage actually works

A submission goes through `categorizeReport()` (`server/src/categorization.ts`), in order:

1. **Hard land-ownership gate.** `getHrmLandEvidence()` (`server/src/localContext.ts`) checks the
   point directly against the local `hrm_owned_land.geojson` parcel file — the same file
   `land-check/` uses — rather than the free geometric proxy (park polygon / street buffer) the
   PRD originally described. If the point isn't on HRM-owned land, the submission is rejected
   outright (`not_hrm_owned`) before Claude is ever called.
2. **Local context, gathered without an API call.** `getPopulationImpact()` places the point in a
   Census 2021 dissemination area and reports its population-density percentile; `getNearbyRequests()`
   queries the Cityworks work-orders SQLite extract for tree work orders within 50m and whether
   they're still open. Both feed the Claude prompt as supporting context, not as inputs Claude can
   look up itself.
3. **Claude picks a work category and an immediate-threat flag** (`server/src/scoring.ts`) — one
   of HRM's seven real work categories (tree assessment, chipping/brush removal, pruning/trimming,
   stump removal, tree removal, tree replacement, tree miscellaneous), a boolean for whether the
   evidence shows an immediate threat right now, and up to five specific `visible_hazard_signals`
   backing that call. If the tool output fails validation (e.g. `immediate_threat: true` with no
   supporting signals), the model gets one retry with the validation error attached before the
   submission is surfaced to the resident as `AI_UNAVAILABLE`.
4. **A pure function derives HRM's actual priority rule**, not Claude: `priorityFor()`
   (`server/src/categorization.ts`) only allows Priority 1 for the four categories that are ever
   urgent (chipping/brush, pruning, stump, removal) *and* only when `immediate_threat` is true —
   tree assessment/replacement/miscellaneous are always Priority 2, no matter what Claude reports.
   Priority 1 maps to tier `imminent_hazard`, Priority 2 to `routine`. A live utility-proximity hit
   still overrides everything to `utility_emergency`, same as before.

The officer console still runs on the older category (`utility`/`fallen`/`hanging_limb`/...) +
priority (`high`/`medium`/`low`) vocabulary from before this change — `legacyCategory()` in
`server/src/pipeline.ts` maps the new work category onto it so the console's queue, sort, and
clustering didn't need to change. The richer categorization (work category, immediate-threat
signals, population impact, nearby work orders) is preserved in the audit log and the creation
response, even though the console UI doesn't surface it yet.

## What's real vs. stubbed vs. a known limitation

**Real:** HRM-owned land parcels, NS Topographic Utilities, Street Centrelines, HRM municipal
boundary, Census 2021 population density, Cityworks Work Orders (all live/local open data),
live Open-Meteo wind, live Claude scoring + translation, the full human-in-the-loop review/audit
flow, the Land check tool.

**Stubbed / not built in this consolidation:**
- **Officer console has no login.** The PRD calls for a shared demo passphrase (real HRM SSO is
  named future work); that gate existed in one of the two pre-consolidation tracks but wasn't
  carried over, because the console UI kept here wasn't built with a login screen. `/console` is
  open to anyone who can reach the frontend.
- Cityworks write-back — nothing is dispatched to HRM's real system.

**Known limitations, stated rather than hidden:**
- **The private-property diversion from PRD §6.2 — described there as "the single highest-value
  feature for residents" — isn't in the current pipeline.** A report on land that isn't HRM-owned
  now gets a flat `not_hrm_owned` rejection (a 422 with the raw land-check result) rather than the
  PRD's friendly "here's what you can actually do, here's why it won't enter the queue" message.
  The resident app shows whatever plain-text error the server sends, which works but isn't the
  designed experience.
- **`insufficient_info` doesn't appear to be reachable from a real submission any more.** The new
  categorization path only ever resolves to `imminent_hazard` or `routine` (or `utility_emergency`
  on a hard utility-proximity hit) — there's no path back to "the model declines to guess, here's
  what's missing," which PRD §9 calls out as a required tier the prompt must explicitly permit.
- **District is always "unknown."** No HRM open-data layer in scope (PRD §5.1) gives a district
  number, so it isn't fabricated — the console already renders "unknown" as "Area unknown" and
  the district filter/sort just won't have much to group by until a real districts layer is
  wired in.
- **Block location falls back to raw coordinates** when the geometry check can't resolve a
  street or park name for a point.
- Full parcel *ownership* (as opposed to which parcels HRM itself owns) is still a paid,
  restricted provincial licence (~$8,786+tax, PRD §5.2) — the local `hrm_owned_land.geojson`
  check tells us whether HRM owns a given point, not who owns it if HRM doesn't.
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
- `server/src/geometry.ts` still runs `getLandStatus`/`resolveLandStatus` on every submission (its
  street/park name feeds `block_location`, and it still backs the resident-facing
  `/api/geometry-hint` pre-fill) and still owns utility-proximity/EAB/wind — but the reconciled
  public/private *result* no longer decides the outcome of a submission. That decision is now the
  hard HRM-owned-land gate in `server/src/localContext.ts` — see "How triage actually works" above.
- Officer console still runs on the older category + priority vocabulary (clustering, area
  filter, sort by either) rather than the newer work-category model Claude actually outputs —
  `legacyCategory()` bridges the two so the console didn't need a rebuild. See "How triage
  actually works" above.
- Land check (`land-check/`) stays a separate Python/FastAPI service rather than being ported
  into the TS backend — it already works, and re-implementing its Shapely point-in-polygon logic
  in Turf.js would just be re-doing solved work for the sake of one fewer process.
