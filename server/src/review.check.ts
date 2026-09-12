import assert from "node:assert/strict";
import { applyAction, clusterReports, inCityQueue, sortReports, summarize, tierFrom } from "./review.js";
import type { Report, Tier } from "./types.js";

function report(partial: Partial<Report> & Pick<Report, "id" | "proposed_tier" | "status" | "review_state">): Report {
  return {
    created_at: "2026-09-12T12:00:00.000Z",
    reference_code: "CW-TEST",
    photo_url: null,
    lat: 44.65,
    lng: -63.58,
    location_source: "image",
    block_location: "Test",
    district: "8",
    category: "other",
    priority: "medium",
    notes: "",
    description_original: "test",
    description_language: "en",
    description_translated: null,
    translation_is_ai: false,
    questionnaire_location_answer: "not sure",
    questionnaire_danger_answer: "not sure",
    land_status: "right_of_way",
    land_status_source: "geometry",
    reason: "test",
    confidence: 0.5,
    missing_detail: null,
    utility_proximity_m: null,
    utility_feature_type: null,
    wind_context: "",
    eab_flag: false,
    historical_pattern_note: "",
    confirmation_count: 0,
    last_confirmed_at: null,
    final_tier: null,
    override_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    ...partial,
  };
}

const utility = report({
  id: "u",
  proposed_tier: "utility_emergency",
  status: "new",
  review_state: "awaiting_review",
  confidence: 0.9,
});
const routine = report({
  id: "r",
  proposed_tier: "routine",
  status: "new",
  review_state: "awaiting_review",
  confidence: 0.99,
});
const diverted = report({
  id: "d",
  proposed_tier: "routine",
  status: "diverted_private",
  review_state: "awaiting_review",
  created_at: "2026-09-12T18:00:00.000Z",
});

const summary = summarize([utility, routine, diverted], "2026-09-12T10:00:00.000Z");
assert.equal(summary.awaiting_review, 2);
assert.equal(summary.awaiting_by_tier.utility_emergency, 1);
assert.equal(summary.deflected, 1);
assert.equal(summary.utility_emergencies, 1);
assert.equal(summary.new_since, 2);

assert.equal(inCityQueue(diverted), false);

const sorted = sortReports([routine, utility, diverted]);
assert.equal(sorted[0].id, "u");

const byDate = sortReports(
  [
    report({
      id: "old",
      proposed_tier: "routine",
      status: "new",
      review_state: "awaiting_review",
      created_at: "2026-09-11T12:00:00.000Z",
      district: "8",
    }),
    report({
      id: "new",
      proposed_tier: "routine",
      status: "new",
      review_state: "awaiting_review",
      created_at: "2026-09-12T18:00:00.000Z",
      district: "8",
    }),
  ],
  "date",
);
assert.equal(byDate[0].id, "new");

const byArea = sortReports(
  [
    report({
      id: "d8",
      proposed_tier: "routine",
      status: "new",
      review_state: "awaiting_review",
      district: "8",
      created_at: "2026-09-12T18:00:00.000Z",
    }),
    report({
      id: "d5",
      proposed_tier: "routine",
      status: "new",
      review_state: "awaiting_review",
      district: "5",
      created_at: "2026-09-11T12:00:00.000Z",
    }),
  ],
  "area",
);
assert.equal(byArea[0].id, "d5");
assert.equal(byArea[1].id, "d8");

const accepted = applyAction(utility, { action: "accept", officer_id: "pat" }, "t", "a1");
assert.equal(accepted.report.review_state, "reviewed_accepted");
assert.equal(accepted.report.final_tier, "utility_emergency");
assert.equal(accepted.audit.actor, "pat");

assert.throws(() => applyAction(utility, { action: "override", officer_id: "pat" }));
assert.throws(() =>
  applyAction(utility, {
    action: "override",
    officer_id: "pat",
    final_tier: "routine",
  }),
);

const over = applyAction(utility, {
  action: "override",
  officer_id: "pat",
  final_tier: "routine" as Tier,
  override_reason: "Line is de-energized; this is a prune.",
});
assert.equal(over.report.review_state, "reviewed_overridden");
assert.equal(over.report.final_tier, "routine");

assert.throws(() => applyAction(utility, { action: "accept", officer_id: "  " }));

const afterAccept = summarize([accepted.report, routine, diverted], null);
assert.equal(afterAccept.awaiting_review, 1);
assert.equal(afterAccept.utility_emergencies, 0);

assert.equal(tierFrom("high", "utility"), "utility_emergency");
assert.equal(tierFrom("high", "hanging_limb"), "imminent_hazard");
assert.equal(tierFrom("low", "stump"), "routine");

const nearA = report({
  id: "na",
  proposed_tier: "imminent_hazard",
  status: "new",
  review_state: "awaiting_review",
  lat: 44.6591,
  lng: -63.5994,
});
const nearB = report({
  id: "nb",
  proposed_tier: "routine",
  status: "new",
  review_state: "awaiting_review",
  lat: 44.65922,
  lng: -63.59948,
});
const far = report({
  id: "far",
  proposed_tier: "routine",
  status: "new",
  review_state: "awaiting_review",
  lat: 44.74,
  lng: -63.65,
});
const groups = clusterReports([nearA, far, nearB]);
assert.equal(groups.length, 2);
assert.equal(groups.find((g) => g.length === 2)?.map((r) => r.id).sort().join(","), "na,nb");

console.log("review.check.ts: ok");
