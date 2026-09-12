import "dotenv/config";
import { migrate } from "./db.js";
import { insertReport } from "./reportsRepo.js";

// Five fake reports so front-end work never has to wait on a real
// submission pipeline (build-plan Step 2). Do NOT run this while
// `npm run dev:server` is also running — PGlite is single-process and two
// writers on the same data dir will corrupt it.
async function seed() {
  await migrate();

  await insertReport({
    photoUrl: null,
    lat: 44.6488,
    lng: -63.5752,
    locationSource: "map_pin",
    descriptionOriginal: "Big branch hanging right over the sidewalk on Spring Garden, looks like it could drop any time.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "street_or_sidewalk",
    questionnaireDangerAnswer: "hanging_over_something",
    landStatus: "right_of_way",
    landStatusSource: "both_agree",
    proposedTier: "imminent_hazard",
    reason: "Large limb hanging directly over a pedestrian sidewalk with visible splitting at the branch collar.",
    confidence: 0.86,
    missingDetail: null,
    utilityProximityM: 210,
    utilityFeatureType: null,
    windContext: "wind 14 km/h, gusts 27 km/h",
    eabFlag: true,
    historicalPatternNote: "2 prior tree service request(s) within 75m (most recent 2025)",
    preFlaggedUrgent: false,
    status: "new"
  });

  await insertReport({
    photoUrl: null,
    lat: 44.6733,
    lng: -63.6109,
    locationSource: "geolocation",
    descriptionOriginal: "Tree fell against the power line behind our house after the storm last night.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "not_sure",
    questionnaireDangerAnswer: "blocking_something",
    landStatus: "ambiguous",
    landStatusSource: "geometry",
    proposedTier: "utility_emergency",
    reason: "Within 12m of a transmission line — routed as a utility emergency regardless of the model's tree-only assessment.",
    confidence: 0.95,
    missingDetail: null,
    utilityProximityM: 12,
    utilityFeatureType: "transmission line",
    windContext: "wind 9 km/h, gusts 15 km/h",
    eabFlag: true,
    historicalPatternNote: null,
    preFlaggedUrgent: true,
    status: "new"
  });

  await insertReport({
    photoUrl: null,
    lat: 44.6393,
    lng: -63.5921,
    locationSource: "exif",
    descriptionOriginal: "Sur le trottoir, un petit arbre semble mort, quelques branches sèches mais rien qui bloque.",
    descriptionLanguage: "French",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "public_park",
    questionnaireDangerAnswer: "looks_unwell",
    landStatus: "public_park",
    landStatusSource: "both_agree",
    proposedTier: "routine",
    reason: "Dead-appearing street tree with dry branches, no blockage or overhang reported.",
    confidence: 0.74,
    missingDetail: null,
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: "wind 6 km/h, gusts 11 km/h",
    eabFlag: true,
    historicalPatternNote: null,
    preFlaggedUrgent: false,
    status: "new"
  });

  await insertReport({
    photoUrl: null,
    lat: 44.661,
    lng: -63.598,
    locationSource: "typed_address",
    descriptionOriginal: "There's a tree somewhere near the school, might be an issue.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "not_sure",
    questionnaireDangerAnswer: "not_sure",
    landStatus: "ambiguous",
    landStatusSource: "geometry",
    proposedTier: "insufficient_info",
    reason: "No photo and no specific description of the hazard — cannot distinguish routine from urgent.",
    confidence: 0.4,
    missingDetail: "A photo of the tree, or a description of what specifically looks unsafe about it.",
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: "wind 11 km/h, gusts 19 km/h",
    eabFlag: true,
    historicalPatternNote: null,
    preFlaggedUrgent: false,
    status: "new"
  });

  await insertReport({
    photoUrl: null,
    lat: 44.6301,
    lng: -63.6743,
    locationSource: "map_pin",
    descriptionOriginal: "Tree in my backyard split in half, worried it'll hit the shed.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "private_property",
    questionnaireDangerAnswer: "hanging_over_something",
    landStatus: "private",
    landStatusSource: "both_agree",
    proposedTier: null,
    reason: null,
    confidence: null,
    missingDetail: null,
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: null,
    eabFlag: true,
    historicalPatternNote: null,
    preFlaggedUrgent: false,
    status: "diverted_private"
  });

  console.log("Seeded 5 reports.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
