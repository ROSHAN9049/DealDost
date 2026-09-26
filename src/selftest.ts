import assert from "node:assert/strict";
import { PaperBroker } from "./paper.js";
import { RiskGovernor } from "./risk.js";
import type { Signal } from "./types.js";

const makeSignal = (index: number, engine: "MOMENTUM" | "SCALPING"): Signal => {
  const symbol = "T" + String(index).padStart(2, "0") + "USDT";
  const entry = 100;
  const stop = engine === "MOMENTUM" ? 99 : 99.5;
  const tp1 = engine === "MOMENTUM" ? 101.5 : 100.8;
  return {
    signalId: "SELFTEST-" + engine + "-" + symbol,
    symbol,
    engine,
    side: "LONG",
    stage: "CONFIRMED",
    quality: {
      trend: 20,
      momentum: 20,
      volume: 15,
      volatility: 15,
      structure: 15,
      regime: 15,
      total: 95,
    },
    regime: "TREND_UP",
    entry,
    stop,
    takeProfit1: tp1,
    takeProfit2: tp1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rationale: ["self-test"],
    risk: {
      eligible: true,
      reason: "RISK_GATE_PASS",
      entry,
      stop,
      takeProfit1: tp1,
      takeProfit2: tp1,
      riskDistancePct: engine === "MOMENTUM" ? 1 : 0.5,
      riskUsd: 10,
      notionalUsd: engine === "MOMENTUM" ? 1000 : 500,
    },
  };
};

const risk = new RiskGovernor();
for (let i = 0; i < 3; i += 1) {
  const symbol = "RM" + i + "USDT";
  assert.equal(risk.canOpen(symbol, "MOMENTUM").eligible, true);
  risk.registerOpen(symbol, "MOMENTUM");
}
assert.equal(risk.canOpen("RM3USDT", "MOMENTUM").reason, "MOMENTUM_LIMIT");

for (let i = 0; i < 3; i += 1) {
  const symbol = "RS" + i + "USDT";
  assert.equal(risk.canOpen(symbol, "SCALPING").eligible, true);
  risk.registerOpen(symbol, "SCALPING");
}
assert.equal(risk.canOpen("RMXUSDT", "MOMENTUM").reason, "TOTAL_POSITION_LIMIT");

risk.registerClose("RM0USDT", -10);
assert.equal(risk.canOpen("RM0USDT", "MOMENTUM").reason, "COOLDOWN");

risk.setEmergencyStop(true);
assert.equal(risk.canOpen("NEWUSDT", "MOMENTUM").reason, "EMERGENCY_STOP");

const paper = new PaperBroker();
paper.setAuto(true);

const paperSignals = [
  makeSignal(1, "MOMENTUM"),
  makeSignal(2, "MOMENTUM"),
  makeSignal(3, "MOMENTUM"),
  makeSignal(4, "SCALPING"),
  makeSignal(5, "SCALPING"),
  makeSignal(6, "SCALPING"),
];

for (const signal of paperSignals) {
  const result = paper.tryOpen(signal);
  assert.equal(result.opened, true, signal.symbol + " should open");
}

assert.equal(paper.positionsList().length, 6);
assert.equal(paper.positionsList().filter((p) => p.engine === "MOMENTUM").length, 3);
assert.equal(paper.positionsList().filter((p) => p.engine === "SCALPING").length, 3);

const seventh = paper.tryOpen(makeSignal(7, "SCALPING"));
assert.equal(seventh.opened, false);
assert.match(seventh.reason, /POSITION_LIMIT|LIMIT/);

const duplicate = paper.tryOpen(paperSignals[0]);
assert.equal(duplicate.opened, false);
assert.equal(duplicate.reason, "SYMBOL_ALREADY_OPEN");

console.log("DealDost self-test PASS • 6-position hard cap • 3+3 engine caps • cooldown • emergency stop • duplicate guard");
