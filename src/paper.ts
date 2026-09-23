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
  marginReservedUsd: number;
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

  restore(snapshot: Partial<PaperStateView> | null | undefined) {
    if (!snapshot || typeof snapshot !== "object") return;

    const starting = Number(snapshot.startingBalanceUsd);
    const realized = Number(snapshot.realizedPnlUsd);
    const fees = Number(snapshot.feesUsd);

    if (Number.isFinite(starting) && starting > 0 && starting <= this.startingBalance * 2) {
      this.balance = starting + (Number.isFinite(realized) ? realized : 0);
    } else if (Number.isFinite(realized)) {
      this.balance = this.startingBalance + realized;
    }

    if (Number.isFinite(realized)) this.realizedPnl = realized;
    if (Number.isFinite(fees) && fees >= 0) this.fees = fees;
    if (typeof snapshot.auto === "boolean") this.auto = snapshot.auto;

    const positions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
    this.positions.clear();
    for (const raw of positions) {
      const p = raw as Partial<PaperPosition>;
      if (
        typeof p.tradeId !== "string" ||
        typeof p.signalId !== "string" ||
        (p.engine !== "MOMENTUM" && p.engine !== "SCALPING") ||
        (p.side !== "LONG" && p.side !== "SHORT") ||
        typeof p.symbol !== "string" ||
        !Number.isFinite(Number(p.quantity)) ||
        Number(p.quantity) <= 0 ||
        !Number.isFinite(Number(p.entry)) ||
        !Number.isFinite(Number(p.markPrice)) ||
        !Number.isFinite(Number(p.stop)) ||
        !Number.isFinite(Number(p.takeProfit1)) ||
        !Number.isFinite(Number(p.takeProfit2)) ||
        !Number.isFinite(Number(p.marginReservedUsd))
      ) continue;

      this.positions.set(p.symbol.toUpperCase(), {
        tradeId: p.tradeId,
        signalId: p.signalId,
        symbol: p.symbol.toUpperCase(),
        engine: p.engine,
        side: p.side,
        quantity: Number(p.quantity),
        entry: Number(p.entry),
        markPrice: Number(p.markPrice),
        stop: Number(p.stop),
        takeProfit1: Number(p.takeProfit1),
        takeProfit2: Number(p.takeProfit2),
        openedAt: Number.isFinite(Number(p.openedAt)) ? Number(p.openedAt) : Date.now(),
        entryFeeUsd: Number.isFinite(Number(p.entryFeeUsd)) ? Number(p.entryFeeUsd) : 0,
        marginReservedUsd: Number(p.marginReservedUsd),
        grossPnlUsd: Number.isFinite(Number(p.grossPnlUsd)) ? Number(p.grossPnlUsd) : 0,
        netPnlUsd: Number.isFinite(Number(p.netPnlUsd)) ? Number(p.netPnlUsd) : 0,
      });
    }

    const history = Array.isArray(snapshot.history) ? snapshot.history : [];
    this.history = history
      .filter((raw): raw is PaperTrade => {
        const t = raw as Partial<PaperTrade>;
        return typeof t.tradeId === "string" &&
          typeof t.signalId === "string" &&
          typeof t.symbol === "string" &&
          (t.engine === "MOMENTUM" || t.engine === "SCALPING") &&
          (t.side === "LONG" || t.side === "SHORT") &&
          Number.isFinite(Number(t.netPnlUsd)) &&
          Number.isFinite(Number(t.closedAt));
      })
      .slice(-100)
      .map((t) => ({ ...t, symbol: t.symbol.toUpperCase(), rotationId: typeof t.rotationId === "string" ? t.rotationId : null }));

    this.openedSignals = new Set([
      ...this.history.map((t) => t.signalId),
      ...this.positionsList().map((p) => p.signalId),
    ]);
  }

  private reservedMargin() {
    return [...this.positions.values()].reduce((sum, p) => sum + p.marginReservedUsd, 0);
  }

  private availableBalance() {
    return Math.max(0, this.balance - this.reservedMargin());
  }

  snapshot(): PaperStateView {
    const unrealized = [...this.positions.values()].reduce((sum, p) => sum + p.netPnlUsd, 0);
    const wins = this.history.filter((t) => t.netPnlUsd > 0).length;
    const losses = this.history.filter((t) => t.netPnlUsd <= 0).length;

    return {
      enabled: true,
      auto: this.auto,
      startingBalanceUsd: this.startingBalance,
      balanceUsd: this.balance + unrealized,
      availableBalanceUsd: this.availableBalance(),
      reservedMarginUsd: this.reservedMargin(),
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

    // Defense in depth: enforce the V2 3 Momentum + 3 Scalping / 6 total
    // position limits inside the broker itself, not only in the risk layer.
    if (this.positions.size >= config.maxTotalPositions) {
      return { opened: false, reason: "TOTAL_POSITION_LIMIT" };
    }
    const sameEngineOpen = [...this.positions.values()].filter((p) => p.engine === signal.engine).length;
    const engineLimit = signal.engine === "MOMENTUM"
      ? config.maxMomentumPositions
      : config.maxScalpingPositions;
    if (sameEngineOpen >= engineLimit) {
      return { opened: false, reason: signal.engine + "_LIMIT" };
    }

    const stopDistance = Math.abs(signal.entry - signal.stop);
    if (!stopDistance || signal.entry <= 0) return { opened: false, reason: "INVALID_RISK_DISTANCE" };

    const available = this.availableBalance();
    // Keep six-position mode practical even when ATR/stop distance is tiny.
    // With the default 15% cap, six fully-sized positions use at most 90% of
    // the starting account notional, leaving a cash buffer for fees/slippage.
    const maxNotional = this.startingBalance * (config.maxNotionalPctPerTrade / 100);
    const notional = Math.min(
      signal.risk.notionalUsd,
      maxNotional,
      Math.max(0, available * 0.95),
    );
    if (notional <= 0) return { opened: false, reason: "INSUFFICIENT_PAPER_MARGIN" };

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
      marginReservedUsd: notional,
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
