import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { BinanceScanner } from "./scanner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(scanner: BinanceScanner) {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(path.resolve(__dirname, "../public")));

  app.get("/api/health", (_req, res) => {
    const state = scanner.state();
    res.json({
      ok: true,
      service: "dealdost-scanner",
      websocket: state.feed.websocket,
      data: state.feed.data,
      universe: state.market.universeSize,
      paperPositions: state.paper.positions.length,
      updatedAt: state.updatedAt,
    });
  });

  app.get("/api/state", (_req, res) => {
    res.json(scanner.state());
  });

  app.post("/api/paper/auto", (req, res) => {
    scanner.setPaperAuto(Boolean(req.body?.enabled));
    res.json(scanner.state());
  });

  app.post("/api/paper/close", (req, res) => {
    const symbol = String(req.body?.symbol ?? "").toUpperCase();
    if (!symbol) return res.status(400).json({ error: "symbol_required" });
    scanner.closePaperPosition(symbol);
    res.json(scanner.state());
  });

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify(scanner.state()));
  });

  scanner.onUpdate(() => {
    const payload = JSON.stringify(scanner.state());
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  });

  server.listen(config.port, "0.0.0.0", () => {
    console.log("DealDost listening on http://0.0.0.0:" + config.port);
  });

  return server;
}
