import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// See server/dataLayers.ts — same read-only-filesystem-outside-/tmp reasoning.
const CACHE_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "canopy-watch-cache")
  : path.join(__dirname, "data", "cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Both Cityworks datasets are ArcGIS *Tables* (no geometry column — f=geojson
// returns geometry:null), confirmed by direct query. Coordinates come from
// plain lat/lng fields (Service Requests) or Web Mercator x/y (Work Orders).
const SERVICE_REQUESTS_URL =
  "https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/Cityworks_Service_Requests/FeatureServer/0/query";
const WORK_ORDERS_URL =
  "https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/Cityworks_Work_Orders/FeatureServer/0/query";

const PAGE_SIZE = 2000;
const MAX_RECORDS = 6000; // most-recent-first cap so a hackathon laptop isn't paginating 34k+ rows

export interface TreeServiceRequest {
  id: number;
  description: string; // always "Trees" for this subset
  status: string;
  dateInitiated: number; // epoch ms
  lat: number;
  lng: number;
}

export interface TreeWorkOrder {
  id: number;
  workType: string; // e.g. "Tree - Pruning and Trimming"
  status: string;
  dateInitiated: number;
  lat: number;
  lng: number;
}

/** EPSG:3857 (Web Mercator) -> EPSG:4326 (WGS84 lat/lng). */
function webMercatorToLatLng(x: number, y: number): { lat: number; lng: number } {
  const R = 20037508.34;
  const lng = (x / R) * 180;
  let lat = (y / R) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return { lat, lng };
}

async function paginate(
  baseUrl: string,
  where: string,
  outFields: string,
  orderBy: string
): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  while (all.length < MAX_RECORDS) {
    const url =
      `${baseUrl}?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(outFields)}` +
      `&orderByFields=${encodeURIComponent(orderBy)}&f=json&resultRecordCount=${PAGE_SIZE}&resultOffset=${offset}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { features?: { attributes: any }[]; exceededTransferLimit?: boolean };
    const page = json.features ?? [];
    all.push(...page.map((f) => f.attributes));
    if (page.length < PAGE_SIZE || !json.exceededTransferLimit) break;
    offset += PAGE_SIZE;
  }
  return all.slice(0, MAX_RECORDS);
}

function loadCached<T>(file: string): T[] | null {
  if (!fs.existsSync(file)) return null;
  const fresh = Date.now() - fs.statSync(file).mtimeMs < CACHE_TTL_MS;
  const data = JSON.parse(fs.readFileSync(file, "utf-8")) as T[];
  return fresh ? data : null;
}

let serviceRequestsCache: TreeServiceRequest[] | null = null;
let workOrdersCache: TreeWorkOrder[] | null = null;

export async function getTreeServiceRequests(): Promise<TreeServiceRequest[]> {
  if (serviceRequestsCache) return serviceRequestsCache;
  const file = path.join(CACHE_DIR, "tree-service-requests.json");
  const cached = loadCached<TreeServiceRequest>(file);
  if (cached) {
    serviceRequestsCache = cached;
    return cached;
  }
  try {
    const rows = await paginate(
      SERVICE_REQUESTS_URL,
      "DESCRIPTION='Trees'",
      "OBJECTID,DESCRIPTION,STATUS,DATE_INITIATED,LATITUDE,LONGITUDE",
      "DATE_INITIATED DESC"
    );
    const requests: TreeServiceRequest[] = rows
      .filter((r) => typeof r.LATITUDE === "number" && typeof r.LONGITUDE === "number")
      .map((r) => ({
        id: r.OBJECTID,
        description: r.DESCRIPTION,
        status: r.STATUS,
        dateInitiated: r.DATE_INITIATED,
        lat: r.LATITUDE,
        lng: r.LONGITUDE
      }));
    fs.writeFileSync(file, JSON.stringify(requests));
    serviceRequestsCache = requests;
    return requests;
  } catch (err) {
    console.error("[cityworks] failed to fetch service requests:", (err as Error).message);
    const stale = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as TreeServiceRequest[]) : [];
    serviceRequestsCache = stale;
    return stale;
  }
}

export async function getTreeWorkOrders(): Promise<TreeWorkOrder[]> {
  if (workOrdersCache) return workOrdersCache;
  const file = path.join(CACHE_DIR, "tree-work-orders.json");
  const cached = loadCached<TreeWorkOrder>(file);
  if (cached) {
    workOrdersCache = cached;
    return cached;
  }
  try {
    const rows = await paginate(
      WORK_ORDERS_URL,
      "ASSET_TYPE='AST_TREE'",
      "OBJECTID,DESCRIPTION,STATUS,DATE_INITIATED,X_COORDINATE,Y_COORDINATE",
      "DATE_INITIATED DESC"
    );
    const orders: TreeWorkOrder[] = rows
      .filter((r) => typeof r.X_COORDINATE === "number" && typeof r.Y_COORDINATE === "number")
      .map((r) => {
        const { lat, lng } = webMercatorToLatLng(r.X_COORDINATE, r.Y_COORDINATE);
        return {
          id: r.OBJECTID,
          workType: r.DESCRIPTION,
          status: r.STATUS,
          dateInitiated: r.DATE_INITIATED,
          lat,
          lng
        };
      });
    fs.writeFileSync(file, JSON.stringify(orders));
    workOrdersCache = orders;
    return orders;
  } catch (err) {
    console.error("[cityworks] failed to fetch work orders:", (err as Error).message);
    const stale = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as TreeWorkOrder[]) : [];
    workOrdersCache = stale;
    return stale;
  }
}

const EARTH_RADIUS_M = 6371000;
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * "Has this address generated tree complaints before?" — nearest prior
 * service request / work order within radiusM, using the cached (recent,
 * up-to-MAX_RECORDS) snapshot rather than a live query per PRD 5.3: this is
 * a historical-pattern check, not live duplicate detection against HRM's
 * current internal queue (that needs an API HRM has but doesn't publish).
 */
export async function getHistoricalPatternNote(
  lat: number,
  lng: number,
  radiusM = 75
): Promise<string | null> {
  const [requests, orders] = await Promise.all([getTreeServiceRequests(), getTreeWorkOrders()]);

  const nearbyRequests = requests.filter((r) => haversineMeters(lat, lng, r.lat, r.lng) <= radiusM);
  const nearbyOrders = orders.filter((o) => haversineMeters(lat, lng, o.lat, o.lng) <= radiusM);

  if (nearbyRequests.length === 0 && nearbyOrders.length === 0) return null;

  const parts: string[] = [];
  if (nearbyRequests.length > 0) {
    const mostRecent = nearbyRequests[0]; // already sorted DATE_INITIATED DESC
    const year = new Date(mostRecent.dateInitiated).getFullYear();
    parts.push(
      `${nearbyRequests.length} prior tree service request(s) within ${radiusM}m (most recent ${year})`
    );
  }
  if (nearbyOrders.length > 0) {
    const types = [...new Set(nearbyOrders.map((o) => o.workType))].slice(0, 3).join(", ");
    parts.push(`${nearbyOrders.length} prior work order(s) within ${radiusM}m (${types})`);
  }
  return parts.join("; ");
}
