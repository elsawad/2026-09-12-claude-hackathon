// Vercel filesystem convention: this file becomes a serverless function.
// vercel.json rewrites /api/* here (a single function name doesn't
// otherwise match every /api/... path Express routes internally).
// Env vars (ANTHROPIC_API_KEY, DATABASE_URL, BLOB_READ_WRITE_TOKEN) come
// from Vercel's project settings, not a .env file, in production.
import { app } from "../server/src/app.js";

export default app;
