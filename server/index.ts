import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "./db.js";
import { warmDataLayers } from "./dataLayers.js";
import { getLandStatus } from "./geometry.js";
import { submitReport } from "./pipeline.js";
import {
  listReports,
  getReportById,
  getReportByReferenceCode,
  confirmReport,
  updateReview,
  insertAuditLog,
  getAuditLog
} from "./reportsRepo.js";
import type { LocationSource, ReviewState, ReportStatus, Tier } from "./types.js";
import type { QuestionnaireLocationAnswer } from "./geometry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Deliberately NOT named PORT: dev launchers (including this repo's own
// .claude/launch.json flow) commonly inject a PORT env var for "the" dev
// server, which here is Vite's — reusing that name made Express try to
// bind Vite's port instead of its own.
const PORT = Number(process.env.API_PORT ?? 8787);
const OFFICER_PASSPHRASE = process.env.OFFICER_PASSPHRASE ?? "canopy";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`)
  }),
  limits: { fileSize: 8 * 1024 * 1024 }
});

// --- Layer 9: soft per-session/IP rate limit (build plan section 8, PRD table 8.1) ---
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

function officerAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.header("x-officer-passphrase") !== OFFICER_PASSPHRASE) {
    res.status(401).json({ error: "Invalid or missing officer passphrase." });
    return;
  }
  next();
}

// ---------- Resident-facing routes ----------

app.post("/api/officer/login", (req, res) => {
  const { passphrase } = req.body ?? {};
  if (passphrase === OFFICER_PASSPHRASE) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

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
      photoUrl = `/uploads/${req.file.filename}`;
      photoBase64 = fs.readFileSync(req.file.path).toString("base64");
      photoMediaType = req.file.mimetype;
    }

    const result = await submitReport({
      photoUrl,
      photoBase64,
      photoMediaType,
      lat,
      lng,
      locationSource: (body.locationSource as LocationSource) ?? "map_pin",
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
      case "rejected_spam":
        res.status(422).json({ error: result.reason });
        return;
      case "diverted_private":
        res.json({
          kind: "diverted_private",
          referenceCode: result.report.reference_code,
          message: result.message
        });
        return;
      case "created":
        res.json({
          kind: "created",
          referenceCode: result.report.reference_code,
          tier: result.report.proposed_tier,
          possibleDuplicate: result.possibleDuplicate
        });
        return;
    }
  } catch (err) {
    console.error("[POST /api/reports]", err);
    res.status(500).json({ error: "Something went wrong scoring this report. Please try again." });
  }
});

// Public map: block-level location only, no reporter identity, ever existed to begin with.
function blockLevel(coord: number): number {
  return Math.round(coord * 800) / 800; // ~roughly 120-140m grid at Halifax's latitude
}

app.get("/api/reports/public", async (_req, res) => {
  const reports = await listReports();
  res.json(
    reports
      .filter((r) => r.status !== "diverted_private")
      .map((r) => ({
        id: r.id,
        lat: blockLevel(r.lat),
        lng: blockLevel(r.lng),
        tier: r.review_state === "reviewed_overridden" ? r.final_tier : r.proposed_tier,
        status: r.status,
        confirmationCount: r.confirmation_count,
        createdAt: r.created_at
      }))
  );
});

app.get("/api/reports/public/:id", async (req, res) => {
  const r = await getReportById(req.params.id);
  if (!r || r.status === "diverted_private") {
    res.status(404).json({ error: "Not found" });
    return;
  }
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
  const report = await getReportById(req.params.id);
  if (!report) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const result = await confirmReport(req.params.id, sessionToken);
  res.json(result);
});

app.get("/api/reports/lookup/:code", async (req, res) => {
  const r = await getReportByReferenceCode(req.params.code.toUpperCase());
  if (!r) {
    res.status(404).json({ error: "No report found with that reference code." });
    return;
  }
  res.json({
    referenceCode: r.reference_code,
    status: r.status,
    reviewState: r.review_state,
    tier: r.review_state === "reviewed_overridden" ? r.final_tier : r.proposed_tier,
    createdAt: r.created_at
  });
});

// ---------- Officer console routes (passphrase-gated) ----------

app.use("/api/officer", officerAuth);

app.get("/api/officer/summary", async (_req, res) => {
  const reports = await listReports();
  const active = reports.filter((r) => r.status !== "diverted_private" && r.status !== "resolved" && r.status !== "stale");
  const awaiting = active.filter((r) => r.review_state === "awaiting_review");
  const byTier: Record<string, number> = {};
  for (const r of awaiting) byTier[r.proposed_tier ?? "unscored"] = (byTier[r.proposed_tier ?? "unscored"] ?? 0) + 1;

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const newSinceLastCheck = active.filter((r) => new Date(r.created_at).getTime() > oneDayAgo).length;
  const deflected = reports.filter((r) => r.status === "diverted_private").length;

  res.json({
    awaitingReviewByTier: byTier,
    awaitingReviewTotal: awaiting.length,
    utilityEmergencies: awaiting.filter((r) => r.proposed_tier === "utility_emergency").length,
    newSinceLastCheck,
    deflectedCount: deflected
  });
});

const TIER_ORDER: Record<string, number> = { utility_emergency: 0, imminent_hazard: 1, routine: 2, insufficient_info: 3 };

app.get("/api/officer/reports", async (req, res) => {
  const reports = await listReports();
  const filterState = req.query.review_state as ReviewState | undefined;
  let filtered = reports.filter((r) => r.status !== "diverted_private");
  if (filterState) filtered = filtered.filter((r) => r.review_state === filterState);
  filtered.sort((a, b) => {
    const tierDiff = (TIER_ORDER[a.proposed_tier ?? ""] ?? 9) - (TIER_ORDER[b.proposed_tier ?? ""] ?? 9);
    if (tierDiff !== 0) return tierDiff;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
  res.json(filtered);
});

app.get("/api/officer/reports/:id", async (req, res) => {
  const report = await getReportById(req.params.id);
  if (!report) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const auditLog = await getAuditLog(report.id);
  res.json({ report, auditLog });
});

const VALID_ACTIONS = ["accept", "override", "escalate", "in_progress", "resolve"] as const;

app.post("/api/officer/reports/:id/review", async (req, res) => {
  const { action, finalTier, overrideReason, reviewedBy } = req.body as {
    action: (typeof VALID_ACTIONS)[number];
    finalTier?: Tier;
    overrideReason?: string;
    reviewedBy?: string;
  };
  if (!VALID_ACTIONS.includes(action)) {
    res.status(400).json({ error: `action must be one of ${VALID_ACTIONS.join(", ")}` });
    return;
  }
  const before = await getReportById(req.params.id);
  if (!before) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (action === "override" && !overrideReason) {
    res.status(400).json({ error: "overrideReason is required when overriding a tier." });
    return;
  }

  let reviewState: ReviewState = before.review_state;
  let status: ReportStatus | undefined;
  if (action === "accept") reviewState = "reviewed_accepted";
  if (action === "override") reviewState = "reviewed_overridden";
  if (action === "escalate") reviewState = "escalated";
  if (action === "in_progress") status = "in_progress";
  if (action === "resolve") status = "resolved";

  const officer = reviewedBy || "officer_demo";
  const updated = await updateReview(req.params.id, {
    reviewState,
    finalTier: action === "override" ? finalTier ?? null : action === "accept" ? before.proposed_tier : undefined,
    overrideReason: action === "override" ? overrideReason ?? null : null,
    reviewedBy: officer,
    status
  });

  await insertAuditLog({
    report_id: req.params.id,
    actor: officer,
    action,
    before: JSON.stringify({ review_state: before.review_state, status: before.status, final_tier: before.final_tier }),
    after: JSON.stringify({ review_state: updated?.review_state, status: updated?.status, final_tier: updated?.final_tier })
  });

  res.json(updated);
});

async function main() {
  await migrate();
  warmDataLayers().catch((err) => console.error("[warmDataLayers]", err));
  app.listen(PORT, () => console.log(`Canopy Watch API listening on http://localhost:${PORT}`));
}

main();
