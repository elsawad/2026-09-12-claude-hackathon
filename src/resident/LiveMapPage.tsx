import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
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
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, confirmationCount: r.confirmationCount + (result.alreadyConfirmed ? 0 : 1) } : r)));
    }
  }

  return (
    <div className="screen">
      <p className="lede">
        Pins are shown at block level, not exact addresses. Tap a pin to confirm you see it too.
      </p>
      {loading ? (
        <p className="center-note">Loading reports…</p>
      ) : (
        <div className="leaflet-map" style={{ height: 460 }}>
          <MapContainer center={HALIFAX_CENTER} zoom={12} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {reports.map((r) => (
              <CircleMarker
                key={r.id}
                center={[r.lat, r.lng]}
                radius={10}
                pathOptions={{
                  color: TIER_COLORS[r.tier ?? "insufficient_info"],
                  fillColor: TIER_COLORS[r.tier ?? "insufficient_info"],
                  fillOpacity: 0.8
                }}
              >
                <Popup>
                  <div style={{ fontSize: 13 }}>
                    <strong>{r.tier?.replace(/_/g, " ") ?? "unscored"}</strong>
                    <br />
                    Status: {r.status}
                    <br />
                    Confirmations: {r.confirmationCount}
                    <br />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: 8, padding: "6px 10px", fontSize: 12 }}
                      disabled={confirmed.has(r.id)}
                      onClick={() => handleConfirm(r.id)}
                    >
                      {confirmed.has(r.id) ? "You confirmed this ✓" : "I see this too"}
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      )}
      {!loading && reports.length === 0 && <p className="center-note">No reports yet.</p>}
    </div>
  );
}
