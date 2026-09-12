import "dotenv/config";
import { app } from "./app.js";

// Deliberately NOT named PORT: dev launchers (including this repo's own
// .claude/launch.json flow) commonly inject a PORT env var for "the" dev
// server, which here is Vite's — reusing that name made Express try to
// bind Vite's port instead of its own.
const PORT = Number(process.env.API_PORT ?? 8787);

app.listen(PORT, () => console.log(`Canopy Watch API listening on http://localhost:${PORT}`));
