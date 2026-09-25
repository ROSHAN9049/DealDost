import { createHmac } from "node:crypto";
import { config } from "./config.js";
import type { Engine, Side, TestnetPositionView, TestnetStateView } from "./types.js";

type BalanceRow = {
  asset?: string;
  balance?: string;
  availableBalance?: string;
};

type PositionRow = {
  symbol?: string;
  positionAmt?: string;
  entryPrice?: string;
  markPrice?: string;
  unrealizedProfit?: string;
  unRealizedProfit?: string;
  leverage?: string;
  updateTime?: number;
};

type ExchangeFilter = {
  filterType?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  tickSize?: string;
  notional?: string;
};

type ExchangeSymbol = {
  symbol: string;
  status?: string;
  quoteAsset?: string;
  contractType?: string;
  filters?: ExchangeFilter[];
};

type ExchangeInfo = {
  symbols?: ExchangeSymbol[];
};

type OrderRow = {
  symbol?: string;
  side?: "BUY" | "SELL";
  type?: string;
  status?: string;
  clientOrderId?: string;
  reduceOnly?: boolean;
  closePosition?: boolean;
  orderId?: string | number;
  stopPrice?: string;
  time?: number;
  updateTime?: number;
};

type AlgoOrderRow = {
  symbol?: string;
  side?: "BUY" | "SELL";
  orderType?: string;
  algoStatus?: string;
  clientAlgoId?: string;
  algoId?: string | number;
  closePosition?: boolean;
  triggerPrice?: string;
  createTime?: number;
  updateTime?: number;
};

type IncomeRow = {
  income?: string;
  asset?: string;
  incomeType?: string;
  time?: number;
};

export interface TestnetOrderPlan {
  symbol: string;
  side: Side;
  quantity: number;
  entryOrderSide: "BUY" | "SELL";
  closeOrderSide: "BUY" | "SELL";
  stopPrice?: number;
  takeProfitPrice?: number;
  minQty: number;
  stepSize: number;
  minNotional: number;
}

export interface TestnetOrderResult {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  status: string;
  executedQty: number;
  avgPrice: number;
  stopOrderId?: string;
  takeProfitOrderId?: string;
}

export interface TestnetExecutionSnapshot {
  connected: boolean;
  accountBalanceUsd: number;
  availableBalanceUsd: number;
  unrealizedPnlUsd: number;
  positions: TestnetPositionView[];
  openPositions: number;
  momentumOpen: number;
  scalpingOpen: number;
  unclassifiedOpenPositions: number;
  unprotectedOpenPositions: number;
  dailyRiskUsedPct: number;
  realizedPnlTodayUsd: number;
  feesTodayUsd: number;
  netPnlTodayUsd: number;
  lastClosedAt: Record<string, number>;
}

export class TestnetClient {
  constructor(private readonly profile: "TESTNET" | "LIVE" = "TESTNET") {}

  private exchangeInfo?: ExchangeInfo;
  private exchangeInfoAt = 0;

  private accountReadCache?: {
    at: number;
    balances: BalanceRow[];
    positions: PositionRow[];
  };
  private accountReadInFlight?: Promise<{
    balances: BalanceRow[];
    positions: PositionRow[];
  }>;
  private readonly accountReadCacheMs = 3000;
  private serverTimeOffsetMs = 0;
  private serverTimeAt = 0;
  private serverTimeInFlight?: Promise<number>;
  private readonly serverTimeCacheMs = 30_000;

  private get baseUrl() {
    return this.profile === "LIVE" ? config.liveRestBase : config.testnetRestBase;
  }

  private get apiKey() {
    return this.profile === "LIVE" ? config.liveApiKey : config.testnetApiKey;
  }

  private get apiSecret() {
    return this.profile === "LIVE" ? config.liveApiSecret : config.testnetApiSecret;
  }

  private get executionFlag() {
    return this.profile === "LIVE" ? config.liveExecutionEnabled : config.testnetExecutionEnabled;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiSecret);
  }

  isExecutionEnabled() {
    return this.isConfigured() && this.executionFlag;
  }

  emptyState(): TestnetStateView {
    return {
      configured: this.isConfigured(),
      executionEnabled: this.isExecutionEnabled(),
      auto: false,
      connected: false,
      accountBalanceUsd: 0,
      availableBalanceUsd: 0,
      unrealizedPnlUsd: 0,
      openPositions: 0,
      momentumOpen: 0,
      scalpingOpen: 0,
      unclassifiedOpenPositions: 0,
      unprotectedOpenPositions: 0,
      dailyRiskUsedPct: 0,
      realizedPnlTodayUsd: 0,
      feesTodayUsd: 0,
      netPnlTodayUsd: 0,
      positions: [],
      lastSyncAt: 0,
      error: null,
    };
  }

  async sync(): Promise<TestnetStateView> {
    const base = this.emptyState();
    if (!this.isConfigured()) {
      return { ...base, lastSyncAt: Date.now() };
    }

    const { balances, positions } = await this.getAccountRead();

    if (this.isExecutionEnabled()) {
      try {
        await this.cleanupStaleProtectionOrders(
          new Set(
            positions
              .filter((row) => Math.abs(Number(row.positionAmt ?? 0)) > 0)
              .map((row) => String(row.symbol ?? "").toUpperCase()),
          ),
        );
      } catch (error) {
        // Protection cleanup is maintenance, not the authoritative account
        // read. A transient cleanup timeout must not blank the account or
        // interrupt position reconciliation.
        console.warn(
          "[testnet stale protection cleanup]",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const usdt = balances.find((row) => row.asset === "USDT");
    const open = positions.filter((row) => Math.abs(Number(row.positionAmt ?? 0)) > 0);
    const basicPositions: TestnetPositionView[] = open.map((row) => ({
      symbol: String(row.symbol ?? "").toUpperCase(),
      engine: null,
      side: Number(row.positionAmt ?? 0) >= 0 ? "LONG" : "SHORT",
      quantity: Math.abs(Number(row.positionAmt ?? 0)),
      entryPrice: Number(row.entryPrice ?? 0),
      markPrice: Number(row.markPrice ?? 0),
      unrealizedPnlUsd: Number(row.unRealizedProfit ?? row.unrealizedProfit ?? 0),
      leverage: Number.isFinite(Number(row.leverage)) ? Number(row.leverage) : null,
      openedAt: Number(row.updateTime ?? 0),
      protection: "MISSING",
      takeProfitPrice: null,
      tpManagedByEngine: false,
    }));

    const basic = {
      ...base,
      connected: true,
      accountBalanceUsd: Number(usdt?.balance ?? 0),
      availableBalanceUsd: Number(usdt?.availableBalance ?? 0),
      unrealizedPnlUsd: open.reduce((sum, row) => sum + Number(row.unRealizedProfit ?? row.unrealizedProfit ?? 0), 0),
      openPositions: open.length,
      momentumOpen: 0,
      scalpingOpen: 0,
      unclassifiedOpenPositions: open.length,
      unprotectedOpenPositions: open.length,
      dailyRiskUsedPct: 0,
      realizedPnlTodayUsd: 0,
      feesTodayUsd: 0,
      netPnlTodayUsd: 0,
      positions: basicPositions,
      lastSyncAt: Date.now(),
    };

    try {
      const enriched = await this.getExecutionSnapshot();
      return {
        ...basic,
        connected: enriched.connected,
        accountBalanceUsd: enriched.accountBalanceUsd,
        availableBalanceUsd: enriched.availableBalanceUsd,
        unrealizedPnlUsd: enriched.unrealizedPnlUsd,
        openPositions: enriched.openPositions,
        momentumOpen: enriched.momentumOpen,
        scalpingOpen: enriched.scalpingOpen,
        unclassifiedOpenPositions: enriched.unclassifiedOpenPositions,
        unprotectedOpenPositions: enriched.unprotectedOpenPositions,
        dailyRiskUsedPct: enriched.dailyRiskUsedPct,
        realizedPnlTodayUsd: enriched.realizedPnlTodayUsd,
        feesTodayUsd: enriched.feesTodayUsd,
        netPnlTodayUsd: enriched.netPnlTodayUsd,
        positions: enriched.positions,
        lastSyncAt: Date.now(),
      };
    } catch {
      // Basic account sync remains authoritative for dashboard connectivity.
      // Execution auto-gates still call getExecutionSnapshot() and fail closed
      // when reconciliation cannot be completed.
      return basic;
    }
  }

  async getExecutionSnapshot(): Promise<TestnetExecutionSnapshot> {
    if (!this.isConfigured()) {
      return {
        connected: false,
        accountBalanceUsd: 0,
        availableBalanceUsd: 0,
        unrealizedPnlUsd: 0,
        positions: [],
        openPositions: 0,
        momentumOpen: 0,
        scalpingOpen: 0,
        unclassifiedOpenPositions: 0,
        unprotectedOpenPositions: 0,
        dailyRiskUsedPct: 0,
        realizedPnlTodayUsd: 0,
        feesTodayUsd: 0,
        netPnlTodayUsd: 0,
        lastClosedAt: {},
      };
    }

    const [{ balances, positions }, income, commission] = await Promise.all([
      this.getAccountRead(),
      this.signedGet<IncomeRow[]>(this.incomePath("REALIZED_PNL")),
      this.signedGet<IncomeRow[]>(this.incomePath("COMMISSION")),
    ]);

    const usdt = balances.find((row) => row.asset === "USDT");
    const open = positions.filter((row) => Math.abs(Number(row.positionAmt ?? 0)) > 0);
    const positionViews: TestnetPositionView[] = [];
    let momentumOpen = 0;
    let scalpingOpen = 0;
    let unclassifiedOpenPositions = 0;
    let unprotectedOpenPositions = 0;

    const tagged = await Promise.all(
      open.map(async (row) => {
        const symbol = String(row.symbol ?? "").toUpperCase();
        const [orders, openOrders] = await Promise.all([
          this.getRecentOrders(symbol),
          this.getOpenOrders(symbol),
        ]);
        const engine = this.detectEngine(orders);
        const lastClosedAt = this.detectLastClosedAt(orders);
        const protection = this.getProtectionStatus(openOrders);
        return { row, symbol, orders, openOrders, engine, lastClosedAt, protection };
      }),
    );

    const lastClosedAt: Record<string, number> = {};
    for (const item of tagged) {
      const position = item.row;
      const quantity = Math.abs(Number(position.positionAmt ?? 0));
      const side: Side = Number(position.positionAmt ?? 0) >= 0 ? "LONG" : "SHORT";
      const engine = item.engine;
      if (engine === "MOMENTUM") momentumOpen += 1;
      else if (engine === "SCALPING") scalpingOpen += 1;
      else unclassifiedOpenPositions += 1;

      if (item.protection !== "OK") unprotectedOpenPositions += 1;
      if (item.lastClosedAt > 0) lastClosedAt[item.symbol] = item.lastClosedAt;

      positionViews.push({
        symbol: item.symbol,
        engine,
        side,
        quantity,
        entryPrice: Number(position.entryPrice ?? 0),
        markPrice: Number(position.markPrice ?? 0),
        unrealizedPnlUsd: Number(position.unRealizedProfit ?? position.unrealizedProfit ?? 0),
        leverage: Number.isFinite(Number(position.leverage))
          ? Number(position.leverage)
          : item.engine
            ? 1
            : null,
        openedAt: Number(position.updateTime ?? 0),
        protection: item.protection,
        takeProfitPrice: this.getExistingTakeProfitPrice(item.openOrders),
        tpManagedByEngine: true,
      });
    }

    const accountBalanceUsd = Number(usdt?.balance ?? 0);
    const availableBalanceUsd = Number(usdt?.availableBalance ?? 0);
    const realizedPnlTodayUsd = income.reduce((sum, row) => sum + Number(row.income ?? 0), 0);
    const feesTodayUsd = Math.abs(commission.reduce((sum, row) => sum + Number(row.income ?? 0), 0));
    const negativeRealized = income.reduce((sum, row) => {
      const value = Number(row.income ?? 0);
      return value < 0 ? sum + Math.abs(value) : sum;
    }, 0);
    const negativeCommission = commission.reduce((sum, row) => {
      const value = Number(row.income ?? 0);
      return value < 0 ? sum + Math.abs(value) : sum;
    }, 0);
    const dailyLossUsd = negativeRealized + negativeCommission;
    const dailyRiskUsedPct = accountBalanceUsd > 0 ? (dailyLossUsd / accountBalanceUsd) * 100 : 0;
    const netPnlTodayUsd = realizedPnlTodayUsd - feesTodayUsd;
    const unrealizedPnlUsd = open.reduce(
      (sum, row) => sum + Number(row.unRealizedProfit ?? row.unrealizedProfit ?? 0),
      0,
    );

    return {
      connected: true,
      accountBalanceUsd,
      availableBalanceUsd,
      unrealizedPnlUsd,
      positions: positionViews,
      openPositions: open.length,
      momentumOpen,
      scalpingOpen,
      unclassifiedOpenPositions,
      unprotectedOpenPositions,
      dailyRiskUsedPct,
      realizedPnlTodayUsd,
      feesTodayUsd,
      netPnlTodayUsd,
      lastClosedAt,
    };
  }

  async getAnalytics(daysInput = 30) {
    if (!this.isConfigured()) {
      throw new Error(this.profile + "_NOT_CONFIGURED");
    }

    const days = Math.min(90, Math.max(1, Math.floor(Number(daysInput) || 30)));
    const endTime = Date.now();
    const startTime = this.getIstDayStartMsForAnalytics(endTime - (days - 1) * 24 * 60 * 60 * 1000);

    const [realizedIncome, commissionIncome, orders] = await Promise.all([
      this.signedGet<IncomeRow[]>(
        this.incomePath("REALIZED_PNL", startTime),
      ),
      this.signedGet<IncomeRow[]>(
        this.incomePath("COMMISSION", startTime),
      ),
      this.getAccountOrdersForAnalytics(startTime),
    ]);
    const income = [...realizedIncome, ...commissionIncome];

    const dayKeys = Array.from({ length: days }, (_, index) => {
      const ts = startTime + index * 24 * 60 * 60 * 1000;
      return this.getIstDateKey(ts);
    });

    const daily = dayKeys.map((date) => ({
      date,
      realizedPnlUsd: 0,
      feesUsd: 0,
      netPnlUsd: 0,
    }));
    const byDay = new Map(daily.map((row) => [row.date, row]));

    for (const row of income) {
      const value = Number(row.income ?? 0);
      const timestamp = Number(row.time ?? 0);
      if (!Number.isFinite(value) || !Number.isFinite(timestamp)) continue;
      const day = byDay.get(this.getIstDateKey(timestamp));
      if (!day) continue;

      if (row.incomeType === "REALIZED_PNL") {
        day.realizedPnlUsd += value;
      } else if (row.incomeType === "COMMISSION") {
        day.feesUsd += Math.abs(value);
      }
    }

    for (const day of daily) {
      day.netPnlUsd = day.realizedPnlUsd - day.feesUsd;
    }

    let momentumEntries = 0;
    let scalpingEntries = 0;
    let ddtFilledEntries = 0;
    let ddtProtectionOrders = 0;

    for (const order of orders) {
      const clientId = String(order.clientOrderId ?? "");
      const status = String(order.status ?? "");
      const type = String(order.type ?? "");
      if (status !== "FILLED") continue;

      if (clientId.startsWith("DDT-MOM-") && type === "MARKET" && !order.reduceOnly && !order.closePosition) {
        momentumEntries += 1;
        ddtFilledEntries += 1;
      } else if (clientId.startsWith("DDT-SCALP-") && type === "MARKET" && !order.reduceOnly && !order.closePosition) {
        scalpingEntries += 1;
        ddtFilledEntries += 1;
      }

      if (clientId.startsWith("DDT-") && (type === "STOP_MARKET" || type === "TAKE_PROFIT_MARKET")) {
        ddtProtectionOrders += 1;
      }
    }

    const realizedPnlUsd = daily.reduce((sum, row) => sum + row.realizedPnlUsd, 0);
    const feesUsd = daily.reduce((sum, row) => sum + row.feesUsd, 0);
    const netPnlUsd = realizedPnlUsd - feesUsd;

    return {
      profile: this.profile,
      generatedAt: Date.now(),
      windowDays: days,
      startTime,
      endTime,
      totals: {
        realizedPnlUsd,
        feesUsd,
        netPnlUsd,
      },
      ddt: {
        filledEntries: ddtFilledEntries,
        momentumEntries: momentumEntries,
        scalpingEntries: scalpingEntries,
        protectionOrders: ddtProtectionOrders,
      },
      daily,
      recentOrders: orders
        .filter((order) => String(order.clientOrderId ?? "").startsWith("DDT-"))
        .sort((a, b) => Number(b.time ?? b.updateTime ?? 0) - Number(a.time ?? a.updateTime ?? 0))
        .slice(0, 50)
        .map((order) => ({
          time: Number(order.time ?? order.updateTime ?? 0),
          symbol: String(order.symbol ?? ""),
          engine: String(order.clientOrderId ?? "").includes("MOM-") ? "MOMENTUM"
            : String(order.clientOrderId ?? "").includes("SCALP-") ? "SCALPING" : "DDT",
          type: String(order.type ?? ""),
          side: String(order.side ?? ""),
          status: String(order.status ?? ""),
          clientOrderId: String(order.clientOrderId ?? ""),
        })),
      coverage: {
        incomeRows: income.length,
        orderRows: orders.length,
        orderRowsLimit: 1000,
        truncated: orders.length >= 5000,
        note: "Fees and realized P&L are account-level Binance income data; they may include activity outside DealDost. Engine counts use DDT client order IDs. Individual exchange trade P&L attribution is not inferred unless supported by Binance income/order data.",
      },
    };
  }

  async setOneXLeverage(symbol: string) {
    if (!this.isExecutionEnabled()) throw new Error(this.profile + "_EXECUTION_DISABLED");
    await this.signedPost<any>("/fapi/v1/leverage", {
      symbol: symbol.toUpperCase(),
      leverage: "1",
    });
  }

  async buildMarketOrderPlan(input: {
    symbol: string;
    side: Side;
    quantity: number;
    stopPrice?: number;
    takeProfitPrice?: number;
  }): Promise<TestnetOrderPlan> {
    const symbol = input.symbol.toUpperCase();
    if (!/^[A-Z0-9]+USDT$/.test(symbol)) {
      throw new Error(this.profile + " symbol must be a USDT-M symbol: " + symbol);
    }

    const rules = await this.getSymbolRules(symbol);
    if (rules.status !== "TRADING" || rules.quoteAsset !== "USDT" || rules.contractType !== "PERPETUAL") {
      throw new Error(this.profile + " symbol is not an active USDT perpetual: " + symbol);
    }

    const lot = (rules.filters ?? []).find((f) => f.filterType === "MARKET_LOT_SIZE")
      ?? (rules.filters ?? []).find((f) => f.filterType === "LOT_SIZE");
    const minQty = Number(lot?.minQty ?? 0);
    const maxQty = Number(lot?.maxQty ?? Number.POSITIVE_INFINITY);
    const stepSize = Number(lot?.stepSize ?? 0);

    if (!Number.isFinite(minQty) || !Number.isFinite(stepSize) || stepSize <= 0) {
      throw new Error("Missing " + this.profile + " quantity filters for " + symbol);
    }

    const mark = await this.publicGet<{ markPrice?: string }>(
      "/fapi/v1/premiumIndex?symbol=" + encodeURIComponent(symbol),
    );
    const markPrice = Number(mark.markPrice ?? 0);
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      throw new Error("Unable to read TESTNET mark price for " + symbol);
    }

    if (input.stopPrice !== undefined && input.takeProfitPrice !== undefined) {
      if (input.side === "LONG" && !(input.stopPrice < markPrice && input.takeProfitPrice > markPrice)) {
        throw new Error("TESTNET LONG protection prices are not on the correct side of market");
      }
      if (input.side === "SHORT" && !(input.stopPrice > markPrice && input.takeProfitPrice < markPrice)) {
        throw new Error("TESTNET SHORT protection prices are not on the correct side of market");
      }
    }

    const quantity = this.floorToStep(input.quantity, stepSize);
    if (quantity < minQty || quantity <= 0) {
      throw new Error(this.profile + " quantity below minimum for " + symbol + ": " + quantity);
    }
    if (quantity > maxQty) {
      throw new Error(this.profile + " quantity above maximum for " + symbol + ": " + quantity);
    }

    const minNotional = Number(
      (rules.filters ?? []).find((f) => f.filterType === "MIN_NOTIONAL")?.notional ?? 0,
    );
    const notional = quantity * markPrice;
    if (minNotional > 0 && notional < minNotional) {
      throw new Error(
        this.profile + " order notional below minimum for " +
          symbol +
          ": " +
          notional.toFixed(4) +
          " < " +
          minNotional,
      );
    }

    return {
      symbol,
      side: input.side,
      quantity,
      entryOrderSide: input.side === "LONG" ? "BUY" : "SELL",
      closeOrderSide: input.side === "LONG" ? "SELL" : "BUY",
      stopPrice: input.stopPrice,
      takeProfitPrice: input.takeProfitPrice,
      minQty,
      stepSize,
      minNotional,
    };
  }

  async placeMarketOrder(input: {
    symbol: string;
    side: Side;
    quantity: number;
    stopPrice?: number;
    takeProfitPrice?: number;
    clientOrderId?: string;
  }): Promise<TestnetOrderResult> {
    if (!this.isExecutionEnabled()) {
      throw new Error(
        this.isConfigured()
          ? this.profile + "_EXECUTION_DISABLED"
          : this.profile + "_NOT_CONFIGURED",
      );
    }

    const plan = await this.buildMarketOrderPlan(input);
    await this.setOneXLeverage(plan.symbol);

    const clientOrderId = this.safeClientOrderId(
      input.clientOrderId ?? "DDT-" + Date.now().toString(36),
    );

    const order = await this.signedPost<any>("/fapi/v1/order", {
      symbol: plan.symbol,
      side: plan.entryOrderSide,
      type: "MARKET",
      quantity: this.formatNumber(plan.quantity),
      newOrderRespType: "RESULT",
      newClientOrderId: clientOrderId,
    });

    let executedQty = Number(order.executedQty ?? order.cumQty ?? 0);
    let avgPrice = Number(
      order.avgPrice ??
        (Number(order.cummulativeQuoteQty ?? 0) > 0 && executedQty > 0
          ? Number(order.cummulativeQuoteQty) / executedQty
          : 0),
    );

    // Some Demo responses can omit final fill fields even when the order was
    // accepted. Reconcile the order by ID before declaring the execution
    // failed; Binance documents RESULT MARKET orders as final FILLED responses
    // when the order completes. citeturn942765search3
    if ((!executedQty || !avgPrice) && order.orderId !== undefined) {
      for (let attempt = 0; attempt < 3 && (!executedQty || !avgPrice); attempt += 1) {
        const reconciled = await this.signedGet<any>(
          "/fapi/v1/order?symbol=" + encodeURIComponent(plan.symbol) +
          "&orderId=" + encodeURIComponent(String(order.orderId)),
        );
        executedQty = Number(reconciled.executedQty ?? reconciled.cumQty ?? 0);
        avgPrice = Number(
          reconciled.avgPrice ??
            (Number(reconciled.cummulativeQuoteQty ?? 0) > 0 && executedQty > 0
              ? Number(reconciled.cummulativeQuoteQty) / executedQty
              : 0),
        );
        if (executedQty && avgPrice) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (!executedQty || !avgPrice) {
      const status = String(order.status ?? "UNKNOWN");
      throw new Error(
        this.profile + " market entry not filled: status=" + status +
        " orderId=" + String(order.orderId ?? "—"),
      );
    }

    let stopOrderId: string | undefined;

    try {
      if (plan.stopPrice !== undefined && plan.stopPrice > 0) {
        const stop = await this.placeCloseProtection(
          plan.symbol,
          plan.closeOrderSide,
          "STOP_MARKET",
          plan.stopPrice,
          clientOrderId + "-SL",
        );
        stopOrderId = String(stop.orderId);
      }
    } catch (error) {
      try {
        await this.signedPost<any>("/fapi/v1/order", {
          symbol: plan.symbol,
          side: plan.closeOrderSide,
          type: "MARKET",
          quantity: this.formatNumber(executedQty),
          reduceOnly: "true",
          newOrderRespType: "RESULT",
        });
      } catch (closeError) {
        throw new Error(
          this.profile + " protection failed and emergency close also failed: " +
            (error instanceof Error ? error.message : String(error)) +
            " | close: " +
            (closeError instanceof Error ? closeError.message : String(closeError)),
        );
      }
      throw new Error(
        this.profile + " protection failed; entry was emergency-closed: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }

    return {
      orderId: String(order.orderId),
      clientOrderId,
      symbol: plan.symbol,
      side: plan.entryOrderSide,
      status: String(order.status ?? "UNKNOWN"),
      executedQty,
      avgPrice,
      stopOrderId,
      takeProfitOrderId: undefined,
    };
  }

  async ensureOpenPositionProtection(input: {
    symbol: string;
    side: Side;
    quantity: number;
    stopPrice: number;
    takeProfitPrice: number;
  }) {
    if (!this.isExecutionEnabled()) throw new Error(this.profile + "_EXECUTION_DISABLED");
    const symbol = input.symbol.toUpperCase();

    await this.buildMarketOrderPlan({
      symbol,
      side: input.side,
      quantity: input.quantity,
      stopPrice: input.stopPrice,
      takeProfitPrice: input.takeProfitPrice,
    });

    const openOrders = await this.getOpenOrders(symbol);
    if (this.getProtectionStatus(openOrders) === "OK") {
      return { changed: false, protection: "OK" as const };
    }

    const closeSide: "BUY" | "SELL" = input.side === "LONG" ? "SELL" : "BUY";
    const hasStop = openOrders.some(
      (o) =>
        o.status === "NEW" &&
        (o.closePosition === true || String(o.closePosition).toLowerCase() === "true") &&
        o.type === "STOP_MARKET" &&
        String(o.clientOrderId ?? "").startsWith("DDT-"),
    );
    const baseId = "DDT-SAFETY-" + symbol;
    if (!hasStop) {
      await this.placeCloseProtection(
        symbol,
        closeSide,
        "STOP_MARKET",
        input.stopPrice,
        baseId + "-SL",
      );
    }

    const verified = await this.getOpenOrders(symbol);
    if (this.getProtectionStatus(verified) !== "OK") {
      throw new Error(this.profile + " protection verification failed");
    }

    return { changed: true, protection: "OK" as const };
  }

  async closeManagedPosition(symbolInput: string, reason: "TP1" | "MANUAL" = "MANUAL") {
    if (!this.isExecutionEnabled()) throw new Error(this.profile + "_EXECUTION_DISABLED");
    const symbol = symbolInput.toUpperCase();

    const snapshot = await this.getExecutionSnapshot();
    const position = snapshot.positions.find((p) => p.symbol === symbol);
    if (!position) throw new Error("TESTNET_POSITION_NOT_FOUND");
    if (!position.engine) throw new Error("TESTNET_EXTERNAL_POSITION_CLOSE_BLOCKED");

    // Keep protective orders live until the market close is confirmed.
    // If the close request is rejected, the existing SL/TP remains active.
    const plan = await this.buildMarketOrderPlan({
      symbol,
      side: position.side,
      quantity: position.quantity,
    });

    const order = await this.signedPost<any>("/fapi/v1/order", {
      symbol: plan.symbol,
      side: plan.closeOrderSide,
      type: "MARKET",
      quantity: this.formatNumber(plan.quantity),
      reduceOnly: "true",
      positionSide: "BOTH",
      newClientOrderId: this.safeClientOrderId(
        (reason === "TP1" ? "DDT-TP-" : "DDT-MAN-") +
          (position.engine === "MOMENTUM" ? "MOM-" : "SCALP-") +
          symbol + "-" + Date.now().toString(36),
      ),
      newOrderRespType: "RESULT",
    });

    let executedQty = Number(order.executedQty ?? order.cumQty ?? 0);
    let avgPrice = Number(
      order.avgPrice ??
        (Number(order.cummulativeQuoteQty ?? 0) > 0 && executedQty > 0
          ? Number(order.cummulativeQuoteQty) / executedQty
          : 0),
    );

    if ((!executedQty || !avgPrice) && order.orderId !== undefined) {
      for (let attempt = 0; attempt < 3 && (!executedQty || !avgPrice); attempt += 1) {
        const reconciled = await this.signedGet<any>(
          "/fapi/v1/order?symbol=" + encodeURIComponent(plan.symbol) +
          "&orderId=" + encodeURIComponent(String(order.orderId)),
        );
        executedQty = Number(reconciled.executedQty ?? reconciled.cumQty ?? 0);
        avgPrice = Number(
          reconciled.avgPrice ??
            (Number(reconciled.cummulativeQuoteQty ?? 0) > 0 && executedQty > 0
              ? Number(reconciled.cummulativeQuoteQty) / executedQty
              : 0),
        );
        if (executedQty && avgPrice) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (!executedQty || !avgPrice) {
      throw new Error(
        this.profile + " manual close not filled: status=" + String(order.status ?? "UNKNOWN") +
        " orderId=" + String(order.orderId ?? "—"),
      );
    }

    // The position is now confirmed closed. Remove only DealDost-owned
    // protections; cleanup errors do not reopen exposure and will be retried
    // by normal TESTNET reconciliation.
    try {
      // DDT STOP/TP protections are Algo orders after Binance's 2026
      // USDⓈ-M conditional-order migration. Clean up only that authoritative
      // protection store after the close is confirmed.
      const algoOrders = await this.signedGet<AlgoOrderRow[]>(
        "/fapi/v1/openAlgoOrders?symbol=" + encodeURIComponent(symbol),
      );

      for (const protection of algoOrders) {
        const clientId = String(protection.clientAlgoId ?? "");
        if (
          protection.algoStatus === "NEW" &&
          protection.closePosition === true &&
          (protection.orderType === "STOP_MARKET" || protection.orderType === "TAKE_PROFIT_MARKET") &&
          clientId.startsWith("DDT-") &&
          (protection.algoId !== undefined || protection.clientAlgoId)
        ) {
          await this.signedDelete<any>("/fapi/v1/algoOrder", {
            symbol,
            algoId: protection.algoId === undefined ? "" : String(protection.algoId),
            clientAlgoId: protection.algoId === undefined ? clientId : "",
          });
        }
      }
    } catch (error) {
      console.warn(
        "[testnet manual close cleanup]",
        symbol,
        error instanceof Error ? error.message : String(error),
      );
    }

    return {
      symbol,
      side: position.side,
      engine: position.engine,
      executedQty,
      avgPrice,
      orderId: String(order.orderId ?? ""),
      snapshot: await this.getExecutionSnapshot(),
    };
  }

  private detectEngine(orders: OrderRow[]): Engine | null {
    const entry = [...orders]
      .filter((o) => o.status === "FILLED" && !o.reduceOnly && !o.closePosition && o.type === "MARKET")
      .sort((a, b) => Number(b.time ?? b.updateTime ?? 0) - Number(a.time ?? a.updateTime ?? 0))[0];
    const id = String(entry?.clientOrderId ?? "");
    if (id.startsWith("DDT-MOM-")) return "MOMENTUM";
    if (id.startsWith("DDT-SCALP-")) return "SCALPING";
    return null;
  }

  private detectLastClosedAt(orders: OrderRow[]) {
    return orders
      .filter((o) => o.status === "FILLED" && (o.reduceOnly || o.closePosition))
      .map((o) => Number(o.time ?? o.updateTime ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => b - a)[0] ?? 0;
  }

  private getProtectionStatus(openOrders: OrderRow[]): "OK" | "PARTIAL" | "MISSING" {
    const protections = openOrders.filter(
      (o) =>
        o.status === "NEW" &&
        (o.closePosition === true || String(o.closePosition).toLowerCase() === "true") &&
        o.type === "STOP_MARKET" &&
        String(o.clientOrderId ?? "").startsWith("DDT-"),
    );
    return protections.length > 0 ? "OK" : "MISSING";
  }

  private getExistingTakeProfitPrice(openOrders: OrderRow[]): number | null {
    const tp = openOrders
      .filter(
        (o) =>
          o.status === "NEW" &&
          (o.closePosition === true || String(o.closePosition).toLowerCase() === "true") &&
          o.type === "TAKE_PROFIT_MARKET" &&
          String(o.clientOrderId ?? "").startsWith("DDT-"),
      )
      .sort((a, b) => Number(b.time ?? b.updateTime ?? 0) - Number(a.time ?? a.updateTime ?? 0))[0];
    const value = Number(tp?.stopPrice ?? 0);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private getIstDateKey(timestamp = Date.now()) {
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    return new Date(timestamp + istOffsetMs).toISOString().slice(0, 10);
  }

  private getIstDayStartMsForAnalytics(timestamp: number) {
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const shifted = new Date(timestamp + istOffsetMs);
    shifted.setUTCHours(0, 0, 0, 0);
    return shifted.getTime() - istOffsetMs;
  }

  private async getAccountOrdersForAnalytics(startTime: number): Promise<OrderRow[]> {
    const orders: OrderRow[] = [];
    let cursor = startTime;

    // Binance currently caps one allOrders response at 1000 rows. Paginate
    // modestly by the last orderId so analytics does not hammer the API.
    for (let page = 0; page < 5; page += 1) {
      const suffix = page === 0
        ? "&startTime=" + cursor
        : "&orderId=" + encodeURIComponent(String(Math.max(1, cursor))) +
          "&startTime=" + startTime;
      const batch = await this.signedGet<OrderRow[]>(
        "/fapi/v1/allOrders?limit=1000" + suffix,
      );
      if (!batch.length) break;
      orders.push(...batch);

      if (batch.length < 1000) break;
      const lastId = Number(batch.at(-1)?.orderId ?? 0);
      if (!Number.isFinite(lastId) || lastId <= 0) break;
      cursor = lastId + 1;
    }

    return orders;
  }

  private incomePath(type: "REALIZED_PNL" | "COMMISSION", startTime?: number) {
    const effectiveStart = Number.isFinite(Number(startTime))
      ? Number(startTime)
      : this.getIstDayStartMsForAnalytics(Date.now());
    return "/fapi/v1/income?incomeType=" + type + "&startTime=" + effectiveStart + "&limit=1000";
  }

  private async getServerTimeOffset(_forceRefresh = false): Promise<number> {
    // Do not make /fapi/v1/time a prerequisite for account reconciliation.
    // The signed endpoints already validate timestamp freshness and the
    // serverless/persistent clocks are expected to be NTP-synchronized.
    return this.serverTimeOffsetMs;
  }

  private async getAccountRead(): Promise<{
    balances: BalanceRow[];
    positions: PositionRow[];
  }> {
    const now = Date.now();
    if (this.accountReadCache && now - this.accountReadCache.at < this.accountReadCacheMs) {
      return {
        balances: this.accountReadCache.balances,
        positions: this.accountReadCache.positions,
      };
    }

    if (this.accountReadInFlight) return this.accountReadInFlight;

    this.accountReadInFlight = Promise.all([
      this.signedGet<BalanceRow[]>("/fapi/v3/balance"),
      this.getPositionRisk(),
    ])
      .then(([balances, positions]) => {
        this.accountReadCache = {
          at: Date.now(),
          balances,
          positions,
        };
        return { balances, positions };
      })
      .catch((error) => {
        // A transient account-read failure must not erase the last known
        // exchange state. Reconciliation callers can continue using the most
        // recent authoritative snapshot until Binance recovers.
        if (this.accountReadCache) {
          console.warn(
            "[testnet account read stale fallback]",
            error instanceof Error ? error.message : String(error),
          );
          return {
            balances: this.accountReadCache.balances,
            positions: this.accountReadCache.positions,
          };
        }
        throw error;
      })
      .finally(() => {
        this.accountReadInFlight = undefined;
      });

    return this.accountReadInFlight;
  }

  private async getPositionRisk(): Promise<PositionRow[]> {
    try {
      return await this.signedGet<PositionRow[]>("/fapi/v3/positionRisk");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("/fapi/v3/positionRisk")) throw error;

      // Keep v3 as the primary endpoint. If Demo v3 is temporarily slow,
      // fall back to the proven v2 position-risk response so one flaky
      // endpoint does not block account reconciliation.
      console.warn("[testnet positionRisk v3 fallback]", message);
      return await this.signedGet<PositionRow[]>("/fapi/v2/positionRisk");
    }
  }

  private async getRecentOrders(symbol: string): Promise<OrderRow[]> {
    return this.signedGet<OrderRow[]>(
      "/fapi/v1/allOrders?symbol=" + encodeURIComponent(symbol) + "&limit=50",
    );
  }

  private async getOpenOrders(symbol: string): Promise<OrderRow[]> {
    // Since the 2026 USDⓈ-M conditional-order migration, DealDost protection
    // orders are created through the Algo service. Do not hit the legacy
    // /fapi/v1/openOrders endpoint for protection reconciliation: it is not
    // needed for DDT-managed STOP/TP and was the source of repeated TESTNET
    // symbol-scoped timeouts.
    const algoOrders = await this.signedGet<AlgoOrderRow[]>(
      "/fapi/v1/openAlgoOrders?symbol=" + encodeURIComponent(symbol),
    );

    return algoOrders.map((order) => ({
      symbol: order.symbol,
      side: order.side,
      type: order.orderType,
      status: order.algoStatus,
      clientOrderId: order.clientAlgoId,
      closePosition: order.closePosition,
      orderId: order.algoId,
      stopPrice: order.triggerPrice,
      time: order.createTime,
      updateTime: order.updateTime,
    }));
  }

  private async cleanupStaleProtectionOrders(openSymbols: Set<string>) {
    const [normalOrders, algoOrders] = await Promise.all([
      this.signedGet<OrderRow[]>("/fapi/v1/openOrders"),
      this.signedGet<AlgoOrderRow[]>("/fapi/v1/openAlgoOrders"),
    ]);

    const staleNormal = normalOrders.filter((order) => {
      const symbol = String(order.symbol ?? "").toUpperCase();
      const clientId = String(order.clientOrderId ?? "");
      return (
        symbol &&
        !openSymbols.has(symbol) &&
        order.status === "NEW" &&
        (order.closePosition === true || String(order.closePosition).toLowerCase() === "true") &&
        (order.type === "STOP_MARKET" || order.type === "TAKE_PROFIT_MARKET") &&
        clientId.startsWith("DDT-")
      );
    });

    for (const order of staleNormal) {
      if (order.orderId === undefined && !order.clientOrderId) continue;
      try {
        await this.signedDelete<any>("/fapi/v1/order", {
          symbol: String(order.symbol ?? "").toUpperCase(),
          orderId: order.orderId === undefined ? "" : String(order.orderId),
          origClientOrderId: order.orderId === undefined ? String(order.clientOrderId) : "",
        });
        console.info("[testnet cleanup]", order.symbol, order.clientOrderId);
      } catch (error) {
        console.error("[testnet cleanup]", order.symbol, error);
      }
    }

    const staleAlgo = algoOrders.filter((order) => {
      const symbol = String(order.symbol ?? "").toUpperCase();
      const clientId = String(order.clientAlgoId ?? "");
      return (
        symbol &&
        !openSymbols.has(symbol) &&
        order.algoStatus === "NEW" &&
        order.closePosition === true &&
        (order.orderType === "STOP_MARKET" || order.orderType === "TAKE_PROFIT_MARKET") &&
        clientId.startsWith("DDT-")
      );
    });

    for (const order of staleAlgo) {
      if (order.algoId === undefined && !order.clientAlgoId) continue;
      try {
        await this.signedDelete<any>("/fapi/v1/algoOrder", {
          symbol: String(order.symbol ?? "").toUpperCase(),
          algoId: order.algoId === undefined ? "" : String(order.algoId),
          clientAlgoId: order.algoId === undefined ? String(order.clientAlgoId) : "",
        });
        console.info("[testnet algo cleanup]", order.symbol, order.clientAlgoId);
      } catch (error) {
        console.error("[testnet algo cleanup]", order.symbol, error);
      }
    }
  }

  private async placeCloseProtection(
    symbol: string,
    side: "BUY" | "SELL",
    type: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
    stopPrice: number,
    clientOrderId: string,
  ) {
    const rules = await this.getSymbolRules(symbol);
    const priceFilter = (rules.filters ?? []).find((f) => f.filterType === "PRICE_FILTER");
    const tickSize = Number(priceFilter?.tickSize ?? 0);
    const isLong = side === "SELL";
    const normalizedPrice = tickSize > 0
      ? type === "STOP_MARKET"
        ? (isLong ? this.floorToStep(stopPrice, tickSize) : this.ceilToStep(stopPrice, tickSize))
        : (isLong ? this.ceilToStep(stopPrice, tickSize) : this.floorToStep(stopPrice, tickSize))
      : stopPrice;

    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      throw new Error("Invalid protection price for " + symbol);
    }

    // Binance USDⓈ-M conditional orders use the Algo service.
    return this.signedPost<any>("/fapi/v1/algoOrder", {
      algoType: "CONDITIONAL",
      symbol,
      side,
      type,
      triggerPrice: this.formatNumber(normalizedPrice),
      closePosition: "true",
      positionSide: "BOTH",
      workingType: "MARK_PRICE",
      priceProtect: "true",
      clientAlgoId: this.safeAlgoClientId(clientOrderId),
      newOrderRespType: "RESULT",
    });
  }

  async preflight() {
    if (!this.isConfigured()) {
      return {
        connected: false,
        executionEnabled: false,
        tradePermission: false,
        symbol: "BTCUSDT",
        quantity: 0,
        balanceUsd: 0,
        openPositions: 0,
        ok: false,
        reason: this.profile + "_NOT_CONFIGURED",
      };
    }

    try {
      const [balances, positions] = await Promise.all([
        this.signedGet<BalanceRow[]>("/fapi/v3/balance"),
        this.signedGet<PositionRow[]>("/fapi/v3/positionRisk"),
      ]);

      const usdt = balances.find((row) => row.asset === "USDT");
      const openPositions = positions.filter((row) => Math.abs(Number(row.positionAmt ?? 0)) > 0).length;
      const symbol = "BTCUSDT";
      const rules = await this.getSymbolRules(symbol);
      if (rules.status !== "TRADING" || rules.quoteAsset !== "USDT" || rules.contractType !== "PERPETUAL") {
        return {
          connected: true,
          executionEnabled: this.isExecutionEnabled(),
          tradePermission: false,
          symbol,
          quantity: 0,
          balanceUsd: Number(usdt?.balance ?? 0),
          openPositions,
          ok: false,
          reason: "SYMBOL_NOT_TRADABLE",
        };
      }

      const mark = await this.publicGet<{ markPrice?: string }>(
        "/fapi/v1/premiumIndex?symbol=" + encodeURIComponent(symbol),
      );
      const markPrice = Number(mark.markPrice ?? 0);
      const lot = (rules.filters ?? []).find((f) => f.filterType === "MARKET_LOT_SIZE")
        ?? (rules.filters ?? []).find((f) => f.filterType === "LOT_SIZE");
      const priceFilter = (rules.filters ?? []).find((f) => f.filterType === "PRICE_FILTER");
      const minQty = Number(lot?.minQty ?? 0);
      const maxQty = Number(lot?.maxQty ?? Number.POSITIVE_INFINITY);
      const stepSize = Number(lot?.stepSize ?? 0);
      const minNotional = Number(
        (rules.filters ?? []).find((f) => f.filterType === "MIN_NOTIONAL")?.notional ?? 0,
      );

      if (!(markPrice > 0) || !(minQty > 0) || !(stepSize > 0)) {
        return {
          connected: true,
          executionEnabled: this.isExecutionEnabled(),
          tradePermission: false,
          symbol,
          quantity: 0,
          balanceUsd: Number(usdt?.balance ?? 0),
          openPositions,
          ok: false,
          reason: "SYMBOL_FILTERS_UNAVAILABLE",
        };
      }

      const minimumByNotional = minNotional > 0 ? (minNotional / markPrice) * 1.01 : 0;
      const rawQuantity = Math.max(minQty, minimumByNotional);
      const quantity = this.ceilToStep(rawQuantity, stepSize);

      if (!(quantity > 0) || quantity > maxQty) {
        return {
          connected: true,
          executionEnabled: this.isExecutionEnabled(),
          tradePermission: false,
          symbol,
          quantity,
          balanceUsd: Number(usdt?.balance ?? 0),
          openPositions,
          ok: false,
          reason: "TEST_QUANTITY_INVALID",
        };
      }

      // Binance's order-test endpoint validates the signed trade request
      // without creating a real order or position. This is the safest way to
      // verify that the Demo key can reach the trading endpoint before AUTO is
      // armed.
      await this.signedPost<any>("/fapi/v1/order/test", {
        symbol,
        side: "BUY",
        type: "MARKET",
        quantity: this.formatNumber(quantity),
        positionSide: "BOTH",
      });

      return {
        connected: true,
        executionEnabled: this.isExecutionEnabled(),
        tradePermission: true,
        symbol,
        quantity,
        balanceUsd: Number(usdt?.balance ?? 0),
        openPositions,
        markPrice,
        tickSize: Number(priceFilter?.tickSize ?? 0),
        ok: true,
        reason: "ORDER_TEST_PASSED",
      };
    } catch (error) {
      return {
        connected: false,
        executionEnabled: this.isExecutionEnabled(),
        tradePermission: false,
        symbol: "BTCUSDT",
        quantity: 0,
        balanceUsd: 0,
        openPositions: 0,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async isTradablePerpetual(symbol: string) {
    try {
      const row = await this.getSymbolRules(symbol.toUpperCase());
      return row.status === "TRADING" && row.quoteAsset === "USDT" && row.contractType === "PERPETUAL";
    } catch {
      return false;
    }
  }

  private async getSymbolRules(symbol: string): Promise<ExchangeSymbol> {
    const now = Date.now();
    if (!this.exchangeInfo || now - this.exchangeInfoAt > 5 * 60_000) {
      this.exchangeInfo = await this.publicGet<ExchangeInfo>("/fapi/v1/exchangeInfo");
      this.exchangeInfoAt = now;
    }

    const row = this.exchangeInfo.symbols?.find((item) => item.symbol === symbol);
    if (!row) {
      throw new Error(this.profile + " symbol not found in exchange info: " + symbol);
    }
    return row;
  }

  private floorToStep(value: number, step: number) {
    const precision = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
    const units = Math.floor(value / step + 1e-12);
    return Number((units * step).toFixed(precision));
  }

  private ceilToStep(value: number, step: number) {
    const precision = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
    const units = Math.ceil(value / step - 1e-12);
    return Number((units * step).toFixed(precision));
  }

  private formatNumber(value: number) {
    return Number(value.toFixed(12)).toString();
  }

  private safeClientOrderId(value: string) {
    const cleaned = String(value).replace(/[^A-Za-z0-9_-]/g, "");
    return cleaned.slice(0, 36) || "DDT-" + Date.now().toString(36);
  }

  private safeAlgoClientId(value: string) {
    const cleaned = String(value).replace(/[^A-Za-z0-9_-]/g, "");
    return cleaned.slice(0, 32) || "DDT-ALGO-" + Date.now().toString(36);
  }

  private async publicGet<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        signal: AbortSignal.timeout(7000),
        headers: {
          "Accept": "application/json",
          "User-Agent": "DealDost/2.4",
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error("Binance " + this.profile + " public timeout: " + path);
      }
      throw new Error("Binance " + this.profile + " public request failed: " + path + " • " +
        (error instanceof Error ? error.message : String(error)));
    }
    const body = await response.text();
    if (!response.ok) {
      throw new Error("Binance " + this.profile + " public " + response.status + ": " + body.slice(0, 300));
    }
    return JSON.parse(body) as T;
  }

  private async signedGet<T>(path: string): Promise<T> {
    const [pathname, rawQuery = ""] = path.split("?");
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {

      const params = new URLSearchParams(rawQuery);
      params.set("recvWindow", "60000");
      params.set("timestamp", String(Date.now() + this.serverTimeOffsetMs));
      const signature = createHmac("sha256", this.apiSecret)
        .update(params.toString())
        .digest("hex");
      params.set("signature", signature);

      try {
        const response = await fetch(this.baseUrl + pathname + "?" + params.toString(), {
          signal: AbortSignal.timeout(7000),
          headers: {
            "X-MBX-APIKEY": this.apiKey,
            "User-Agent": "DealDost/2.4",
          },
        });

        const body = await response.text();
        if (!response.ok) {
          const error = new Error(
            "Binance " + this.profile + " " + response.status + ": " + body.slice(0, 300),
          );
          if (body.includes('"code":-1021') && attempt === 0) {
            lastError = error;
            continue;
          }
          throw error;
        }

        return JSON.parse(body) as T;
      } catch (error) {
        lastError = error;
        const timedOut = error instanceof DOMException && error.name === "TimeoutError";
        const timestampRejected = error instanceof Error && error.message.includes('"code":-1021');
        if ((timedOut || timestampRejected) && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        break;
      }
    }

    if (lastError instanceof DOMException && lastError.name === "TimeoutError") {
      throw new Error("Binance " + this.profile + " signed timeout: " + pathname + " • retried once");
    }
    throw new Error("Binance " + this.profile + " signed request failed: " + pathname + " • " +
      (lastError instanceof Error ? lastError.message : String(lastError)));
  }
  private async signedDelete<T>(path: string, payload: Record<string, string>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const params = new URLSearchParams(
        Object.fromEntries(Object.entries(payload).filter(([, value]) => value)),
      );
      params.set("recvWindow", "60000");
      params.set("timestamp", String(Date.now() + this.serverTimeOffsetMs));

      const signature = createHmac("sha256", this.apiSecret)
        .update(params.toString())
        .digest("hex");
      params.set("signature", signature);

      try {
        const response = await fetch(this.baseUrl + path + "?" + params.toString(), {
          method: "DELETE",
          signal: AbortSignal.timeout(10_000),
          headers: {
            "X-MBX-APIKEY": this.apiKey,
            "User-Agent": "DealDost/2.4",
          },
        });

        const body = await response.text();
        if (!response.ok) {
          const error = new Error("Binance " + this.profile + " " + response.status + ": " + body.slice(0, 300));
          if (body.includes('"code":-1021') && attempt === 0) {
            lastError = error;
            continue;
          }
          throw error;
        }
        return JSON.parse(body) as T;
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.message.includes('"code":-1021') && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        break;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Binance " + this.profile + " signed DELETE failed: " + path);
  }
  private async signedPost<T>(path: string, payload: Record<string, string>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const params = new URLSearchParams(payload);
      params.set("recvWindow", "60000");
      params.set("timestamp", String(Date.now() + this.serverTimeOffsetMs));

      const signature = createHmac("sha256", this.apiSecret)
        .update(params.toString())
        .digest("hex");
      params.set("signature", signature);

      try {
        const response = await fetch(this.baseUrl + path + "?" + params.toString(), {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            "X-MBX-APIKEY": this.apiKey,
            "User-Agent": "DealDost/2.4",
          },
        });

        const body = await response.text();
        if (!response.ok) {
          const error = new Error("Binance " + this.profile + " " + response.status + ": " + body.slice(0, 300));
          if (body.includes('"code":-1021') && attempt === 0) {
            lastError = error;
            continue;
          }
          throw error;
        }

        return JSON.parse(body) as T;
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.message.includes('"code":-1021') && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        break;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Binance " + this.profile + " signed POST failed: " + path);
  }
}
