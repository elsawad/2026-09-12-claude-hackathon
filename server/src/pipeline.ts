import {
  isInsideHRM,
  getLandStatus,
  getUtilityProximity,
  resolveLandStatus,
  type QuestionnaireLocationAnswer
} from "./geometry.js";
import { getEabFlag } from "./eab.js";
import { getWindContext } from "./wind.js";
import { getHistoricalPatternNote } from "./cityworks.js";
import { detectAndTranslate, respondInLanguage } from "./translate.js";
import { scoreReport } from "./scoring.js";
import { insertReport, findNearbyReport, insertAuditLog, type NewReportInput } from "./reportsRepo.js";
import type { Report } from "./types.js";

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
  | { kind: "rejected_spam"; reason: string }
  | { kind: "diverted_private"; message: string; report: Report }
  | { kind: "created"; report: Report; possibleDuplicate: { referenceCode: string; distanceApprox: string } | null };

const PRIVATE_PROPERTY_MESSAGE =
  "HRM handles municipal trees and right-of-way blockages. Trees and debris on private " +
  "property are the homeowner's (or their insurer's) responsibility. If a tree on your own " +
  "property is dangerous, a licensed arborist can assess and remove it — HRM's 311 line can " +
  "point you to general guidance, but this specific report won't enter the city's work queue.";

/**
 * No HRM open-data layer gives us a district number or a human "near X"
 * label (see PRD 5.1 — nothing named "HRM Districts" is in scope), so the
 * best free approximation is the street/park name the geometry check
 * already resolved. District is left "unknown" rather than fabricated —
 * the console already renders that as "Area unknown".
 */
function blockLocationFrom(detail: string | null, lat: number, lng: number): string {
  return detail ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export async function submitReport(input: SubmitReportInput): Promise<SubmitReportResult> {
  // Step 1: geofence
  if (!(await isInsideHRM(input.lat, input.lng))) {
    return { kind: "outside_hrm" };
  }

  // Step 2 + human questionnaire reconciliation
  const geometryLandStatus = await getLandStatus(input.lat, input.lng);
  const resolved = resolveLandStatus(geometryLandStatus, input.questionnaireLocationAnswer);
  const blockLocation = blockLocationFrom(geometryLandStatus.detail, input.lat, input.lng);

  // Step 3
  const utilityProximity = await getUtilityProximity(input.lat, input.lng);

  // Step 4 (informational only — never blocks submission)
  const nearbyDuplicate = await findNearbyReport(input.lat, input.lng, 50);

  // Step 5
  const historicalPatternNote = await getHistoricalPatternNote(input.lat, input.lng);

  // Step 6
  const windContext = await getWindContext(input.lat, input.lng);

  const eabFlag = await getEabFlag(input.lat, input.lng);

  // Translation — original is always preserved; translatedToEnglish feeds Claude + officer view.
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

  if (resolved.divertPrivate) {
    const baseInput: NewReportInput = {
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
      landStatus: resolved.status,
      landStatusSource: resolved.source,
      category: "other",
      priority: "low",
      reason: "Private property, both geometry and resident agree — not a city work item.",
      confidence: null,
      missingDetail: null,
      utilityProximityM: utilityProximity?.distanceM ?? null,
      utilityFeatureType: utilityProximity?.featureType ?? null,
      windContext,
      eabFlag,
      historicalPatternNote,
      status: "diverted_private"
    };
    const report = await insertReport(baseInput);
    await insertAuditLog({
      report_id: report.id,
      actor: "model",
      action: "diverted_private",
      before: null,
      after: { land_status: "private", land_status_source: "both_agree", note: "diverted before entering work queue" }
    });
    const message =
      descriptionLanguage && descriptionLanguage.toLowerCase() !== "english"
        ? await respondInLanguage(PRIVATE_PROPERTY_MESSAGE, descriptionLanguage)
        : PRIVATE_PROPERTY_MESSAGE;
    return { kind: "diverted_private", message, report };
  }

  // Step 7: Claude scoring (rides the spam/content check for any attached photo)
  const scoring = await scoreReport({
    description: descriptionTranslated ?? input.descriptionOriginal,
    descriptionLanguage,
    questionnaireLocationAnswer: input.questionnaireLocationAnswer,
    questionnaireDangerAnswer: input.questionnaireDangerAnswer,
    landStatus: resolved.status,
    utilityProximityM: utilityProximity?.distanceM ?? null,
    utilityFeatureType: utilityProximity?.featureType ?? null,
    windContext,
    eabFlag,
    historicalPatternNote,
    preFlaggedUrgent: input.preFlaggedUrgent,
    photoBase64: input.photoBase64,
    photoMediaType: input.photoMediaType
  });

  if (input.photoBase64 && !scoring.photo_shows_tree_hazard) {
    return {
      kind: "rejected_spam",
      reason: "The photo doesn't appear to show a tree or vegetation hazard. Please retake the photo showing the tree or branch in question."
    };
  }

  // Utility proximity is a hard, measured signal — it overrides the model's
  // own category/priority judgement the same way Track A's tier override
  // did, rather than just being one more thing Claude weighs.
  const utilityIsEmergency = utilityProximity?.isEmergency ?? false;
  const category = utilityIsEmergency ? "utility" : scoring.category;
  const priority = utilityIsEmergency ? "high" : scoring.priority;
  const reason = utilityIsEmergency
    ? `Within ${Math.round(utilityProximity!.distanceM)}m of a ${utilityProximity!.featureType} — routed as a utility emergency regardless of the model's tree-only assessment.`
    : scoring.reason;

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
    landStatus: resolved.status,
    landStatusSource: resolved.source,
    category,
    priority,
    reason,
    confidence: scoring.confidence,
    missingDetail: scoring.missing_detail,
    utilityProximityM: utilityProximity?.distanceM ?? null,
    utilityFeatureType: utilityProximity?.featureType ?? null,
    windContext,
    eabFlag,
    historicalPatternNote,
    status: "new"
  });

  await insertAuditLog({
    report_id: report.id,
    actor: "model",
    action: "scored",
    before: null,
    after: { ...scoring, category, priority, proposed_tier: report.proposed_tier, utility_override: utilityIsEmergency }
  });

  return {
    kind: "created",
    report,
    possibleDuplicate: nearbyDuplicate
      ? { referenceCode: nearbyDuplicate.reference_code, distanceApprox: "within 50m" }
      : null
  };
}
