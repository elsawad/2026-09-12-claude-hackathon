import "dotenv/config";
import { migrate } from "./db.js";
import { insertReport, updateReview, type NewReportInput } from "./reportsRepo.js";

// Nine demo reports covering every tier/status combination the console and
// resident app need to show off, so front-end work never has to wait on a
// real submission (build-plan Step 2). Do NOT run this while `npm run dev`
// is also running — PGlite is single-process and two writers on the same
// data dir will corrupt it.

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

type SeedItem = NewReportInput & { blockLocation: string; district: string };

const ITEMS: SeedItem[] = [
  {
    createdAt: hoursAgo(1.2),
    photoUrl: null,
    lat: 44.6478,
    lng: -63.6019,
    locationSource: "map_pin",
    blockLocation: "Quinpool Rd near Windsor St",
    district: "8",
    descriptionOriginal: "Large branch resting on the overhead line above the sidewalk.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "street_or_sidewalk",
    questionnaireDangerAnswer: "hanging_over_something",
    landStatus: "right_of_way",
    landStatusSource: "both_agree",
    category: "utility",
    priority: "high",
    reason: "Utility contact. Not a prune job.",
    confidence: 0.93,
    missingDetail: null,
    utilityProximityM: 8,
    utilityFeatureType: "transmission line",
    windContext: "wind 14 km/h, gusts 27 km/h",
    eabFlag: true,
    historicalPatternNote: "2 prior tree service request(s) within 75m (most recent 2025)",
    status: "confirmed"
  },
  {
    createdAt: hoursAgo(3),
    photoUrl: null,
    lat: 44.6591,
    lng: -63.5994,
    locationSource: "geolocation",
    blockLocation: "Agricola St near North St",
    district: "8",
    descriptionOriginal: "A split limb is hanging over the front of the house.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "street_or_sidewalk",
    questionnaireDangerAnswer: "hanging_over_something",
    landStatus: "right_of_way",
    landStatusSource: "geometry",
    category: "hanging_limb",
    priority: "high",
    reason: "Failed limb over a structure. 24-hour standard.",
    confidence: 0.86,
    missingDetail: null,
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: "wind 9 km/h, gusts 15 km/h",
    eabFlag: true,
    historicalPatternNote: null,
    status: "new"
  },
  {
    createdAt: hoursAgo(2.4),
    photoUrl: null,
    lat: 44.65922,
    lng: -63.59948,
    locationSource: "geolocation",
    blockLocation: "Agricola St near North St",
    district: "8",
    descriptionOriginal: "Same tree, another angle. Branches over the sidewalk.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "street_or_sidewalk",
    questionnaireDangerAnswer: "hanging_over_something",
    landStatus: "right_of_way",
    landStatusSource: "geometry",
    category: "pruning",
    priority: "medium",
    reason: "Same site as the nearby hanging-limb report. Clearance prune unless the split fails.",
    confidence: 0.74,
    missingDetail: null,
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: "wind 9 km/h, gusts 15 km/h",
    eabFlag: true,
    historicalPatternNote: null,
    status: "new"
  },
  {
    createdAt: hoursAgo(5.5),
    photoUrl: null,
    lat: 44.6255,
    lng: -63.5658,
    locationSource: "map_pin",
    blockLocation: "Point Pleasant Park, south entrance",
    district: "7",
    descriptionOriginal: "Tree down across the path.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "public_park",
    questionnaireDangerAnswer: "blocking_something",
    landStatus: "public_park",
    landStatusSource: "both_agree",
    category: "fallen",
    priority: "high",
    reason: "Fallen tree pushing people into the road.",
    confidence: 0.9,
    missingDetail: null,
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: "wind 18 km/h, gusts 31 km/h",
    eabFlag: true,
    historicalPatternNote: null,
    status: "confirmed"
  },
  {
    createdAt: hoursAgo(8),
    photoUrl: null,
    lat: 44.6512,
    lng: -63.585,
    locationSource: "typed_address",
    blockLocation: "Gottingen St near Cunard St",
    district: "7",
    descriptionOriginal: "árbol malo creo",
    descriptionLanguage: "Spanish",
    descriptionTranslated: "bad tree I think",
    translationIsAi: true,
    questionnaireLocationAnswer: "not_sure",
    questionnaireDangerAnswer: "not_sure",
    landStatus: "ambiguous",
    landStatusSource: "conflict",
    category: "other",
    priority: "low",
    reason: "Photo does not show the tree or the target.",
    confidence: 0.41,
    missingDetail: "Need a photo of the whole tree and what it could hit.",
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: "wind 11 km/h, gusts 19 km/h",
    eabFlag: true,
    historicalPatternNote: null,
    status: "new"
  },
  {
    createdAt: hoursAgo(2.4),
    photoUrl: null,
    lat: 44.67118,
    lng: -63.5815,
    locationSource: "map_pin",
    blockLocation: "George St near Portland St, Dartmouth",
    district: "5",
    descriptionOriginal: "Limb cracked over the sidewalk beside the plaza.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "street_or_sidewalk",
    questionnaireDangerAnswer: "hanging_over_something",
    landStatus: "right_of_way",
    landStatusSource: "geometry",
    category: "hanging_limb",
    priority: "high",
    reason: "Failed limb over a sidewalk. 24-hour standard.",
    confidence: 0.84,
    missingDetail: null,
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: "wind 12 km/h, gusts 20 km/h",
    eabFlag: true,
    historicalPatternNote: null,
    status: "new"
  },
  {
    createdAt: hoursAgo(11),
    photoUrl: null,
    lat: 44.74096,
    lng: -63.65112,
    locationSource: "map_pin",
    blockLocation: "Riverview Cres, Bedford",
    district: "16",
    descriptionOriginal: "Stump from last year's takedown still in the boulevard.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "street_or_sidewalk",
    questionnaireDangerAnswer: "looks_unwell",
    landStatus: "right_of_way",
    landStatusSource: "geometry",
    category: "stump",
    priority: "low",
    reason: "Stump in the right of way. 12-month standard.",
    confidence: 0.8,
    missingDetail: null,
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: "wind 7 km/h, gusts 12 km/h",
    eabFlag: true,
    historicalPatternNote: null,
    status: "new"
  },
  {
    createdAt: hoursAgo(28),
    photoUrl: null,
    lat: 44.6704,
    lng: -63.6091,
    locationSource: "typed_address",
    blockLocation: "Kencrest Ave near Lady Hammond Rd",
    district: "8",
    descriptionOriginal: "Needs a trim, brushing the roof of the bus shelter.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "street_or_sidewalk",
    questionnaireDangerAnswer: "hanging_over_something",
    landStatus: "right_of_way",
    landStatusSource: "geometry",
    category: "pruning",
    priority: "medium",
    reason: "Clearance prune. No failure indicators.",
    confidence: 0.81,
    missingDetail: null,
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: "wind 10 km/h, gusts 16 km/h",
    eabFlag: true,
    historicalPatternNote: null,
    status: "in_progress"
  },
  {
    createdAt: hoursAgo(6),
    photoUrl: null,
    lat: 44.6635,
    lng: -63.6122,
    locationSource: "map_pin",
    blockLocation: "North End backyard, near Fullerton Ave",
    district: "8",
    descriptionOriginal: "Neighbour's tree is dropping stuff on my deck.",
    descriptionLanguage: "English",
    descriptionTranslated: null,
    translationIsAi: false,
    questionnaireLocationAnswer: "private_property",
    questionnaireDangerAnswer: "not_sure",
    landStatus: "private",
    landStatusSource: "both_agree",
    category: "other",
    priority: "low",
    reason: "Private property. Not a city work item.",
    confidence: 0.88,
    missingDetail: null,
    utilityProximityM: null,
    utilityFeatureType: null,
    windContext: null,
    eabFlag: true,
    historicalPatternNote: null,
    status: "diverted_private"
  }
];

// Index of the "Kencrest Ave" pruning report above — seeded as already
// reviewed so the console has a "Reviewed" example out of the box.
const ALREADY_REVIEWED_INDEX = 7;

async function seed() {
  await migrate();

  for (const [i, item] of ITEMS.entries()) {
    const report = await insertReport(item);
    if (i === ALREADY_REVIEWED_INDEX) {
      await updateReview(report.id, {
        reviewState: "reviewed_accepted",
        finalTier: report.proposed_tier,
        reviewedBy: "a.desroches",
        status: "in_progress"
      });
    }
  }

  console.log(`Seeded ${ITEMS.length} reports.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
