import express from "express";
import path from "node:path";
import { BinanceScanner } from "../src/scanner.js";

const app = express();
const scanner = new BinanceScanner();
let started = false;
let startPromise: Promise<void> | undefined;

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.resolve(process.cwd(), "public")));

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

app.get("/api/state", async (_req, res) => {
  try {
    await ensureStarted();
    await scanner.serverlessTick();
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.json(scanner.state());
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
