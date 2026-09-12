import {
  getLandStatus,
  getUtilityProximity,
  isInsideHRM,
  resolveLandStatus,
  type QuestionnaireLocationAnswer,
} from "./geometry.js";
import { getEabFlag } from "./eab.js";
import { getWindContext } from "./wind.js";
import { detectAndTranslate } from "./translate.js";
import { categorizeReport, summarizeNearbyRequests } from "./categorization.js";
import { findNearbyReport, insertAuditLog, insertReport } from "./reportsRepo.js";
import type {
  CategorizationAccepted,
  Category,
  LandEvidence,
  LandStatus,
  Priority,
  Report,
  WorkCategory,
} from "./types.js";

export interface SubmitReportInput {
  photoUrl: string | null;
  photoBase64: string | null;
  photoMediaType: string | null;
  lat: number;
  lng: number;
  locationSource: string;
  descriptionOriginal: string | null;
  questionnaireLocationAnswer: QuestionnaireLocationAnswer | null;
  questionnaireDangerAnswer: string | null;
  preFlaggedUrgent: boolean;
}

export type SubmitReportResult =
  | { kind: "outside_hrm" }
  | { kind: "not_hrm_owned"; landCheck: LandEvidence }
  | { kind: "categorization_error"; code: "INVALID_INPUT" | "AI_UNAVAILABLE"; message: string }
  | { kind: "rejected_spam"; reason: string }
  | {
      kind: "created";
      report: Report;
      categorization: CategorizationAccepted;
      possibleDuplicate: { referenceCode: string; distanceApprox: string } | null;
    };

function blockLocationFrom(detail: string | null, lat: number, lng: number): string {
  return detail ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function legacyCategory(category: WorkCategory): Category {
  if (category === "pruning_trimming") return "pruning";
  if (category === "stump_removal") return "stump";
  if (category === "chipping_brush_removal") return "blockage";
  if (category === "tree_assessment") return "disease";
  return "other";
}

export async function submitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
  if (!(await isInsideHRM(input.lat, input.lng))) return { kind: "outside_hrm" };

  const geometryLandStatus = await getLandStatus(input.lat, input.lng);
  const resolved = resolveLandStatus(geometryLandStatus, input.questionnaireLocationAnswer);
  const blockLocation = blockLocationFrom(geometryLandStatus.detail, input.lat, input.lng);
  const utilityProximity = await getUtilityProximity(input.lat, input.lng);
  const nearbyDuplicate = await findNearbyReport(input.lat, input.lng, 50);
  const windContext = await getWindContext(input.lat, input.lng);
  const eabFlag = await getEabFlag(input.lat, input.lng);

  const categorization = await categorizeReport({
    lat: input.lat,
    lng: input.lng,
    description: input.descriptionOriginal,
    descriptionLanguage: null,
    questionnaireLocationAnswer: input.questionnaireLocationAnswer,
    questionnaireDangerAnswer: input.questionnaireDangerAnswer,
    landStatus: resolved.status,
    utilityProximityM: utilityProximity?.distanceM ?? null,
    utilityFeatureType: utilityProximity?.featureType ?? null,
    windContext,
    eabFlag,
    historicalPatternNote: null,
    preFlaggedUrgent: input.preFlaggedUrgent,
    photoBase64: input.photoBase64,
    photoMediaType: input.photoMediaType,
  });

  if (categorization.status === "rejected") {
    return { kind: "not_hrm_owned", landCheck: categorization.land_check };
  }
  if (categorization.status === "error") {
    return {
      kind: "categorization_error",
      code: categorization.error,
      message: categorization.message,
    };
  }
  if (!categorization.photo_shows_tree_hazard) {
    return {
      kind: "rejected_spam",
      reason:
        "The photo doesn't appear to show a tree or vegetation hazard. Please retake the photo showing the tree or branch in question.",
    };
  }

  let descriptionLanguage: string | null = null;
  let descriptionTranslated: string | null = null;
  let translationIsAi = false;
  if (input.descriptionOriginal) {
    const translation = await detectAndTranslate(input.descriptionOriginal);
    if (translation) {
      descriptionLanguage = translation.language;
      if (!translation.isEnglishOrFrench) {
        descriptionTranslated = translation.translatedToEnglish;
        translationIsAi = true;
      }
    }
  }

  const utilityIsEmergency = utilityProximity?.isEmergency ?? false;
  const category: Category = utilityIsEmergency ? "utility" : legacyCategory(categorization.work_category);
  const priority: Priority = utilityIsEmergency || categorization.priority === 1 ? "high" : "low";
  const proposedTier = utilityIsEmergency ? "utility_emergency" : categorization.tier;
  const reason = utilityIsEmergency
    ? `Within ${Math.round(utilityProximity!.distanceM)}m of a ${utilityProximity!.featureType} — routed as a utility emergency regardless of the model's tree-only assessment.`
    : categorization.reason;
  const localLandStatus: LandStatus =
    categorization.land_check.asset_code === "ROW" ||
    categorization.land_check.location_type?.startsWith("ROW")
      ? "right_of_way"
      : "public_park";
  const historicalPatternNote = summarizeNearbyRequests(categorization.nearby_requests);

  const report = await insertReport({
    photoUrl: input.photoUrl,
    lat: input.lat,
    lng: input.lng,
    locationSource: input.locationSource,
    blockLocation,
    district: "unknown",
    descriptionOriginal: input.descriptionOriginal,
    descriptionLanguage,
    descriptionTranslated,
    translationIsAi,
    questionnaireLocationAnswer: input.questionnaireLocationAnswer,
    questionnaireDangerAnswer: input.questionnaireDangerAnswer,
    landStatus: localLandStatus,
    landStatusSource: "geometry",
    category,
    priority,
    proposedTier,
    reason,
    confidence: categorization.confidence,
    missingDetail: categorization.missing_detail,
    utilityProximityM: utilityProximity?.distanceM ?? null,
    utilityFeatureType: utilityProximity?.featureType ?? null,
    windContext,
    eabFlag,
    historicalPatternNote,
    status: "new",
  });

  await insertAuditLog({
    report_id: report.id,
    actor: "model",
    action: "scored",
    before: null,
    after: { ...categorization, final_tier: proposedTier, utility_override: utilityIsEmergency },
  });

  return {
    kind: "created",
    report,
    categorization,
    possibleDuplicate: nearbyDuplicate
      ? { referenceCode: nearbyDuplicate.reference_code, distanceApprox: "within 50m" }
      : null,
  };
}
