# Canopy Watch — Halifax Tree Hazard Reporting & Triage
Product Requirements Document (v3)
Claude Community Impact Lab Halifax, Sep 12 2026

---

## 1. Problem

HRM receives about 2,000 tree-related service requests every six months. Every one needs a
site visit before anyone knows whether it is a branch about to hit a house or a nuisance
complaint. Roughly 290 are waiting at any given time.

HRM's own published policy defines the two outcomes that matter: a tree showing an imminent
hazard gets a 24 hour service standard, routine pruning or removal gets up to 12 months.
That split is decided today by a human arborist reading each request in turn, and the review
lead time before a request is even assessed runs roughly 2 to 3 days.

**The core insight driving this product:** we are not trying to remove the arborist. We are
trying to remove the 2 to 3 days of lead time *before* the arborist looks. A pre-triaged,
pre-verified, pre-summarized request lets a city worker make the same decision in thirty
seconds that currently takes days to reach them.

## 2. Goals

A working system that takes a resident's tree report, cheaply verifies it against real HRM
and provincial data, pre-triages it using HRM's own service standards, and presents it to a
city worker as a summary they can accept or override in seconds.

Success by 2:30:
- Resident submits a report from a phone in under 30 seconds.
- System reproduces the 24hr/12-month split on real historical HRM data, with visible reasoning.
- Reports near power infrastructure flag as a distinct utility emergency.
- Reports on private property are identified and diverted before they enter the city queue.
- City console shows a summarized, one-glance view with an explicit human-in-the-loop
  decision on every item.
- Works from a phone browser, installable to home screen, no app store.

Out of scope: real staff auth, live Cityworks write-back, hardware.

## 3. Guiding principles

1. **Human in the loop, always.** Every scored report requires a human decision before it
   becomes city action. Nothing auto-closes, nothing auto-dispatches. The model proposes,
   the arborist disposes.
2. **Reduce lead time, not headcount.** The value is speed to first assessment, not replacing
   judgment.
3. **Deflect before collecting.** A report we can resolve, divert, or merge is worth more
   than a report we add to the queue.
4. **Anonymous by default.** No reporter identity is collected or displayed, ever.
5. **Say what's uncertain.** Model confidence, translation quality, and data staleness are
   always surfaced, never hidden.

## 4. The three sides

**A. Resident app (public).** Report a tree, see the live map, confirm others' reports.
No login, no identity, no account.

**B. City officer console (internal).** Summarized, prioritized queue with an explicit
human-in-the-loop review flag on every item. Built for a 30 second check-in, not a long
session.

**C. Unified backend.** One API and data layer serving both. All verification, scoring, data
cross-referencing, and Claude calls happen here. Both front ends stay thin.

---

## 5. Data sources

### 5.1 Confirmed and in scope

**Nova Scotia Topographic Database — Utilities Map** (provincial, free)
`data.novascotia.ca/Environment-and-Energy/Nova-Scotia-Topographic-DataBase-Utilities-Map/x39x-aw9i`
Pipelines, tanks, electrical substations, transmission lines and towers, maintained from
aerial photography and verified with field inspections. Drives the utility emergency flag.

**Cityworks Service Requests (HRM)**
`data-hrm.hub.arcgis.com/datasets/d2b7dd138adb468293183926a1a7a81c_0/explore`
HRM's own table of service requests from Cityworks, their work order management system.

**Cityworks Work Orders (HRM)**
`data-hrm.hub.arcgis.com/datasets/HRM::cityworks-work-orders/explore`
Work orders for right-of-way maintenance carried out by Public Works.

**HRM Park** (public land layer)
HRM owned park data, containing parks HRM owns and has an interest in (maintained, leased,
etc), compiled from multiple sources including staff site visits.

**HRM Park Recreation Features**
Point representation of HRM owned or maintained outdoor recreational uses, refreshed daily.
Useful as a secondary public-land signal (playgrounds, sports fields, beaches).

**Street Centreline (HRM)**
Single line representation of every street in HRM with street names, types, and address block
face ranges. Buffered, this is the practical right-of-way proxy.

**Building Polygon / Civic Address (HRM)**
Building footprints and civic address points. Used for consequence assessment (is there a
structure inside the fall radius).

### 5.2 Known data limitation: parcel ownership is not free

Full parcel-level ownership is held in the Nova Scotia Property Records Database, maintained
by Service Nova Scotia's LANDS Program and distributed by GeoNOVA. It is sold under a
restricted data use licence, with full provincial coverage priced at roughly $8,786 plus tax,
and the corresponding map service is licence-gated. It is also explicitly *not* conclusive
evidence of property boundaries, suitable for graphical representation only.

**Therefore we do not attempt authoritative ownership lookup.** We use a two-part proxy:

1. **Geometric proxy (automatic).** Is the report inside an HRM Park polygon, or within a
   buffer of the street centreline (the right of way)? If yes → likely public. If neither →
   likely private.
2. **Questionnaire (asks the human).** Where geometry is ambiguous, ask the resident directly.

This is honest, free, and arguably better than a paid parcel layer, because the resident
standing in front of the tree knows things the geometry does not.

### 5.3 Known data limitation: service request data is a snapshot

HRM service request open data ends December 2024 and is published as a periodic snapshot, not
a live feed. **We therefore cannot do live duplicate detection against HRM's current queue.**
What we can do, and what we will claim:
- Historical pattern check: has this address generated tree complaints before?
- Historical work order check: has work been done here before?
- We state plainly in the demo that live duplicate detection requires an API HRM has
  internally but does not publish. This is a named integration requirement, not a hidden gap.

---

## 6. Resident app

### 6.1 Emergency triage first (before the form)

The very first screen, before any photo upload, asks three yes/no questions:

- Is the tree or branch touching, leaning on, or near a power line?
- Is it blocking a road, sidewalk, or driveway right now?
- Has it already fallen on a building, vehicle, or person?

Any "yes" on the first question routes immediately out of the app: **call 911 if anything is
touching a live line, or Nova Scotia Power at 1-877-428-6004 to report a downed line.** The
app does not try to capture these. Somebody looking at a branch on a live wire should not be
filling out a form.

"Yes" on questions two or three continues into the form but pre-flags the report as urgent.

### 6.2 Ownership questionnaire

After location is captured, the backend runs the geometric proxy and asks a short
confirmation questionnaire, pre-filled with its best guess:

1. **Where is the tree?** (pre-selected from geometry: on a street or sidewalk / in a public
   park / on private property / not sure)
2. **Is it dangerous right now?** (blocking something / hanging over something / looks unwell
   but not urgent / not sure)
3. **Optional:** anything else we should know (free text, any language)

If the answer indicates private property, the resident gets an immediate, useful response
rather than a false promise: HRM handles municipal trees and right-of-way blockages, private
trees and debris on private property are the homeowner's responsibility, here is what you can
actually do. The report is logged as a private-property case for statistics but does not enter
the city work queue.

**This is the single highest-value feature for residents in the product.** Today they wait
months to find out the city was never going to come.

### 6.3 Location capture

Fallback chain, all free:
1. EXIF GPS from the photo (client side, no API call).
2. Browser geolocation permission.
3. Drop a pin on a map.
4. Type an address (free geocoding, no paid API).

Assume EXIF is frequently stripped by messaging apps, treat it as the lucky case not the
default.

### 6.4 Language

- **English and French are first class.** Full UI, full confirmation messaging, no caveat.
- **Other languages are supported via AI translation**, with a persistent, visible notice:
  *"This translation was generated by AI and may not be fully accurate."*
- Residents may write their description in any language; Claude reads it and responds in the
  same language, with the same notice attached when it is not English or French.
- Officer console always displays the original text alongside the English translation, so a
  city worker is never acting on a translation alone.

### 6.5 Anonymity

**All reports are anonymous. Always.** No name, no account, no contact info required or
stored. The submit screen states this plainly.

Consequence accepted deliberately: we cannot notify a reporter directly. Instead, every
submission returns a **report reference code**, and a public lookup page lets anyone check the
status of a code. Status is public information tied to a code, not to a person. Tree disputes
between neighbours are real, and anonymity is what makes people willing to report the tree
next door.

### 6.6 Live map

- Pins shown at **block level, not exact coordinates**, on the public map. A public map of
  hazards pinned to exact private addresses is a privacy problem.
- Colour coded by tier.
- Tap to see status and confirm ("I see this too").
- One confirmation per browser session per report.

---

## 7. City officer console

Designed around a single constraint: **an officer should be able to check in for 30 seconds
and leave knowing what matters.** Not a dashboard to explore. A shift summary to act on.

### 7.1 Summary view (the landing screen)

Top of screen, at a glance:
- Count awaiting human review, by tier.
- Utility emergencies (always surfaced separately, above everything).
- New since last check-in.
- Count deflected automatically (private property, duplicates, resolved-by-photo), i.e. work
  that did *not* land in the queue.

Then a compact list, each row one line: thumbnail, block-level location, tier, one-sentence
reason, confidence, confirmation count, review flag.

### 7.2 Human-in-the-loop review flag

Every scored report carries an explicit review state, visible at all times:

- `awaiting_review` — model has scored it, no human has looked. Default state for everything.
- `reviewed_accepted` — officer agrees with the model's tier.
- `reviewed_overridden` — officer changed the tier, reason required.
- `escalated` — sent up for a second opinion.

**Nothing leaves `awaiting_review` without a human action. No report auto-closes, no report
auto-dispatches.** The queue counter for `awaiting_review` is the headline number on the
summary screen, because it is the number that tells an officer whether they are on top of it.

### 7.3 Report detail

- Full photo and original description (plus translation if applicable, original always shown).
- All scoring inputs displayed plainly: what the geometry said, what the utility check said,
  wind context, questionnaire answers, historical pattern findings, model confidence.
- Actions: accept tier, override tier (reason required), escalate, mark in progress, resolve.
- Every action is logged with timestamp, officer identifier, and the model's original output
  preserved alongside.

### 7.4 Audit log

Every decision, model and human, is stored immutably. This is the liability answer made
concrete: any outcome can be reconstructed showing exactly what the model said, what the
human decided, and when.

### 7.5 Access

Shared passphrase for the demo. Real HRM staff SSO is named future work.

---

## 8. Verification layers (unified backend)

| Layer | Check | Cost | Blocking? |
|---|---|---|---|
| 1 | Photo content matches a tree hazard (Claude vision) | Rides existing call | Yes, rejects spam |
| 2 | Inside HRM boundary (geofence) | Free, local polygon | Yes |
| 3 | Public vs private land (HRM Park + street centreline buffer) | Free, cached layers | No, routes |
| 4 | Questionnaire answers | Free | No, informs |
| 5 | Utility proximity (NS Topographic Utilities) | Free, cached layer | No, flags |
| 6 | Nearby Canopy Watch duplicate (~50m) | Local DB query | No, offers merge |
| 7 | Historical pattern (Cityworks SR + WO, pre-Dec 2024) | Free, cached | No, informs |
| 8 | Social confirmation and decay | Free | No, adjusts confidence |
| 9 | Rate limit per browser session | Free | Yes, soft cap |

---

## 9. Prioritization model

Tiers, in order:

- **Utility emergency** — within buffer of a utility feature. Distinct handling and messaging.
- **Imminent hazard** — HRM's own 24 hour service standard.
- **Routine** — HRM's own up-to-12-month standard.
- **Insufficient information** — model declines to guess, names the specific missing detail.
- **Private property (diverted)** — not a city work item, logged for statistics only.

One Claude call per report receives: photo, description, questionnaire answers, public/private
geometry result, utility proximity result, current wind forecast (free keyless API), EAB
context flag, historical pattern result.

Returns: tier, one-sentence plain-language reason, confidence, missing-detail prompt if
insufficient.

**The model never sets final status.** It sets a proposed tier and a review flag.

---

## 10. Data model

```
reports
  id, created_at, reference_code
  photo_url
  lat, lng, location_source
  description_original, description_language, description_translated
  translation_is_ai (boolean)
  questionnaire_location_answer, questionnaire_danger_answer
  land_status (public_park / right_of_way / private / ambiguous)
  land_status_source (geometry / questionnaire / both_agree / conflict)
  proposed_tier, reason, confidence
  utility_proximity_m, utility_feature_type
  wind_context, eab_flag
  historical_pattern_note
  confirmation_count, last_confirmed_at
  review_state (awaiting_review / reviewed_accepted / reviewed_overridden / escalated)
  final_tier, override_reason, reviewed_by, reviewed_at
  status (new / confirmed / stale / in_progress / resolved / diverted_private)

audit_log
  id, report_id, actor (model / officer_id), action, before, after, timestamp
```

---

## 11. Architecture

- **Resident app:** Vite + React, mobile-first, PWA (manifest + service worker, installable).
- **Officer console:** same repo, separate route, desktop-first responsive.
- **Unified backend:** thin API layer. Only place that talks to Claude, the open data
  endpoints, and the database.
- **Datastore:** Supabase or equivalent hosted Postgres, plus a cache for open data layer
  lookups so they are not re-queried per request.
- **Precompute:** historical HRM tree backlog scored ahead of time as the test set and the
  safe demo fallback.

---

## 12. Risks and open questions

- **Parcel ownership is paid and restricted.** Proxy approach documented in 5.2. State this
  openly; it is a real constraint, not a shortcut.
- **Service request data ends Dec 2024.** Live duplicate detection is not possible with public
  data. Named as an integration requirement in 5.3.
- **EXIF GPS frequently stripped.** Test with real phone photos early.
- **Utility buffer distance** needs a sensible default. Err wide, let an officer downgrade a
  false positive rather than miss a real one.
- **Confirmation counts are popularity, not expertise.** They move confidence, never tier.
- **Public hazard map is a public record that the city knew.** Good for accountability,
  uncomfortable for legal. Raise it ourselves rather than letting a judge raise it.
- **No ground truth on which trees failed.** Validate by backtesting against known storm dates
  and say so plainly rather than claiming measured accuracy.
- **Volume risk.** Easier reporting means more reports. The deflection counter on the officer
  summary screen is the mitigation and the metric.
