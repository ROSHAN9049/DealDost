import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { config } from "./config.js";
import { atr, ema, macdHistogram, percentChange, rsi, vwap } from "./indicators.js";
import { PaperBroker } from "./paper.js";
import { ProfitRotationV3 } from "./rotation.js";
import { RiskGovernor } from "./risk.js";
import type { Candle, DashboardState, Engine, Regime, Signal, Side, SymbolState } from "./types.js";

type BinanceExchangeInfo = {
  symbols: Array<{ symbol: string; status: string; quoteAsset: string; contractType: string }>;
};

type BinanceTicker = { symbol: string; quoteVolume: string; lastPrice: string };

export class BinanceScanner extends EventEmitter {
  private symbols = new Map<string, SymbolState>();
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private universeTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private reconnects = 0;
  private feedStatus: DashboardState["feed"]["websocket"] = "OFFLINE";
  private lastUpdateAt = 0;
  private marketRegime: Regime = "NO_TRADE";
  private btcPrice = 0;
  private signals = new Map<string, Signal>();
  private readonly risk = new RiskGovernor();
  private readonly paper = new PaperBroker();
  private readonly rotation = new ProfitRotationV3();

  onUpdate(listener: () => void): () => void {
    this.on("update", listener);
    return () => this.off("update", listener);
  }

  async start() {
    await this.refreshUniverse();
    await this.bootstrapHistory();
    this.connectWebSocket();

    this.universeTimer = setInterval(() => {
      void this.refreshUniverse()
        .then(() => this.bootstrapHistory())
        .then(() => this.connectWebSocket())
        .catch((error) => console.error("[universe refresh]", error));
    }, 30 * 60_000);
  }

  async stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.universeTimer) clearInterval(this.universeTimer);
    this.ws?.close();
  }

  state(): DashboardState {
    const risk = this.risk.snapshot();
    const allSignals = [...this.signals.values()]
      .sort((a, b) => b.quality.total - a.quality.total || b.updatedAt - a.updatedAt)
      .slice(0, 30);

    return {
      mode: "PAPER",
      auto: this.paper.getAuto(),
      market: { regime: this.marketRegime, btcPrice: this.btcPrice, universeSize: this.symbols.size },
      feed: {
        websocket: this.feedStatus,
        data: !this.lastUpdateAt ? "NO_DATA" : Date.now() - this.lastUpdateAt < 15_000 ? "FRESH" : "STALE",
        lastUpdateAt: this.lastUpdateAt,
        reconnects: this.reconnects,
      },
      engines: {
        momentum: {
          open: risk.momentum,
          max: this.risk.cfg.maxMomentumPositions,
          status: risk.momentum >= this.risk.cfg.maxMomentumPositions ? "FULL" : "READY",
        },
        scalping: {
          open: risk.scalping,
          max: this.risk.cfg.maxScalpingPositions,
          status: risk.scalping >= this.risk.cfg.maxScalpingPositions ? "FULL" : "READY",
        },
        totalOpen: risk.total,
        totalMax: this.risk.cfg.maxTotalPositions,
      },
      risk: { ...this.risk.cfg, dailyRiskUsedPct: risk.dailyRiskUsedPct, emergencyStop: risk.emergencyStop },
      paper: this.paper.snapshot(),
      rotation: this.rotation.snapshot(),
      signals: allSignals,
      updatedAt: Date.now(),
    };
  }

  setPaperAuto(enabled: boolean) {
    this.paper.setAuto(enabled);
    this.emit("update");
    if (enabled) this.tryAutoEntries();
  }

  closePaperPosition(symbol: string) {
    const trade = this.paper.closeManual(symbol);
    if (trade) {
      this.risk.registerClose(symbol, trade.netPnlUsd);
      const rotationEvent = this.rotation.onClosedTrade(trade);
      if (rotationEvent) trade.rotationId = rotationEvent.rotationId;
    }
    this.emit("update");
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(config.restBase + path, { headers: { "User-Agent": "DealDost/2.0" } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error("Binance REST " + response.status + ": " + body.slice(0, 300));
    }
    return (await response.json()) as T;
  }

  private async refreshUniverse() {
    const [info, ticker] = await Promise.all([
      this.request<BinanceExchangeInfo>("/fapi/v1/exchangeInfo"),
      this.request<BinanceTicker[]>("/fapi/v1/ticker/24hr"),
    ]);

    const eligible = new Set(
      info.symbols
        .filter((s) => s.status === "TRADING" && s.quoteAsset === "USDT" && s.contractType === "PERPETUAL")
        .map((s) => s.symbol),
    );

    const top = ticker
      .filter((t) => eligible.has(t.symbol) && Number(t.quoteVolume) >= config.minQuoteVolume)
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, config.universeSize);

    const next = new Map<string, SymbolState>();
    for (const t of top) {
      const previous = this.symbols.get(t.symbol);
      next.set(t.symbol, {
        symbol: t.symbol,
        quoteVolume24h: Number(t.quoteVolume),
        lastPrice: Number(t.lastPrice),
        lastDataAt: previous?.lastDataAt ?? 0,
        candles: previous?.candles ?? { "1m": [], "5m": [], "15m": [] },
      });
    }

    this.symbols = next;
    this.btcPrice = this.symbols.get("BTCUSDT")?.lastPrice ?? this.btcPrice;
    this.emit("update");
  }

  private async bootstrapHistory() {
    const states = [...this.symbols.values()];
    const concurrency = 5;

    for (let i = 0; i < states.length; i += concurrency) {
      const batch = states.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (state) => {
          try {
            const [m1, m5, m15] = await Promise.all([
              this.request<any[]>("/fapi/v1/klines?symbol=" + state.symbol + "&interval=1m&limit=120"),
              this.request<any[]>("/fapi/v1/klines?symbol=" + state.symbol + "&interval=5m&limit=120"),
              this.request<any[]>("/fapi/v1/klines?symbol=" + state.symbol + "&interval=15m&limit=120"),
            ]);

            state.candles["1m"] = m1.map(this.toCandle);
            state.candles["5m"] = m5.map(this.toCandle);
            state.candles["15m"] = m15.map(this.toCandle);
            state.lastPrice = state.candles["1m"].at(-1)?.close ?? state.lastPrice;
            state.lastDataAt = Date.now();

            this.evaluate(state.symbol, "MOMENTUM");
            this.evaluate(state.symbol, "SCALPING");
          } catch (error) {
            console.error("[bootstrap] " + state.symbol, error);
          }
        }),
      );
      this.emit("update");
    }

    this.tryAutoEntries();
  }

  private toCandle = (row: any[]): Candle => ({
    openTime: Number(row[0]),
    closeTime: Number(row[6]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    quoteVolume: Number(row[7]),
    trades: Number(row[8]),
  });

  private connectWebSocket() {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {}
    }

    const streams = [...this.symbols.keys()]
      .flatMap((symbol) => [
        symbol.toLowerCase() + "@kline_1m",
        symbol.toLowerCase() + "@kline_5m",
        symbol.toLowerCase() + "@kline_15m",
      ])
      .join("/");

    if (!streams) return;

    this.feedStatus = this.reconnectAttempts > 0 ? "RECONNECTING" : "CONNECTING";
    const ws = new WebSocket(config.wsBase + "?streams=" + streams);
    this.ws = ws;

    ws.on("open", () => {
      this.feedStatus = "ONLINE";
      this.reconnectAttempts = 0;
      this.lastUpdateAt = Date.now();
      this.emit("update");
    });

    ws.on("ping", () => {
      try { ws.pong(); } catch {}
    });

    ws.on("message", (raw) => {
      try {
        const envelope = JSON.parse(raw.toString());
        const data = envelope.data;
        if (data?.e !== "kline") return;

        const k = data.k;
        const symbol = data.s;
        const interval = k.i as "1m" | "5m" | "15m";
        const state = this.symbols.get(symbol);
        if (!state) return;

        const candle: Candle = {
          openTime: Number(k.t),
          closeTime: Number(k.T),
          open: Number(k.o),
          high: Number(k.h),
          low: Number(k.l),
          close: Number(k.c),
          volume: Number(k.v),
          quoteVolume: Number(k.q),
          trades: Number(k.n),
        };

        state.lastPrice = candle.close;
        state.lastDataAt = Date.now();
        this.lastUpdateAt = Date.now();
        if (symbol === "BTCUSDT") this.btcPrice = candle.close;

        const arr = state.candles[interval];
        const index = arr.findIndex((x) => x.openTime === candle.openTime);
        if (index >= 0) arr[index] = candle;
        else {
          arr.push(candle);
          if (arr.length > 200) arr.shift();
        }

        const closedTrade = this.paper.mark(symbol, state.lastPrice);
        if (closedTrade) {
          this.risk.registerClose(symbol, closedTrade.netPnlUsd);
          const rotationEvent = this.rotation.onClosedTrade(closedTrade);
          if (rotationEvent) closedTrade.rotationId = rotationEvent.rotationId;
        }

        if (k.x) {
          this.evaluate(symbol, interval === "1m" ? "SCALPING" : "MOMENTUM");
          this.tryAutoEntries();
        }

        this.emit("update");
      } catch (error) {
        console.error("[websocket message]", error);
      }
    });

    ws.on("close", () => {
      this.feedStatus = "RECONNECTING";
      this.reconnects += 1;
      this.scheduleReconnect();
    });

    ws.on("error", (error) => {
      console.error("[websocket]", error.message);
      this.feedStatus = "RECONNECTING";
      try { ws.close(); } catch {}
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(5, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connectWebSocket(), delay);
  }

  private tryAutoEntries() {
    if (!this.paper.getAuto()) return;

    const candidates = [...this.signals.values()]
      .filter((s) => s.stage === "CONFIRMED")
      .sort((a, b) => b.quality.total - a.quality.total);

    for (const signal of candidates) {
      const gate = this.risk.canOpen(signal.symbol, signal.engine);
      if (!gate.eligible) continue;

      const refreshed = { ...signal, risk: this.risk.preview(signal) };
      if (!refreshed.risk.eligible) continue;

      const result = this.paper.tryOpen(refreshed);
      if (result.opened) this.risk.registerOpen(signal.symbol, signal.engine);
    }
  }

  private evaluate(symbol: string, engine: Engine) {
    const state = this.symbols.get(symbol);
    if (!state) return;

    const base = engine === "MOMENTUM" ? state.candles["5m"] : state.candles["1m"];
    const context = state.candles["15m"];
    if (base.length < 60 || context.length < 60) return;

    const bClose = base.map((c) => c.close);
    const bHigh = base.map((c) => c.high);
    const bLow = base.map((c) => c.low);
    const bVol = base.map((c) => c.volume);
    const cClose = context.map((c) => c.close);
    const cHigh = context.map((c) => c.high);
    const cLow = context.map((c) => c.low);

    const price = state.lastPrice;
    const emaFast = ema(bClose, 5);
    const emaSlow = ema(bClose, 13);
    const emaContextFast = ema(cClose, 20);
    const emaContextSlow = ema(cClose, 50);
    const r = rsi(bClose, 14);
    const a = atr(bHigh, bLow, bClose, 14);
    const aContext = atr(cHigh, cLow, cClose, 14);
    const vw = vwap(bHigh, bLow, bClose, bVol, 30);
    const macd = macdHistogram(bClose);
    const avgVol = bVol.slice(-20).reduce((x, y) => x + y, 0) / 20;
    const lastVol = bVol.at(-1) ?? 0;
    const momentumPct = percentChange(price, bClose.at(-6) ?? price);
    const contextPct = percentChange(cClose.at(-1) ?? price, cClose.at(-4) ?? price);

    const regime = this.detectRegime(cClose, emaContextFast, emaContextSlow, aContext);
    if (symbol === "BTCUSDT") this.marketRegime = regime;

    const longAligned = emaFast > emaSlow && emaContextFast > emaContextSlow && price >= vw && momentumPct >= 0;
    const shortAligned = emaFast < emaSlow && emaContextFast < emaContextSlow && price <= vw && momentumPct <= 0;

    let long = 0;
    let short = 0;
    const rationale: string[] = [];

    if (emaFast > emaSlow) { long += 12; rationale.push("fast EMA above slow EMA"); }
    else { short += 12; rationale.push("fast EMA below slow EMA"); }

    if (emaContextFast > emaContextSlow) long += 10;
    else short += 10;

    if (r >= 55 && r <= 72) { long += 14; rationale.push("RSI bullish range"); }
    if (r <= 45 && r >= 28) { short += 14; rationale.push("RSI bearish range"); }

    if (macd > 0) long += 12;
    else short += 12;

    if (price > vw) long += 8;
    else short += 8;

    if (lastVol > avgVol * 1.25) {
      if (momentumPct >= 0) { long += 14; rationale.push("volume expansion"); }
      else { short += 14; rationale.push("volume expansion"); }
    }

    if (Math.abs(momentumPct) >= (engine === "MOMENTUM" ? 0.25 : 0.12)) {
      if (momentumPct > 0) long += 10;
      else short += 10;
    }

    if (contextPct > 0) long += 5;
    else short += 5;

    if (regime === "TREND_UP") long += 15;
    if (regime === "TREND_DOWN") short += 15;
    if (regime === "RANGE") { long += 5; short += 5; }
    if (regime === "HIGH_VOLATILITY" || regime === "NO_TRADE") { long -= 10; short -= 10; }

    const side: Side = long >= short ? "LONG" : "SHORT";
    const winner = Math.max(long, short);
    const loser = Math.min(long, short);
    const separation = Math.max(0, winner - loser);
    const total = Math.max(0, Math.min(100, Math.round(winner * 0.9 + Math.min(15, separation * 0.25))));

    const stage =
      regime === "NO_TRADE" || regime === "HIGH_VOLATILITY"
        ? "BLOCKED"
        : total >= config.minConfirmedScore && (longAligned || shortAligned)
          ? "CONFIRMED"
          : total >= 60
            ? "SETUP"
            : "WATCH";

    const atrDistance = Math.max(a * (engine === "MOMENTUM" ? 1.4 : 1.1), price * 0.003);
    const stop = side === "LONG" ? price - atrDistance : price + atrDistance;
    const tp1 = side === "LONG"
      ? price + atrDistance * (engine === "MOMENTUM" ? 1.5 : 1.1)
      : price - atrDistance * (engine === "MOMENTUM" ? 1.5 : 1.1);
    const tp2 = side === "LONG"
      ? price + atrDistance * (engine === "MOMENTUM" ? 2.5 : 1.8)
      : price - atrDistance * (engine === "MOMENTUM" ? 2.5 : 1.8);

    const signalKey = engine + ":" + symbol;
    const current = this.signals.get(signalKey);
    const signalId =
      "SIG-" + symbol + "-" + engine + "-" + String(base.at(-1)?.openTime ?? Date.now());

    const quality = {
      trend: Math.min(20, Math.round((Math.abs(emaFast - emaSlow) / Math.max(a, 1e-8)) * 3 + 6)),
      momentum: Math.min(20, Math.round(Math.abs(momentumPct) * 16)),
      volume: Math.min(15, lastVol > avgVol ? 12 : 5),
      volatility: Math.min(15, Math.round(Math.min(3, (a / price) * 100) * 5)),
      structure: Math.min(15, Math.round((Math.abs(price - vw) / Math.max(a, 1e-8)) * 3 + 5)),
      regime: regime === "TREND_UP" || regime === "TREND_DOWN" ? 15 : regime === "RANGE" ? 8 : 3,
      total,
    };

    const signal: Signal = {
      signalId,
      symbol,
      engine,
      side,
      stage,
      quality,
      regime,
      entry: price,
      stop,
      takeProfit1: tp1,
      takeProfit2: tp2,
      createdAt: current?.signalId === signalId ? current.createdAt : Date.now(),
      updatedAt: Date.now(),
      rationale: Array.from(new Set(rationale)).slice(0, 6),
      risk: {
        eligible: false,
        reason: "PENDING",
        entry: price,
        stop,
        takeProfit1: tp1,
        takeProfit2: tp2,
        riskDistancePct: (Math.abs(price - stop) / price) * 100,
        riskUsd: 0,
        notionalUsd: 0,
      },
    };

    signal.risk = this.risk.preview(signal);
    this.signals.set(signalKey, signal);

    if (this.signals.size > 250) {
      const oldest = [...this.signals.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (oldest) this.signals.delete(oldest.engine + ":" + oldest.symbol);
    }
  }

  private detectRegime(closes: number[], fast: number, slow: number, currentAtr: number): Regime {
    const price = closes.at(-1) ?? 0;
    if (!price || !Number.isFinite(currentAtr)) return "NO_TRADE";

    const atrPct = (currentAtr / price) * 100;
    const trendGapPct = (Math.abs(fast - slow) / price) * 100;
    const shortMovePct = Math.abs(percentChange(price, closes.at(-6) ?? price));

    if (atrPct > 2.2) return "HIGH_VOLATILITY";
    if (atrPct < 0.15) return "LOW_VOLATILITY";
    if (trendGapPct < 0.12 && shortMovePct < 0.4) return "RANGE";
    if (fast > slow && trendGapPct >= 0.12) return "TREND_UP";
    if (fast < slow && trendGapPct >= 0.12) return "TREND_DOWN";
    return "NO_TRADE";
  }
}
