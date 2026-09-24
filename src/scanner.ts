import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { config } from "./config.js";
import { atr, ema, macdHistogram, percentChange, rsi, vwap } from "./indicators.js";
import { PaperBroker } from "./paper.js";
import { ProfitRotationV3 } from "./rotation.js";
import { RiskGovernor } from "./risk.js";
import { TestnetClient } from "./testnet.js";
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
  private testnetTimer?: NodeJS.Timeout;
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
  private readonly testnet = new TestnetClient("TESTNET");
  private readonly live = new TestnetClient("LIVE");
  private testnetState = this.testnet.emptyState();
  private liveState = this.live.emptyState();
  private mode: "PAPER" | "TESTNET" | "LIVE" = "PAPER";
  private testnetAuto = false;
  private liveAuto = false;
  private testnetExecutionInFlight = false;
  private liveExecutionInFlight = false;
  private lastTestnetSyncAt = 0;
  private lastLiveSyncAt = 0;
  private serverlessMode = false;
  private lastServerlessPollAt = 0;
  private serverlessCursor = 0;
  private lastMarketError: string | null = null;

  onUpdate(listener: () => void): () => void {
    this.on("update", listener);
    return () => this.off("update", listener);
  }

  async start() {
    this.serverlessMode = false;

    // Railway/host regions can be denied by Binance public REST with HTTP 451.
    // Never let that external market-data restriction crash the persistent
    // application. Keep the API/WebSocket server alive and retry in the
    // background; browser market ingestion can also repopulate the scanner.
    try {
      await this.refreshUniverse();
      await this.bootstrapHistory();
      this.connectWebSocket();
    } catch (error) {
      this.feedStatus = "OFFLINE";
      this.lastMarketError = error instanceof Error ? error.message : String(error);
      console.error("[startup market feed]", this.lastMarketError);
    }

    void this.syncTestnet();
    void this.syncLive();

    this.testnetTimer = setInterval(() => {
      void this.syncTestnet();
      void this.syncLive();
    }, 30_000);

    this.universeTimer = setInterval(() => {
      void this.refreshUniverse()
        .then(() => this.bootstrapHistory())
        .then(() => this.connectWebSocket())
        .catch((error) => {
          this.feedStatus = "OFFLINE";
          this.lastMarketError = error instanceof Error ? error.message : String(error);
          console.error("[universe refresh]", this.lastMarketError);
          this.emit("update");
        });
    }, 30 * 60_000);
  }

  async startServerless() {
    this.serverlessMode = true;
    try {
      await this.refreshUniverse();
      this.feedStatus = "ONLINE";
      this.lastUpdateAt = Date.now();
    } catch (error) {
      this.feedStatus = "OFFLINE";
      console.error("[serverless universe]", error);
    }
    // Do not block the API startup on kline history. Vercel serverless
    // invocations must return quickly; scoring happens inside /api/state.
    void this.syncTestnet();
    void this.syncLive();
    this.emit("update");
  }

  async serverlessTick() {
    if (!this.serverlessMode) return;
    if (Date.now() - this.lastServerlessPollAt < 1000) return;
    this.lastServerlessPollAt = Date.now();

    try {
      await this.refreshUniverse();
      const states = [...this.symbols.values()];
      if (states.length) {
        // Always score BTC first so a fresh Vercel invocation produces a
        // deterministic server-owned market/signal result.
        const btc = this.symbols.get("BTCUSDT");
        const target = btc ?? states[this.serverlessCursor % states.length];
        this.serverlessCursor = (this.serverlessCursor + 1) % states.length;
        await this.bootstrapHistoryForStates([target]);
      }
      await this.syncTestnetIfDue();
      await this.syncLiveIfDue();
      this.feedStatus = "ONLINE";
      this.lastUpdateAt = Date.now();
    } catch (error) {
      this.feedStatus = "OFFLINE";
      console.error("[serverless tick]", error);
    }

    this.emit("update");
  }

  async stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.universeTimer) clearInterval(this.universeTimer);
    if (this.testnetTimer) clearInterval(this.testnetTimer);
    this.ws?.close();
  }

  restorePaperRuntime(paperSnapshot: unknown, rotationSnapshot?: unknown) {
    this.paper.restore(paperSnapshot as any);

    const history = this.paper.historyList();
    this.risk.hydrate(
      this.paper.positionsList().map((p) => ({ symbol: p.symbol, engine: p.engine })),
      history.map((t) => ({ symbol: t.symbol, netPnlUsd: t.netPnlUsd, closedAt: t.closedAt })),
    );

    const events = rotationSnapshot && typeof rotationSnapshot === "object"
      ? (rotationSnapshot as any).events
      : undefined;
    this.rotation.restore(Array.isArray(events) ? events : []);
  }

  private syncPaperRiskState() {
    this.risk.syncOpenPositions(
      this.paper.positionsList().map((p) => ({ symbol: p.symbol, engine: p.engine })),
    );
  }

  state(): DashboardState {
    this.syncPaperRiskState();
    const risk = this.risk.snapshot();
    const allSignals = [...this.signals.values()]
      // Risk/PASS is dashboard state, so recompute it from the current
      // exchange/PAPER position snapshot. This prevents a symbol already
      // open on TESTNET/LIVE from continuing to display PASS.
      .map((signal) => ({ ...signal, risk: this.previewSignalRisk(signal) }))
      .sort((a, b) => b.quality.total - a.quality.total || b.updatedAt - a.updatedAt)
      .slice(0, 30);

    const executionMode = this.mode === "TESTNET"
      ? this.testnetState
      : this.mode === "LIVE"
        ? this.liveState
        : null;
    const paperPositions = this.paper.positionsList();
    const paperEngineOpen = {
      momentum: paperPositions.filter((p) => p.engine === "MOMENTUM").length,
      scalping: paperPositions.filter((p) => p.engine === "SCALPING").length,
      total: paperPositions.length,
    };
    const engineOpen = executionMode
      ? {
          momentum: executionMode.momentumOpen,
          scalping: executionMode.scalpingOpen,
          total: executionMode.openPositions,
        }
      : paperEngineOpen;
    const riskDaily = executionMode ? executionMode.dailyRiskUsedPct : risk.dailyRiskUsedPct;
    const riskAccount = executionMode
      ? executionMode.accountBalanceUsd || this.risk.cfg.accountBalanceUsd
      : this.risk.cfg.accountBalanceUsd;

    return {
      mode: this.mode,
      auto: this.mode === "TESTNET"
        ? this.testnetAuto
        : this.mode === "LIVE"
          ? this.liveAuto
          : this.paper.getAuto(),
      market: { regime: this.marketRegime, btcPrice: this.btcPrice, universeSize: this.symbols.size },
      feed: {
        websocket: this.feedStatus,
        data: !this.lastUpdateAt ? "NO_DATA" : Date.now() - this.lastUpdateAt < 15_000 ? "FRESH" : "STALE",
        lastUpdateAt: this.lastUpdateAt,
        reconnects: this.reconnects,
        error: this.lastMarketError,
      },
      engines: {
        momentum: {
          open: engineOpen.momentum,
          max: this.risk.cfg.maxMomentumPositions,
          status: engineOpen.momentum > this.risk.cfg.maxMomentumPositions ? "BLOCKED" :
            engineOpen.momentum >= this.risk.cfg.maxMomentumPositions ? "FULL" : "READY",
        },
        scalping: {
          open: engineOpen.scalping,
          max: this.risk.cfg.maxScalpingPositions,
          status: engineOpen.scalping > this.risk.cfg.maxScalpingPositions ? "BLOCKED" :
            engineOpen.scalping >= this.risk.cfg.maxScalpingPositions ? "FULL" : "READY",
        },
        totalOpen: engineOpen.total,
        totalMax: this.risk.cfg.maxTotalPositions,
      },
      risk: {
        ...this.risk.cfg,
        accountBalanceUsd: riskAccount,
        dailyRiskUsedPct: riskDaily,
        emergencyStop: risk.emergencyStop,
      },
      paper: this.paper.snapshot(),
      testnet: this.testnetState,
      live: this.liveState,
      rotation: this.rotation.snapshot(),
      signals: allSignals,
      updatedAt: Date.now(),
    };
  }

  async ingestBrowserMarket(input: {
    universe: Array<{ symbol: string; quoteVolume: number; lastPrice: number }>;
    symbol: string;
    candles: { "1m": Candle[]; "5m": Candle[]; "15m": Candle[] };
    btc15m?: Candle[];
  }) {
    const validUniverse = input.universe
      .filter((t) => t.symbol.endsWith("USDT") && Number.isFinite(t.quoteVolume) && Number.isFinite(t.lastPrice))
      .slice(0, config.universeSize);

    const existing = this.symbols;
    const next = new Map<string, SymbolState>();
    for (const t of validUniverse) {
      const previous = existing.get(t.symbol);
      next.set(t.symbol, {
        symbol: t.symbol,
        quoteVolume24h: t.quoteVolume,
        lastPrice: t.lastPrice,
        lastDataAt: previous?.lastDataAt ?? 0,
        candles: previous?.candles ?? { "1m": [], "5m": [], "15m": [] },
      });
    }

    const state = next.get(input.symbol);
    if (!state) throw new Error("Symbol not in browser universe: " + input.symbol);

    if (
      input.candles["1m"].length < 60 ||
      input.candles["5m"].length < 60 ||
      input.candles["15m"].length < 60
    ) {
      throw new Error("Insufficient candle history for " + input.symbol);
    }

    state.candles = {
      "1m": input.candles["1m"].map((c) => ({ ...c })),
      "5m": input.candles["5m"].map((c) => ({ ...c })),
      "15m": input.candles["15m"].map((c) => ({ ...c })),
    };
    state.lastPrice = state.candles["1m"].at(-1)?.close ?? state.lastPrice;
    state.lastDataAt = Date.now();

    this.symbols = next;
    // Keep the global BTC card populated from the live universe ticker even
    // when the rotating signal target is another symbol.
    this.btcPrice = this.symbols.get("BTCUSDT")?.lastPrice ?? this.btcPrice;
    if (input.symbol === "BTCUSDT") this.btcPrice = state.lastPrice;

    // Keep the global market regime tied to BTC even while signal scoring
    // rotates through other symbols in serverless browser mode.
    if (input.btc15m && input.btc15m.length >= 60) {
      this.updateMarketRegimeFromContext(input.btc15m);
    }

    // In Vercel/serverless mode there is no Binance websocket connection.
    // Re-mark every open paper position from the fresh browser universe
    // ticker so unrealized P&L and SL/TP exits keep working.
    for (const position of this.paper.positionsList()) {
      const livePrice = this.symbols.get(position.symbol)?.lastPrice;
      if (livePrice !== undefined && Number.isFinite(livePrice) && livePrice > 0) {
        this.handlePaperMark(position.symbol, livePrice);
      }
    }

    this.evaluate(input.symbol, "MOMENTUM");
    this.evaluate(input.symbol, "SCALPING");
    this.lastMarketError = null;
    this.feedStatus = "ONLINE";
    this.lastUpdateAt = Date.now();
    this.tryActiveEntries();
    this.emit("update");

    return this.state();
  }

  setRequestMode(
    mode: "PAPER" | "TESTNET" | "LIVE",
    auto?: boolean,
    automation?: { paperAuto?: boolean; testnetAuto?: boolean; liveAuto?: boolean },
  ) {
    if (mode === "LIVE" && !this.live.isExecutionEnabled()) {
      throw new Error("LIVE_EXECUTION_LOCKED");
    }
    this.mode = mode;

    if (typeof automation?.paperAuto === "boolean") {
      this.paper.setAuto(automation.paperAuto);
    } else if (mode === "PAPER" && typeof auto === "boolean") {
      this.paper.setAuto(auto);
    }

    if (typeof automation?.testnetAuto === "boolean") {
      this.testnetAuto = automation.testnetAuto;
    } else if (mode === "TESTNET" && typeof auto === "boolean") {
      this.testnetAuto = auto;
    }

    if (typeof automation?.liveAuto === "boolean") {
      this.liveAuto = automation.liveAuto;
    } else if (mode === "LIVE" && typeof auto === "boolean") {
      this.liveAuto = auto;
    }

    if (this.testnetAuto) void this.tryTestnetEntries();
    if (this.liveAuto) void this.tryLiveEntries();
    if (this.paper.getAuto()) this.tryPaperEntries();
    this.emit("update");
  }


  setPaperAuto(enabled: boolean) {
    this.mode = "PAPER";
    this.paper.setAuto(enabled);
    this.emit("update");
    if (enabled) this.tryPaperEntries();
  }

  setTestnetAuto(enabled: boolean) {
    this.mode = "TESTNET";
    this.testnetAuto = Boolean(enabled);
    this.emit("update");
    if (this.testnetAuto) void this.tryTestnetEntries();
  }

  setLiveAuto(enabled: boolean) {
    if (enabled && !this.live.isExecutionEnabled()) {
      throw new Error("LIVE_EXECUTION_LOCKED");
    }
    this.mode = "LIVE";
    this.liveAuto = Boolean(enabled);
    this.emit("update");
    if (this.liveAuto) void this.tryLiveEntries();
  }

  async syncLivePositionProtection(symbol: string) {
    if (this.mode !== "LIVE") throw new Error("LIVE_MODE_REQUIRED");
    if (!this.live.isExecutionEnabled()) throw new Error("LIVE_EXECUTION_DISABLED");

    const snapshot = await this.live.getExecutionSnapshot();
    const position = snapshot.positions.find((p) => p.symbol === symbol.toUpperCase());
    if (!position) throw new Error("LIVE_POSITION_NOT_FOUND");
    if (position.protection === "OK") {
      this.liveState = { ...this.liveState, ...snapshot, auto: this.liveAuto, error: null };
      return this.state();
    }

    if (!position.engine) throw new Error("LIVE_POSITION_ENGINE_UNKNOWN");

    const signal = this.signals.get(position.engine + ":" + position.symbol);
    if (!signal || signal.side !== position.side) {
      throw new Error("No matching current signal for LIVE protection sync");
    }
    if (signal.stage === "BLOCKED") {
      throw new Error("Current matching signal is BLOCKED");
    }

    await this.live.ensureOpenPositionProtection({
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
      stopPrice: signal.stop,
      takeProfitPrice: signal.takeProfit1,
    });

    const refreshed = await this.live.getExecutionSnapshot();
    this.liveState = {
      ...this.liveState,
      connected: refreshed.connected,
      accountBalanceUsd: refreshed.accountBalanceUsd,
      availableBalanceUsd: refreshed.availableBalanceUsd,
      unrealizedPnlUsd: refreshed.unrealizedPnlUsd,
      openPositions: refreshed.openPositions,
      momentumOpen: refreshed.momentumOpen,
      scalpingOpen: refreshed.scalpingOpen,
      unclassifiedOpenPositions: refreshed.unclassifiedOpenPositions,
      unprotectedOpenPositions: refreshed.unprotectedOpenPositions,
      dailyRiskUsedPct: refreshed.dailyRiskUsedPct,
      realizedPnlTodayUsd: refreshed.realizedPnlTodayUsd,
      feesTodayUsd: refreshed.feesTodayUsd,
      positions: refreshed.positions,
      lastSyncAt: Date.now(),
      error: null,
      auto: this.liveAuto,
    };
    return this.state();
  }

  async syncTestnetPositionProtection(symbol: string) {
    if (this.mode !== "TESTNET") throw new Error("TESTNET_MODE_REQUIRED");
    if (!this.testnet.isExecutionEnabled()) throw new Error("TESTNET_EXECUTION_DISABLED");

    const snapshot = await this.testnet.getExecutionSnapshot();
    const position = snapshot.positions.find((p) => p.symbol === symbol.toUpperCase());
    if (!position) throw new Error("TESTNET_POSITION_NOT_FOUND");
    if (position.protection === "OK") {
      this.testnetState = { ...this.testnetState, ...snapshot, auto: this.testnetAuto, error: null };
      return this.state();
    }

    if (!position.engine) throw new Error("TESTNET_POSITION_ENGINE_UNKNOWN");

    const signal = this.signals.get(position.engine + ":" + position.symbol);
    if (!signal || signal.side !== position.side) {
      throw new Error("No matching current signal for TESTNET protection sync");
    }
    if (signal.stage === "BLOCKED") {
      throw new Error("Current matching signal is BLOCKED");
    }

    await this.testnet.ensureOpenPositionProtection({
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
      stopPrice: signal.stop,
      takeProfitPrice: signal.takeProfit1,
    });

    const refreshed = await this.testnet.getExecutionSnapshot();
    this.testnetState = {
      ...this.testnetState,
      connected: refreshed.connected,
      accountBalanceUsd: refreshed.accountBalanceUsd,
      availableBalanceUsd: refreshed.availableBalanceUsd,
      unrealizedPnlUsd: refreshed.unrealizedPnlUsd,
      openPositions: refreshed.openPositions,
      momentumOpen: refreshed.momentumOpen,
      scalpingOpen: refreshed.scalpingOpen,
      unclassifiedOpenPositions: refreshed.unclassifiedOpenPositions,
      unprotectedOpenPositions: refreshed.unprotectedOpenPositions,
      dailyRiskUsedPct: refreshed.dailyRiskUsedPct,
      realizedPnlTodayUsd: refreshed.realizedPnlTodayUsd,
      feesTodayUsd: refreshed.feesTodayUsd,
      positions: refreshed.positions,
      lastSyncAt: Date.now(),
      error: null,
      auto: this.testnetAuto,
    };
    return this.state();
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

  async closeManagedTestnetPosition(symbol: string) {
    if (this.mode !== "TESTNET") throw new Error("TESTNET_MODE_REQUIRED");
    const result = await this.testnet.closeManagedPosition(symbol);
    this.testnetState = {
      ...this.testnetState,
      ...result.snapshot,
      auto: this.testnetAuto,
      lastSyncAt: Date.now(),
      error: null,
    };
    this.emit("update");
    return this.state();
  }
  async closeManagedLivePosition(symbol: string) {
    if (this.mode !== "LIVE") throw new Error("LIVE_MODE_REQUIRED");
    const result = await this.live.closeManagedPosition(symbol);
    this.liveState = {
      ...this.liveState,
      ...result.snapshot,
      auto: this.liveAuto,
      lastSyncAt: Date.now(),
      error: null,
    };
    this.emit("update");
    return this.state();
  }

  private handlePaperMark(symbol: string, price: number) {
    const trade = this.paper.mark(symbol, price);
    if (!trade) return;

    this.risk.registerClose(symbol, trade.netPnlUsd);
    const rotationEvent = this.rotation.onClosedTrade(trade);
    if (rotationEvent) trade.rotationId = rotationEvent.rotationId;
  }

  private async syncTestnet() {
    try {
      let synced = await this.testnet.sync();
      let repairError: string | null = null;

      // Protection is a safety requirement independent of AUTO. When a
      // DDT-managed position is missing SL/TP, attempt a verified repair
      // during reconciliation rather than waiting for AUTO to be enabled.
      if (this.testnet.isExecutionEnabled() && synced.unprotectedOpenPositions > 0) {
        const reconciled = await this.testnet.getExecutionSnapshot();
        const repaired = await this.repairManagedTestnetProtection(reconciled);
        repairError = repaired.error;
        if (repaired.snapshot !== reconciled || repaired.error) {
          synced = {
            ...synced,
            connected: repaired.snapshot.connected,
            accountBalanceUsd: repaired.snapshot.accountBalanceUsd,
            availableBalanceUsd: repaired.snapshot.availableBalanceUsd,
            unrealizedPnlUsd: repaired.snapshot.unrealizedPnlUsd,
            openPositions: repaired.snapshot.openPositions,
            momentumOpen: repaired.snapshot.momentumOpen,
            scalpingOpen: repaired.snapshot.scalpingOpen,
            unclassifiedOpenPositions: repaired.snapshot.unclassifiedOpenPositions,
            unprotectedOpenPositions: repaired.snapshot.unprotectedOpenPositions,
            dailyRiskUsedPct: repaired.snapshot.dailyRiskUsedPct,
            realizedPnlTodayUsd: repaired.snapshot.realizedPnlTodayUsd,
            feesTodayUsd: repaired.snapshot.feesTodayUsd,
            positions: repaired.snapshot.positions,
            lastSyncAt: Date.now(),
          };
        }
      }

      this.testnetState = {
        ...synced,
        auto: this.testnetAuto,
        error: repairError,
      };
      this.lastTestnetSyncAt = Date.now();
      this.emit("update");
    } catch (error) {
      this.testnetState = {
        ...this.testnet.emptyState(),
        configured: this.testnet.isConfigured(),
        executionEnabled: this.testnet.isExecutionEnabled(),
        auto: this.testnetAuto,
        error: error instanceof Error ? error.message : String(error),
      };
      this.lastTestnetSyncAt = Date.now();
      this.emit("update");
    }
  }
  private async syncLive() {
    try {
      let synced = await this.live.sync();
      let repairError: string | null = null;

      // Protection is a safety requirement independent of AUTO. When a
      // DDT-managed position is missing SL/TP, attempt a verified repair
      // during reconciliation rather than waiting for AUTO to be enabled.
      if (this.live.isExecutionEnabled() && synced.unprotectedOpenPositions > 0) {
        const reconciled = await this.live.getExecutionSnapshot();
        const repaired = await this.repairManagedLiveProtection(reconciled);
        repairError = repaired.error;
        if (repaired.snapshot !== reconciled || repaired.error) {
          synced = {
            ...synced,
            connected: repaired.snapshot.connected,
            accountBalanceUsd: repaired.snapshot.accountBalanceUsd,
            availableBalanceUsd: repaired.snapshot.availableBalanceUsd,
            unrealizedPnlUsd: repaired.snapshot.unrealizedPnlUsd,
            openPositions: repaired.snapshot.openPositions,
            momentumOpen: repaired.snapshot.momentumOpen,
            scalpingOpen: repaired.snapshot.scalpingOpen,
            unclassifiedOpenPositions: repaired.snapshot.unclassifiedOpenPositions,
            unprotectedOpenPositions: repaired.snapshot.unprotectedOpenPositions,
            dailyRiskUsedPct: repaired.snapshot.dailyRiskUsedPct,
            realizedPnlTodayUsd: repaired.snapshot.realizedPnlTodayUsd,
            feesTodayUsd: repaired.snapshot.feesTodayUsd,
            positions: repaired.snapshot.positions,
            lastSyncAt: Date.now(),
          };
        }
      }

      this.liveState = {
        ...synced,
        auto: this.liveAuto,
        error: repairError,
      };
      this.lastLiveSyncAt = Date.now();
      this.emit("update");
    } catch (error) {
      this.liveState = {
        ...this.live.emptyState(),
        configured: this.live.isConfigured(),
        executionEnabled: this.live.isExecutionEnabled(),
        auto: this.liveAuto,
        error: error instanceof Error ? error.message : String(error),
      };
      this.lastLiveSyncAt = Date.now();
      this.emit("update");
    }
  }

  private async syncTestnetIfDue() {
    if (!this.testnet.isConfigured()) return;
    if (Date.now() - this.lastTestnetSyncAt < 30_000) return;
    await this.syncTestnet();
  }
  private async syncLiveIfDue() {
    if (!this.live.isConfigured()) return;
    if (Date.now() - this.lastLiveSyncAt < 30_000) return;
    await this.syncLive();
  }


  private async request<T>(path: string): Promise<T> {
    const bases = [...new Set([config.restBase, ...config.restFallbackBases])];
    const failures: string[] = [];

    for (const base of bases) {
      try {
        const response = await fetch(base + path, {
          headers: {
            "User-Agent": "DealDost/2.2",
            "Accept": "application/json",
          },
          signal: AbortSignal.timeout(5000),
        });
        const body = await response.text();
        if (!response.ok) {
          failures.push(base + " -> HTTP " + response.status + " " + body.slice(0, 160));
          continue;
        }
        this.lastMarketError = null;
        return JSON.parse(body) as T;
      } catch (error) {
        failures.push(base + " -> " + (error instanceof Error ? error.message : String(error)));
      }
    }

    const message = "Binance REST unavailable: " + failures.join(" | ");
    this.lastMarketError = message;
    throw new Error(message);
  }

  private async refreshUniverse() {
    let ticker: BinanceTicker[];
    try {
      ticker = await this.request<BinanceTicker[]>("/fapi/v1/ticker/24hr");
    } catch (error) {
      this.feedStatus = "OFFLINE";
      this.lastMarketError = error instanceof Error ? error.message : String(error);
      throw new Error("Binance market ticker unavailable: " + this.lastMarketError);
    }

    // The 24h futures ticker is the reliable public market-data path.
    // Keep the universe filter conservative without making exchangeInfo a
    // second mandatory network dependency for every serverless invocation.
    const top = ticker
      .filter((t) => t.symbol.endsWith("USDT") && Number(t.quoteVolume) >= config.minQuoteVolume)
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

  private async bootstrapHistory(limit = this.symbols.size) {
    const states = [...this.symbols.values()].slice(0, limit);
    await this.bootstrapHistoryForStates(states);
  }

  private async bootstrapHistoryForStates(states: SymbolState[]) {
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

    this.tryActiveEntries();
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
    if (this.serverlessMode) return;

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

        this.handlePaperMark(symbol, state.lastPrice);

        if (k.x) {
          this.evaluate(symbol, interval === "1m" ? "SCALPING" : "MOMENTUM");
          this.tryActiveEntries();
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

  private tryActiveEntries() {
    // PAPER AUTO and TESTNET AUTO are independent switches. The selected
    // dashboard mode controls which account is shown, but never disables the
    // other explicitly-enabled simulator/execution engine.
    if (this.paper.getAuto()) this.tryPaperEntries();
    if (this.mode === "TESTNET" && this.testnetAuto) void this.tryTestnetEntries();
    if (this.mode === "LIVE" && this.liveAuto) void this.tryLiveEntries();
  }

  private tryPaperEntries() {
    if (!this.paper.getAuto()) return;

    // Reconcile the risk layer from the broker's actual open positions before
    // every entry cycle so a restart/restore or UI refresh cannot make the
    // governor believe the account is empty while PAPER still has positions.
    this.syncPaperRiskState();

    const now = Date.now();
    const candidates = [...this.signals.values()]
      .filter((s) => {
        if (s.stage !== "CONFIRMED") return false;
        const maxAgeMs = s.engine === "SCALPING" ? 90_000 : 10 * 60_000;
        return now - s.updatedAt <= maxAgeMs;
      })
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

  private async repairManagedTestnetProtection(snapshot: Awaited<ReturnType<TestnetClient["getExecutionSnapshot"]>>) {
    let changed = false;
    let errorMessage: string | null = null;
    const now = Date.now();

    for (const position of snapshot.positions.filter((p) => p.engine && p.protection !== "OK")) {
      const signal = this.signals.get(position.engine + ":" + position.symbol);

      let stopPrice: number | undefined;
      let takeProfitPrice: number | undefined;

      if (signal && signal.side === position.side && signal.stage !== "BLOCKED" && now - signal.updatedAt <= 10 * 60_000) {
        stopPrice = signal.stop;
        takeProfitPrice = signal.takeProfit1;
      } else {
        // Serverless restarts can lose in-memory signal history while the
        // exchange position remains open. Safety repair must not depend on
        // an in-memory signal being present.
        const base = position.entryPrice;
        if (!Number.isFinite(base) || base <= 0) continue;

        const mark = Number(position.markPrice);
        if (!Number.isFinite(mark) || mark <= 0) continue;

        const stopPct = position.engine === "MOMENTUM" ? 0.0042 : 0.0030;
        const takePct = position.engine === "MOMENTUM" ? 0.0063 : 0.0033;
        const minTriggerGap = 0.0001;

        // Start from the original entry-derived bracket, then move any
        // already-crossed trigger just beyond the current mark so Binance
        // accepts it and the position remains protected immediately.
        const rawStop = position.side === "LONG" ? base * (1 - stopPct) : base * (1 + stopPct);
        const rawTakeProfit = position.side === "LONG" ? base * (1 + takePct) : base * (1 - takePct);

        if (position.side === "LONG") {
          stopPrice = Math.min(rawStop, mark * (1 - minTriggerGap));
          takeProfitPrice = Math.max(rawTakeProfit, mark * (1 + minTriggerGap));
        } else {
          stopPrice = Math.max(rawStop, mark * (1 + minTriggerGap));
          takeProfitPrice = Math.min(rawTakeProfit, mark * (1 - minTriggerGap));
        }

        console.warn(
          "[testnet protection fallback]",
          position.symbol,
          "signal memory unavailable; using emergency bracket",
        );
      }

      try {
        await this.testnet.ensureOpenPositionProtection({
          symbol: position.symbol,
          side: position.side,
          quantity: position.quantity,
          stopPrice,
          takeProfitPrice,
        });
        changed = true;
      } catch (error) {
        errorMessage = "Protection repair failed for " + position.symbol + ": " +
          (error instanceof Error ? error.message : String(error));
      }
    }

    return {
      snapshot: changed ? await this.testnet.getExecutionSnapshot() : snapshot,
      error: errorMessage,
    };
  }
  private async repairManagedLiveProtection(snapshot: Awaited<ReturnType<TestnetClient["getExecutionSnapshot"]>>) {
    let changed = false;
    let errorMessage: string | null = null;
    const now = Date.now();

    for (const position of snapshot.positions.filter((p) => p.engine && p.protection !== "OK")) {
      const signal = this.signals.get(position.engine + ":" + position.symbol);

      let stopPrice: number | undefined;
      let takeProfitPrice: number | undefined;

      if (signal && signal.side === position.side && signal.stage !== "BLOCKED" && now - signal.updatedAt <= 10 * 60_000) {
        stopPrice = signal.stop;
        takeProfitPrice = signal.takeProfit1;
      } else {
        // Serverless restarts can lose in-memory signal history while the
        // exchange position remains open. Safety repair must not depend on
        // an in-memory signal being present.
        const base = position.entryPrice;
        if (!Number.isFinite(base) || base <= 0) continue;

        const mark = Number(position.markPrice);
        if (!Number.isFinite(mark) || mark <= 0) continue;

        const stopPct = position.engine === "MOMENTUM" ? 0.0042 : 0.0030;
        const takePct = position.engine === "MOMENTUM" ? 0.0063 : 0.0033;
        const minTriggerGap = 0.0001;

        // Start from the original entry-derived bracket, then move any
        // already-crossed trigger just beyond the current mark so Binance
        // accepts it and the position remains protected immediately.
        const rawStop = position.side === "LONG" ? base * (1 - stopPct) : base * (1 + stopPct);
        const rawTakeProfit = position.side === "LONG" ? base * (1 + takePct) : base * (1 - takePct);

        if (position.side === "LONG") {
          stopPrice = Math.min(rawStop, mark * (1 - minTriggerGap));
          takeProfitPrice = Math.max(rawTakeProfit, mark * (1 + minTriggerGap));
        } else {
          stopPrice = Math.max(rawStop, mark * (1 + minTriggerGap));
          takeProfitPrice = Math.min(rawTakeProfit, mark * (1 - minTriggerGap));
        }

        console.warn(
          "[testnet protection fallback]",
          position.symbol,
          "signal memory unavailable; using emergency bracket",
        );
      }

      try {
        await this.live.ensureOpenPositionProtection({
          symbol: position.symbol,
          side: position.side,
          quantity: position.quantity,
          stopPrice,
          takeProfitPrice,
        });
        changed = true;
      } catch (error) {
        errorMessage = "Protection repair failed for " + position.symbol + ": " +
          (error instanceof Error ? error.message : String(error));
      }
    }

    return {
      snapshot: changed ? await this.live.getExecutionSnapshot() : snapshot,
      error: errorMessage,
    };
  }

  private async liveExecutionGates(
    signal: Signal,
    snapshot: Awaited<ReturnType<TestnetClient["getExecutionSnapshot"]>>,
    usedSymbols: Set<string>,
  ) {
    const failures: string[] = [];
    const now = Date.now();
    const maxAgeMs = signal.engine === "SCALPING" ? 90_000 : 10 * 60_000;

    if (!this.live.isExecutionEnabled()) failures.push("LIVE_FLAG");
    if (!snapshot.connected) failures.push("ACCOUNT_CONNECTED");
    if (snapshot.unclassifiedOpenPositions !== 0) failures.push("CLASSIFIED_POSITIONS");
    if (snapshot.unprotectedOpenPositions !== 0) failures.push("PROTECTED_POSITIONS");
    if (snapshot.openPositions >= config.maxTotalPositions) failures.push("TOTAL_CAPACITY");
    if (signal.engine === "MOMENTUM" && snapshot.momentumOpen >= config.maxMomentumPositions) failures.push("MOMENTUM_CAPACITY");
    if (signal.engine === "SCALPING" && snapshot.scalpingOpen >= config.maxScalpingPositions) failures.push("SCALPING_CAPACITY");
    if (usedSymbols.has(signal.symbol)) failures.push("SYMBOL_LOCK");
    if (snapshot.dailyRiskUsedPct >= config.maxDailyRiskPct) failures.push("DAILY_RISK");
    if (signal.stage !== "CONFIRMED") failures.push("CONFIRMED_STAGE");
    if (!Number.isFinite(signal.updatedAt) || now - signal.updatedAt > maxAgeMs) failures.push("SIGNAL_FRESHNESS");
    if (!signal.risk || !Number.isFinite(signal.entry) || signal.entry <= 0) failures.push("VALID_SIGNAL");
    if (failures.length > 0) return { passed: false, failures, notionalUsd: 0 };
    if (!(await this.live.isTradablePerpetual(signal.symbol))) failures.push("TRADABLE_PERPETUAL");

    const riskDistance = Math.abs(signal.entry - signal.stop);
    if (!Number.isFinite(riskDistance) || riskDistance <= 0) failures.push("RISK_DISTANCE");

    const riskUsd = snapshot.accountBalanceUsd * (config.riskPerTradePct / 100);
    const riskBasedNotional = riskDistance > 0 ? riskUsd * (signal.entry / riskDistance) : 0;
    const maxAccountNotional = snapshot.accountBalanceUsd * (config.maxNotionalPctPerTrade / 100);
    const maxAvailableNotional = snapshot.availableBalanceUsd * 0.95;
    const notionalUsd = Math.min(riskBasedNotional, maxAccountNotional, maxAvailableNotional);
    if (!(Number.isFinite(notionalUsd) && notionalUsd > 0)) failures.push("VALID_NOTIONAL");

    try {
      await this.live.setOneXLeverage(signal.symbol);
    } catch {
      failures.push("ONE_X_LEVERAGE");
    }

    return { passed: failures.length === 0, failures, notionalUsd };
  }

  private async tryTestnetEntries() {
    if (
      this.mode !== "TESTNET" ||
      !this.testnetAuto ||
      !this.testnet.isExecutionEnabled() ||
      this.testnetExecutionInFlight
    ) return;

    this.testnetExecutionInFlight = true;
    try {
      let snapshot = await this.testnet.getExecutionSnapshot();

      // Self-heal only DDT-managed positions with a fresh matching signal.
      // Never bypass the protection gate if repair cannot be verified.
      let repairError: string | null = null;
      if (snapshot.unprotectedOpenPositions > 0) {
        const repaired = await this.repairManagedTestnetProtection(snapshot);
        snapshot = repaired.snapshot;
        repairError = repaired.error;
      }

      this.testnetState = {
        ...this.testnetState,
        auto: this.testnetAuto,
        connected: snapshot.connected,
        accountBalanceUsd: snapshot.accountBalanceUsd,
        availableBalanceUsd: snapshot.availableBalanceUsd,
        unrealizedPnlUsd: snapshot.unrealizedPnlUsd,
        openPositions: snapshot.openPositions,
        momentumOpen: snapshot.momentumOpen,
        scalpingOpen: snapshot.scalpingOpen,
        unclassifiedOpenPositions: snapshot.unclassifiedOpenPositions,
        unprotectedOpenPositions: snapshot.unprotectedOpenPositions,
        dailyRiskUsedPct: snapshot.dailyRiskUsedPct,
        realizedPnlTodayUsd: snapshot.realizedPnlTodayUsd,
        feesTodayUsd: snapshot.feesTodayUsd,
        positions: snapshot.positions,
        lastSyncAt: Date.now(),
        error: repairError,
      };

      if (!snapshot.connected) return;
      if (snapshot.unclassifiedOpenPositions > 0) return;
      if (snapshot.unprotectedOpenPositions > 0) return;
      // A reconciliation that finds an engine already above its configured
      // 3-position cap is a hard safety stop. Do not "rebalance" by guessing
      // which existing position should be closed.
      if (snapshot.momentumOpen > config.testnetMaxMomentumPositions) return;
      if (snapshot.scalpingOpen > config.testnetMaxScalpingPositions) return;
      if (snapshot.openPositions >= config.testnetMaxTotalPositions) return;
      if (snapshot.dailyRiskUsedPct >= config.testnetMaxDailyRiskPct) return;

      let total = snapshot.openPositions;
      let momentum = snapshot.momentumOpen;
      let scalping = snapshot.scalpingOpen;
      const usedSymbols = new Set(snapshot.positions.map((p) => p.symbol));

      const now = Date.now();
      const candidates = [...this.signals.values()]
        .filter((s) => {
          if (s.stage !== "CONFIRMED") return false;
          const maxAgeMs = s.engine === "SCALPING" ? 90_000 : 10 * 60_000;
          return now - s.updatedAt <= maxAgeMs;
        })
        .sort((a, b) => b.quality.total - a.quality.total);

      for (const signal of candidates) {
        if (total >= config.testnetMaxTotalPositions) break;
        if (usedSymbols.has(signal.symbol)) continue;

        // The public market universe and Binance Demo/Testnet can temporarily
        // disagree on TradFi/adjustment contracts. Never send an order for a
        // symbol that the exchangeInfo does not currently expose as a
        // TRADING USDT perpetual; silently skip it instead of poisoning the
        // execution status for the whole scanner cycle.
        if (!(await this.testnet.isTradablePerpetual(signal.symbol))) continue;
        if (signal.engine === "MOMENTUM" && momentum >= config.testnetMaxMomentumPositions) continue;
        if (signal.engine === "SCALPING" && scalping >= config.testnetMaxScalpingPositions) continue;

        const lastClosedAt = snapshot.lastClosedAt[signal.symbol] ?? 0;
        if (lastClosedAt > 0 && Date.now() - lastClosedAt < config.cooldownMinutes * 60_000) continue;

        const riskDistance = Math.abs(signal.entry - signal.stop);
        if (!Number.isFinite(riskDistance) || riskDistance <= 0 || signal.entry <= 0) continue;

        const riskUsd = snapshot.accountBalanceUsd * (config.testnetRiskPerTradePct / 100);
        const riskBasedNotional = riskUsd * (signal.entry / riskDistance);
        const maxAccountNotional = snapshot.accountBalanceUsd * (config.maxNotionalPctPerTrade / 100);
        const maxAvailableNotional = snapshot.availableBalanceUsd * 0.95;
        const notionalUsd = Math.min(riskBasedNotional, maxAccountNotional, maxAvailableNotional);
        const quantity = notionalUsd > 0 ? notionalUsd / signal.entry : 0;

        if (!(quantity > 0)) continue;

        try {
          const result = await this.testnet.placeMarketOrder({
            symbol: signal.symbol,
            side: signal.side,
            quantity,
            stopPrice: signal.stop,
            takeProfitPrice: signal.takeProfit1,
            clientOrderId: "DDT-" + (signal.engine === "MOMENTUM" ? "MOM-" : "SCALP-") + signal.symbol + "-" + signal.signalId.slice(-10),
          });

          total += 1;
          usedSymbols.add(signal.symbol);
          if (signal.engine === "MOMENTUM") momentum += 1;
          else scalping += 1;

          this.testnetState.error = null;
          console.info("[testnet entry]", result);
          // One new entry per execution cycle keeps balance/risk sizing
          // authoritative and avoids a burst of orders from one stale snapshot.
          break;
        } catch (error) {
          this.testnetState = {
            ...this.testnetState,
            auto: this.testnetAuto,
            error: error instanceof Error ? error.message : String(error),
            lastSyncAt: Date.now(),
          };
        }
      }

      const refreshed = await this.testnet.getExecutionSnapshot();
      this.testnetState = {
        ...this.testnetState,
        auto: this.testnetAuto,
        connected: refreshed.connected,
        accountBalanceUsd: refreshed.accountBalanceUsd,
        availableBalanceUsd: refreshed.availableBalanceUsd,
        unrealizedPnlUsd: refreshed.unrealizedPnlUsd,
        openPositions: refreshed.openPositions,
        momentumOpen: refreshed.momentumOpen,
        scalpingOpen: refreshed.scalpingOpen,
        unclassifiedOpenPositions: refreshed.unclassifiedOpenPositions,
        unprotectedOpenPositions: refreshed.unprotectedOpenPositions,
        dailyRiskUsedPct: refreshed.dailyRiskUsedPct,
        realizedPnlTodayUsd: refreshed.realizedPnlTodayUsd,
        feesTodayUsd: refreshed.feesTodayUsd,
        positions: refreshed.positions,
        lastSyncAt: Date.now(),
        // A successful exchange reconciliation clears stale candidate/order
        // errors from the dashboard. Genuine execution failures are still
        // surfaced during the cycle in which they occur.
        error: null,
      };
    } catch (error) {
      this.testnetState = {
        ...this.testnetState,
        auto: this.testnetAuto,
        error: error instanceof Error ? error.message : String(error),
        lastSyncAt: Date.now(),
      };
    } finally {
      this.testnetExecutionInFlight = false;
      this.emit("update");
    }
  }
  private async tryLiveEntries() {
    if (
      this.mode !== "LIVE" ||
      !this.liveAuto ||
      !this.live.isExecutionEnabled() ||
      this.liveExecutionInFlight
    ) return;

    this.liveExecutionInFlight = true;
    try {
      let snapshot = await this.live.getExecutionSnapshot();

      // Self-heal only DDT-managed positions with a fresh matching signal.
      // Never bypass the protection gate if repair cannot be verified.
      let repairError: string | null = null;
      if (snapshot.unprotectedOpenPositions > 0) {
        const repaired = await this.repairManagedLiveProtection(snapshot);
        snapshot = repaired.snapshot;
        repairError = repaired.error;
      }

      this.liveState = {
        ...this.liveState,
        auto: this.liveAuto,
        connected: snapshot.connected,
        accountBalanceUsd: snapshot.accountBalanceUsd,
        availableBalanceUsd: snapshot.availableBalanceUsd,
        unrealizedPnlUsd: snapshot.unrealizedPnlUsd,
        openPositions: snapshot.openPositions,
        momentumOpen: snapshot.momentumOpen,
        scalpingOpen: snapshot.scalpingOpen,
        unclassifiedOpenPositions: snapshot.unclassifiedOpenPositions,
        unprotectedOpenPositions: snapshot.unprotectedOpenPositions,
        dailyRiskUsedPct: snapshot.dailyRiskUsedPct,
        realizedPnlTodayUsd: snapshot.realizedPnlTodayUsd,
        feesTodayUsd: snapshot.feesTodayUsd,
        positions: snapshot.positions,
        lastSyncAt: Date.now(),
        error: repairError,
      };

      if (!snapshot.connected) return;
      if (snapshot.unclassifiedOpenPositions > 0) return;
      if (snapshot.unprotectedOpenPositions > 0) return;
      // A reconciliation that finds an engine already above its configured
      // 3-position cap is a hard safety stop. Do not "rebalance" by guessing
      // which existing position should be closed.
      if (snapshot.momentumOpen > config.maxMomentumPositions) return;
      if (snapshot.scalpingOpen > config.maxScalpingPositions) return;
      if (snapshot.openPositions >= config.maxTotalPositions) return;
      if (snapshot.dailyRiskUsedPct >= config.maxDailyRiskPct) return;

      let total = snapshot.openPositions;
      let momentum = snapshot.momentumOpen;
      let scalping = snapshot.scalpingOpen;
      const usedSymbols = new Set(snapshot.positions.map((p) => p.symbol));

      const now = Date.now();
      const candidates = [...this.signals.values()]
        .filter((s) => {
          if (s.stage !== "CONFIRMED") return false;
          const maxAgeMs = s.engine === "SCALPING" ? 90_000 : 10 * 60_000;
          return now - s.updatedAt <= maxAgeMs;
        })
        .sort((a, b) => b.quality.total - a.quality.total);

      for (const signal of candidates) {
        if (total >= config.maxTotalPositions) break;
        if (usedSymbols.has(signal.symbol)) continue;

        const lastClosedAt = snapshot.lastClosedAt[signal.symbol] ?? 0;
        if (lastClosedAt > 0 && Date.now() - lastClosedAt < config.cooldownMinutes * 60_000) continue;

        const gate = await this.liveExecutionGates(signal, snapshot, usedSymbols);
        if (!gate.passed) {
          console.info("[live gate blocked]", signal.symbol, signal.engine, gate.failures.join(","));
          continue;
        }

        const notionalUsd = gate.notionalUsd;
        const quantity = notionalUsd > 0 ? notionalUsd / signal.entry : 0;
        if (!(quantity > 0)) continue;

        try {
          const result = await this.live.placeMarketOrder({
            symbol: signal.symbol,
            side: signal.side,
            quantity,
            stopPrice: signal.stop,
            takeProfitPrice: signal.takeProfit1,
            clientOrderId: "DDT-" + (signal.engine === "MOMENTUM" ? "MOM-" : "SCALP-") + signal.symbol + "-" + signal.signalId.slice(-10),
          });

          total += 1;
          usedSymbols.add(signal.symbol);
          if (signal.engine === "MOMENTUM") momentum += 1;
          else scalping += 1;

          this.liveState.error = null;
          console.info("[live entry]", result);
          // One new entry per execution cycle keeps balance/risk sizing
          // authoritative and avoids a burst of orders from one stale snapshot.
          break;
        } catch (error) {
          this.liveState = {
            ...this.liveState,
            auto: this.liveAuto,
            error: error instanceof Error ? error.message : String(error),
            lastSyncAt: Date.now(),
          };
        }
      }

      const refreshed = await this.live.getExecutionSnapshot();
      this.liveState = {
        ...this.liveState,
        auto: this.liveAuto,
        connected: refreshed.connected,
        accountBalanceUsd: refreshed.accountBalanceUsd,
        availableBalanceUsd: refreshed.availableBalanceUsd,
        unrealizedPnlUsd: refreshed.unrealizedPnlUsd,
        openPositions: refreshed.openPositions,
        momentumOpen: refreshed.momentumOpen,
        scalpingOpen: refreshed.scalpingOpen,
        unclassifiedOpenPositions: refreshed.unclassifiedOpenPositions,
        unprotectedOpenPositions: refreshed.unprotectedOpenPositions,
        dailyRiskUsedPct: refreshed.dailyRiskUsedPct,
        realizedPnlTodayUsd: refreshed.realizedPnlTodayUsd,
        feesTodayUsd: refreshed.feesTodayUsd,
        positions: refreshed.positions,
        lastSyncAt: Date.now(),
        // A successful exchange reconciliation clears stale candidate/order
        // errors from the dashboard. Genuine execution failures are still
        // surfaced during the cycle in which they occur.
        error: null,
      };
    } catch (error) {
      this.liveState = {
        ...this.liveState,
        auto: this.liveAuto,
        error: error instanceof Error ? error.message : String(error),
        lastSyncAt: Date.now(),
      };
    } finally {
      this.liveExecutionInFlight = false;
      this.emit("update");
    }
  }

  private previewSignalRisk(
    signal: Pick<Signal, "symbol" | "engine" | "side" | "entry" | "stop" | "takeProfit1" | "takeProfit2">,
  ): Signal["risk"] {
    const riskDistance = Math.abs(signal.entry - signal.stop);

    if (!Number.isFinite(signal.entry) || signal.entry <= 0 || !Number.isFinite(riskDistance) || riskDistance <= 0) {
      return {
        eligible: false,
        reason: "INVALID_RISK_DISTANCE",
        entry: signal.entry,
        stop: signal.stop,
        takeProfit1: signal.takeProfit1,
        takeProfit2: signal.takeProfit2,
        riskDistancePct: 0,
        riskUsd: 0,
        notionalUsd: 0,
      };
    }

    const riskDistancePct = (riskDistance / signal.entry) * 100;
    if (this.mode === "PAPER") return this.risk.preview(signal as Signal);

    const executionState = this.mode === "TESTNET" ? this.testnetState : this.liveState;
    const riskPct = this.mode === "TESTNET" ? config.testnetRiskPerTradePct : config.riskPerTradePct;
    const maxDaily = this.mode === "TESTNET" ? config.testnetMaxDailyRiskPct : config.maxDailyRiskPct;
    const maxTotal = this.mode === "TESTNET" ? config.testnetMaxTotalPositions : config.maxTotalPositions;
    const maxMomentum = this.mode === "TESTNET" ? config.testnetMaxMomentumPositions : config.maxMomentumPositions;
    const maxScalping = this.mode === "TESTNET" ? config.testnetMaxScalpingPositions : config.maxScalpingPositions;

    const riskUsd = executionState.accountBalanceUsd * (riskPct / 100);
    const riskBasedNotional = riskDistance > 0 ? riskUsd * (signal.entry / riskDistance) : 0;
    const maxAccountNotional = executionState.accountBalanceUsd * (config.maxNotionalPctPerTrade / 100);
    const notionalUsd = Math.min(riskBasedNotional, maxAccountNotional);
    const positions = executionState.positions ?? [];
    const symbolOpen = positions.some((p) => p.symbol === signal.symbol);
    let reason = "RISK_GATE_PASS";
    let eligible = true;

    if (!executionState.connected || !executionState.executionEnabled) {
      eligible = false;
      reason = this.mode + "_NOT_ARMED";
    } else if (executionState.unclassifiedOpenPositions > 0) {
      eligible = false;
      reason = "UNCLASSIFIED_POSITION";
    } else if (executionState.unprotectedOpenPositions > 0) {
      eligible = false;
      reason = "PROTECTION_GATE";
    } else if (executionState.momentumOpen > maxMomentum || executionState.scalpingOpen > maxScalping) {
      eligible = false;
      reason = "ENGINE_POSITION_OVER_LIMIT";
    } else if (executionState.openPositions >= maxTotal) {
      eligible = false;
      reason = "TOTAL_POSITION_LIMIT";
    } else if (signal.engine === "MOMENTUM" && executionState.momentumOpen >= maxMomentum) {
      eligible = false;
      reason = "MOMENTUM_LIMIT";
    } else if (signal.engine === "SCALPING" && executionState.scalpingOpen >= maxScalping) {
      eligible = false;
      reason = "SCALPING_LIMIT";
    } else if (symbolOpen) {
      eligible = false;
      reason = "SYMBOL_ALREADY_OPEN";
    } else if (executionState.dailyRiskUsedPct >= maxDaily) {
      eligible = false;
      reason = "DAILY_RISK_LIMIT";
    }

    return {
      eligible,
      reason,
      entry: signal.entry,
      stop: signal.stop,
      takeProfit1: signal.takeProfit1,
      takeProfit2: signal.takeProfit2,
      riskDistancePct,
      riskUsd,
      notionalUsd,
    };
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

    signal.risk = this.previewSignalRisk(signal);
    this.signals.set(signalKey, signal);

    if (this.signals.size > 250) {
      const oldest = [...this.signals.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (oldest) this.signals.delete(oldest.engine + ":" + oldest.symbol);
    }
  }

  private updateMarketRegimeFromContext(candles: Candle[]) {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const fast = ema(closes, 20);
    const slow = ema(closes, 50);
    const currentAtr = atr(highs, lows, closes, 14);
    this.marketRegime = this.detectRegime(closes, fast, slow, currentAtr);
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