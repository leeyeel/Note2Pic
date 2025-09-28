// app.ts
import * as http from "node:http";
import * as url from "node:url";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";

import config from "./config";
import { renderAll, type RenderRequest } from "./render";

import {
  PROJECT_ROOT,
  TEMPLATE_DIR,
  OUTPUT_DIR,
  listTemplates,
  listTemplateFiles,
  listOutputFiles,
  checkFonts,
  rimraf,
  resolveSafePath,
  existsSyncSafe,
} from "./utils";

const PORT = process.env.PORT ? Number(process.env.PORT) : (config as any).server?.port ?? 3000;

function sendJSON(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || "", true);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === "GET" && parsed.pathname === "/health") {
    return sendJSON(res, 200, { ok: true, ts: Date.now() });
  }

  if (req.method === "GET" && parsed.pathname === "/templates") {
    try {
      const names = await listTemplates();
      return sendJSON(res, 200, { ok: true, templates: names });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: (e as Error).message });
    }
  }

  if (req.method === "GET" && parsed.pathname === "/list-template") {
    const name = (parsed.query["name"] as string) || config.templates.defaultName;
    try {
      const result = await listTemplateFiles(name);
      return sendJSON(res, 200, { ok: true, template: name, ...result });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: (e as Error).message });
    }
  }

  if (req.method === "GET" && parsed.pathname === "/list-output") {
    try {
      const result = await listOutputFiles();
      return sendJSON(res, 200, { ok: true, ...result });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: (e as Error).message });
    }
  }

  if (req.method === "GET" && parsed.pathname === "/config") {
    try {
      return sendJSON(res, 200, { ok: true, config });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: (e as Error).message });
    }
  }

  if (req.method === "GET" && parsed.pathname === "/fonts") {
    try {
      const fonts = await checkFonts(config.fonts);
      return sendJSON(res, 200, { ok: true, fonts });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: (e as Error).message });
    }
  }

  if (req.method === "POST" && parsed.pathname === "/clear-output") {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}") as { titleDir?: string };
      if (!payload.titleDir) {
        return sendJSON(res, 400, { ok: false, error: "titleDir is required" });
      }
      const dir = path.join(OUTPUT_DIR, payload.titleDir);
      if (!fssync.existsSync(dir)) {
        return sendJSON(res, 404, { ok: false, error: "titleDir not found" });
      }
      await rimraf(dir);
      return sendJSON(res, 200, { ok: true, cleared: path.relative(PROJECT_ROOT, dir) });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: (e as Error).message });
    }
  }

  if (req.method === "POST" && parsed.pathname === "/render/dry-run") {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}") as RenderRequest;

      if (!payload.titleDir) {
        return sendJSON(res, 400, { ok: false, error: "titleDir is required" });
      }

      const name = payload.templateName || config.templates.defaultName;
      const tmpl = await listTemplateFiles(name);
      if (tmpl.pngFiles.length === 0) {
        return sendJSON(res, 400, { ok: false, error: "No template PNG found" });
      }

      const fonts = await checkFonts(config.fonts);
      const missing = fonts.filter((f) => !f.exists);
      if (missing.length) {
        return sendJSON(res, 400, {
          ok: false,
          error: "Some fonts are missing on disk",
          missing,
        });
      }

      return sendJSON(res, 200, { ok: true, template: tmpl, fonts });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: (e as Error).message });
    }
  }

  if (req.method === "POST" && parsed.pathname === "/render") {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}") as RenderRequest;

      if (!payload.titleDir || typeof payload.titleDir !== "string") {
        return sendJSON(res, 400, { ok: false, error: "titleDir is required (string)" });
      }

      const result = await renderAll(payload);
      return sendJSON(res, 200, { ok: true, result });
    } catch (err) {
      return sendJSON(res, 500, { ok: false, error: (err as Error).message });
    }
  }

  if (req.method === "GET" && parsed.pathname === "/preview") {
    try {
      const scope = (parsed.query["scope"] as string) || "output";
      const rel = (parsed.query["path"] as string) || "";
      const base =
        scope === "template"
          ? TEMPLATE_DIR
          : scope === "output"
          ? OUTPUT_DIR
          : null;

      if (!base) {
        return sendJSON(res, 400, { ok: false, error: "scope must be 'template' or 'output'" });
      }
      if (!rel) {
        return sendJSON(res, 400, { ok: false, error: "path is required" });
      }

      const abs = resolveSafePath(base, rel);
      if (!existsSyncSafe(abs)) {
        return sendJSON(res, 404, { ok: false, error: "file not found" });
      }

      const data = await fs.readFile(abs);
      res.writeHead(200, { "Content-Type": guessContentType(abs) });
      return res.end(data);
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: (e as Error).message });
    }
  }

  return sendJSON(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`HTTP server running at http://127.0.0.1:${PORT}`);
});

