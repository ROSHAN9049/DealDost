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

  snapshot(): RotationStateView {
    const today = new Date().toDateString();

    return {
      enabled: true,
      eventsToday: this.events.filter((e) => new Date(e.createdAt).toDateString() === today).length,
      totalReleasedUsd: this.events.reduce((s, e) => s + e.releasedUsd, 0),
      totalAllocatedUsd: this.events.reduce((s, e) => s + e.allocatedUsd, 0),
      last: this.events.at(-1) ?? null,
      events: [...this.events].reverse().slice(0, 50),
    };
  }
}
