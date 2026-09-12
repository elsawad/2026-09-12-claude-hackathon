import cors from "cors";
import express from "express";
import { getReport, ingestReport, listReports, reviewReport } from "./store.js";
import { ACTIONS, TIERS, type ActionInput, type ActionName, type Tier } from "./types.js";

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "canopy-watch" });
});

app.get("/api", (_req, res) => {
  res.json({
    name: "Canopy Watch API",
    version: "0.2.0",
    endpoints: [
      "/api/health",
      "/api/reports",
      "/api/reports/:id",
      "POST /api/reports  { lat, lng, photo_url?, description?, notes?, priority, category }",
      "POST /api/reports/:id/actions",
    ],
  });
});

app.get("/api/reports", (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : null;
  res.json(listReports(since));
});

app.get("/api/reports/:id", (req, res) => {
  const found = getReport(String(req.params.id));
  if (!found) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(found);
});

app.post("/api/reports", (req, res) => {
  try {
    const report = ingestReport(req.body ?? {});
    res.status(201).json({ report });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid report" });
  }
});

app.post("/api/reports/:id/actions", (req, res) => {
  const body = req.body ?? {};
  const action = body.action as ActionName;
  if (!ACTIONS.includes(action)) {
    res.status(400).json({ error: "Unknown action" });
    return;
  }
  const input: ActionInput = {
    action,
    officer_id: String(body.officer_id || ""),
    final_tier: TIERS.includes(body.final_tier as Tier)
      ? (body.final_tier as Tier)
      : undefined,
    override_reason: body.override_reason,
  };
  try {
    const result = reviewReport(String(req.params.id), input);
    if (!result) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid action" });
  }
});

app.listen(port, () => {
  console.log(`Canopy Watch server listening on http://localhost:${port}`);
});
