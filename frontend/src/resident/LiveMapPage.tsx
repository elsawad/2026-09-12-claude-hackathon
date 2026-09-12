import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { confirmReport, getPublicReports, type PublicReport } from "../lib/api";
import { getSessionToken } from "../lib/session";

const HALIFAX_CENTER: [number, number] = [44.6488, -63.5752];

const TIER_COLORS: Record<string, string> = {
  utility_emergency: "#a3281c",
  imminent_hazard: "#b8590a",
  routine: "#1f6f43",
  insufficient_info: "#5b564a"
};

export default function LiveMapPage() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPublicReports()
      .then(setReports)
      .finally(() => setLoading(false));
  }, []);

  async function handleConfirm(id: string) {
    const token = getSessionToken();
    const result = await confirmReport(id, token);
    if (result.ok) {
      setConfirmed((prev) => new Set(prev).add(id));
      setReports((prev) =>
        prev.map((r) => (r.id === id ? { ...r, confirmationCount: r.confirmationCount + (result.alreadyConfirmed ? 0 : 1) } : r))
      );
    }
  }

  useEffect(() => {
    if (loading || !mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current).setView(HALIFAX_CENTER, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [loading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers: L.CircleMarker[] = [];
    for (const r of reports) {
      const color = TIER_COLORS[r.tier ?? "insufficient_info"];
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 10,
        color,
        fillColor: color,
        fillOpacity: 0.8
      }).addTo(map);
      const popupEl = document.createElement("div");
      popupEl.style.fontSize = "13px";
      popupEl.innerHTML = `<strong>${(r.tier ?? "unscored").replace(/_/g, " ")}</strong><br>Status: ${r.status}<br>Confirmations: ${r.confirmationCount}<br>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary confirm-btn";
      btn.disabled = confirmed.has(r.id);
      btn.textContent = confirmed.has(r.id) ? "You confirmed this ✓" : "I see this too";
      btn.onclick = () => handleConfirm(r.id);
      popupEl.appendChild(btn);
      marker.bindPopup(popupEl);
      markers.push(marker);
    }
    return () => {
      markers.forEach((m) => map.removeLayer(m));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, confirmed]);

  return (
    <div className="screen">
      <p className="lede">Pins are shown at block level, not exact addresses. Tap a pin to confirm you see it too.</p>
      {loading ? (
        <p className="center-note">Loading reports…</p>
      ) : (
        <div ref={mapEl} className="live-map" />
      )}
      {!loading && reports.length === 0 && <p className="center-note">No reports yet.</p>}
    </div>
  );
}
