import cors from "cors";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./db.js";
import { warmDataLayers } from "./dataLayers.js";
import { getLandStatus } from "./geometry.js";
import { submitReport } from "./pipeline.js";
import {
  confirmReport,
  getPublicReports,
  getReport,
  listReports,
  lookupReportByCode,
  reviewReport
} from "./store.js";
import { ACTIONS, TIERS, type ActionInput, type ActionName, type Tier } from "./types.js";
import type { QuestionnaireLocationAnswer } from "./geometry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
// Read-only filesystem outside /tmp on Vercel — harmless no-op there since
// storePhoto() below only writes here when USE_BLOB is false.
try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch {
  // ignore — expected on serverless when not using local disk storage
}

const USE_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// Runs once per cold start; migrate() is idempotent so repeat calls (warm
// invocations reusing this module) are cheap no-ops.
await migrate();
warmDataLayers().catch((err) => console.error("[warmDataLayers]", err));

export const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

// --- Layer 9: soft per-IP rate limit (PRD §8 layer 9) ---
// In-memory, so it resets on every cold start and isn't shared across
// serverless instances — an accepted limitation for a demo.
const submissionTimestamps = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (submissionTimestamps.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  submissionTimestamps.set(key, recent);
  return recent.length > RATE_LIMIT_MAX;
}

async function storePhoto(file: Express.Multer.File): Promise<string> {
  if (USE_BLOB) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`reports/${Date.now()}-${file.originalname}`, file.buffer, {
      access: "public",
      contentType: file.mimetype,
      addRandomSuffix: true
    });
    return blob.url;
  }
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.buffer);
  return `/uploads/${filename}`;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "canopy-watch" });
});

app.get("/api", (_req, res) => {
  res.json({
    name: "Canopy Watch API",
    version: "0.4.0",
    endpoints: [
      "/api/health",
      "GET /api/reports?since=",
      "GET /api/reports/:id",
      "POST /api/reports/:id/actions",
      "POST /api/reports  (multipart: photo?, lat, lng, locationSource, description?, questionnaireLocationAnswer?, questionnaireDangerAnswer?, preFlaggedUrgent?)",
      "GET /api/geometry-hint?lat=&lng=",
      "GET /api/reports/public",
      "GET /api/reports/public/:id",
      "POST /api/reports/:id/confirm",
      "GET /api/reports/lookup/:code"
    ]
  });
});

// ---------- Resident-facing routes ----------

// Lets the resident form pre-fill the ownership questionnaire with the
// geometry proxy's best guess (PRD 6.2) before the resident answers it
// themselves — never authoritative, just a starting point.
app.get("/api/geometry-hint", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: "lat/lng required" });
    return;
  }
  const result = await getLandStatus(lat, lng);
  res.json(result);
});

app.post("/api/reports", upload.single("photo"), async (req, res) => {
  try {
    const key = req.ip ?? "unknown";
    if (rateLimited(key)) {
      res.status(429).json({ error: "Too many reports from this connection recently. Please try again later." });
      return;
    }

    const body = req.body as Record<string, string>;
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: "lat/lng are required and must be numbers." });
      return;
    }

    let photoBase64: string | null = null;
    let photoMediaType: string | null = null;
    let photoUrl: string | null = null;
    if (req.file) {
      photoUrl = await storePhoto(req.file);
      photoBase64 = req.file.buffer.toString("base64");
      photoMediaType = req.file.mimetype;
    }

    const result = await submitReport({
      photoUrl,
      photoBase64,
      photoMediaType,
      lat,
      lng,
      locationSource: body.locationSource || "map_pin",
      descriptionOriginal: body.description || null,
      questionnaireLocationAnswer: (body.questionnaireLocationAnswer as QuestionnaireLocationAnswer) || null,
      questionnaireDangerAnswer: body.questionnaireDangerAnswer || null,
      preFlaggedUrgent: body.preFlaggedUrgent === "true"
    });

    switch (result.kind) {
      case "outside_hrm":
        res.status(400).json({
          error: "This location doesn't appear to be inside Halifax Regional Municipality. Canopy Watch only covers HRM."
        });
        return;
      case "not_hrm_owned":
        res.status(422).json({
          status: "rejected",
          rejection_reason: "NOT_HRM_OWNED",
          land_check: result.landCheck,
          error: "This location is not on HRM-owned land."
        });
        return;
      case "categorization_error":
        res.status(result.code === "AI_UNAVAILABLE" ? 503 : 400).json({
          status: "error",
          error: result.code,
          message: result.message
        });
        return;
      case "rejected_spam":
        res.status(422).json({ error: result.reason });
        return;
      case "created":
        res.json({
          kind: "created",
          referenceCode: result.report.reference_code,
          tier: result.report.proposed_tier,
          categorization: result.categorization,
          possibleDuplicate: result.possibleDuplicate
        });
        return;
    }
  } catch (err) {
    console.error("[POST /api/reports]", err);
    res.status(500).json({ error: "Something went wrong scoring this report. Please try again." });
  }
});

app.get("/api/reports/public", async (_req, res) => {
  res.json(await getPublicReports());
});

app.get("/api/reports/public/:id", async (req, res) => {
  const found = await getReport(req.params.id);
  if (!found || found.report.status === "diverted_private") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const r = found.report;
  const blockLevel = (coord: number) => Math.round(coord * 800) / 800;
  res.json({
    id: r.id,
    lat: blockLevel(r.lat),
    lng: blockLevel(r.lng),
    tier: r.review_state === "reviewed_overridden" ? r.final_tier : r.proposed_tier,
    reason: r.reason,
    status: r.status,
    confirmationCount: r.confirmation_count,
    createdAt: r.created_at
  });
});

app.post("/api/reports/:id/confirm", async (req, res) => {
  const { sessionToken } = req.body ?? {};
  if (!sessionToken) {
    res.status(400).json({ error: "sessionToken required" });
    return;
  }
  const result = await confirmReport(req.params.id, sessionToken);
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(result);
});

app.get("/api/reports/lookup/:code", async (req, res) => {
  const result = await lookupReportByCode(req.params.code);
  if (!result) {
    res.status(404).json({ error: "No report found with that reference code." });
    return;
  }
  res.json(result);
});

// ---------- Officer console routes ----------
// No auth gate yet — the console is demo-only for now (PRD §7.5 names real
// HRM SSO as future work; this consolidation didn't add the shared-passphrase
// stand-in Track A had, since the console UI kept here wasn't built with a
// login screen).

app.get("/api/reports", async (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : null;
  res.json(await listReports(since));
});

app.get("/api/reports/:id", async (req, res) => {
  const found = await getReport(String(req.params.id));
  if (!found) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(found);
});

app.post("/api/reports/:id/actions", async (req, res) => {
  const body = req.body ?? {};
  const action = body.action as ActionName;
  if (!ACTIONS.includes(action)) {
    res.status(400).json({ error: "Unknown action" });
    return;
  }
  const input: ActionInput = {
    action,
    officer_id: String(body.officer_id || ""),
    final_tier: TIERS.includes(body.final_tier as Tier) ? (body.final_tier as Tier) : undefined,
    override_reason: body.override_reason
  };
  try {
    const result = await reviewReport(String(req.params.id), input);
    if (!result) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid action" });
  }
});
