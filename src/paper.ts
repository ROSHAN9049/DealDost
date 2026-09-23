import type { Engine, PaperStateView, Signal, Side } from "./types.js";
import { config } from "./config.js";

export interface PaperPosition {
  tradeId: string;
  signalId: string;
  symbol: string;
  engine: Engine;
  side: Side;
  quantity: number;
  entry: number;
  markPrice: number;
  stop: number;
  takeProfit1: number;
  takeProfit2: number;
  openedAt: number;
  entryFeeUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
}

export interface PaperTrade {
  tradeId: string;
  signalId: string;
  symbol: string;
  engine: Engine;
  side: Side;
  entry: number;
  exit: number;
  quantity: number;
  grossPnlUsd: number;
  feesUsd: number;
  netPnlUsd: number;
  reason: "TP1" | "TP2" | "SL" | "MANUAL";
  openedAt: number;
  closedAt: number;
  rotationId: string | null;
}

export class PaperBroker {
  private readonly feeBps = config.paperFeeBps;
  private readonly slippageBps = config.paperSlippageBps;
  private readonly startingBalance = config.paperBalance;
  private balance = config.paperBalance;
  private realizedPnl = 0;
  private fees = 0;
  private positions = new Map<string, PaperPosition>();
  private history: PaperTrade[] = [];
  private openedSignals = new Set<string>();
  private auto = config.paperAuto;

  setAuto(value: boolean) { this.auto = value; }
  getAuto() { return this.auto; }
  positionsList() { return [...this.positions.values()]; }
  historyList() { return [...this.history]; }

  snapshot(): PaperStateView {
    const unrealized = [...this.positions.values()].reduce((sum, p) => sum + p.netPnlUsd, 0);
    const wins = this.history.filter((t) => t.netPnlUsd > 0).length;
    const losses = this.history.filter((t) => t.netPnlUsd <= 0).length;

    return {
      enabled: true,
      auto: this.auto,
      startingBalanceUsd: this.startingBalance,
      balanceUsd: this.balance + unrealized,
      realizedPnlUsd: this.realizedPnl,
      unrealizedPnlUsd: unrealized,
      feesUsd: this.fees,
      positions: this.positionsList(),
      history: [...this.history].reverse().slice(0, 100),
      tradeCount: this.history.length,
      wins,
      losses,
      winRate: this.history.length ? (wins / this.history.length) * 100 : 0,
    };
  }

  tryOpen(signal: Signal): { opened: boolean; reason: string; position?: PaperPosition } {
    if (!this.auto) return { opened: false, reason: "PAPER_AUTO_OFF" };
    if (signal.stage !== "CONFIRMED") return { opened: false, reason: "SIGNAL_NOT_CONFIRMED" };
    if (!signal.risk.eligible) return { opened: false, reason: signal.risk.reason };
    if (this.positions.has(signal.symbol)) return { opened: false, reason: "SYMBOL_ALREADY_OPEN" };
    if (this.openedSignals.has(signal.signalId)) return { opened: false, reason: "SIGNAL_ALREADY_TRADED" };

    const stopDistance = Math.abs(signal.entry - signal.stop);
    if (!stopDistance || signal.entry <= 0) return { opened: false, reason: "INVALID_RISK_DISTANCE" };

    const notional = Math.min(signal.risk.notionalUsd, Math.max(0, this.balance * 0.95));
    if (notional <= 0) return { opened: false, reason: "INSUFFICIENT_PAPER_BALANCE" };

    const sign = signal.side === "LONG" ? 1 : -1;
    const fillPrice = signal.entry + signal.entry * (this.slippageBps / 10_000) * sign;
    const quantity = notional / fillPrice;
    const entryFee = notional * (this.feeBps / 10_000);

    const position: PaperPosition = {
      tradeId: "P-" + Date.now() + "-" + signal.symbol,
      signalId: signal.signalId,
      symbol: signal.symbol,
      engine: signal.engine,
      side: signal.side,
      quantity,
      entry: fillPrice,
      markPrice: fillPrice,
      stop: signal.stop,
      takeProfit1: signal.takeProfit1,
      takeProfit2: signal.takeProfit2,
      openedAt: Date.now(),
      entryFeeUsd: entryFee,
      grossPnlUsd: 0,
      netPnlUsd: -entryFee,
    };

    this.fees += entryFee;
    this.positions.set(signal.symbol, position);
    this.openedSignals.add(signal.signalId);

    return { opened: true, reason: "PAPER_ENTRY", position };
  }

  mark(symbol: string, price: number) {
    const position = this.positions.get(symbol);
    if (!position || !Number.isFinite(price) || price <= 0) return null;

    position.markPrice = price;
    const priceMove = position.side === "LONG" ? price - position.entry : position.entry - price;
    position.grossPnlUsd = priceMove * position.quantity;

    const exitNotional = Math.abs(price * position.quantity);
    const estimatedExitFee = exitNotional * (this.feeBps / 10_000);
    position.netPnlUsd = position.grossPnlUsd - position.entryFeeUsd - estimatedExitFee;

    const hitTp1 = position.side === "LONG"
      ? price >= position.takeProfit1
      : price <= position.takeProfit1;
    const hitStop = position.side === "LONG"
      ? price <= position.stop
      : price >= position.stop;

    if (hitStop) return this.close(symbol, price, "SL");
    if (hitTp1) return this.close(symbol, price, "TP1");
    return null;
  }

  closeManual(symbol: string) {
    const position = this.positions.get(symbol);
    return position ? this.close(symbol, position.markPrice, "MANUAL") : null;
  }

  private close(symbol: string, requestedExit: number, reason: PaperTrade["reason"]) {
    const position = this.positions.get(symbol);
    if (!position) return null;

    const sign = position.side === "LONG" ? 1 : -1;
    const fillPrice = requestedExit - requestedExit * (this.slippageBps / 10_000) * sign;
    const grossPnl = (position.side === "LONG"
      ? fillPrice - position.entry
      : position.entry - fillPrice) * position.quantity;
    const exitFee = Math.abs(fillPrice * position.quantity) * (this.feeBps / 10_000);
    const totalFees = position.entryFeeUsd + exitFee;
    const netPnl = grossPnl - totalFees;

    this.fees += exitFee;
    this.realizedPnl += netPnl;
    this.balance += netPnl;

    const trade: PaperTrade = {
      tradeId: position.tradeId,
      signalId: position.signalId,
      symbol: position.symbol,
      engine: position.engine,
      side: position.side,
      entry: position.entry,
      exit: fillPrice,
      quantity: position.quantity,
      grossPnlUsd: grossPnl,
      feesUsd: totalFees,
      netPnlUsd: netPnl,
      reason,
      openedAt: position.openedAt,
      closedAt: Date.now(),
      rotationId: null,
    };

    this.history.push(trade);
    this.positions.delete(symbol);
    return trade;
  }
}
