import "dotenv/config";

const n = (key: string, fallback: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
};

const bool = (key: string, fallback: boolean) => {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
};

export const config = {
  port: n("PORT", 3000),
  restBase: process.env.BINANCE_REST_BASE ?? "https://fapi.binance.com",
  wsBase: process.env.BINANCE_WS_BASE ?? "wss://fstream.binance.com/stream",
  universeSize: n("UNIVERSE_SIZE", 50),
  minQuoteVolume: n("MIN_24H_QUOTE_VOLUME_USDT", 10_000_000),
  paperBalance: n("PAPER_BALANCE_USDT", 1000),
  paperFeeBps: n("PAPER_FEE_BPS", 5),
  paperSlippageBps: n("PAPER_SLIPPAGE_BPS", 2),
  paperAuto: bool("PAPER_AUTO", false),
  riskPerTradePct: n("RISK_PER_TRADE_PCT", 1),
  maxDailyRiskPct: n("MAX_DAILY_RISK_PCT", 6),
  maxTotalPositions: n("MAX_TOTAL_POSITIONS", 6),
  maxMomentumPositions: n("MAX_MOMENTUM_POSITIONS", 3),
  maxScalpingPositions: n("MAX_SCALPING_POSITIONS", 3),
  cooldownMinutes: n("COOLDOWN_MINUTES", 15),
  minConfirmedScore: n("MIN_CONFIRMED_SCORE", 75),
};
