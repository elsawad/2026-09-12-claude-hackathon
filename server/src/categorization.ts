import { getHrmLandEvidence, getNearbyRequests, getPopulationImpact } from "./localContext.js";
import { scoreReport } from "./scoring.js";
import type {
  CategorizationResult,
  HrmPriority,
  ScoringInput,
  ScoringOutput,
  WorkCategory,
} from "./types.js";

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PRIORITY_ONE_CATEGORIES = new Set<WorkCategory>([
  "chipping_brush_removal",
  "pruning_trimming",
  "stump_removal",
  "tree_removal",
]);

export type CategorizationInput = Omit<ScoringInput, "populationImpact" | "nearbyRequests"> & {
  lat: number;
  lng: number;
};

export type CategorizationDependencies = {
  getLandEvidence: typeof getHrmLandEvidence;
  getPopulation: typeof getPopulationImpact;
  getNearby: typeof getNearbyRequests;
  score: (input: ScoringInput) => Promise<ScoringOutput>;
};

const DEFAULT_DEPENDENCIES: CategorizationDependencies = {
  getLandEvidence: getHrmLandEvidence,
  getPopulation: getPopulationImpact,
  getNearby: getNearbyRequests,
  score: scoreReport,
};

export function priorityFor(category: WorkCategory, immediateThreat: boolean): HrmPriority {
  return immediateThreat && PRIORITY_ONE_CATEGORIES.has(category) ? 1 : 2;
}

export function summarizeNearbyRequests(requests: ReturnType<typeof getNearbyRequests>): string | null {
  if (requests.length === 0) return null;
  const current = requests.filter((request) => request.is_current).length;
  const past = requests.length - current;
  const categories = [...new Set(requests.map((request) => request.work_category).filter(Boolean))]
    .slice(0, 3)
    .join(", ");
  return `${current} current and ${past} past Cityworks tree work order(s) within 50m${
    categories ? ` (${categories})` : ""
  }`;
}

function validateInput(input: CategorizationInput): string | null {
  if (
    !Number.isFinite(input.lat) ||
    !Number.isFinite(input.lng) ||
    input.lat < -90 ||
    input.lat > 90 ||
    input.lng < -180 ||
    input.lng > 180
  ) {
    return "Coordinates are invalid.";
  }
  if (!input.photoBase64 || !input.photoMediaType) return "A photo is required.";
  if (!SUPPORTED_IMAGE_TYPES.has(input.photoMediaType)) return "Photo must be JPEG, PNG, or WebP.";
  if (input.photoBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.photoBase64)) {
    return "Photo data is not valid base64.";
  }
  const imageBytes = Buffer.from(input.photoBase64, "base64").byteLength;
  if (imageBytes === 0 || imageBytes > MAX_IMAGE_BYTES) {
    return `Photo must be between 1 byte and ${MAX_IMAGE_BYTES} bytes.`;
  }
  return null;
}

export async function categorizeReport(
  input: CategorizationInput,
  dependencies: CategorizationDependencies = DEFAULT_DEPENDENCIES,
): Promise<CategorizationResult> {
  const inputError = validateInput(input);
  if (inputError) return { status: "error", error: "INVALID_INPUT", message: inputError };

  const landEvidence = dependencies.getLandEvidence(input.lat, input.lng);
  if (!landEvidence.on_hrm_owned_land) {
    return {
      status: "rejected",
      rejection_reason: "NOT_HRM_OWNED",
      land_check: landEvidence,
    };
  }

  const populationImpact = dependencies.getPopulation(input.lat, input.lng);
  const nearbyRequests = dependencies.getNearby(input.lat, input.lng, 50);
  const historicalPatternNote = summarizeNearbyRequests(nearbyRequests);
  const landStatus =
    landEvidence.asset_code === "ROW" || landEvidence.location_type?.startsWith("ROW")
      ? "right_of_way"
      : "public_park";

  let scoring: ScoringOutput;
  try {
    scoring = await dependencies.score({
      ...input,
      landStatus,
      historicalPatternNote,
      populationImpact,
      nearbyRequests,
    });
  } catch (error) {
    return {
      status: "error",
      error: "AI_UNAVAILABLE",
      message: (error as Error).message.replace(/^AI_UNAVAILABLE:\s*/, ""),
    };
  }

  const priority = priorityFor(scoring.work_category, scoring.immediate_threat);
  return {
    status: "accepted",
    work_category: scoring.work_category,
    priority,
    tier: priority === 1 ? "imminent_hazard" : "routine",
    nearby_requests: nearbyRequests,
    population_impact: populationImpact,
    land_check: landEvidence,
    visible_hazard_signals: scoring.visible_hazard_signals,
    reason: scoring.reason,
    confidence: scoring.confidence,
    missing_detail: scoring.missing_detail,
    photo_shows_tree_hazard: scoring.photo_shows_tree_hazard,
    requires_human_review: true,
  };
}
