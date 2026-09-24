export type Engine = "MOMENTUM" | "SCALPING";
export type Side = "LONG" | "SHORT";
export type Stage = "WATCH" | "SETUP" | "CONFIRMED" | "BLOCKED";
export type Regime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "HIGH_VOLATILITY" | "LOW_VOLATILITY" | "NO_TRADE";

export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
}

export interface SymbolState {
  symbol: string;
  quoteVolume24h: number;
  lastPrice: number;
  lastDataAt: number;
  candles: { "1m": Candle[]; "5m": Candle[]; "15m": Candle[] };
}

export interface QualityBreakdown {
  trend: number;
  momentum: number;
  volume: number;
  volatility: number;
  structure: number;
  regime: number;
  total: number;
}

export interface RiskPreview {
  eligible: boolean;
  reason: string;
  entry: number;
  stop: number;
  takeProfit1: number;
  takeProfit2: number;
  riskDistancePct: number;
  riskUsd: number;
  notionalUsd: number;
}

export interface Signal {
  signalId: string;
  symbol: string;
  engine: Engine;
  side: Side;
  stage: Stage;
  quality: QualityBreakdown;
  regime: Regime;
  entry: number;
  stop: number;
  takeProfit1: number;
  takeProfit2: number;
  createdAt: number;
  updatedAt: number;
  rationale: string[];
  risk: RiskPreview;
}

export interface RiskConfig {
  accountBalanceUsd: number;
  riskPerTradePct: number;
  maxDailyRiskPct: number;
  maxTotalPositions: number;
  maxMomentumPositions: number;
  maxScalpingPositions: number;
  cooldownMinutes: number;
}

export interface EngineState {
  open: number;
  max: number;
  status: "READY" | "FULL" | "BLOCKED";
}

export interface PaperPositionView {
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

export interface PaperStateView {
  enabled: boolean;
  auto: boolean;
  startingBalanceUsd: number;
  balanceUsd: number;
  availableBalanceUsd: number;
  reservedMarginUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  feesUsd: number;
  positions: PaperPositionView[];
  history: unknown[];
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface RotationStateView {
  enabled: boolean;
  eventsToday: number;
  totalReleasedUsd: number;
  totalAllocatedUsd: number;
  last: unknown | null;
  events: unknown[];
}

export interface TestnetPositionView {
  symbol: string;
  engine: Engine | null;
  side: Side;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnlUsd: number;
  leverage: number | null;
  openedAt: number;
  protection: "OK" | "PARTIAL" | "MISSING";
  takeProfitPrice: number | null;
  tpManagedByEngine: boolean;
}

export interface TestnetStateView {
  configured: boolean;
  executionEnabled: boolean;
  auto: boolean;
  connected: boolean;
  accountBalanceUsd: number;
  availableBalanceUsd: number;
  unrealizedPnlUsd: number;
  openPositions: number;
  momentumOpen: number;
  scalpingOpen: number;
  unclassifiedOpenPositions: number;
  unprotectedOpenPositions: number;
  dailyRiskUsedPct: number;
  realizedPnlTodayUsd: number;
  feesTodayUsd: number;
  netPnlTodayUsd: number;
  positions: TestnetPositionView[];
  lastSyncAt: number;
  error: string | null;
}

export interface LiveStateView extends TestnetStateView {}

export interface DashboardState {
  mode: "PAPER" | "TESTNET" | "LIVE";
  auto: boolean;
  market: { regime: Regime; btcPrice: number; universeSize: number };
  feed: {
    websocket: "ONLINE" | "CONNECTING" | "RECONNECTING" | "OFFLINE";
    data: "FRESH" | "STALE" | "NO_DATA";
    lastUpdateAt: number;
    reconnects: number;
    error: string | null;
  };
  engines: {
    momentum: EngineState;
    scalping: EngineState;
    totalOpen: number;
    totalMax: number;
  };
  risk: RiskConfig & { dailyRiskUsedPct: number; emergencyStop: boolean };
  paper: PaperStateView;
  testnet: TestnetStateView;
  live: LiveStateView;
  rotation: RotationStateView;
  signals: Signal[];
  updatedAt: number;
}
