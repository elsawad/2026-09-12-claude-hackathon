import { getHrmLandEvidence, getNearbyRequests, getPopulationImpact } from "./localContext.js";
import { scoreReport } from "./scoring.js";
import type {
  CategorizationResult,
  HrmPriority,
  PriorityBasis,
  PopulationImpact,
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

/**
 * Density escalation threshold, as a percentile of HRM's Census 2021
 * dissemination-area population density (610 areas: median ~2,190/km²,
 * 90th percentile ~6,550/km², max ~83,250/km² — the distribution is heavily
 * skewed, which is why this is a percentile and not a raw density cutoff).
 *
 * A report at or above this percentile is treated as Priority 1 even with no
 * visible immediate threat, on the theory that the same failure exposes far
 * more people downtown than on a rural boulevard.
 *
 * NOTE: this is a deliberate departure from HRM's published service
 * standards, which set priority on hazard alone, not exposure. It is applied
 * here — deterministically, in code — rather than by Claude, so that the
 * model keeps judging only what the evidence shows and the policy override
 * stays auditable and testable in one place.
 */
export const HIGH_DENSITY_PERCENTILE = 90;

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

export function priorityFor(
  category: WorkCategory,
  immediateThreat: boolean,
  densityPercentile: number | null = null,
): HrmPriority {
  // The category gate is HRM's and is never relaxed: only work types with a
  // 1-business-day repair standard can be Priority 1 at all. Density does not
  // turn an assessment or a replacement into 24-hour work.
  if (!PRIORITY_ONE_CATEGORIES.has(category)) return 2;
  if (immediateThreat) return 1;
  return densityPercentile !== null && densityPercentile >= HIGH_DENSITY_PERCENTILE ? 1 : 2;
}

/** True only when density — not HRM's own rule — is what produced Priority 1. */
export function isDensityEscalated(
  category: WorkCategory,
  immediateThreat: boolean,
  densityPercentile: number | null,
): boolean {
  return priorityFor(category, immediateThreat, densityPercentile) === 1 && !immediateThreat;
}

/** Officer-facing note explaining an escalation that HRM's policy wouldn't make. */
export function densityEscalationNote(impact: PopulationImpact): string {
  return (
    `Escalated to Priority 1 on exposure, not on a visible immediate threat: ` +
    `${impact.population.toLocaleString("en-CA")} residents at ` +
    `${Math.round(impact.population_density_per_km2).toLocaleString("en-CA")}/km² ` +
    `(${impact.density_percentile}th percentile of HRM). HRM's published standard would call this Priority 2.`
  );
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

  const densityPercentile = populationImpact?.density_percentile ?? null;
  const priority = priorityFor(scoring.work_category, scoring.immediate_threat, densityPercentile);
  const escalated = isDensityEscalated(scoring.work_category, scoring.immediate_threat, densityPercentile);
  const basis: PriorityBasis = escalated ? "density_escalated" : "hrm_standard";
  // The escalation rides along in the reason the officer actually reads —
  // a tier that departs from HRM's own policy should never look like HRM's.
  const reason =
    escalated && populationImpact
      ? `${scoring.reason} ${densityEscalationNote(populationImpact)}`
      : scoring.reason;

  return {
    status: "accepted",
    work_category: scoring.work_category,
    priority,
    priority_basis: basis,
    tier: priority === 1 ? "imminent_hazard" : "routine",
    nearby_requests: nearbyRequests,
    population_impact: populationImpact,
    land_check: landEvidence,
    visible_hazard_signals: scoring.visible_hazard_signals,
    reason,
    confidence: scoring.confidence,
    missing_detail: scoring.missing_detail,
    photo_shows_tree_hazard: scoring.photo_shows_tree_hazard,
    requires_human_review: true,
  };
}
