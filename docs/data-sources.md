# Data sources — verified endpoints and field names

The dataset landing pages (data-hrm.hub.arcgis.com, data.novascotia.ca) describe intent, not
field names or even which platform serves them. This is what we actually confirmed by querying
the live services directly, so the reasoning behind `server/dataLayers.ts` and
`server/cityworks.ts` is on the record.

## NS Topographic Database — Utilities

Not a single ArcGIS layer — Socrata, split into three geometry-typed tables:

| Layer | Endpoint | Rows | Notes |
|---|---|---|---|
| Lines | `data.novascotia.ca/resource/yjmz-hpnc.geojson` | 1,353 | transmission lines |
| Points | `data.novascotia.ca/resource/eiwy-kfrj.geojson` | 2,371 | substations, towers |
| Polygons | `data.novascotia.ca/resource/4ujs-gpyq.geojson` | 1,305 | tanks |

All three share a `feat_code` field (`UTTR50`=transmission line, `UTPI50/56/57`=pipeline,
`UTSS40/60`=substation, `UTTO60/65`=tower, `UTTK40/60/65`=tank) and `feat_desc`. `.geojson`
format returns all columns directly — small enough to fetch once and cache indefinitely.

## Cityworks Service Requests

`services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/Cityworks_Service_Requests/FeatureServer/0`

**This is an ArcGIS Table, not a spatial layer** — `f=geojson` returns `geometry: null`.
Location comes from plain `LATITUDE`/`LONGITUDE` fields (WGS84). Tree requests are identified
by `DESCRIPTION='Trees'` (the broader `REQUEST_CATEGORY` field only has buckets like
`ROWMAINTENANCE`). Status: `STATUS`. Date: `DATE_INITIATED` (epoch ms).

**Correction to PRD v3 §5.3:** the "data ends December 2024" claim does not hold — max
`DATE_INITIATED` for the Trees subset is 2026-09-04 (min 2017-07-28). This is a live-ish
periodic ArcGIS extract, not a frozen Dec-2024 snapshot. We still don't have live write-back or
HRM's internal current-queue API, so true real-time duplicate detection against work HRM is
doing *right now* is still out of reach — but historical-pattern lookback (`server/cityworks.ts
getHistoricalPatternNote`) is checking against genuinely recent data, not two-year-old data.

477,343 rows total / 34,860 in the Trees subset — we cache only the most recent 6,000 (see
`MAX_RECORDS` in `server/cityworks.ts`), which easily covers "has this address generated
complaints before."

## Cityworks Work Orders

`services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/Cityworks_Work_Orders/FeatureServer/0`

Also a Table. Location fields are `X_COORDINATE`/`Y_COORDINATE` in **Web Mercator (EPSG:3857)**,
not lat/long — `server/cityworks.ts` reprojects these manually (no proj4 dependency needed for
a single well-known projection pair). Tree work orders: `ASSET_TYPE='AST_TREE'` (40,850 of
118,912 total). `DESCRIPTION` gives the sub-type ("Tree - Removal", "Tree - Pruning and
Trimming", "Tree - Stump Removal", etc). Status: `STATUS`. Date: `DATE_INITIATED`.

## HRM Parks

`services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/HRM_Parks_2/FeatureServer/0`

Real spatial polygon layer. `PARK_NAME`, `PARK_TYPE`, `OWNER`, `HECTARES`. 927 features.

## Street Centrelines

`services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/StreetNetwork/FeatureServer/0`

Polyline layer, 18,640 features. `STR_NAME` (base name) or `FULL_NAME` (name + type, e.g.
"GLORIAROSE LANE").

## HRM municipal boundary

No dataset is literally titled "HRM Boundary." We use **Census 2021 Census Subdivisions**
(`services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/Census_2021_Census_Subdivisions/FeatureServer/0`),
filtered to `CSDNAME='Halifax' AND CSDTYPE='RGM'` — the single polygon matching HRM's legal
boundary (5,475.57 km²). The unfiltered layer has 5 features; the other 4 are Mi'kmaw reserve
enclaves geographically inside HRM's outline but legally separate (Cole Harbour 30, Beaver Lake
17, Sheet Harbour 36, Wallace Hills 14A) — not excluded from the geofence, since for this
product's purpose (is this tree HRM's to look at) that distinction doesn't change the answer.

## Decisions written down (build-plan Step 3)

- **Street ROW buffer:** 10m either side of the centreline (`STREET_ROW_BUFFER_M` in
  `server/geometry.ts`).
- **Utility emergency buffer:** 30m (`UTILITY_EMERGENCY_BUFFER_M`). Erring wide deliberately —
  a false positive costs an officer ten seconds to downgrade; a false negative could mean a
  downed line goes unflagged.
- **Historical pattern radius:** 75m (`getHistoricalPatternNote` default).
- **Nearby-duplicate (our own reports) radius:** 50m, per PRD §8 layer 6.
- **EAB flag:** simplified to "inside HRM ⇒ flagged" (see `server/eab.ts`) — CFIA's actual 2018
  regulated-area boundary wasn't findable as a clean, current GIS layer in the time available;
  named as a simplification rather than silently assumed.
