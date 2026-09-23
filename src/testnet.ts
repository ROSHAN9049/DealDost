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
  lastClosedAt: Record<string, number>;
}

export class TestnetClient {
  private readonly baseUrl = config.testnetRestBase;
  private exchangeInfo?: ExchangeInfo;
  private exchangeInfoAt = 0;

  isConfigured() {
    return Boolean(config.testnetApiKey && config.testnetApiSecret);
  }

  isExecutionEnabled() {
    return this.isConfigured() && config.testnetExecutionEnabled;
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
      dailyRiskUsedPct: 0,
      realizedPnlTodayUsd: 0,
      feesTodayUsd: 0,
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

    const [balances, positions] = await Promise.all([
      this.signedGet<BalanceRow[]>("/fapi/v3/balance"),
      this.signedGet<PositionRow[]>("/fapi/v3/positionRisk"),
    ]);

    if (this.isExecutionEnabled()) {
      await this.cleanupStaleProtectionOrders(
        new Set(
          positions
            .filter((row) => Math.abs(Number(row.positionAmt ?? 0)) > 0)
            .map((row) => String(row.symbol ?? "").toUpperCase()),
        ),
      );
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
        lastClosedAt: {},
      };
    }

    const [balances, positions, income, commission] = await Promise.all([
      this.signedGet<BalanceRow[]>("/fapi/v3/balance"),
      this.signedGet<PositionRow[]>("/fapi/v3/positionRisk"),
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
      lastClosedAt,
    };
  }

  async setOneXLeverage(symbol: string) {
    if (!this.isExecutionEnabled()) throw new Error("TESTNET_EXECUTION_DISABLED");
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
      throw new Error("TESTNET symbol must be a USDT-M symbol: " + symbol);
    }

    const rules = await this.getSymbolRules(symbol);
    if (rules.status !== "TRADING" || rules.quoteAsset !== "USDT" || rules.contractType !== "PERPETUAL") {
      throw new Error("TESTNET symbol is not an active USDT perpetual: " + symbol);
    }

    const lot = (rules.filters ?? []).find((f) => f.filterType === "MARKET_LOT_SIZE")
      ?? (rules.filters ?? []).find((f) => f.filterType === "LOT_SIZE");
    const minQty = Number(lot?.minQty ?? 0);
    const maxQty = Number(lot?.maxQty ?? Number.POSITIVE_INFINITY);
    const stepSize = Number(lot?.stepSize ?? 0);

    if (!Number.isFinite(minQty) || !Number.isFinite(stepSize) || stepSize <= 0) {
      throw new Error("Missing TESTNET quantity filters for " + symbol);
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
      throw new Error("TESTNET quantity below minimum for " + symbol + ": " + quantity);
    }
    if (quantity > maxQty) {
      throw new Error("TESTNET quantity above maximum for " + symbol + ": " + quantity);
    }

    const minNotional = Number(
      (rules.filters ?? []).find((f) => f.filterType === "MIN_NOTIONAL")?.notional ?? 0,
    );
    const notional = quantity * markPrice;
    if (minNotional > 0 && notional < minNotional) {
      throw new Error(
        "TESTNET order notional below minimum for " +
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
          ? "TESTNET_EXECUTION_DISABLED"
          : "TESTNET_NOT_CONFIGURED",
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

    const executedQty = Number(order.executedQty ?? order.origQty ?? 0);
    const avgPrice = Number(
      order.avgPrice ??
        (Number(order.cummulativeQuoteQty ?? 0) > 0 && executedQty > 0
          ? Number(order.cummulativeQuoteQty) / executedQty
          : 0),
    );

    if (!executedQty || !avgPrice) {
      throw new Error("TESTNET market entry returned no executable fill");
    }

    let stopOrderId: string | undefined;
    let takeProfitOrderId: string | undefined;

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

      if (plan.takeProfitPrice !== undefined && plan.takeProfitPrice > 0) {
        const takeProfit = await this.placeCloseProtection(
          plan.symbol,
          plan.closeOrderSide,
          "TAKE_PROFIT_MARKET",
          plan.takeProfitPrice,
          clientOrderId + "-TP",
        );
        takeProfitOrderId = String(takeProfit.orderId);
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
          "TESTNET protection failed and emergency close also failed: " +
            (error instanceof Error ? error.message : String(error)) +
            " | close: " +
            (closeError instanceof Error ? closeError.message : String(closeError)),
        );
      }
      throw new Error(
        "TESTNET protection failed; entry was emergency-closed: " +
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
      takeProfitOrderId,
    };
  }

  async ensureOpenPositionProtection(input: {
    symbol: string;
    side: Side;
    quantity: number;
    stopPrice: number;
    takeProfitPrice: number;
  }) {
    if (!this.isExecutionEnabled()) throw new Error("TESTNET_EXECUTION_DISABLED");
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
    const hasTakeProfit = openOrders.some(
      (o) =>
        o.status === "NEW" &&
        (o.closePosition === true || String(o.closePosition).toLowerCase() === "true") &&
        o.type === "TAKE_PROFIT_MARKET" &&
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
    if (!hasTakeProfit) {
      await this.placeCloseProtection(
        symbol,
        closeSide,
        "TAKE_PROFIT_MARKET",
        input.takeProfitPrice,
        baseId + "-TP",
      );
    }

    const verified = await this.getOpenOrders(symbol);
    if (this.getProtectionStatus(verified) !== "OK") {
      throw new Error("TESTNET protection verification failed");
    }

    return { changed: true, protection: "OK" as const };
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
        (o.type === "STOP_MARKET" || o.type === "TAKE_PROFIT_MARKET") &&
        String(o.clientOrderId ?? "").startsWith("DDT-"),
    );
    const hasStop = protections.some((o) => o.type === "STOP_MARKET");
    const hasTakeProfit = protections.some((o) => o.type === "TAKE_PROFIT_MARKET");
    if (hasStop && hasTakeProfit) return "OK";
    if (hasStop || hasTakeProfit) return "PARTIAL";
    return "MISSING";
  }

  private incomePath(type: "REALIZED_PNL" | "COMMISSION") {
    // DealDost is operated in India, so the daily risk window is IST midnight
    // rather than the Vercel runtime's UTC/local timezone.
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(Date.now() + istOffsetMs);
    istNow.setUTCHours(0, 0, 0, 0);
    const startTime = istNow.getTime() - istOffsetMs;
    return "/fapi/v1/income?incomeType=" + type + "&startTime=" + startTime + "&limit=1000";
  }

  private async getRecentOrders(symbol: string): Promise<OrderRow[]> {
    return this.signedGet<OrderRow[]>(
      "/fapi/v1/allOrders?symbol=" + encodeURIComponent(symbol) + "&limit=50",
    );
  }

  private async getOpenOrders(symbol: string): Promise<OrderRow[]> {
    const [normalOrders, algoOrders] = await Promise.all([
      this.signedGet<OrderRow[]>(
        "/fapi/v1/openOrders?symbol=" + encodeURIComponent(symbol),
      ),
      this.signedGet<AlgoOrderRow[]>(
        "/fapi/v1/openAlgoOrders?symbol=" + encodeURIComponent(symbol),
      ),
    ]);

    const normalizedAlgoOrders: OrderRow[] = algoOrders.map((order) => ({
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

    return [...normalOrders, ...normalizedAlgoOrders];
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
      throw new Error("TESTNET symbol not found in exchange info: " + symbol);
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
    const response = await fetch(this.baseUrl + path, {
      signal: AbortSignal.timeout(7000),
      headers: {
        "Accept": "application/json",
        "User-Agent": "DealDost/2.4",
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error("Binance TESTNET public " + response.status + ": " + body.slice(0, 300));
    }
    return JSON.parse(body) as T;
  }

  private async signedGet<T>(path: string): Promise<T> {
    const [pathname, rawQuery = ""] = path.split("?");
    const params = new URLSearchParams(rawQuery);
    params.set("recvWindow", "5000");
    params.set("timestamp", String(Date.now()));
    const signature = createHmac("sha256", config.testnetApiSecret)
      .update(params.toString())
      .digest("hex");
    params.set("signature", signature);

    const response = await fetch(this.baseUrl + pathname + "?" + params.toString(), {
      signal: AbortSignal.timeout(7000),
      headers: {
        "X-MBX-APIKEY": config.testnetApiKey,
        "User-Agent": "DealDost/2.4",
      },
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error("Binance TESTNET " + response.status + ": " + body.slice(0, 300));
    }

    return JSON.parse(body) as T;
  }

  private async signedDelete<T>(path: string, payload: Record<string, string>): Promise<T> {
    const params = new URLSearchParams(
      Object.fromEntries(Object.entries(payload).filter(([, value]) => value)),
    );
    params.set("recvWindow", "5000");
    params.set("timestamp", String(Date.now()));

    const signature = createHmac("sha256", config.testnetApiSecret)
      .update(params.toString())
      .digest("hex");
    params.set("signature", signature);

    const response = await fetch(this.baseUrl + path + "?" + params.toString(), {
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "X-MBX-APIKEY": config.testnetApiKey,
        "User-Agent": "DealDost/2.4",
      },
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error("Binance TESTNET " + response.status + ": " + body.slice(0, 300));
    }
    return JSON.parse(body) as T;
  }

  private async signedPost<T>(path: string, payload: Record<string, string>): Promise<T> {
    const params = new URLSearchParams(payload);
    params.set("recvWindow", "5000");
    params.set("timestamp", String(Date.now()));

    const signature = createHmac("sha256", config.testnetApiSecret)
      .update(params.toString())
      .digest("hex");
    params.set("signature", signature);

    const response = await fetch(this.baseUrl + path + "?" + params.toString(), {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "X-MBX-APIKEY": config.testnetApiKey,
        "User-Agent": "DealDost/2.4",
      },
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error("Binance TESTNET " + response.status + ": " + body.slice(0, 300));
    }

    return JSON.parse(body) as T;
  }
}
