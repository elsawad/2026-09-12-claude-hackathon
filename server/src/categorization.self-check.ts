import assert from "node:assert/strict";
import { categorizeReport, priorityFor, type CategorizationInput } from "./categorization.js";
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
  assert.equal(receivedScoringInputs[0]?.landStatus, "right_of_way");
  assert.equal(receivedScoringInputs[0]?.populationImpact?.population, 500);

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
