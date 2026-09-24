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
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json({
      ok: true,
      service: "dealdost-scanner",
      runtime: "railway-node",
      websocket: state.feed.websocket,
      data: state.feed.data,
      universe: state.market.universeSize,
      paperPositions: state.paper.positions.length,
      testnetConfigured: state.testnet.configured,
      testnetConnected: state.testnet.connected,
      updatedAt: state.updatedAt,
    });
  });

  app.get("/api/state", (req, res) => {
    try {
      const requested = String(req.get("x-dealdost-mode") ?? "").toUpperCase();
      if (requested === "PAPER" || requested === "TESTNET" || requested === "LIVE") {
        scanner.setRequestMode(requested, req.get("x-dealdost-auto") === "true", {
          paperAuto: req.get("x-dealdost-paper-auto") === "true",
          testnetAuto: req.get("x-dealdost-testnet-auto") === "true",
          liveAuto: req.get("x-dealdost-live-auto") === "true",
        });
      }

      res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
      res.json(scanner.state());
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/market/ingest", async (req, res) => {
    try {
      const body = req.body ?? {};
      const mode = String(body.mode ?? "").toUpperCase();
      if (mode === "LIVE") {
        return res.status(403).json({ error: "LIVE_EXECUTION_LOCKED" });
      }
      if (mode === "PAPER" || mode === "TESTNET") {
        scanner.setRequestMode(mode, Boolean(body.auto), {
          paperAuto: body.paperAuto === undefined ? undefined : Boolean(body.paperAuto),
          testnetAuto: body.testnetAuto === undefined ? undefined : Boolean(body.testnetAuto),
        });
      }

      const universe = Array.isArray(body.universe) ? body.universe : [];
      const symbol = String(body.symbol ?? "").toUpperCase();
      const candles = body.candles;

      if (
        !symbol ||
        !Array.isArray(candles?.["1m"]) ||
        !Array.isArray(candles?.["5m"]) ||
        !Array.isArray(candles?.["15m"])
      ) {
        return res.status(400).json({ error: "invalid_market_payload" });
      }

      const state = await scanner.ingestBrowserMarket({
        universe: universe.map((t: any) => ({
          symbol: String(t.symbol ?? "").toUpperCase(),
          quoteVolume: Number(t.quoteVolume),
          lastPrice: Number(t.lastPrice),
        })),
        symbol,
        candles: {
          "1m": candles["1m"],
          "5m": candles["5m"],
          "15m": candles["15m"],
        },
        btc15m: Array.isArray(body.btc15m) ? body.btc15m : undefined,
      });

      res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
      res.json(state);
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/live/protection-sync", async (req, res) => {
    try {
      const symbol = String(req.body?.symbol ?? "").toUpperCase();
      if (!symbol) return res.status(400).json({ error: "symbol_required" });
      const state = await scanner.syncLivePositionProtection(symbol);
      res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
      res.json(state);
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/live/close", async (req, res) => {
    try {
      const symbol = String(req.body?.symbol ?? "").toUpperCase();
      if (!symbol) return res.status(400).json({ error: "symbol_required" });
      const state = await scanner.closeManagedLivePosition(symbol);
      res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
      res.json(state);
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/mode", async (req, res) => {
    try {
      const body = req.body ?? {};
      const mode = String(body.mode ?? "").toUpperCase();
      if (mode !== "PAPER" && mode !== "TESTNET" && mode !== "LIVE") {
        return res.status(mode === "LIVE" ? 403 : 400).json({
          error: mode === "LIVE" ? "LIVE_EXECUTION_LOCKED" : "invalid_mode",
        });
      }

      scanner.setRequestMode(mode, Boolean(body.auto ?? body.testnetAuto), {
        paperAuto: body.paperAuto === undefined ? undefined : Boolean(body.paperAuto),
        testnetAuto: body.testnetAuto === undefined ? undefined : Boolean(body.testnetAuto),
      });
      res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
      res.json(scanner.state());
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/testnet/protection-sync", async (req, res) => {
    try {
      const symbol = String(req.body?.symbol ?? "").toUpperCase();
      if (!symbol) return res.status(400).json({ error: "symbol_required" });

      const state = await scanner.syncTestnetPositionProtection(symbol);
      res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
      res.json(state);
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/testnet/close", async (req, res) => {
    try {
      const symbol = String(req.body?.symbol ?? "").toUpperCase();
      if (!symbol) return res.status(400).json({ error: "symbol_required" });

      const state = await scanner.closeManagedTestnetPosition(symbol);
      res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
      res.json(state);
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
    }
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
