import { config } from "./config.js";
import type { Engine, RiskConfig, Signal } from "./types.js";

export class RiskGovernor {
  readonly cfg: RiskConfig;
  private openPositions = new Map<string, Engine>();
  private cooldowns = new Map<string, number>();
  private dailyRiskUsedPct = 0;
  private riskDate = new Date().toDateString();
  private emergencyStop = false;

  constructor() {
    this.cfg = {
      accountBalanceUsd: config.paperBalance,
      riskPerTradePct: config.riskPerTradePct,
      maxDailyRiskPct: config.maxDailyRiskPct,
      maxTotalPositions: config.maxTotalPositions,
      maxMomentumPositions: config.maxMomentumPositions,
      maxScalpingPositions: config.maxScalpingPositions,
      cooldownMinutes: config.cooldownMinutes,
    };
  }

  setEmergencyStop(value: boolean) {
    this.emergencyStop = value;
  }

  private resetDailyRiskIfNeeded() {
    const today = new Date().toDateString();
    if (today !== this.riskDate) {
      this.riskDate = today;
      this.dailyRiskUsedPct = 0;
    }
  }

  snapshot() {
    this.resetDailyRiskIfNeeded();

    let momentum = 0;
    let scalping = 0;
    for (const engine of this.openPositions.values()) {
      if (engine === "MOMENTUM") momentum += 1;
      else scalping += 1;
    }

    return {
      dailyRiskUsedPct: this.dailyRiskUsedPct,
      emergencyStop: this.emergencyStop,
      momentum,
      scalping,
      total: this.openPositions.size,
    };
  }

  canOpen(symbol: string, engine: Engine): { eligible: boolean; reason: string } {
    this.resetDailyRiskIfNeeded();

    if (this.emergencyStop) return { eligible: false, reason: "EMERGENCY_STOP" };
    if (this.openPositions.has(symbol)) return { eligible: false, reason: "SYMBOL_LOCKED" };

    const cooldownUntil = this.cooldowns.get(symbol) ?? 0;
    if (cooldownUntil > Date.now()) return { eligible: false, reason: "COOLDOWN" };

    const s = this.snapshot();
    if (s.total >= this.cfg.maxTotalPositions) return { eligible: false, reason: "TOTAL_POSITION_LIMIT" };
    if (engine === "MOMENTUM" && s.momentum >= this.cfg.maxMomentumPositions) {
      return { eligible: false, reason: "MOMENTUM_LIMIT" };
    }
    if (engine === "SCALPING" && s.scalping >= this.cfg.maxScalpingPositions) {
      return { eligible: false, reason: "SCALPING_LIMIT" };
    }
    if (s.dailyRiskUsedPct >= this.cfg.maxDailyRiskPct) {
      return { eligible: false, reason: "DAILY_RISK_LIMIT" };
    }

    return { eligible: true, reason: "RISK_GATE_PASS" };
  }

  recordTradeResult(netPnlUsd: number) {
    this.resetDailyRiskIfNeeded();
    if (netPnlUsd < 0 && this.cfg.accountBalanceUsd > 0) {
      this.dailyRiskUsedPct += (Math.abs(netPnlUsd) / this.cfg.accountBalanceUsd) * 100;
    }
  }

  preview(signal: Pick<Signal, "symbol" | "engine" | "side" | "entry" | "stop" | "takeProfit1" | "takeProfit2">): Signal["risk"] {
    const gate = this.canOpen(signal.symbol, signal.engine);
    const riskUsd = this.cfg.accountBalanceUsd * (this.cfg.riskPerTradePct / 100);
    const riskDistance = Math.abs(signal.entry - signal.stop);
    const riskDistancePct = signal.entry ? (riskDistance / signal.entry) * 100 : 0;
    const notionalUsd = riskDistance > 0 ? riskUsd * (signal.entry / riskDistance) : 0;

    return {
      eligible: gate.eligible,
      reason: gate.reason,
      entry: signal.entry,
      stop: signal.stop,
      takeProfit1: signal.takeProfit1,
      takeProfit2: signal.takeProfit2,
      riskDistancePct,
      riskUsd,
      notionalUsd,
    };
  }

  registerOpen(symbol: string, engine: Engine) {
    this.openPositions.set(symbol, engine);
  }

  registerClose(symbol: string, netPnlUsd = 0) {
    this.openPositions.delete(symbol);
    this.cooldowns.set(symbol, Date.now() + this.cfg.cooldownMinutes * 60_000);
    this.recordTradeResult(netPnlUsd);
  }
}
