# DealDost Binance Scanner V2

Fresh scanner-first architecture for Binance USDⓈ-M Futures.

Implemented:
- Liquid USDT perpetual universe selection
- Top 50 universe by 24h quote volume after filters
- REST history bootstrap for 1m, 5m and 15m candles
- Live combined WebSocket market feed
- Automatic reconnect and stale-data detection
- Market regime classification
- Momentum and Scalping engines
- WATCH / SETUP / CONFIRMED / BLOCKED stages
- Transparent 0-100 quality score
- Central risk governor
- Maximum 3 Momentum + 3 Scalping + 6 total position slots
- Global symbol lock and cooldown rules
- ATR-aware entry, stop and take-profit preview
- Server-owned scanner state; UI is read-only
- Paper broker with simulated slippage and configurable fees
- Paper position lifecycle with SL/TP/manual close
- Paper P&L, trade history, win rate and fee tracking
- Profit Rotation V3 event ledger
- PAPER / TESTNET / LIVE mode labels
- TESTNET execution adapter with 1x leverage enforcement, exchange filters, minimum-notional checks, protected SL/TP and emergency close
- Exchange-reconciled TESTNET position/engine counting and same-day loss risk gate
- PAPER / TESTNET request-mode routing with LIVE fail-closed lock
- LIVE execution intentionally not wired yet

Paper configuration:
- PAPER_BALANCE_USDT
- PAPER_FEE_BPS
- PAPER_SLIPPAGE_BPS
- PAPER_AUTO

Current execution boundary:
- PAPER is local simulation only.
- TESTNET and LIVE adapters are not enabled in this phase.
- Never put real Binance API keys in the repository.

Binance WebSocket market connections are treated as reconnectable streams, with heartbeat/reconnect handling and stale-data gating.


Testnet phase 1:
- Dedicated Binance Futures Demo/Testnet credentials are read only from environment variables.
- Dashboard can sync testnet USDT balance and open positions without touching PAPER state.
- Testnet execution remains disabled until explicitly enabled and is not wired into PAPER auto-trading.


TESTNET execution phase 2:
- Dashboard can switch between PAPER and TESTNET without connecting LIVE.
- TESTNET AUTO only attempts orders when BINANCE_TESTNET_EXECUTION_ENABLED=true and credentials are configured server-side.
- Before an auto-entry, the scanner reconciles Binance Demo balance, open positions, engine tags, recent exits/cooldowns and same-day realized-loss/commission usage.
- Auto-entry is blocked when any open position is unclassified, total positions reach 6, Momentum reaches 3, Scalping reaches 3, or daily risk reaches 6%.
- Orders are forced to 1x leverage, sized from 1% account risk and available balance, and use exchange-valid quantity/price filters.
- Market entries require protected STOP_MARKET and TAKE_PROFIT_MARKET orders; if protection cannot be installed, the entry is immediately emergency-closed.
- LIVE remains locked and has no order path in V2.
- Because Vercel is serverless, this reconciliation is exchange-authoritative but is not a distributed transactional lock; the system therefore fails closed on missing reconciliation data and should not be treated as an atomic multi-instance position lock.

- TESTNET AUTO accepts only fresh CONFIRMED signals (Scalping <= 90s, Momentum <= 10m) and places at most one new entry per execution cycle.
- Dashboard exposes TESTNET realized PNL and fees for the current IST trading day.
