import type { RotationStateView } from "./types.js";
import type { PaperTrade } from "./paper.js";

export interface RotationEvent {
  rotationId: string;
  createdAt: number;
  sourceTradeId: string;
  sourceProfile?: "PAPER" | "TESTNET" | "LIVE";
  symbol?: string;
  engine?: string;
  side?: string;
  releasedUsd: number;
  allocatedUsd: number;
  retainedUsd: number;
  status: "PLANNED";
}

export interface ExchangeClosedTrade {
  sourceTradeId: string;
  sourceProfile: "TESTNET" | "LIVE";
  symbol: string;
  engine: string;
  side: string;
  netPnlUsd: number;
  closedAt: number;
}

export class ProfitRotationV3 {
  private events: RotationEvent[] = [];
  private sequence = 0;

  private createEvent(input: {
    sourceTradeId: string;
    sourceProfile: "PAPER" | "TESTNET" | "LIVE";
    symbol?: string;
    engine?: string;
    side?: string;
    netPnlUsd: number;
    createdAt: number;
  }): RotationEvent | null {
    if (!(input.netPnlUsd > 0)) return null;

    const existing = this.events.find((event) => event.sourceTradeId === input.sourceTradeId);
    if (existing) return existing;

    const released = input.netPnlUsd;
    const retained = released * 0.10;
    const allocated = released - retained;

    const event: RotationEvent = {
      rotationId: "ROT-" + String(++this.sequence).padStart(4, "0"),
      createdAt: input.createdAt,
      sourceTradeId: input.sourceTradeId,
      sourceProfile: input.sourceProfile,
      symbol: input.symbol,
      engine: input.engine,
      side: input.side,
      releasedUsd: released,
      allocatedUsd: allocated,
      retainedUsd: retained,
      status: "PLANNED",
    };

    this.events.push(event);
    if (this.events.length > 200) this.events.shift();
    return event;
  }

  onClosedTrade(trade: PaperTrade): RotationEvent | null {
    return this.createEvent({
      sourceTradeId: "PAPER:" + trade.tradeId,
      sourceProfile: "PAPER",
      symbol: trade.symbol,
      engine: trade.engine,
      side: trade.side,
      netPnlUsd: trade.netPnlUsd,
      createdAt: trade.closedAt || Date.now(),
    });
  }

  onExchangeClosedTrade(trade: ExchangeClosedTrade): RotationEvent | null {
    return this.createEvent({
      sourceTradeId: trade.sourceTradeId,
      sourceProfile: trade.sourceProfile,
      symbol: trade.symbol,
      engine: trade.engine,
      side: trade.side,
      netPnlUsd: trade.netPnlUsd,
      createdAt: trade.closedAt || Date.now(),
    });
  }

  restore(events: unknown[] | null | undefined) {
    if (!Array.isArray(events)) return;

    this.events = events
      .filter((raw): raw is RotationEvent => {
        const e = raw as Partial<RotationEvent>;
        return typeof e.rotationId === "string" &&
          typeof e.sourceTradeId === "string" &&
          Number.isFinite(Number(e.createdAt)) &&
          Number.isFinite(Number(e.releasedUsd)) &&
          Number.isFinite(Number(e.allocatedUsd)) &&
          Number.isFinite(Number(e.retainedUsd)) &&
          e.status === "PLANNED";
      })
      .slice(-200)
      .map((e) => ({ ...e }));

    this.sequence = this.events.reduce((max, e) => {
      const n = Number(e.rotationId.replace(/^ROT-/, ""));
      return Number.isFinite(n) ? Math.max(n, max) : max;
    }, 0);
  }

  private getIstDateKey(timestamp = Date.now()) {
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    return new Date(timestamp + istOffsetMs).toISOString().slice(0, 10);
  }

  snapshot(): RotationStateView {
    const today = this.getIstDateKey();

    return {
      enabled: true,
      eventsToday: this.events.filter((e) => this.getIstDateKey(e.createdAt) === today).length,
      totalReleasedUsd: this.events.reduce((s, e) => s + e.releasedUsd, 0),
      totalAllocatedUsd: this.events.reduce((s, e) => s + e.allocatedUsd, 0),
      last: this.events.at(-1) ?? null,
      events: [...this.events].reverse().slice(0, 50),
    };
  }
}
