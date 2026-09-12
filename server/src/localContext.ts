import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import * as turf from "@turf/turf";
import type { BBox, Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { LandEvidence, NearbyRequest, PopulationImpact } from "./types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OWNED_LAND_FILE = path.join(ROOT, "hrm_owned_land.geojson");
const CENSUS_FILE = path.join(ROOT, "Census_2021_Dissemination_Areas_-5724810768993162933.geojson");
const WORK_ORDERS_FILE = path.join(ROOT, "Cityworks_Work_Orders_5341484547526583350.sqlite");
const EARTH_RADIUS_M = 6_371_000;
const TERMINAL_STATUSES = new Set(["CLOSED", "COMPLETE"]);

type PolygonFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>;
type IndexedFeature = { feature: PolygonFeature; bbox: BBox };

type WorkOrderRow = {
  work_order_id: string;
  description: string | null;
  status: string | null;
  date_initiated: string | null;
  lon: number;
  lat: number;
};

let ownedLand: IndexedFeature[] | null = null;
let censusAreas: IndexedFeature[] | null = null;
let censusDensities: number[] | null = null;
let workOrdersDb: Database.Database | null = null;

function loadPolygons(file: string): IndexedFeature[] {
  const collection = JSON.parse(fs.readFileSync(file, "utf8")) as FeatureCollection;
  return collection.features
    .filter(
      (feature): feature is PolygonFeature =>
        feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon",
    )
    .map((feature) => ({ feature, bbox: turf.bbox(feature) }));
}

function contains([west, south, east, north]: BBox, lng: number, lat: number): boolean {
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

function containingFeature(features: IndexedFeature[], lat: number, lng: number): PolygonFeature | null {
  const point = turf.point([lng, lat]);
  for (const candidate of features) {
    if (contains(candidate.bbox, lng, lat) && turf.booleanPointInPolygon(point, candidate.feature)) {
      return candidate.feature;
    }
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function getHrmLandEvidence(lat: number, lng: number): LandEvidence {
  ownedLand ??= loadPolygons(OWNED_LAND_FILE);
  const match = containingFeature(ownedLand, lat, lng);
  const properties = match?.properties;
  return {
    on_hrm_owned_land: match !== null,
    asset_code: typeof properties?.ASSETCODE === "string" ? properties.ASSETCODE : null,
    location_type: typeof properties?.LOCGEN === "string" ? properties.LOCGEN : null,
    pid: typeof properties?.PID === "string" ? properties.PID : null,
  };
}

export function getPopulationImpact(lat: number, lng: number): PopulationImpact | null {
  if (!censusAreas) {
    censusAreas = loadPolygons(CENSUS_FILE);
    censusDensities = censusAreas
      .map(({ feature }) => finiteNumber(feature.properties?.DAPOPDEN))
      .filter((density): density is number => density !== null)
      .sort((a, b) => a - b);
  }

  const match = containingFeature(censusAreas, lat, lng);
  if (!match || !censusDensities?.length) return null;

  const population = finiteNumber(match.properties?.DAPOP2021);
  const density = finiteNumber(match.properties?.DAPOPDEN);
  const areaId = match.properties?.DAUID;
  if (population === null || density === null || typeof areaId !== "string") return null;

  const atOrBelow = censusDensities.filter((candidate) => candidate <= density).length;
  return {
    dissemination_area_id: areaId,
    population,
    population_density_per_km2: density,
    density_percentile: Math.round((atOrBelow / censusDensities.length) * 1000) / 10,
  };
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function getWorkOrdersDb(): Database.Database {
  workOrdersDb ??= new Database(WORK_ORDERS_FILE, { readonly: true, fileMustExist: true });
  return workOrdersDb;
}

export function getNearbyRequests(lat: number, lng: number, radiusM = 50): NearbyRequest[] {
  const latitudeDelta = radiusM / 111_320;
  const longitudeDelta = radiusM / (111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const rows = getWorkOrdersDb()
    .prepare(
      `SELECT work_order_id, description, status, date_initiated, lon, lat
       FROM work_orders
       WHERE asset_type = 'AST_TREE'
         AND lon BETWEEN ? AND ?
         AND lat BETWEEN ? AND ?`,
    )
    .all(
      lng - longitudeDelta,
      lng + longitudeDelta,
      lat - latitudeDelta,
      lat + latitudeDelta,
    ) as WorkOrderRow[];

  return rows
    .map((row) => ({ row, distance: haversineMeters(lat, lng, row.lat, row.lon) }))
    .filter(({ distance }) => distance <= radiusM)
    .sort((a, b) => a.distance - b.distance)
    .map(({ row, distance }) => ({
      id: row.work_order_id,
      source_type: "cityworks_work_order",
      work_category: row.description,
      status: row.status,
      date_initiated: row.date_initiated,
      distance_m: Math.round(distance * 10) / 10,
      is_current: !TERMINAL_STATUSES.has(row.status?.toUpperCase() ?? ""),
    }));
}
