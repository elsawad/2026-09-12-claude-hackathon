import type { Tier } from "../types";

export interface PublicReport {
  id: string;
  lat: number;
  lng: number;
  tier: Tier | null;
  status: string;
  confirmationCount: number;
  createdAt: string;
}

export interface SubmitReportPayload {
  photo: File | null;
  lat: number;
  lng: number;
  locationSource: "exif" | "geolocation" | "map_pin" | "typed_address";
  description: string;
  questionnaireLocationAnswer: string | null;
  questionnaireDangerAnswer: string | null;
  preFlaggedUrgent: boolean;
}

async function parseOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function submitReport(payload: SubmitReportPayload) {
  const form = new FormData();
  if (payload.photo) form.append("photo", payload.photo);
  form.append("lat", String(payload.lat));
  form.append("lng", String(payload.lng));
  form.append("locationSource", payload.locationSource);
  form.append("description", payload.description);
  if (payload.questionnaireLocationAnswer) form.append("questionnaireLocationAnswer", payload.questionnaireLocationAnswer);
  if (payload.questionnaireDangerAnswer) form.append("questionnaireDangerAnswer", payload.questionnaireDangerAnswer);
  form.append("preFlaggedUrgent", String(payload.preFlaggedUrgent));

  const res = await fetch("/api/reports", { method: "POST", body: form });
  return parseOrThrow(res);
}

export async function getGeometryHint(lat: number, lng: number): Promise<{ status: string; detail: string | null }> {
  const res = await fetch(`/api/geometry-hint?lat=${lat}&lng=${lng}`);
  return parseOrThrow(res);
}

export async function getPublicReports(): Promise<PublicReport[]> {
  const res = await fetch("/api/reports/public");
  return parseOrThrow(res);
}

export async function confirmReport(id: string, sessionToken: string) {
  const res = await fetch(`/api/reports/${id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken })
  });
  return parseOrThrow(res);
}

export async function lookupReport(code: string) {
  const res = await fetch(`/api/reports/lookup/${encodeURIComponent(code)}`);
  return parseOrThrow(res);
}
