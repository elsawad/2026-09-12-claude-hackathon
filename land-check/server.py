#!/usr/bin/env python3
from pathlib import Path
from typing import Optional
import sqlite3

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from hrm_land import LandIndex, in_hrm_bbox

ROOT = Path(__file__).resolve().parents[1]
SQLITE = ROOT / "Cityworks_Work_Orders_5341484547526583350.sqlite"
LAND = ROOT / "hrm_owned_land.geojson"
STATIC = Path(__file__).resolve().parent / "static"

app = FastAPI(title="HRM Public Land Check")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

land_index = LandIndex(LAND)


def db():
    conn = sqlite3.connect(SQLITE)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/api/stats")
def stats(trees_only: bool = False):
    where = "WHERE lon IS NOT NULL AND lat IS NOT NULL AND on_hrm_land IS NOT NULL"
    params = []
    if trees_only:
        where += " AND asset_type = ?"
        params.append("AST_TREE")
    conn = db()
    cur = conn.cursor()
    total = cur.execute(
        f"SELECT COUNT(*) FROM work_orders {where}", params
    ).fetchone()[0]
    on_land = cur.execute(
        f"SELECT COUNT(*) FROM work_orders {where} AND on_hrm_land = 1", params
    ).fetchone()[0]
    by_code = [
        {"code": row["land_asset_code"] or "unknown", "n": row["n"]}
        for row in cur.execute(
            f"""
            SELECT land_asset_code, COUNT(*) AS n
            FROM work_orders
            {where} AND on_hrm_land = 1
            GROUP BY land_asset_code
            ORDER BY n DESC
            """,
            params,
        )
    ]
    conn.close()
    return {
        "total_with_coords": total,
        "on_hrm_land": on_land,
        "not_on_hrm_land": total - on_land,
        "pct_on_hrm_land": round(100.0 * on_land / total, 1) if total else 0,
        "parcel_count": land_index.parcel_count,
        "by_asset_code": by_code,
    }


@app.get("/api/points")
def points(
    west: float,
    south: float,
    east: float,
    north: float,
    on_hrm_land: Optional[int] = Query(default=None),
    trees_only: bool = False,
    limit: int = Query(default=4000, ge=1, le=8000),
):
    clauses = [
        "lon IS NOT NULL",
        "lat IS NOT NULL",
        "on_hrm_land IS NOT NULL",
        "lon BETWEEN ? AND ?",
        "lat BETWEEN ? AND ?",
    ]
    params = [west, east, south, north]
    if on_hrm_land in (0, 1):
        clauses.append("on_hrm_land = ?")
        params.append(on_hrm_land)
    if trees_only:
        clauses.append("asset_type = ?")
        params.append("AST_TREE")
    where = " AND ".join(clauses)
    conn = db()
    cur = conn.cursor()
    available = cur.execute(
        f"SELECT COUNT(*) FROM work_orders WHERE {where}", params
    ).fetchone()[0]
    skip = max(1, available // limit)
    rows = cur.execute(
        f"""
        SELECT object_id, work_order_id, lon, lat, on_hrm_land, land_asset_code,
               asset_type, status, address
        FROM work_orders
        WHERE {where}
          AND (object_id % ?) = 0
        LIMIT ?
        """,
        [*params, skip, limit],
    ).fetchall()
    conn.close()
    return {
        "count": len(rows),
        "available": available,
        "truncated": available > len(rows),
        "points": [
            {
                "id": row["object_id"],
                "wo": row["work_order_id"],
                "lon": row["lon"],
                "lat": row["lat"],
                "on": int(row["on_hrm_land"]),
                "code": row["land_asset_code"],
                "asset": row["asset_type"],
                "status": row["status"],
                "address": row["address"],
            }
            for row in rows
        ],
    }


@app.get("/api/search")
def search(q: str):
    needle = (q or "").strip()
    if not needle:
        raise HTTPException(status_code=400, detail="Enter a work order ID")
    conn = db()
    row = conn.execute(
        """
        SELECT object_id, work_order_id, lon, lat
        FROM work_orders
        WHERE work_order_id = ? OR CAST(object_id AS TEXT) = ?
        LIMIT 1
        """,
        (needle, needle),
    ).fetchone()
    if not row:
        row = conn.execute(
            """
            SELECT object_id, work_order_id, lon, lat
            FROM work_orders
            WHERE address LIKE ?
            LIMIT 1
            """,
            (f"%{needle}%",),
        ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No matching work order")
    return dict(row)


@app.get("/api/work-order/{object_id}")
def work_order(object_id: int):
    conn = db()
    row = conn.execute(
        """
        SELECT object_id, work_order_id, date_initiated, actual_finish_date,
               asset_type, description, priority, status, address, district,
               lon, lat, on_hrm_land, land_asset_code, land_location_type, land_pid
        FROM work_orders
        WHERE object_id = ?
        """,
        (object_id,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Work order not found")
    data = dict(row)
    land = None
    if data["lon"] is not None and data["lat"] is not None:
        land = land_index.summarize(data["lon"], data["lat"])
    return {"work_order": data, "land": land}


@app.get("/api/check")
def check(lat: float, lon: float):
    if not in_hrm_bbox(lon, lat):
        return {
            "lat": lat,
            "lon": lon,
            "in_hrm": False,
            "on_hrm_land": False,
            "message": "Outside the Halifax Regional Municipality area used for this check.",
        }
    summary = land_index.summarize(lon, lat)
    conn = db()
    nearby = [
        dict(row)
        for row in conn.execute(
            """
            SELECT object_id, work_order_id, address, asset_type, status,
                   on_hrm_land, lon, lat,
                   ((lon - ?) * (lon - ?) + (lat - ?) * (lat - ?)) AS d2
            FROM work_orders
            WHERE lon BETWEEN ? AND ?
              AND lat BETWEEN ? AND ?
              AND on_hrm_land IS NOT NULL
            ORDER BY d2
            LIMIT 8
            """,
            (lon, lon, lat, lat, lon - 0.03, lon + 0.03, lat - 0.03, lat + 0.03),
        ).fetchall()
    ]
    conn.close()
    return {
        "lat": lat,
        "lon": lon,
        "in_hrm": True,
        **summary,
        "nearby_work_orders": nearby,
    }


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
