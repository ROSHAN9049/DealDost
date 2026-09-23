import { createHmac } from "node:crypto";
import { config } from "./config.js";
import type { TestnetStateView } from "./types.js";

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

export class TestnetClient {
  private readonly baseUrl = config.testnetRestBase;

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
        "User-Agent": "DealDost/2.1",
      },
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error("Binance TESTNET " + response.status + ": " + body.slice(0, 300));
    }

    return JSON.parse(body) as T;
  }
}
