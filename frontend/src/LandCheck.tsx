import { useEffect, useRef, useState, type FormEvent } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./LandCheck.css";

type Stats = {
  on_hrm_land: number;
  not_on_hrm_land: number;
  pct_on_hrm_land: number;
};

type MapPoint = {
  id: number;
  lat: number;
  lon: number;
  on: number;
};

const LABELS: Record<string, string> = {
  BSP: "Business park",
  LACEM: "Cemetery",
  DRA: "Drainage",
  LAB: "Land associated with buildings",
  LAU: "Land associated with utilities",
  OPN: "Open space",
  ROW: "Right-of-way",
  SWL: "Solid waste",
  ITR: "In transition",
  VAC: "Vacant",
  WAT: "Water lot",
  UNKN: "Unknown",
};

function fmt(n: number) {
  return Number(n).toLocaleString("en-CA");
}

function coords(lat: number, lon: number) {
  return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
}

function landBadge(on: boolean) {
  return on
    ? `<span class="badge on">On HRM-owned land</span>`
    : `<span class="badge off">Not on HRM-owned land</span>`;
}

export default function LandCheck() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const probeRef = useRef<L.CircleMarker | null>(null);
  const landFilter = useRef("");
  const treesOnly = useRef(false);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState("");
  const [trees, setTrees] = useState(false);
  const [detailHtml, setDetailHtml] = useState("<p>No location selected.</p>");
  const [detailEmpty, setDetailEmpty] = useState(true);
  const [zoomHint, setZoomHint] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");

  function setDetail(html: string) {
    setDetailEmpty(false);
    setDetailHtml(html);
  }

  function setProbe(lat: number, lon: number, on: boolean) {
    const map = mapRef.current;
    if (!map) return;
    if (probeRef.current) map.removeLayer(probeRef.current);
    probeRef.current = L.circleMarker([lat, lon], {
      radius: 9,
      color: "#14241b",
      weight: 2,
      fillColor: on ? "#d7e27c" : "#ffffff",
      fillOpacity: 1,
    }).addTo(map);
  }

  async function loadStats() {
    const res = await fetch(`/api/stats?trees_only=${treesOnly.current}`);
    const data: Stats = await res.json();
    setStats(data);
  }

  async function loadPoints() {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const bounds = map.getBounds();
    const params = new URLSearchParams({
      west: String(bounds.getWest()),
      south: String(bounds.getSouth()),
      east: String(bounds.getEast()),
      north: String(bounds.getNorth()),
      trees_only: String(treesOnly.current),
      limit: "5000",
    });
    if (landFilter.current !== "") params.set("on_hrm_land", landFilter.current);

    const res = await fetch(`/api/points?${params}`);
    const data = await res.json();
    layer.clearLayers();
    const canvas = L.canvas({ padding: 0.5 });

    (data.points as MapPoint[]).forEach((point) => {
      const marker = L.circleMarker([point.lat, point.lon], {
        renderer: canvas,
        radius: 5,
        color: point.on ? "#2f6b32" : "#9a4d31",
        fillColor: point.on ? "#7dcc7a" : "#e08963",
        fillOpacity: 0.85,
        weight: 1,
      });
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        void showWorkOrder(point.id);
      });
      marker.addTo(layer);
    });

    if (data.truncated) {
      setZoomHint(
        `Showing ${fmt(data.count)} of ${fmt(data.available)} work orders in view. Zoom in for the rest.`,
      );
    } else {
      setZoomHint(null);
    }
  }

  function scheduleLoad() {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => void loadPoints(), 200);
  }

  async function showWorkOrder(id: number) {
    const res = await fetch(`/api/work-order/${id}`);
    if (!res.ok) {
      setDetail("<p>Work order not found.</p>");
      return;
    }
    const data = await res.json();
    const wo = data.work_order;
    const land = data.land || {};
    if (wo.lat != null && wo.lon != null) {
      setProbe(wo.lat, wo.lon, Boolean(wo.on_hrm_land));
    }
    setDetail(`
      ${landBadge(Boolean(wo.on_hrm_land))}
      <h2>Work order ${wo.work_order_id}</h2>
      <dl class="kv">
        <dt>Coordinates</dt><dd>${wo.lat == null ? "None" : coords(wo.lat, wo.lon)}</dd>
        <dt>Address</dt><dd>${wo.address || "—"}</dd>
        <dt>Asset</dt><dd>${wo.asset_type || "—"}</dd>
        <dt>Description</dt><dd>${wo.description || "—"}</dd>
        <dt>Status</dt><dd>${wo.status || "—"}</dd>
        <dt>Land type</dt><dd>${land.asset_label || LABELS[wo.land_asset_code] || "Not HRM land"}</dd>
        <dt>PID</dt><dd>${wo.land_pid || "—"}</dd>
      </dl>
    `);
  }

  async function checkLatLng(lat: number, lon: number) {
    const res = await fetch(`/api/check?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    setProbe(lat, lon, Boolean(data.on_hrm_land));
    const parcels = (data.parcels || [])
      .map(
        (p: { asset_label?: string; asset_code?: string; pid?: string }) =>
          `${p.asset_label || p.asset_code}${p.pid ? ` · PID ${p.pid}` : ""}`,
      )
      .join("<br>");
    setDetail(`
      ${landBadge(Boolean(data.on_hrm_land))}
      <h2>Dropped pin</h2>
      <dl class="kv">
        <dt>Coordinates</dt><dd>${coords(lat, lon)}</dd>
        <dt>Land type</dt><dd>${data.asset_label || "Not HRM-owned land"}</dd>
        <dt>Location</dt><dd>${data.location_label || "—"}</dd>
        <dt>PID</dt><dd>${data.pid || "—"}</dd>
        <dt>Parcels</dt><dd>${parcels || "None"}</dd>
      </dl>
    `);
  }

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;

    const map = L.map(mapEl.current, { zoomControl: true }).setView(
      [44.6488, -63.5752],
      12,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;

    map.on("moveend", scheduleLoad);
    map.on("click", (event: L.LeafletMouseEvent) => {
      void checkLatLng(event.latlng.lat, event.latlng.lng);
    });

    return () => {
      if (loadTimer.current) clearTimeout(loadTimer.current);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      probeRef.current = null;
    };
    // Map bootstrap once; filters reload via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    landFilter.current = filter;
    treesOnly.current = trees;
    void loadStats();
    void loadPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, trees]);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    const q = searchQ.trim();
    if (!q) return;
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      setDetail(`<p>No work order matched “${q}”.</p>`);
      return;
    }
    const match = await res.json();
    if (match.lat != null && match.lon != null && mapRef.current) {
      mapRef.current.setView([match.lat, match.lon], 17);
    }
    void showWorkOrder(match.object_id);
  }

  return (
    <div className="land-check">
      <div ref={mapEl} className="land-map" />

      <aside className="panel">
        <p className="eyebrow">Canopy Watch · Halifax</p>
        <h1>Public land check</h1>
        <p className="lede">
          Each Cityworks work order is plotted by coordinate and tested against
          HRM-owned land{" "}
          <a
            href="https://www.arcgis.com/apps/mapviewer/index.html?url=https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/ArcGIS/rest/services/HRM_Owned_Land/FeatureServer/0&source=sd"
            target="_blank"
            rel="noreferrer"
          >
            10,194 municipal parcels
          </a>
          .
        </p>

        <div className="stats">
          <div className="stat">
            <strong>{stats ? fmt(stats.on_hrm_land) : "—"}</strong>
            <span>On HRM land</span>
          </div>
          <div className="stat">
            <strong>{stats ? fmt(stats.not_on_hrm_land) : "—"}</strong>
            <span>Not on HRM land</span>
          </div>
          <div className="stat">
            <strong>{stats ? `${stats.pct_on_hrm_land}%` : "—"}</strong>
            <span>Share on public land</span>
          </div>
        </div>

        <div className="filters">
          {(
            [
              ["", "All coordinates"],
              ["1", "On public land"],
              ["0", "Not public land"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              className={`chip${filter === value ? " active" : ""}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="toggle">
          <input
            type="checkbox"
            checked={trees}
            onChange={(e) => setTrees(e.target.checked)}
          />
          Tree work orders only
        </label>

        <form className="search" onSubmit={onSearch}>
          <input
            type="search"
            placeholder="Work order ID or click the map"
            autoComplete="off"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          <button type="submit">Find</button>
        </form>

        <p className="hint">
          Click any point for its coordinates. Click empty map to test an
          arbitrary location.
        </p>

        <div
          className={`detail${detailEmpty ? " empty" : ""}`}
          dangerouslySetInnerHTML={{ __html: detailHtml }}
        />
      </aside>

      <div className="legend">
        <span>
          <i className="dot on" /> On HRM-owned land
        </span>
        <span>
          <i className="dot off" /> Not on HRM-owned land
        </span>
      </div>

      {zoomHint ? <p className="zoom-hint">{zoomHint}</p> : null}
    </div>
  );
}
