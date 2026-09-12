import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLandStatus, getUtilityProximity } from "../geometry.js";
import { getEabFlag } from "../eab.js";
import { getWindContext } from "../wind.js";
import { scoreReport } from "../scoring.js";
import { tierFrom } from "../review.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "..", "..", "..", "data", "scored-backlog.json");

const SERVICE_REQUESTS_URL =
  "https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/Cityworks_Service_Requests/FeatureServer/0/query";

const SAMPLE_SIZE = Number(process.argv[2] ?? 20);

/**
 * Build-plan Step 5: pull real tree-related service requests, run every one
 * through the real scoring function, commit the scored output as JSON —
 * this is both the safe demo fallback if live calls fail, and the evidence
 * that the model works on real inputs, not three cherry-picked examples.
 *
 * The dataset's DESCRIPTION field is a coarse category ("Trees"), not a
 * narrative complaint — we pull outFields=* and hand Claude every non-empty
 * attribute so it has the same raw material a real intake would.
 */
async function fetchSample(): Promise<Record<string, any>[]> {
  const url =
    `${SERVICE_REQUESTS_URL}?where=${encodeURIComponent("DESCRIPTION='Trees'")}` +
    `&outFields=*&orderByFields=${encodeURIComponent("DATE_INITIATED DESC")}` +
    `&f=json&resultRecordCount=${SAMPLE_SIZE}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { features?: { attributes: Record<string, any> }[] };
  return (json.features ?? []).map((f) => f.attributes);
}

function attributesToDescription(attrs: Record<string, any>): string {
  const skip = new Set(["OBJECTID", "DESCRIPTION", "LATITUDE", "LONGITUDE", "GlobalID", "Shape"]);
  return Object.entries(attrs)
    .filter(([k, v]) => !skip.has(k) && v !== null && v !== "" && v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

async function main() {
  console.log(`Fetching ${SAMPLE_SIZE} most recent tree service requests...`);
  const rows = await fetchSample();
  const withCoords = rows.filter((r) => typeof r.LATITUDE === "number" && typeof r.LONGITUDE === "number");
  console.log(`Got ${rows.length} rows (${withCoords.length} with coordinates). Scoring...`);

  const results = [];
  for (const [i, attrs] of withCoords.entries()) {
    const lat = attrs.LATITUDE;
    const lng = attrs.LONGITUDE;
    try {
      const [landStatus, utilityProximity, windContext, eabFlag] = await Promise.all([
        getLandStatus(lat, lng),
        getUtilityProximity(lat, lng),
        getWindContext(lat, lng),
        getEabFlag(lat, lng)
      ]);
      const description = attributesToDescription(attrs);
      const scoring = await scoreReport({
        description: description || null,
        descriptionLanguage: "English",
        questionnaireLocationAnswer: null,
        questionnaireDangerAnswer: null,
        landStatus: landStatus.status,
        utilityProximityM: utilityProximity?.distanceM ?? null,
        utilityFeatureType: utilityProximity?.featureType ?? null,
        windContext,
        eabFlag,
        historicalPatternNote: null,
        preFlaggedUrgent: false,
        photoBase64: null,
        photoMediaType: null
      });
      const tier = tierFrom(scoring.priority, scoring.category);
      console.log(`[${i + 1}/${withCoords.length}] ${attrs.OBJECTID} -> ${scoring.category}/${scoring.priority} (${tier}, ${scoring.confidence})`);
      results.push({
        sourceObjectId: attrs.OBJECTID,
        dateInitiated: attrs.DATE_INITIATED,
        lat,
        lng,
        rawAttributes: attrs,
        landStatus: landStatus.status,
        utilityProximityM: utilityProximity?.distanceM ?? null,
        scoring: { ...scoring, tier }
      });
    } catch (err) {
      console.error(`[${i + 1}/${withCoords.length}] ${attrs.OBJECTID} FAILED:`, (err as Error).message);
    }
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`Wrote ${results.length} scored reports to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
