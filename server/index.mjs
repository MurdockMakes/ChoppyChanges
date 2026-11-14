import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CoachError, generateCoachPlan } from "./coach.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const port = Number(process.env.COACH_PORT || process.env.PORT || 8787);
const host = process.env.COACH_HOST || "0.0.0.0";
const MAX_BODY_BYTES = 64 * 1024;
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2",
};

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new CoachError(415, "Send JSON to /api/coach.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new CoachError(413, "The symbolic summary is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CoachError(400, "Invalid JSON.");
  }
}

async function serveStatic(pathname, res) {
  let path;
  try { path = decodeURIComponent(pathname); } catch { return false; }
  const candidate = resolve(dist, `.${path}`);
  if (candidate !== dist && !candidate.startsWith(`${dist}${sep}`)) return false;
  const file = extname(candidate) ? candidate : resolve(dist, "index.html");
  try {
    if (!(await stat(file)).isFile()) return false;
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
    res.end(content);
    return true;
  } catch { return false; }
}

export function createCoachServer(options = {}) {
  return createServer(async (req, res) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (pathname === "/api/coach") {
      if (req.method !== "POST") return json(res, 405, { error: "Use POST /api/coach." });
      try {
        const payload = await readJson(req);
        const plan = await generateCoachPlan(payload, options);
        return json(res, 200, plan);
      } catch (error) {
        const status = error instanceof CoachError ? error.status : 500;
        return json(res, status, { error: error instanceof CoachError ? error.message : "Coach request failed." });
      }
    }
    if (pathname.startsWith("/api/")) return json(res, 404, { error: "Unknown API route." });
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed." });
    if (!await serveStatic(pathname, res)) return json(res, 404, { error: "Build the app first with npm run build." });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createCoachServer();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Coach API port ${port} is already in use. Stop the existing dev server before restarting.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
  server.listen(port, host, () => {
    console.log(`Changes Coach server listening on http://${host}:${port}`);
  });
}
