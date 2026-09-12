import { useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";

export type LocationSource = "exif" | "geolocation" | "map_pin" | "typed_address";
export interface CapturedLocation {
  lat: number;
  lng: number;
  source: LocationSource;
}

const HALIFAX_CENTER: [number, number] = [44.6488, -63.5752];

interface Props {
  value: CapturedLocation | null;
  onChange: (loc: CapturedLocation) => void;
}

/**
 * PRD 6.3 fallback chain: EXIF (handled by the caller on photo select,
 * before this component even mounts its own choice) -> browser geolocation
 * -> map pin -> typed address. All free, no paid geocoding API.
 */
export default function LocationCapture({ value, onChange }: Props) {
  const [mode, setMode] = useState<"choose" | "map" | "address">("choose");
  const [address, setAddress] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function useGeolocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("Geolocation isn't available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: "geolocation" }),
      () => setError("Couldn't get your location — try dropping a pin or typing an address instead."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function geocodeAddress() {
    if (!address.trim()) return;
    setGeocoding(true);
    setError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        address + ", Halifax, Nova Scotia"
      )}&viewbox=-63.85,44.85,-63.4,44.5&bounded=1&limit=1`;
      const res = await fetch(url);
      const results = (await res.json()) as { lat: string; lon: string }[];
      if (results.length === 0) {
        setError("Couldn't find that address in HRM — try being more specific.");
        return;
      }
      onChange({ lat: Number(results[0].lat), lng: Number(results[0].lon), source: "typed_address" });
    } catch {
      setError("Address lookup failed. Try dropping a pin on the map instead.");
    } finally {
      setGeocoding(false);
    }
  }

  if (value) {
    return (
      <div className="field">
        <label>Location</label>
        <div className="pill">
          {labelForSource(value.source)} · {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 8 }}
          onClick={() => {
            setMode("choose");
            onChange(null as unknown as CapturedLocation);
          }}
        >
          Change location
        </button>
      </div>
    );
  }

  if (mode === "map") {
    return (
      <div className="field">
        <label>Tap the map where the tree is</label>
        <div className="leaflet-map">
          <MapContainer center={HALIFAX_CENTER} zoom={13} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <PinPicker onPick={(lat, lng) => onChange({ lat, lng, source: "map_pin" })} />
          </MapContainer>
        </div>
      </div>
    );
  }

  if (mode === "address") {
    return (
      <div className="field">
        <label>Type the address</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. 1234 Spring Garden Rd"
        />
        <button type="button" className="btn btn-primary" disabled={geocoding} onClick={geocodeAddress}>
          {geocoding ? "Looking up…" : "Find address"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  return (
    <div className="field">
      <label>Location</label>
      <div className="stack">
        <button type="button" className="btn btn-secondary" onClick={useGeolocation}>
          📍 Use my location
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setMode("map")}>
          🗺️ Drop a pin on the map
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setMode("address")}>
          ⌨️ Type an address
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function PinPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const [marker, setMarker] = useState<[number, number] | null>(null);
  useMapEvents({
    click(e) {
      setMarker([e.latlng.lat, e.latlng.lng]);
      onPick(e.latlng.lat, e.latlng.lng);
    }
  });
  return marker ? <Marker position={marker} /> : null;
}

function labelForSource(source: LocationSource): string {
  switch (source) {
    case "exif":
      return "From photo";
    case "geolocation":
      return "Your location";
    case "map_pin":
      return "Map pin";
    case "typed_address":
      return "Typed address";
  }
}
