import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureCollection } from "geojson";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Lives at server/data/cache, one level up from src/ — matches server/data/
// already being gitignored, and reuses whatever's already been fetched.
// Vercel's filesystem is read-only outside /tmp, so cache there instead when
// deployed — ephemeral per-instance, which is fine: worst case is one live
// re-fetch per cold start rather than a crash.
const CACHE_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "canopy-watch-cache")
  : path.join(__dirname, "..", "data", "cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // re-fetch at most once a day

/**
 * Real REST endpoints, verified directly against the services (the
 * data-hrm.hub.arcgis.com / data.novascotia.ca landing pages only describe
 * intent, not field names or even which platform serves them). See
 * docs/data-sources.md for the full field-name notes.
 *
 * NS Topographic Utilities is Socrata (3 separate geometry-typed tables,
 * not one ArcGIS layer); everything else is ArcGIS FeatureServer.
 */
const ENDPOINTS = {
  utilitiesLines: "https://data.novascotia.ca/resource/yjmz-hpnc.geojson?$limit=50000",
  utilitiesPoints: "https://data.novascotia.ca/resource/eiwy-kfrj.geojson?$limit=50000",
  utilitiesPolygons: "https://data.novascotia.ca/resource/4ujs-gpyq.geojson?$limit=50000",
  parks:
    "https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/HRM_Parks_2/FeatureServer/0/query?where=1=1&outFields=PARK_NAME,PARK_TYPE,OWNER&f=geojson&resultRecordCount=2000",
  streetCentreline:
    "https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/StreetNetwork/FeatureServer/0/query?where=1=1&outFields=STR_NAME,FULL_NAME&f=geojson&resultRecordCount=50000",
  municipalBoundary:
    "https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/Census_2021_Census_Subdivisions/FeatureServer/0/query?where=CSDNAME='Halifax' AND CSDTYPE='RGM'&outFields=CSDNAME&f=geojson"
} as const;

type LayerKey = keyof typeof ENDPOINTS;

// Rough Halifax peninsula + harbour-area fallback so the geofence degrades
// to "probably fine" instead of hard-failing if the live boundary layer is
// ever unreachable during the demo. Not a substitute for the real layer.
const HALIFAX_FALLBACK_BBOX: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "HRM approximate bounding box (fallback)" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-63.85, 44.5],
            [-63.4, 44.5],
            [-63.4, 44.85],
            [-63.85, 44.85],
            [-63.85, 44.5]
          ]
        ]
      }
    }
  ]
};

const memoryCache = new Map<LayerKey, FeatureCollection>();

function cacheFile(key: LayerKey) {
  return path.join(CACHE_DIR, `${key}.geojson.json`);
}

async function fetchLayer(key: LayerKey): Promise<FeatureCollection | null> {
  const url = ENDPOINTS[key];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as FeatureCollection;
    if (!data.features) throw new Error("response missing 'features'");
    fs.writeFileSync(cacheFile(key), JSON.stringify(data));
    return data;
  } catch (err) {
    console.error(`[dataLayers] live fetch failed for '${key}':`, (err as Error).message);
    return null;
  }
}

export async function getLayer(key: LayerKey): Promise<FeatureCollection | null> {
  if (memoryCache.has(key)) return memoryCache.get(key)!;

  const file = cacheFile(key);
  if (fs.existsSync(file)) {
    const stat = fs.statSync(file);
    const fresh = Date.now() - stat.mtimeMs < CACHE_TTL_MS;
    const cached = JSON.parse(fs.readFileSync(file, "utf-8")) as FeatureCollection;
    if (fresh) {
      memoryCache.set(key, cached);
      return cached;
    }
    // Stale but present: try to refresh, fall back to stale-but-usable data.
    const refreshed = await fetchLayer(key);
    const result = refreshed ?? cached;
    memoryCache.set(key, result);
    return result;
  }

  const fetched = await fetchLayer(key);
  if (fetched) {
    memoryCache.set(key, fetched);
    return fetched;
  }

  if (key === "municipalBoundary") {
    memoryCache.set(key, HALIFAX_FALLBACK_BBOX);
    return HALIFAX_FALLBACK_BBOX;
  }

  return null;
}

/** Fetch + cache every layer once at server boot so the first request isn't slow. */
export async function warmDataLayers() {
  await Promise.all((Object.keys(ENDPOINTS) as LayerKey[]).map(getLayer));
}
