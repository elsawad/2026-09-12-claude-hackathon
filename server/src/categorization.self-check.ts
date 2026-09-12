import assert from "node:assert/strict";
import {
  categorizeReport,
  HIGH_DENSITY_PERCENTILE,
  isDensityEscalated,
  priorityFor,
  type CategorizationInput
} from "./categorization.js";
import { getHrmLandEvidence, getNearbyRequests, getPopulationImpact } from "./localContext.js";
import { scoreReport } from "./scoring.js";
import type { ScoringInput, ScoringOutput, WorkCategory } from "./types.js";

const scoringOutput: ScoringOutput = {
  work_category: "tree_removal",
  immediate_threat: true,
  visible_hazard_signals: ["split trunk over a path"],
  reason: "A split trunk is visibly leaning over a public path.",
  confidence: 0.9,
  missing_detail: null,
  photo_shows_tree_hazard: true
};

const input: CategorizationInput = {
  lat: 44.66660765368158,
  lng: -63.57216958207298,
  description: "Split tree over a path",
  descriptionLanguage: "English",
  questionnaireLocationAnswer: "public_park",
  questionnaireDangerAnswer: "hanging_over_something",
  landStatus: "public_park",
  utilityProximityM: null,
  utilityFeatureType: null,
  windContext: null,
  eabFlag: true,
  historicalPatternNote: null,
  preFlaggedUrgent: true,
  photoBase64: Buffer.from("image").toString("base64"),
  photoMediaType: "image/jpeg"
};

async function run() {
  const priorityOne: WorkCategory[] = [
    "chipping_brush_removal",
    "pruning_trimming",
    "stump_removal",
    "tree_removal"
  ];
  const priorityTwoOnly: WorkCategory[] = ["tree_assessment", "tree_replacement", "tree_misc"];
  for (const category of priorityOne) assert.equal(priorityFor(category, true), 1);
  for (const category of priorityTwoOnly) assert.equal(priorityFor(category, true), 2);
  for (const category of [...priorityOne, ...priorityTwoOnly]) assert.equal(priorityFor(category, false), 2);

  const invalid = await categorizeReport(
    { ...input, photoBase64: null },
    {
      getLandEvidence: () => {
        throw new Error("invalid input should stop before land lookup");
      },
      getPopulation: () => null,
      getNearby: () => [],
      score: async () => scoringOutput
    }
  );
  assert.deepEqual(invalid, {
    status: "error",
    error: "INVALID_INPUT",
    message: "A photo is required."
  });

  let callsAfterRejection = 0;
  const rejected = await categorizeReport(input, {
    getLandEvidence: () => ({
      on_hrm_owned_land: false,
      asset_code: null,
      location_type: null,
      pid: null
    }),
    getPopulation: () => {
      callsAfterRejection++;
      return null;
    },
    getNearby: () => {
      callsAfterRejection++;
      return [];
    },
    score: async () => {
      callsAfterRejection++;
      return scoringOutput;
    }
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(callsAfterRejection, 0);

  const receivedScoringInputs: ScoringInput[] = [];
  const accepted = await categorizeReport(input, {
    getLandEvidence: () => ({
      on_hrm_owned_land: true,
      asset_code: "ROW",
      location_type: "ROW",
      pid: "test"
    }),
    getPopulation: () => ({
      dissemination_area_id: "test-area",
      population: 500,
      population_density_per_km2: 2000,
      density_percentile: 75
    }),
    getNearby: () => [
      {
        id: "test-order",
        source_type: "cityworks_work_order",
        work_category: "Tree - Removal",
        status: "OPEN",
        date_initiated: "2026-09-12",
        distance_m: 12,
        is_current: true
      }
    ],
    score: async (value) => {
      receivedScoringInputs.push(value);
      return scoringOutput;
    }
  });
  assert.equal(accepted.status, "accepted");
  if (accepted.status !== "accepted") throw new Error("Expected accepted categorization");
  assert.equal(accepted.priority, 1);
  assert.equal(accepted.tier, "imminent_hazard");
  assert.equal(accepted.nearby_requests.length, 1);
  // Priority 1 on HRM's own rule (immediate threat), not on the 75th-percentile density.
  assert.equal(accepted.priority_basis, "hrm_standard");
  assert.equal(accepted.reason, scoringOutput.reason);
  assert.equal(receivedScoringInputs[0]?.landStatus, "right_of_way");
  assert.equal(receivedScoringInputs[0]?.populationImpact?.population, 500);

  // --- Density escalation -------------------------------------------------
  // A top-decile-density location promotes a non-urgent report to Priority 1.
  // This is deliberately NOT HRM's published rule, so it must be flagged in
  // priority_basis and spelled out in the officer-facing reason.
  for (const category of priorityOne) {
    assert.equal(priorityFor(category, false, HIGH_DENSITY_PERCENTILE), 1);
    assert.equal(priorityFor(category, false, HIGH_DENSITY_PERCENTILE - 0.1), 2);
    assert.equal(priorityFor(category, false, null), 2);
    assert.equal(isDensityEscalated(category, false, 95), true);
    // Already Priority 1 on hazard alone — density didn't cause it.
    assert.equal(isDensityEscalated(category, true, 95), false);
  }
  // The category gate is HRM's and density never relaxes it: an assessment or
  // a replacement is not 24-hour work no matter how dense the block is.
  for (const category of priorityTwoOnly) {
    assert.equal(priorityFor(category, false, 99), 2);
    assert.equal(priorityFor(category, true, 99), 2);
    assert.equal(isDensityEscalated(category, false, 99), false);
  }

  const routineScoring: ScoringOutput = {
    work_category: "pruning_trimming",
    immediate_threat: false,
    visible_hazard_signals: [],
    reason: "Clearance prune over the sidewalk, no failure indicators.",
    confidence: 0.8,
    missing_detail: null,
    photo_shows_tree_hazard: true
  };

  async function categorizeAtDensity(densityPercentile: number) {
    return categorizeReport(input, {
      getLandEvidence: () => ({
        on_hrm_owned_land: true,
        asset_code: "ROW",
        location_type: "ROW",
        pid: "test"
      }),
      getPopulation: () => ({
        dissemination_area_id: "test-area",
        population: 1200,
        population_density_per_km2: 7400,
        density_percentile: densityPercentile
      }),
      getNearby: () => [],
      score: async () => routineScoring
    });
  }

  const dense = await categorizeAtDensity(95);
  if (dense.status !== "accepted") throw new Error("Expected accepted categorization");
  assert.equal(dense.priority, 1);
  assert.equal(dense.tier, "imminent_hazard");
  assert.equal(dense.priority_basis, "density_escalated");
  assert.match(dense.reason, /Escalated to Priority 1 on exposure/);
  assert.match(dense.reason, /95th percentile/);
  // The officer must be able to see that HRM's own policy disagrees.
  assert.match(dense.reason, /HRM's published standard would call this Priority 2/);

  const sparse = await categorizeAtDensity(50);
  if (sparse.status !== "accepted") throw new Error("Expected accepted categorization");
  assert.equal(sparse.priority, 2);
  assert.equal(sparse.tier, "routine");
  assert.equal(sparse.priority_basis, "hrm_standard");
  assert.equal(sparse.reason, routineScoring.reason);

  let attempts = 0;
  let retryReason = "";
  const scored = await scoreReport(
    { ...input, populationImpact: null, nearbyRequests: [] },
    async (_value, validationFailure) => {
      attempts++;
      retryReason = validationFailure ?? retryReason;
      return attempts === 1 ? {} : scoringOutput;
    }
  );
  assert.equal(scored.work_category, "tree_removal");
  assert.equal(attempts, 2);
  assert.match(retryReason, /invalid work category/);

  const owned = getHrmLandEvidence(input.lat, input.lng);
  assert.equal(owned.on_hrm_owned_land, true);
  assert.ok(getPopulationImpact(input.lat, input.lng));
  assert.equal(getNearbyRequests(input.lat, input.lng)[0]?.is_current, false);
  assert.equal(getNearbyRequests(44.66866839055081, -63.61726816691401)[0]?.is_current, true);
  assert.equal(getHrmLandEvidence(44.67117950823134, -63.58149591021733).on_hrm_owned_land, false);

  console.log("Tree categorization self-check passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
