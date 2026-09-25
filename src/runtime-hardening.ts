import { config } from "./config.js";
import { BinanceScanner } from "./scanner.js";
import { TestnetClient } from "./testnet.js";

type HealthState = {
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  detail: string | null;
  updatedAt: number;
};

const applied = new WeakSet<object>();
const scannerByClient = new WeakMap<object, BinanceScanner>();
const lastGoodSnapshot = new WeakMap<object, any>();
const healthByClient = new WeakMap<object, HealthState>();

const stageCode: Record<string, string> = {
  WATCH: "WA",
  SETUP: "SU",
  CONFIRMED: "CF",
  BLOCKED: "BL",
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isIncomeFailure(error: unknown) {
  return /\/fapi\/v1\/income|incomeType|REALIZED_PNL|COMMISSION/.test(messageOf(error));
}

function isRetryableSignedRead(error: unknown) {
  const value = messageOf(error);
  return /signed timeout:|signed request failed: .*\s(?:500|502|503|504):/.test(value) ||
    /ECONNRESET|ETIMEDOUT|UND_ERR|fetch failed/i.test(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEntryMetadata(clientOrderId: string) {
  const match = String(clientOrderId).match(
    /^DDT-(MOM|SCALP)-([A-Z0-9]+)-(L|S)Q(\\d{1,3})(WA|SU|CF|BL)-[A-Za-z0-9]+$/,
  );
  if (!match) return null;
  return {
    engine: match[1] === "MOM" ? "MOMENTUM" : "SCALPING",
    symbol: match[2],
    side: match[3] === "L" ? "LONG" : "SHORT",
    quality: Number(match[4]),
    stage: match[5] === "WA"
      ? "WATCH"
      : match[5] === "SU"
        ? "SETUP"
        : match[5] === "BL"
          ? "BLOCKED"
          : "CONFIRMED",
  };
}

async function getCloseNetPnl(client: TestnetClient, symbol: string, orderId: string) {
  const api = client as any;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rows = await api.getUserTradesForAnalytics(
        Date.now() - 120_000,
        Date.now(),
        [symbol],
      );
      const fills = (Array.isArray(rows) ? rows : [])
        .filter((row: any) => String(row.orderId ?? "") === String(orderId));

      if (fills.length) {
        const realized = fills.reduce((sum: number, row: any) => sum + Number(row.realizedPnl ?? 0), 0);
        const fees = fills.reduce((sum: number, row: any) => {
          const asset = String(row.commissionAsset ?? "").toUpperCase();
          return sum + (asset === "USDT" ? Math.abs(Number(row.commission ?? 0)) : 0);
        }, 0);
        return realized - fees;
      }
    } catch {
      // A close can be visible in order history a moment before userTrades.
    }
    if (attempt === 0) await sleep(400);
  }
  return null;
}

async function patchExchangeAnalytics(client: TestnetClient, base: any, symbols: string[]) {
  const api = client as any;
  const orderRows = Array.isArray(base?.trades) ? base.trades : [];
  let fullOrderRows = orderRows;
  try {
    const fetched = await api.getAccountOrdersForAnalytics(
      Number(base.startTime),
      Number(base.endTime),
      symbols,
    );
    if (Array.isArray(fetched) && fetched.length) fullOrderRows = fetched;
  } catch {
    // Keep the primary analytics result when a second historical scan is unavailable.
  }

  const ddtOrderIds = new Set(
    fullOrderRows
      .map((row: any) => String(row.clientOrderId ?? ""))
      .filter((id: string) => id.startsWith("DDT-")),
  );

  const ddtSymbols = [...new Set(
    fullOrderRows
      .filter((row: any) => ddtOrderIds.has(String(row.clientOrderId ?? "")))
      .map((row: any) => String(row.symbol ?? "").toUpperCase())
      .filter(Boolean),
  )];

  if (!ddtSymbols.length || !orderRows.length) {
    return {
      ...base,
      ddtOnly: true,
      ddtOnlyTotals: { realizedPnlUsd: 0, feesUsd: 0, netPnlUsd: 0 },
      accountTotals: base?.totals ?? null,
    };
  }

  let userTrades: any[] = [];
  try {
    userTrades = await api.getUserTradesForAnalytics(
      Number(base.startTime),
      Number(base.endTime),
      ddtSymbols,
    );
  } catch {
    userTrades = [];
  }

  const fillsByOrder = new Map<string, { realized: number; fees: number; lastTime: number; quantity: number; notional: number }>();
  for (const fill of userTrades) {
    const orderId = String(fill?.orderId ?? "");
    if (!orderId) continue;
    const existing = fillsByOrder.get(orderId) ?? { realized: 0, fees: 0, lastTime: 0, quantity: 0, notional: 0 };
    existing.realized += Number(fill?.realizedPnl ?? 0) || 0;
    if (String(fill?.commissionAsset ?? "").toUpperCase() === "USDT") {
      existing.fees += Math.abs(Number(fill?.commission ?? 0)) || 0;
    }
    const quantity = Math.abs(Number(fill?.qty ?? 0)) || 0;
    const price = Number(fill?.price ?? 0) || 0;
    existing.quantity += quantity;
    existing.notional += quantity * price;
    existing.lastTime = Math.max(existing.lastTime, Number(fill?.time ?? 0) || 0);
    fillsByOrder.set(orderId, existing);
  }

  const chronological = [...fullOrderRows]
    .filter((row: any) => String(row.clientOrderId ?? "").startsWith("DDT-"))
    .sort((a: any, b: any) =>
      Number(a.time ?? a.updateTime ?? 0) - Number(b.time ?? b.updateTime ?? 0),
    );

  const openBySymbol = new Map<string, {
    side: "LONG" | "SHORT";
    entryOrderId: string;
    engine: string;
    quality: number | null;
    stage: string | null;
  }>();

  const orderMeta = new Map<string, { positionSide: "LONG" | "SHORT"; entryMeta: ReturnType<typeof parseEntryMetadata> }>();
  const closeNetByOrder = new Map<string, number>();

  let realizedPnlUsd = 0;
  let feesUsd = 0;

  const dailyMap = new Map<string, { date: string; realizedPnlUsd: number; feesUsd: number; netPnlUsd: number }>();

  const addDaily = (ts: number, realized: number, fees: number) => {
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const date = new Date(timestamp + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const row = dailyMap.get(date) ?? { date, realizedPnlUsd: 0, feesUsd: 0, netPnlUsd: 0 };
    row.realizedPnlUsd += realized;
    row.feesUsd += fees;
    row.netPnlUsd = row.realizedPnlUsd - row.feesUsd;
    dailyMap.set(date, row);
  };

  for (const order of chronological) {
    const id = String(order.clientOrderId ?? "");
    const orderId = String(order.orderId ?? "");
    const symbol = String(order.symbol ?? "").toUpperCase();
    const status = String(order.status ?? "");
    if (status !== "FILLED") continue;

    const fill = fillsByOrder.get(orderId);
    const isEntry =
      (id.startsWith("DDT-MOM-") || id.startsWith("DDT-SCALP-")) &&
      String(order.type ?? "") === "MARKET" &&
      !order.reduceOnly &&
      !order.closePosition;

    const isClose =
      Boolean(order.reduceOnly || order.closePosition) ||
      /-(SL|TP)$/.test(id) ||
      id.startsWith("DDT-TP-") ||
      id.startsWith("DDT-MAN-");

    if (isEntry) {
      const metadata = parseEntryMetadata(id);
      const side: "LONG" | "SHORT" = metadata?.side === "SHORT"
        ? "SHORT"
        : "LONG";
      openBySymbol.set(symbol, {
        side,
        entryOrderId: orderId,
        engine: metadata?.engine ?? "DDT",
        quality: metadata?.quality ?? null,
        stage: metadata?.stage ?? null,
      });
      orderMeta.set(orderId, { positionSide: side, entryMeta: metadata });
      const entryFees = fill?.fees ?? 0;
      feesUsd += entryFees;
      addDaily(fill?.lastTime || Number(order.time ?? order.updateTime ?? 0), 0, entryFees);
      continue;
    }

    if (!isClose) continue;

    const open = openBySymbol.get(symbol);
    const exitSide = String(order.side ?? "").toUpperCase() === "BUY" ? "BUY" : "SELL";
    const positionSide: "LONG" | "SHORT" = open?.side ?? (exitSide === "BUY" ? "SHORT" : "LONG");
    const closeRealized = fill?.realized ?? 0;
    const closeFees = fill?.fees ?? 0;
    const entryFees = open ? (fillsByOrder.get(open.entryOrderId)?.fees ?? 0) : 0;
    const closeNet = closeRealized - closeFees - entryFees;

    realizedPnlUsd += closeRealized;
    feesUsd += closeFees;
    closeNetByOrder.set(orderId, closeNet);
    orderMeta.set(orderId, {
      positionSide,
      entryMeta: open
        ? {
            engine: open.engine === "MOMENTUM" ? "MOMENTUM" : open.engine === "SCALPING" ? "SCALPING" : "DDT",
            symbol,
            side: open.side,
            quality: open.quality ?? 0,
            stage: open.stage ?? "CONFIRMED",
          }
        : null,
    });
    addDaily(fill?.lastTime || Number(order.time ?? order.updateTime ?? 0), closeRealized, closeFees);
    openBySymbol.delete(symbol);
  }

  const tradeResults: number[] = [];
  for (const [, net] of closeNetByOrder) tradeResults.push(net);

  const wins = tradeResults.filter((v) => v > 0).length;
  const losses = tradeResults.filter((v) => v < 0).length;
  const grossProfit = tradeResults.filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const grossLoss = tradeResults.filter((v) => v < 0).reduce((s, v) => s + v, 0);

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of [...tradeResults].reverse()) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const trades = orderRows
    .filter((row: any) => String(row.clientOrderId ?? "").startsWith("DDT-"))
    .map((row: any) => {
      const id = String(row.clientOrderId ?? "");
      const metadata = parseEntryMetadata(id);
      const orderId = String(row.orderId ?? "");
      const meta = orderMeta.get(orderId);
      const isClose =
        Boolean(row.reduceOnly || row.closePosition) ||
        /-(SL|TP)$/.test(id) ||
        id.startsWith("DDT-TP-") ||
        id.startsWith("DDT-MAN-");
      const exitSide = String(row.side ?? "").toUpperCase() === "BUY"
        ? "BUY"
        : String(row.side ?? "").toUpperCase() === "SELL"
          ? "SELL"
          : null;
      const fill = fillsByOrder.get(orderId);
      const net = closeNetByOrder.get(orderId);
      return {
        ...row,
        time: Number(row.time ?? row.updateTime ?? fill?.lastTime ?? 0),
        engine: metadata?.engine ??
          (id.includes("MOM-") ? "MOMENTUM" : id.includes("SCALP-") ? "SCALPING" : "DDT"),
        positionSide: metadata?.side ?? meta?.positionSide ?? null,
        exitSide: isClose ? exitSide : null,
        side: metadata?.side ?? meta?.positionSide ?? null,
        stage: metadata?.stage ?? meta?.entryMeta?.stage ?? null,
        quality: metadata?.quality ?? meta?.entryMeta?.quality ?? null,
        exit: isClose && fill && fill.quantity > 0
          ? fill.notional / fill.quantity
          : null,
        reason:
          id.includes("-SL") ? "SL" :
          id.startsWith("DDT-TP-") ? "TP" :
          id.startsWith("DDT-MAN-") ? "MANUAL" :
          String(row.type ?? row.status ?? "MARKET"),
        netPnlUsd: isClose && Number.isFinite(net) ? net : null,
      };
    })
    .sort((a: any, b: any) => Number(b.time) - Number(a.time))
    .slice(0, 50);

  const ddtEntries = trades.filter((row: any) =>
    row.status === "FILLED" &&
    !row.reduceOnly &&
    !row.closePosition &&
    (String(row.clientOrderId ?? "").startsWith("DDT-MOM-") ||
      String(row.clientOrderId ?? "").startsWith("DDT-SCALP-")),
  );

  return {
    ...base,
    accountTotals: base?.totals ?? null,
    totals: {
      realizedPnlUsd,
      feesUsd,
      netPnlUsd: realizedPnlUsd - feesUsd,
    },
    ddtOnly: true,
    ddt: {
      ...base.ddt,
      filledEntries: ddtEntries.length,
      momentumEntries: ddtEntries.filter((row: any) => row.engine === "MOMENTUM").length,
      scalpingEntries: ddtEntries.filter((row: any) => row.engine === "SCALPING").length,
    },
    stats: {
      wins,
      losses,
      winRate: tradeResults.length ? wins / tradeResults.length * 100 : 0,
      profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : 0,
      averageWinUsd: wins ? grossProfit / wins : 0,
      averageLossUsd: losses ? grossLoss / losses : 0,
      maxDrawdownUsd: maxDrawdown,
    },
    daily: [...dailyMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
    trades,
    coverage: {
      ...base.coverage,
      ddtTradeSymbolsScanned: ddtSymbols.length,
      userTradeRows: userTrades.length,
      note: "DealDost analytics use DDT-tagged Binance fills only. Account-level Binance totals are retained separately as accountTotals. External/non-DDT activity is excluded from the primary DealDost totals.",
    },
  };
}

function applyScannerClientAssociation(scanner: BinanceScanner) {
  const self = scanner as any;
  if (self.testnet) scannerByClient.set(self.testnet, scanner);
  if (self.live) scannerByClient.set(self.live, scanner);
}

export function applyRuntimeHardening() {
  const tnProto = TestnetClient.prototype as any;
  if (applied.has(tnProto)) return;
  applied.add(tnProto);

  const originalSignedGet = tnProto.signedGet;
  tnProto.signedGet = async function <T>(path: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await originalSignedGet.call(this, path);
      } catch (error) {
        lastError = error;
        if (!isRetryableSignedRead(error) || attempt >= 2) throw error;
        await sleep(300 * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };

  const originalSnapshot = tnProto.getExecutionSnapshot;
  tnProto.getExecutionSnapshot = async function (...args: any[]) {
    try {
      const snapshot = await originalSnapshot.apply(this, args);
      lastGoodSnapshot.set(this, snapshot);
      healthByClient.set(this, {
        status: "ONLINE",
        detail: null,
        updatedAt: Date.now(),
      });
      return snapshot;
    } catch (error) {
      if (!isIncomeFailure(error)) {
        healthByClient.set(this, {
          status: "OFFLINE",
          detail: messageOf(error),
          updatedAt: Date.now(),
        });
        throw error;
      }

      const detail = "Income analytics degraded; account/positions remain live and new entries are fail-closed.";
      const previous = lastGoodSnapshot.get(this);
      const originalIncome = this.getIncomeHistory;

      this.getIncomeHistory = async () => [];
      try {
        const snapshot = await originalSnapshot.apply(this, args);
        snapshot.realizedPnlTodayUsd = previous?.realizedPnlTodayUsd ?? 0;
        snapshot.feesTodayUsd = previous?.feesTodayUsd ?? 0;
        snapshot.netPnlTodayUsd = previous?.netPnlTodayUsd ?? 0;
        // When today's income cannot be verified, new entries must stop.
        snapshot.dailyRiskUsedPct = this.profile === "TESTNET"
          ? config.testnetMaxDailyRiskPct
          : config.maxDailyRiskPct;
        snapshot.analyticsDegraded = true;
        snapshot.analyticsError = messageOf(error);
        healthByClient.set(this, {
          status: "DEGRADED",
          detail,
          updatedAt: Date.now(),
        });
        return snapshot;
      } finally {
        this.getIncomeHistory = originalIncome;
      }
    }
  };

  const originalSync = tnProto.sync;
  tnProto.sync = async function (...args: any[]) {
    try {
      const state = await originalSync.apply(this, args);
      const health = healthByClient.get(this) ?? {
        status: state.connected ? "ONLINE" : "OFFLINE",
        detail: null,
        updatedAt: Date.now(),
      };
      return {
        ...state,
        health: health.status,
        healthDetail: health.detail,
        healthUpdatedAt: health.updatedAt,
      };
    } catch (error) {
      healthByClient.set(this, {
        status: "OFFLINE",
        detail: messageOf(error),
        updatedAt: Date.now(),
      });
      throw error;
    }
  };

  const originalAnalytics = tnProto.getAnalytics;
  tnProto.getAnalytics = async function (days = 30, symbols: string[] = []) {
    let base: any;
    let degraded = false;

    try {
      base = await originalAnalytics.call(this, days, symbols);
    } catch (error) {
      if (!isIncomeFailure(error)) throw error;
      degraded = true;
      const originalIncome = this.getIncomeHistory;
      this.getIncomeHistory = async () => [];
      try {
        base = await originalAnalytics.call(this, days, symbols);
      } finally {
        this.getIncomeHistory = originalIncome;
      }
    }

    const enriched = await patchExchangeAnalytics(this, base, symbols);
    return {
      ...enriched,
      analyticsHealth: degraded ? "DEGRADED" : "ONLINE",
      analyticsHealthDetail: degraded
        ? "Binance income endpoint timed out; DDT fill analytics remain available where userTrades are present."
        : null,
    };
  };

  const originalPlace = tnProto.placeMarketOrder;
  tnProto.placeMarketOrder = async function (input: any) {
    const scanner = scannerByClient.get(this);
    if (scanner && input?.clientOrderId) {
      const currentId = String(input.clientOrderId);
      const match = currentId.match(/^DDT-(MOM|SCALP)-([A-Z0-9]+)-([a-z0-9]+)$/);
      if (match) {
        const engine = match[1] === "MOM" ? "MOMENTUM" : "SCALPING";
        const key = engine + ":" + match[2];
        const signal = (scanner as any).signals?.get(key);
        if (signal) {
          const code = stageCode[signal.stage] ?? "CF";
          const side = signal.side === "LONG" ? "L" : "S";
          input = {
            ...input,
            clientOrderId:
              "DDT-" + match[1] + "-" + match[2] + "-" + side +
              "Q" + Math.round(signal.quality?.total ?? 0) + code + "-" + match[3],
          };
        }
      }
    }
    return originalPlace.call(this, input);
  };

  const scannerProto = BinanceScanner.prototype as any;
  const originalScannerState = scannerProto.state;
  if (!scannerProto.__dealdostRuntimeStatePatched) {
    scannerProto.__dealdostRuntimeStatePatched = true;
    scannerProto.state = function (...args: any[]) {
      applyScannerClientAssociation(this);
      return originalScannerState.apply(this, args);
    };
  }

  const originalTestnetClose = scannerProto.closeManagedTestnetPosition;
  scannerProto.closeManagedTestnetPosition = async function (symbol: string, reason: "TP1" | "MANUAL" = "MANUAL") {
    const result = await originalTestnetClose.call(this, symbol, reason);
    const rotation = this.rotation;
    const client = this.testnet as TestnetClient;
    if (rotation && result?.orderId) {
      const netPnl = await getCloseNetPnl(client, String(symbol).toUpperCase(), String(result.orderId));
      if (Number.isFinite(netPnl) && netPnl !== null) {
        const before = this.testnetState?.positions?.find((p: any) =>
          String(p.symbol).toUpperCase() === String(symbol).toUpperCase(),
        );
        const event = rotation.onExchangeClosedTrade?.({
          sourceTradeId: "TESTNET:" + String(result.orderId),
          sourceProfile: "TESTNET",
          symbol: String(symbol).toUpperCase(),
          engine: before?.engine ?? result.engine ?? "DDT",
          side: before?.side ?? result.side ?? "LONG",
          netPnlUsd: Number(netPnl),
          closedAt: Date.now(),
        });
        if (event) this.emit("update");
      }
    }
    return this.state();
  };

  const originalLiveClose = scannerProto.closeManagedLivePosition;
  scannerProto.closeManagedLivePosition = async function (symbol: string, reason: "TP1" | "MANUAL" = "MANUAL") {
    const result = await originalLiveClose.call(this, symbol, reason);
    const rotation = this.rotation;
    const client = this.live as TestnetClient;
    if (rotation && result?.orderId) {
      const netPnl = await getCloseNetPnl(client, String(symbol).toUpperCase(), String(result.orderId));
      if (Number.isFinite(netPnl) && netPnl !== null) {
        const before = this.liveState?.positions?.find((p: any) =>
          String(p.symbol).toUpperCase() === String(symbol).toUpperCase(),
        );
        const event = rotation.onExchangeClosedTrade?.({
          sourceTradeId: "LIVE:" + String(result.orderId),
          sourceProfile: "LIVE",
          symbol: String(symbol).toUpperCase(),
          engine: before?.engine ?? result.engine ?? "DDT",
          side: before?.side ?? result.side ?? "LONG",
          netPnlUsd: Number(netPnl),
          closedAt: Date.now(),
        });
        if (event) this.emit("update");
      }
    }
    return this.state();
  };
}
