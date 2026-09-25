import express from "express";
import path from "node:path";
import { BinanceScanner } from "../src/scanner.js";

const app = express();
const scanner = new BinanceScanner();
let started = false;
let startPromise: Promise<void> | undefined;

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.resolve(process.cwd(), "public")));

// Request mode is mutated only by explicit control endpoints.
// State/market reads remain side-effect free so stale browser state cannot
// silently disable server-owned TESTNET automation.
function applyControlMode(input: any) {
  if (input?.emergencyStop !== undefined) {
    scanner.setEmergencyStop(Boolean(input.emergencyStop));
  }
  const requested = String(input?.mode ?? "").toUpperCase();
  if (requested === "PAPER" || requested === "TESTNET" || requested === "LIVE") {
    const automation = {
      paperAuto: input?.paperAuto === undefined ? undefined : Boolean(input.paperAuto),
      testnetAuto: input?.testnetAuto === undefined ? undefined : Boolean(input.testnetAuto),
      liveAuto: input?.liveAuto === undefined ? undefined : Boolean(input.liveAuto),
    };
    scanner.setRequestMode(requested, Boolean(input?.auto), automation);
  }
}

function applyReadMode(input: any) {
  const requested = String(input?.mode ?? "").toUpperCase();
  if (requested === "PAPER" || requested === "TESTNET" || requested === "LIVE") {
    scanner.setRequestMode(requested);
  }
}

async function ensureStarted() {
  if (started) return;
  if (!startPromise) {
    startPromise = scanner.startServerless().then(() => {
      started = true;
    }).catch((error) => {
      startPromise = undefined;
      throw error;
    });
  }
  await startPromise;
}

app.get("/api/health", async (_req, res) => {
  try {
    await ensureStarted();
    const state = scanner.state();
    res.json({
      ok: true,
      service: "dealdost-scanner",
      runtime: "vercel-node",
      websocket: state.feed.websocket,
      data: state.feed.data,
      universe: state.market.universeSize,
      paperPositions: state.paper.positions.length,
      updatedAt: state.updatedAt,
    });
  } catch (error) {
    res.status(503).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/state", async (req, res) => {
  try {
    await ensureStarted();
    applyReadMode({ mode: req.get("x-dealdost-mode") });
    await scanner.serverlessTick();
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(scanner.state());
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/market/ingest", async (req, res) => {
  try {
    await ensureStarted();
    const body = req.body ?? {};
    applyReadMode({ mode: body.mode });
    scanner.restorePaperRuntime(body.paperState, body.rotationState);
    const universe = Array.isArray(body.universe) ? body.universe : [];
    const symbol = String(body.symbol ?? "").toUpperCase();
    const candles = body.candles;

    if (!symbol || !Array.isArray(candles?.["1m"]) || !Array.isArray(candles?.["5m"]) || !Array.isArray(candles?.["15m"])) {
      res.status(400).json({ error: "invalid_market_payload" });
      return;
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

app.post("/api/mode", async (req, res) => {
  try {
    await ensureStarted();
    const body = req.body ?? {};
    const mode = String(body.mode ?? "").toUpperCase();
    if (mode !== "PAPER" && mode !== "TESTNET" && mode !== "LIVE") {
      res.status(400).json({ error: "invalid_mode" });
      return;
    }
    scanner.setRequestMode(mode, Boolean(body.auto ?? body.testnetAuto ?? body.liveAuto), {
      paperAuto: body.paperAuto === undefined ? undefined : Boolean(body.paperAuto),
      testnetAuto: body.testnetAuto === undefined ? undefined : Boolean(body.testnetAuto),
      liveAuto: body.liveAuto === undefined ? undefined : Boolean(body.liveAuto),
    });
    res.json(scanner.state());
  } catch (error) {
    res.status(error instanceof Error && error.message === "LIVE_EXECUTION_LOCKED" ? 403 : 503)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/analytics", async (req, res) => {
  try {
    await ensureStarted();
    const requested = String(req.query?.mode ?? req.get("x-dealdost-mode") ?? "").toUpperCase();
    const mode = requested === "LIVE" ? "LIVE" : "TESTNET";
    const days = Math.min(90, Math.max(1, Number(req.query?.days ?? 30) || 30));
    const analytics = await scanner.accountAnalytics(mode, days);
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(analytics);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/risk/emergency-stop", async (req, res) => {
  try {
    await ensureStarted();
    scanner.setEmergencyStop(Boolean(req.body?.enabled));
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(scanner.state());
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/testnet/preflight", async (_req, res) => {
  try {
    await ensureStarted();
    const result = await scanner.testnetPreflight();
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/testnet/protection-sync", async (req, res) => {
  try {
    await ensureStarted();
    const symbol = String(req.body?.symbol ?? "").toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: "symbol_required" });
      return;
    }
    const state = await scanner.syncTestnetPositionProtection(symbol);
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(state);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/testnet/close", async (req, res) => {
  try {
    await ensureStarted();
    const symbol = String(req.body?.symbol ?? "").toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: "symbol_required" });
      return;
    }
    const state = await scanner.closeManagedTestnetPosition(symbol);
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(state);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/live/protection-sync", async (req, res) => {
  try {
    await ensureStarted();
    const symbol = String(req.body?.symbol ?? "").toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: "symbol_required" });
      return;
    }
    const state = await scanner.syncLivePositionProtection(symbol);
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(state);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/live/close", async (req, res) => {
  try {
    await ensureStarted();
    const symbol = String(req.body?.symbol ?? "").toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: "symbol_required" });
      return;
    }
    const state = await scanner.closeManagedLivePosition(symbol);
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(state);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/paper/auto", async (req, res) => {
  try {
    await ensureStarted();
    scanner.setPaperAuto(Boolean(req.body?.enabled));
    res.json(scanner.state());
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/paper/close", async (req, res) => {
  try {
    await ensureStarted();
    const symbol = String(req.body?.symbol ?? "").toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: "symbol_required" });
      return;
    }
    scanner.closePaperPosition(symbol);
    res.json(scanner.state());
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default app;
