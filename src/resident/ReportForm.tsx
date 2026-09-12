import { useEffect, useState } from "react";
import exifr from "exifr";
import LocationCapture, { type CapturedLocation } from "./LocationCapture";
import { getGeometryHint, submitReport } from "../lib/api";

interface Props {
  preFlaggedUrgent: boolean;
  onDone: (result: any) => void;
}

const LOCATION_OPTIONS = [
  { value: "street_or_sidewalk", label: "On a street or sidewalk" },
  { value: "public_park", label: "In a public park" },
  { value: "private_property", label: "On private property" },
  { value: "not_sure", label: "Not sure" }
];

const DANGER_OPTIONS = [
  { value: "blocking_something", label: "Blocking something" },
  { value: "hanging_over_something", label: "Hanging over something" },
  { value: "looks_unwell", label: "Looks unwell but not urgent" },
  { value: "not_sure", label: "Not sure" }
];

function landStatusToQuestionnaireGuess(status: string): string {
  if (status === "public_park") return "public_park";
  if (status === "right_of_way") return "street_or_sidewalk";
  if (status === "private") return "private_property";
  return "not_sure";
}

export default function ReportForm({ preFlaggedUrgent, onDone }: Props) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [location, setLocation] = useState<CapturedLocation | null>(null);
  const [locationAnswer, setLocationAnswer] = useState<string>("");
  const [dangerAnswer, setDangerAnswer] = useState<string>("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPhotoChange(file: File | null) {
    setPhoto(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
    if (file && !location) {
      try {
        const gps = await exifr.gps(file);
        if (gps && typeof gps.latitude === "number") {
          setLocation({ lat: gps.latitude, lng: gps.longitude, source: "exif" });
        }
      } catch {
        // EXIF frequently stripped by messaging apps — silently fall through to manual capture.
      }
    }
  }

  useEffect(() => {
    if (!location) return;
    getGeometryHint(location.lat, location.lng)
      .then((hint) => setLocationAnswer((prev) => prev || landStatusToQuestionnaireGuess(hint.status)))
      .catch(() => {});
  }, [location]);

  const canSubmit = location !== null && !submitting;

  async function handleSubmit() {
    if (!location) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitReport({
        photo,
        lat: location.lat,
        lng: location.lng,
        locationSource: location.source,
        description,
        questionnaireLocationAnswer: locationAnswer || null,
        questionnaireDangerAnswer: dangerAnswer || null,
        preFlaggedUrgent
      });
      onDone(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="screen">
      <div className="card">
        <div className="field">
          <label>Photo</label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
          />
          {photoPreview && (
            <img
              src={photoPreview}
              alt="Selected tree hazard"
              style={{ marginTop: 8, borderRadius: 10, maxHeight: 200, objectFit: "cover" }}
            />
          )}
        </div>

        <LocationCapture value={location} onChange={setLocation} />

        {location && (
          <>
            <div className="field">
              <label>Where is the tree?</label>
              <select value={locationAnswer} onChange={(e) => setLocationAnswer(e.target.value)}>
                <option value="">Select one</option>
                {LOCATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="helper-text">Pre-filled with our best guess — change it if we got it wrong.</p>
            </div>

            <div className="field">
              <label>Is it dangerous right now?</label>
              <select value={dangerAnswer} onChange={(e) => setDangerAnswer(e.target.value)}>
                <option value="">Select one</option>
                {DANGER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Anything else we should know? (optional, any language)</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
          {submitting ? "Submitting…" : "Submit report"}
        </button>
        <p className="helper-text" style={{ marginTop: 10, textAlign: "center" }}>
          This report is anonymous. We don't collect your name or contact info.
        </p>
      </div>
    </div>
  );
}
