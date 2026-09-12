#!/usr/bin/env python3
"""Tag each Cityworks work order with HRM-owned land status."""

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from hrm_land import LandIndex, in_hrm_bbox  # noqa: E402

SQLITE = ROOT / "Cityworks_Work_Orders_5341484547526583350.sqlite"
LAND = ROOT / "hrm_owned_land.geojson"


def ensure_columns(cur):
    existing = {row[1] for row in cur.execute("PRAGMA table_info(work_orders)")}
    for name, ddl in [
        ("on_hrm_land", "INTEGER"),
        ("land_asset_code", "TEXT"),
        ("land_location_type", "TEXT"),
        ("land_pid", "TEXT"),
    ]:
        if name not in existing:
            cur.execute(f"ALTER TABLE work_orders ADD COLUMN {name} {ddl}")


def main():
    print("Loading HRM owned land ...", flush=True)
    index = LandIndex(LAND)
    print(f"  {index.parcel_count:,} parcels", flush=True)

    conn = sqlite3.connect(SQLITE)
    cur = conn.cursor()
    ensure_columns(cur)

    rows = cur.execute(
        "SELECT object_id, lon, lat FROM work_orders"
    ).fetchall()
    print(f"Classifying {len(rows):,} work orders ...", flush=True)

    updates = []
    on_count = 0
    off_count = 0
    missing = 0
    for object_id, lon, lat in rows:
        if not in_hrm_bbox(lon, lat):
            updates.append((None, None, None, None, object_id))
            missing += 1
            continue
        summary = index.summarize(lon, lat)
        if summary["on_hrm_land"]:
            on_count += 1
            updates.append(
                (
                    1,
                    summary["asset_code"],
                    summary["location_type"],
                    summary["pid"],
                    object_id,
                )
            )
        else:
            off_count += 1
            updates.append((0, None, None, None, object_id))

    cur.executemany(
        """
        UPDATE work_orders
        SET on_hrm_land = ?, land_asset_code = ?, land_location_type = ?, land_pid = ?
        WHERE object_id = ?
        """,
        updates,
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_work_orders_on_hrm_land ON work_orders(on_hrm_land)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_work_orders_asset_type_land ON work_orders(asset_type, on_hrm_land)"
    )
    conn.commit()
    conn.close()
    print(
        f"Done. on_hrm_land={on_count:,}  not_on_land={off_count:,}  no_usable_coords={missing:,}"
    )


if __name__ == "__main__":
    main()
