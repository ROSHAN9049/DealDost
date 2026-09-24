import type { RotationStateView } from "./types.js";
import type { PaperTrade } from "./paper.js";

export interface RotationEvent {
  rotationId: string;
  createdAt: number;
  sourceTradeId: string;
  releasedUsd: number;
  allocatedUsd: number;
  retainedUsd: number;
  status: "PLANNED";
}

export class ProfitRotationV3 {
  private events: RotationEvent[] = [];
  private sequence = 0;

  onClosedTrade(trade: PaperTrade): RotationEvent | null {
    if (trade.netPnlUsd <= 0) return null;

    const released = trade.netPnlUsd;
    const retained = released * 0.10;
    const allocated = released - retained;

    const event: RotationEvent = {
      rotationId: "ROT-" + String(++this.sequence).padStart(4, "0"),
      createdAt: Date.now(),
      sourceTradeId: trade.tradeId,
      releasedUsd: released,
      allocatedUsd: allocated,
      retainedUsd: retained,
      status: "PLANNED",
    };

    this.events.push(event);
    if (this.events.length > 100) this.events.shift();
    return event;
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
      .slice(-100)
      .map((e) => ({ ...e }));

    this.sequence = this.events.reduce((max, e) => {
      const n = Number(e.rotationId.replace(/^ROT-/, ""));
      return Number.isFinite(n) ? Math.max(max, n) : max;
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
