const map = L.map("map", { zoomControl: true }).setView([44.6488, -63.5752], 12);
const canvas = L.canvas({ padding: 0.5 });

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap",
  maxZoom: 19,
}).addTo(map);

const layer = L.layerGroup().addTo(map);
let landFilter = "";
let pending = null;
let probeMarker = null;

const labels = {
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

function treesOnly() {
  return document.getElementById("treesOnly").checked;
}

function fmt(n) {
  return Number(n).toLocaleString("en-CA");
}

function coords(lat, lon) {
  return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
}

async function loadStats() {
  const res = await fetch(`/api/stats?trees_only=${treesOnly()}`);
  const data = await res.json();
  document.getElementById("stat-on").textContent = fmt(data.on_hrm_land);
  document.getElementById("stat-off").textContent = fmt(data.not_on_hrm_land);
  document.getElementById("stat-pct").textContent = `${data.pct_on_hrm_land}%`;
}

async function loadPoints() {
  const bounds = map.getBounds();
  const params = new URLSearchParams({
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
    trees_only: String(treesOnly()),
    limit: "5000",
  });
  if (landFilter !== "") params.set("on_hrm_land", landFilter);

  const res = await fetch(`/api/points?${params}`);
  const data = await res.json();
  layer.clearLayers();

  data.points.forEach((point) => {
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
      showWorkOrder(point.id);
    });
    marker.addTo(layer);
  });

  const hint = document.getElementById("zoomHint");
  if (data.truncated) {
    hint.textContent = `Showing ${fmt(data.count)} of ${fmt(data.available)} work orders in view. Zoom in for the rest.`;
    hint.classList.remove("hidden");
  } else {
    hint.classList.add("hidden");
  }
}

function scheduleLoad() {
  clearTimeout(pending);
  pending = setTimeout(loadPoints, 200);
}

function setDetail(html) {
  const el = document.getElementById("detail");
  el.classList.remove("empty");
  el.innerHTML = html;
}

function landBadge(on) {
  return on
    ? `<span class="badge on">On HRM-owned land</span>`
    : `<span class="badge off">Not on HRM-owned land</span>`;
}

async function showWorkOrder(id) {
  const res = await fetch(`/api/work-order/${id}`);
  if (!res.ok) {
    setDetail("<p>Work order not found.</p>");
    return;
  }
  const data = await res.json();
  const wo = data.work_order;
  const land = data.land || {};
  setProbe(wo.lat, wo.lon, wo.on_hrm_land);
  setDetail(`
    ${landBadge(wo.on_hrm_land)}
    <h2>Work order ${wo.work_order_id}</h2>
    <dl class="kv">
      <dt>Coordinates</dt><dd>${wo.lat == null ? "None" : coords(wo.lat, wo.lon)}</dd>
      <dt>Address</dt><dd>${wo.address || "—"}</dd>
      <dt>Asset</dt><dd>${wo.asset_type || "—"}</dd>
      <dt>Description</dt><dd>${wo.description || "—"}</dd>
      <dt>Status</dt><dd>${wo.status || "—"}</dd>
      <dt>Land type</dt><dd>${land.asset_label || labels[wo.land_asset_code] || "Not HRM land"}</dd>
      <dt>PID</dt><dd>${wo.land_pid || "—"}</dd>
    </dl>
  `);
}

function setProbe(lat, lon, on) {
  if (probeMarker) map.removeLayer(probeMarker);
  probeMarker = L.circleMarker([lat, lon], {
    radius: 9,
    color: "#14241b",
    weight: 2,
    fillColor: on ? "#d7e27c" : "#ffffff",
    fillOpacity: 1,
  }).addTo(map);
}

async function checkLatLng(lat, lon) {
  const res = await fetch(`/api/check?lat=${lat}&lon=${lon}`);
  const data = await res.json();
  setProbe(lat, lon, data.on_hrm_land);
  const parcels = (data.parcels || [])
    .map((p) => `${p.asset_label || p.asset_code}${p.pid ? ` · PID ${p.pid}` : ""}`)
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

map.on("moveend", scheduleLoad);
map.on("click", (event) => checkLatLng(event.latlng.lat, event.latlng.lng));

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    landFilter = chip.dataset.land;
    loadStats();
    loadPoints();
  });
});

document.getElementById("treesOnly").addEventListener("change", () => {
  loadStats();
  loadPoints();
});

document.getElementById("searchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const q = document.getElementById("searchInput").value.trim();
  if (!q) return;
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) {
    setDetail(`<p>No work order matched “${q}”.</p>`);
    return;
  }
  const match = await res.json();
  if (match.lat != null && match.lon != null) {
    map.setView([match.lat, match.lon], 17);
  }
  showWorkOrder(match.object_id);
});

loadStats();
loadPoints();
