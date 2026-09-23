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
  restFallbackBases: (process.env.BINANCE_REST_FALLBACK_BASES ?? "https://fapi1.binance.com,https://fapi2.binance.com,https://fapi3.binance.com")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  wsBase: process.env.BINANCE_WS_BASE ?? "wss://fstream.binance.com/stream",
  testnetRestBase: (process.env.BINANCE_TESTNET_REST_BASE ?? "https://demo-fapi.binance.com").replace(/\/+$/, ""),
  testnetApiKey: process.env.BINANCE_TESTNET_API_KEY ?? "",
  testnetApiSecret: process.env.BINANCE_TESTNET_API_SECRET ?? "",
  testnetExecutionEnabled: bool("BINANCE_TESTNET_EXECUTION_ENABLED", false),
  universeSize: n("UNIVERSE_SIZE", 50),
  minQuoteVolume: n("MIN_24H_QUOTE_VOLUME_USDT", 10_000_000),
  paperBalance: n("PAPER_BALANCE_USDT", 1000),
  paperFeeBps: n("PAPER_FEE_BPS", 5),
  paperSlippageBps: n("PAPER_SLIPPAGE_BPS", 2),
  paperAuto: bool("PAPER_AUTO", false),
  testnetRiskPerTradePct: n("TESTNET_RISK_PER_TRADE_PCT", 1),
  testnetMaxDailyRiskPct: n("TESTNET_MAX_DAILY_RISK_PCT", 6),
  testnetMaxTotalPositions: n("TESTNET_MAX_TOTAL_POSITIONS", 6),
  testnetMaxMomentumPositions: n("TESTNET_MAX_MOMENTUM_POSITIONS", 3),
  testnetMaxScalpingPositions: n("TESTNET_MAX_SCALPING_POSITIONS", 3),
  riskPerTradePct: n("RISK_PER_TRADE_PCT", 1),
  maxDailyRiskPct: n("MAX_DAILY_RISK_PCT", 6),
  maxTotalPositions: n("MAX_TOTAL_POSITIONS", 6),
  maxMomentumPositions: n("MAX_MOMENTUM_POSITIONS", 3),
  maxScalpingPositions: n("MAX_SCALPING_POSITIONS", 3),
  cooldownMinutes: n("COOLDOWN_MINUTES", 15),
  minConfirmedScore: n("MIN_CONFIRMED_SCORE", 75),
};
