import json
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ASSET_LABELS = {
    "BSP": "Business park",
    "LACEM": "Cemetery",
    "DRA": "Drainage",
    "LAB": "Land associated with buildings",
    "LAU": "Land associated with utilities",
    "OPN": "Open space",
    "ROW": "Right-of-way",
    "SWL": "Solid waste",
    "ITR": "In transition",
    "VAC": "Vacant",
    "WAT": "Water lot",
    "UNKN": "Unknown",
}

LOCGEN_LABELS = {
    "ROW": "Right-of-way",
    "ROWBRG": "Right-of-way on a bridge",
    "OSP": "Open space / park",
    "OSPREC": "Recreation site",
    "OSPBRG": "Open space on a bridge",
    "BLD": "Building site",
    "CEM": "Cemetery",
    "SW": "Solid waste site",
    "GEN": "General land",
}

ASSET_PRIORITY = {
    "OPN": 0,
    "LACEM": 1,
    "BSP": 2,
    "LAB": 3,
    "LAU": 4,
    "SWL": 5,
    "DRA": 6,
    "ROW": 7,
    "VAC": 8,
    "ITR": 9,
    "WAT": 10,
    "UNKN": 11,
}

HRM_BOUNDS = {
    "min_lon": -64.6,
    "max_lon": -62.4,
    "min_lat": 44.3,
    "max_lat": 45.4,
}


def in_hrm_bbox(lon, lat):
    if lon is None or lat is None:
        return False
    return (
        HRM_BOUNDS["min_lon"] <= lon <= HRM_BOUNDS["max_lon"]
        and HRM_BOUNDS["min_lat"] <= lat <= HRM_BOUNDS["max_lat"]
    )


def label_asset(code):
    if not code:
        return None
    return ASSET_LABELS.get(code, code)


def label_locgen(code):
    if not code:
        return None
    return LOCGEN_LABELS.get(code, code)


class LandIndex:
    def __init__(self, geojson_path):
        path = Path(geojson_path)
        data = json.loads(path.read_text())
        geoms = []
        props = []
        for feature in data.get("features") or []:
            geom = feature.get("geometry")
            if not geom:
                continue
            try:
                polygon = shape(geom)
            except Exception:
                continue
            if polygon.is_empty:
                continue
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            geoms.append(polygon)
            props.append(feature.get("properties") or {})
        self.geoms = geoms
        self.props = props
        self.tree = STRtree(geoms)
        self.parcel_count = len(geoms)

    def lookup(self, lon, lat):
        if not in_hrm_bbox(lon, lat):
            return []
        point = Point(lon, lat)
        indexes = self.tree.query(point, predicate="intersects")
        hits = []
        for idx in indexes:
            hits.append(self.props[int(idx)])
        hits.sort(key=lambda p: ASSET_PRIORITY.get(p.get("ASSETCODE"), 99))
        return hits

    def summarize(self, lon, lat):
        hits = self.lookup(lon, lat)
        if not hits:
            return {
                "on_hrm_land": False,
                "parcel_count": 0,
                "asset_code": None,
                "asset_label": None,
                "location_type": None,
                "location_label": None,
                "pid": None,
                "owner": None,
                "parcels": [],
            }
        top = hits[0]
        return {
            "on_hrm_land": True,
            "parcel_count": len(hits),
            "asset_code": top.get("ASSETCODE"),
            "asset_label": label_asset(top.get("ASSETCODE")),
            "location_type": top.get("LOCGEN"),
            "location_label": label_locgen(top.get("LOCGEN")),
            "pid": top.get("PID"),
            "owner": top.get("OWNER") or "HRM",
            "parcels": [
                {
                    "object_id": p.get("OBJECTID"),
                    "asset_code": p.get("ASSETCODE"),
                    "asset_label": label_asset(p.get("ASSETCODE")),
                    "location_type": p.get("LOCGEN"),
                    "location_label": label_locgen(p.get("LOCGEN")),
                    "pid": p.get("PID"),
                    "owner": p.get("OWNER") or "HRM",
                }
                for p in hits
            ],
        }
