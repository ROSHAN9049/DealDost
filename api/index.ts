import express from "express";
import path from "node:path";
import "../src/runtime-hardening.js";
import { BinanceScanner } from "../src/scanner.js";

const app = express();
const scanner = new BinanceScanner();
let started = false;
let startPromise: Promise<void> | undefined;

const EXECUTION_BASE = (
  process.env.DEALDOST_EXECUTION_URL ??
  "https://dealdost-production.up.railway.app"
).replace(/\\/+$/, "");

const isExecutionMode = (mode: unknown) => {
  const value = String(mode ?? "").toUpperCase();
  return value === "TESTNET" || value === "LIVE";
};

async function proxyJson(
  requestPath: string,
  init: {
    method?: "GET" | "POST";
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  const response = await fetch(EXECUTION_BASE + requestPath, {
    method: init.method ?? "GET",
    headers,
    body,
    cache: "no-store",
  });

  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || ("HTTP " + response.status) };
  }

  return { status: response.status, payload };
}

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
    const requestedMode = String(req.get("x-dealdost-mode") ?? "").toUpperCase();
    if (isExecutionMode(requestedMode)) {
      const remote = await proxyJson("/api/state", {
        headers: { "x-dealdost-mode": requestedMode },
      });
      res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
      res.status(remote.status).json(remote.payload);
      return;
    }

    await ensureStarted();
    applyReadMode({ mode: requestedMode });
    await scanner.serverlessTick();
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(scanner.state());
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/market/ingest", async (req, res) => {
  try {
    const body = req.body ?? {};
    if (isExecutionMode(body.mode)) {
      const remote = await proxyJson("/api/market/ingest", {
        method: "POST",
        body,
      });
      res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
      res.status(remote.status).json(remote.payload);
      return;
    }

    await ensureStarted();
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
    const body = req.body ?? {};
    const mode = String(body.mode ?? "").toUpperCase();
    if (isExecutionMode(mode)) {
      const controlBody = body.action === "select-mode"
        ? { mode }
        : {
            mode,
            auto: Boolean(body.auto ?? body.testnetAuto ?? body.liveAuto),
            paperAuto: body.paperAuto === undefined ? undefined : Boolean(body.paperAuto),
            testnetAuto: body.testnetAuto === undefined ? undefined : Boolean(body.testnetAuto),
            liveAuto: body.liveAuto === undefined ? undefined : Boolean(body.liveAuto),
            emergencyStop: body.emergencyStop === undefined ? undefined : Boolean(body.emergencyStop),
          };
      const remote = await proxyJson("/api/mode", {
        method: "POST",
        body: controlBody,
      });
      res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
      res.status(remote.status).json(remote.payload);
      return;
    }

    await ensureStarted();
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
    const requested = String(req.query?.mode ?? req.get("x-dealdost-mode") ?? "").toUpperCase();
    const mode = requested === "LIVE" ? "LIVE" : "TESTNET";
    const days = Math.min(90, Math.max(1, Number(req.query?.days ?? 30) || 30));

    const remote = await proxyJson("/api/analytics?mode=" + encodeURIComponent(mode) + "&days=" + days);
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.status(remote.status).json(remote.payload);
    return;

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
    const remote = await proxyJson("/api/testnet/preflight", { method: "POST", body: {} });
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.status(remote.status).json(remote.payload);
    return;

    const result = await scanner.testnetPreflight();
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/testnet/protection-sync", async (req, res) => {
  try {
    const symbol = String(req.body?.symbol ?? "").toUpperCase();
    const remote = await proxyJson("/api/testnet/protection-sync", {
      method: "POST",
      body: { symbol },
    });
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.status(remote.status).json(remote.payload);
    return;

    await ensureStarted();
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
    const symbol = String(req.body?.symbol ?? "").toUpperCase();
    const remote = await proxyJson("/api/testnet/close", {
      method: "POST",
      body: { symbol },
    });
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.status(remote.status).json(remote.payload);
    return;

    await ensureStarted();
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
