# Canopy Watch — Team Build Plan
Claude Community Impact Lab Halifax, Sep 12 2026
Hard deadlines: open source on GitHub by **2:30**. Demos at **2:45**, three minutes each.

---

## How to use this document

Work top to bottom. Each step has an owner slot, a definition of done, and a stop rule.
**If a step runs past its stop time, ship what you have and move on.** The order is designed
so that if you stop at any point after Step 4, you still have a working demo.

Fill in names now, before you start:

| Role | Name | Owns |
|---|---|---|
| Backend / data | | Steps 2, 3, 5, 8 |
| Claude / scoring | | Steps 4, 9 |
| Resident front end | | Steps 6, 7 |
| Officer console | | Steps 10, 11 |
| Demo / narrative | | Step 12, plus the honesty slide throughout |

Everyone commits to the same repo from minute one. Open source on GitHub is a hard
requirement, so make the repo public *now*, not at 2:25.

---

## Step 0 — Setup (15 min, everyone, do this together)

- [ ] Create the public GitHub repo. Add a README with the one-paragraph pitch.
- [ ] Agree the stack out loud so nobody diverges: Vite + React, shared backend, hosted
      Postgres (Supabase or equivalent).
- [ ] Everyone clones, everyone can run the empty app locally.
- [ ] Create a shared scratch doc for API keys, endpoint URLs, and field names as you discover
      them. This saves an hour of "what was that URL again."

**Done when:** every person has the repo running locally and can push a commit.

---

## Step 1 — Confirm the data schemas (30 min, backend owner, in parallel with Step 0)

The dataset landing pages describe intent, not field names. You need the actual REST
endpoints before any join logic gets written.

For each dataset, hit the ArcGIS or Socrata REST endpoint directly in a browser and record the
real field names in the shared doc:

- [ ] Cityworks Service Requests — service request type, date, status, geometry
- [ ] Cityworks Work Orders — work order type, status, date, geometry
- [ ] NS Topographic Utilities — feature code field, geometry type (line vs point)
- [ ] HRM Park — polygon geometry, park name
- [ ] Street Centreline — line geometry, street name
- [ ] HRM municipal boundary — polygon for the geofence

**Stop rule:** 30 minutes. If a dataset won't cooperate, note it and move on. You need
utilities, park, and street centreline to work. The rest are enhancements.

**Done when:** the shared doc has real field names for at least utilities, HRM Park, street
centreline, and the municipal boundary.

---

## Step 2 — Database and schema (30 min, backend owner)

- [ ] Create the `reports` table per PRD section 10.
- [ ] Create the `audit_log` table.
- [ ] Seed with 5 fake reports so front end work can start immediately without waiting for
      the real submission flow.

**Done when:** front end owners can read 5 reports from the database.

**Why this is early:** it unblocks two people. Do not let front end work sit idle waiting for
a real pipeline.

---

## Step 3 — Geometry checks (45 min, backend owner)

Build these as standalone functions first, testable with a lat/lng, before wiring into
anything:

- [ ] `isInsideHRM(lat, lng)` → boolean. Municipal boundary polygon.
- [ ] `getLandStatus(lat, lng)` → `public_park` | `right_of_way` | `private` | `ambiguous`.
      Check HRM Park polygons first, then street centreline buffer, then default to private.
- [ ] `getUtilityProximity(lat, lng)` → `{ distance_m, feature_type }` or null.

Cache the layers locally on first load. Do not re-query the open data endpoint per report.

**Decision needed, make it now and write it down:** the street centreline buffer distance, and
the utility proximity buffer distance. Err wide on utilities. A false positive costs an
officer ten seconds, a false negative is a downed line nobody flagged.

**Done when:** you can pass in coordinates for a known Halifax park, a known street, and a
known residential backyard, and get the right answer for each.

---

## Step 4 — The Claude scoring call (45 min, Claude owner, parallel with Step 3)

This is the heart of the product. Build it standalone against sample inputs before it touches
the live pipeline.

- [ ] Write the prompt. Inputs: photo, description, questionnaire answers, land status,
      utility proximity, wind forecast, EAB flag, historical pattern note.
- [ ] Output must be strict JSON: `proposed_tier`, `reason`, `confidence`, `missing_detail`.
- [ ] Tier values exactly: `utility_emergency` | `imminent_hazard` | `routine` |
      `insufficient_info`.
- [ ] The prompt must explicitly permit `insufficient_info`. Do not force a guess.
- [ ] Photo content check rides the same call: does the photo plausibly show a tree hazard.

**Test against 10 real historical HRM tree service request descriptions.** Read the outputs
yourself. If the reasons are vague or generic, the prompt needs work, not the code.

**Done when:** 10 real historical descriptions produce 10 tiers with reasons you'd be
comfortable showing a judge.

---

## Step 5 — Precompute the backlog (30 min, backend owner)

- [ ] Pull tree-related service requests from the Cityworks Service Requests dataset.
- [ ] Run every one through the Step 4 scoring function.
- [ ] Commit the scored output as a JSON file in the repo.

**This is your safety net.** If live API calls fail during the demo, you still have real
Halifax data, really scored, sitting in the repo. It is also your evidence that the model
works on real inputs rather than on three cherry-picked examples.

**Done when:** a committed JSON file contains scored real reports and you can point at it.

---

## Step 6 — Resident app: emergency triage + submit flow (60 min, resident front end owner)

Build in this order:

- [ ] **Emergency triage screen first.** Three yes/no questions before anything else. "Touching
      a power line" routes straight out to 911 / NS Power 1-877-428-6004. This screen is
      non-negotiable and takes 10 minutes.
- [ ] Photo capture / upload. Use the file input with camera capture on mobile.
- [ ] EXIF GPS extraction, client side.
- [ ] Fallback chain: browser geolocation → map pin → typed address.
- [ ] Ownership questionnaire, pre-filled from the geometry result.
- [ ] Optional free-text description, any language.
- [ ] Submit → confirmation screen with the reference code.

**Stop rule:** if the fallback chain is eating time, ship EXIF plus map pin and drop the rest.
Two working paths beat four broken ones.

**Done when:** you can submit a report end to end on a phone.

---

## Step 7 — Resident app: map and confirmation (45 min, resident front end owner)

- [ ] Live map with pins, block-level placement not exact coordinates.
- [ ] Colour by tier.
- [ ] Tap pin → detail → "I see this too" confirm button.
- [ ] One confirmation per browser session per report (local storage token).
- [ ] Reference code lookup page.

**Done when:** two phones can see each other's reports and confirm them.

---

## Step 8 — Wire the backend pipeline together (45 min, backend owner)

Submission endpoint runs, in order:
1. Geofence check → reject if outside HRM
2. Land status check
3. Utility proximity check
4. Nearby duplicate check (~50m)
5. Historical pattern lookup
6. Wind forecast fetch
7. Claude scoring call
8. Write to database with `review_state = awaiting_review`
9. Write audit log entry

- [ ] If land status is private and the questionnaire agrees, divert: log as
      `diverted_private`, return the "here's what you can actually do" message, do not enter
      the work queue.

**Done when:** a real submission from a phone lands in the database, scored, with an audit
entry.

---

## Step 9 — Translation layer (30 min, Claude owner)

- [ ] Detect description language.
- [ ] If not English or French, translate for the officer view and keep the original.
- [ ] Respond to the resident in their own language.
- [ ] Attach the AI translation notice everywhere a translation is shown, both sides.

**Stop rule:** this is valuable but not load-bearing. If the clock is tight at this point,
skip it and mention it as designed-but-not-built in the demo. That is an honest answer and
costs you nothing.

---

## Step 10 — Officer console: summary view (45 min, officer console owner)

- [ ] Top-of-screen counts: awaiting review by tier, utility emergencies, new since last
      check, deflected count.
- [ ] Compact one-line-per-report list below.
- [ ] Utility emergencies always pinned above everything else.
- [ ] Sort by tier, then confidence.

**Design constraint to hold onto:** an officer should get what they need in 30 seconds. If
your summary screen needs scrolling to understand, it is wrong.

**Done when:** you can look at the screen and immediately say how many things need attention.

---

## Step 11 — Officer console: review actions (45 min, officer console owner)

- [ ] Report detail view showing every scoring input plainly.
- [ ] Original description always shown alongside any translation.
- [ ] Actions: accept tier / override tier (reason required) / escalate / in progress /
      resolve.
- [ ] Every action writes to the audit log.
- [ ] `awaiting_review` count on the summary decrements visibly when an action is taken.

**This is your liability answer and your best demo moment.** Show a judge the model proposing
and a human deciding, with both recorded.

**Done when:** you can review a report, override it, and see the audit trail.

---

## Step 12 — Demo prep (30 min, demo owner, start this by 1:45 regardless of progress)

Three minutes, tight:

- **0:00–0:20** The number. 2,000 requests in six months, 290 waiting, 2 to 3 days before
  anyone even looks at one.
- **0:20–1:00** Submit live from a phone. Photo of a tree taken outside. Watch it score,
  land on the map, and appear in the officer console.
- **1:00–1:30** The deflection. Show a private property report being diverted with a useful
  answer instead of a twelve month wait.
- **1:30–2:10** The officer console. Summary screen, 30 second check-in, override a tier with
  a reason, show the audit log.
- **2:10–2:40** The utility emergency path and the precomputed real backlog.
- **2:40–3:00** The honesty slide.

**Honesty slide, write it now not at 2:40:**
- Real: utilities layer, HRM Park, street centreline, historical service requests, live wind,
  live Claude scoring.
- Stubbed: officer auth, Cityworks write-back.
- Limitations: service request data ends Dec 2024, so live duplicate detection needs an HRM
  API that isn't public. Parcel ownership is a paid restricted licence, so we use a geometric
  proxy plus asking the resident. No ground truth on which trees actually failed, so no
  accuracy claim.

---

## Cut list, in order, if you fall behind

Cut from the bottom up:

1. Translation beyond English and French (Step 9)
2. Historical pattern lookup (part of Step 8)
3. Reference code lookup page (part of Step 7)
4. Escalate action (part of Step 11)
5. Wind forecast (part of Step 8)

**Never cut:** the emergency triage screen, the human-in-the-loop review flag, the private
property diversion, or the honesty slide. Those four are the product.

---

## Standing rules for the day

- **Commit often, to main.** No long-lived branches today.
- **Nobody blocks on anybody.** Seeded data in Step 2 exists so front end work never waits.
- **Timebox ruthlessly.** A step that runs 50% over gets cut, not extended.
- **One person owns the demo laptop** and runs the demo. Practise it once, out loud, by 2:20.
- **If something breaks at 2:35, demo the precomputed backlog.** It is real data, really
  scored, and it always works.
