// app.ts
import * as http from "node:http";
import * as url from "node:url";
import { renderAll, type RenderRequest } from "./render";
import config from "./config";

const PORT = process.env.PORT ? Number(process.env.PORT) :  (config as any).server?.port ?? 3000;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || "", true);

  // CORS（方便本地调试）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === "GET" && parsed.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === "POST" && parsed.pathname === "/render") {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}") as RenderRequest;

      if (!payload.titleDir || typeof payload.titleDir !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "titleDir is required (string)" }));
      }

      const result = await renderAll(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, result }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
    }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`HTTP server running at http://127.0.0.1:${PORT}`);
});

