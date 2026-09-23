import { createHmac } from "node:crypto";
import { config } from "./config.js";
import type { Side, TestnetStateView } from "./types.js";

type BalanceRow = {
  asset?: string;
  balance?: string;
  availableBalance?: string;
};

type PositionRow = {
  symbol?: string;
  positionAmt?: string;
  unrealizedProfit?: string;
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
      connected: false,
      accountBalanceUsd: 0,
      availableBalanceUsd: 0,
      unrealizedPnlUsd: 0,
      openPositions: 0,
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

    const usdt = balances.find((row) => row.asset === "USDT");
    const open = positions.filter((row) => Math.abs(Number(row.positionAmt ?? 0)) > 0);
    const unrealizedPnlUsd = open.reduce((sum, row) => sum + Number(row.unrealizedProfit ?? 0), 0);

    return {
      ...base,
      connected: true,
      accountBalanceUsd: Number(usdt?.balance ?? 0),
      availableBalanceUsd: Number(usdt?.availableBalance ?? 0),
      unrealizedPnlUsd,
      openPositions: open.length,
      lastSyncAt: Date.now(),
    };
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
      // Fail closed: if the entry succeeded but protection could not be
      // installed, immediately attempt a market close instead of leaving an
      // unprotected TESTNET position running.
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
    const normalizedPrice = tickSize > 0
      ? this.floorToStep(stopPrice, tickSize)
      : stopPrice;

    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      throw new Error("Invalid protection price for " + symbol);
    }

    return this.signedPost<any>("/fapi/v1/order", {
      symbol,
      side,
      type,
      stopPrice: this.formatNumber(normalizedPrice),
      closePosition: "true",
      workingType: "MARK_PRICE",
      priceProtect: "true",
      newClientOrderId: this.safeClientOrderId(clientOrderId),
    });
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

  private formatNumber(value: number) {
    return Number(value.toFixed(12)).toString();
  }

  private safeClientOrderId(value: string) {
    const cleaned = String(value).replace(/[^A-Za-z0-9_-]/g, "");
    return cleaned.slice(0, 36) || "DDT-" + Date.now().toString(36);
  }

  private async publicGet<T>(path: string): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      signal: AbortSignal.timeout(7000),
      headers: {
        "Accept": "application/json",
        "User-Agent": "DealDost/2.3",
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error("Binance TESTNET public " + response.status + ": " + body.slice(0, 300));
    }
    return JSON.parse(body) as T;
  }

  private async signedGet<T>(path: string): Promise<T> {
    const params = new URLSearchParams({
      recvWindow: "5000",
      timestamp: String(Date.now()),
    });
    const signature = createHmac("sha256", config.testnetApiSecret)
      .update(params.toString())
      .digest("hex");
    params.set("signature", signature);

    const response = await fetch(this.baseUrl + path + "?" + params.toString(), {
      signal: AbortSignal.timeout(7000),
      headers: {
        "X-MBX-APIKEY": config.testnetApiKey,
        "User-Agent": "DealDost/2.3",
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
        "User-Agent": "DealDost/2.3",
      },
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error("Binance TESTNET " + response.status + ": " + body.slice(0, 300));
    }

    return JSON.parse(body) as T;
  }
}
