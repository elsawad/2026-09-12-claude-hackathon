import cors from "cors";
import express from "express";

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "canopy-watch" });
});

app.get("/api", (_req, res) => {
  res.json({
    name: "Canopy Watch API",
    version: "0.1.0",
    endpoints: ["/api/health"],
  });
});

app.listen(port, () => {
  console.log(`Canopy Watch server listening on http://localhost:${port}`);
});
